import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers6';
import { CHAIN_ID_BSC, CHAIN_ID_SOLANA, isEvmChainId, WORMHOLE_DECIMALS } from './config/chains';
import { RpcConfig } from './config/rpc';
import { Token, TokenList } from './config/tokens';
import { WalletConfig } from './config/wallet';
import { driverConfig } from './driver.conf';
import { SwapRouters } from './driver/routers';
import { alertForLossReach, appendLoss, checkPaidLossWithinRange, maxLossPerSwapUSD, removeLoss } from './loss-tracker';
import { Swap } from './swap.dto';
import { getErc20Balance } from './utils/erc20';
import { EvmProviders } from './utils/evm-providers';
import { SwiftCosts } from './utils/fees';
import logger from './utils/logger';
import { AUCTION_MODES } from './utils/state-parser';
import { MIN_PULL_AMOUNT, Rebalancer } from './rebalancer';
import { createRebalance, DB_PATH } from './utils/sqlite3';
import { GlobalConfig } from './config/global';
import { SimpleCache } from './cache';
import { AuctionListener } from './auction-listener';
import { FutureManager } from './future-manager';
export class AuctionFulfillerConfig {
	private readonly bidAggressionPercent = driverConfig.bidAggressionPercent;
	private readonly fulfillAggressionPercent = driverConfig.fulfillAggressionPercent;

	private readonly perRetryMinAvailableLossUSD: { [x: number]: number } = {
		0: 0.05,
		1: 0.1,
		2: 0.2,
		3: 0.5,
		4: 1,
		5: 5,
		6: 10,
	};
	private readonly forceBid = false;

	private readonly cache = new SimpleCache();
	private readonly getEvmQuoteCache = this.cache.wrap(this.getEvmEquivalentOutput.bind(this), 5000);
	private readonly getSolanaQuoteCache = this.cache.wrap(this.getSolanaEquivalentOutput.bind(this), 5000);

	constructor(
		private readonly gConf: GlobalConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly connection: Connection,
		private readonly evmProviders: EvmProviders,
		private readonly walletConfig: WalletConfig,
		private readonly swapRouters: SwapRouters,
		private readonly tokenList: TokenList,
		private readonly rebalancer: Rebalancer,
		public readonly auctionListener: AuctionListener,
		private readonly futureManager: FutureManager,
	) { }

	async normalizedBidAmount(
		driverToken: Token,
		effectiveAmountIn: number,
		swap: Swap,
		costs: SwiftCosts,
		context: {
			isDriverTokenUSDC: boolean,
			isDstChainValidForRebalance: boolean,
		},
		lastBid?: bigint,
	): Promise<bigint> {
		let balance;
		try {
			balance = await this.futureManager.await(this.getTokenBalanceFutureManagerKey(driverToken));
		} catch (e) {
			balance = await this.getTokenBalanceFuture(driverToken);
		}

		let balanceWithRebalance = balance;
		if (this.gConf.isRebalancerEnabled && context.isDstChainValidForRebalance && context.isDriverTokenUSDC) {
			try {
				balanceWithRebalance = balance + Math.max(await this.rebalancer.fetchSuiUsdcBalance(), MIN_PULL_AMOUNT);
			} catch (error) {
				logger.error(`Error fetching sui usdc balance ${error}`);
				balanceWithRebalance = balance;
			}
		}

		if (balanceWithRebalance < effectiveAmountIn) {
			throw new Error(`Insufficient 1x balance for ${swap.sourceTxHash}. Dropping bid`);
		} else if (balance >= effectiveAmountIn) {
			logger.info(`Balance is ${balance} for ${swap.sourceTxHash}`);
		} else {
			const normalThreshold = Number((await this.rebalancer.getChainConfig(swap.destChain)).normal_threshold) / 10 ** 6;
			const rebalanceAmount = Math.max(effectiveAmountIn - balance + 5 + normalThreshold, MIN_PULL_AMOUNT);
			if ((await this.rebalancer.checkFeasibility(swap.destChain, rebalanceAmount, swap.orderId)).feasible) {
				createRebalance(DB_PATH, swap.orderId, rebalanceAmount);
				logger.info(`Balance is ${balance} and After pull from Solana is ${balanceWithRebalance} for ${swap.sourceTxHash} which is enough for bid`);
			} else {
				throw new Error(`Insufficient 1x balance for ${swap.sourceTxHash}. Dropping bid`);
			}
		}

		if (swap.fromAmount.toNumber() * costs.fromTokenPrice > driverConfig.volumeLimitUsd) {
			throw new Error(`Volume limit exceeded for ${swap.sourceTxHash} and dropping bid`);
		}

		let normalizedEffectiveAmountIn = effectiveAmountIn;
		if (
			swap.sourceChain === CHAIN_ID_BSC &&
			swap.fromTokenAddress === '0x55d398326f99059ff775485246999027b3197955'
		) {
			normalizedEffectiveAmountIn = this.normalizeUsdtIfRequired(effectiveAmountIn);
		}

		// Convert normalized amount to BigInt
		const normalizedEffectiveAmountInBigInt = BigInt(Math.floor(normalizedEffectiveAmountIn * 10 ** driverToken.decimals));

		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);
		const minAmountOutDecimals = Math.min(WORMHOLE_DECIMALS, swap.toToken.decimals);

		let output64: bigint;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			output64 = await this.getSolanaQuoteCache(
				driverToken,
				normalizedEffectiveAmountIn,
				swap.toToken,
				{
					key: `getSolanaEquivalentOutput-${swap.sourceTxHash}`,
				}
			);
		} else {
			output64 = await this.getEvmQuoteCache(
				swap.destChain,
				driverToken,
				normalizedEffectiveAmountIn,
				normalizedMinAmountOut,
				swap.toToken,
				swap.retries,
				{
					key: `getEvmEquivalentOutput-${swap.sourceTxHash}`,
				}
			);
		}

		// Price guard using integer arithmetic
		if (costs.fromTokenPrice && costs.toTokenPrice) {
			// Convert prices to integers (multiply by 1e8 for precision)
			const fromPriceInt = BigInt(Math.floor(costs.fromTokenPrice * 1e8));
			const toPriceInt = BigInt(Math.floor(costs.toTokenPrice * 1e8));

			// Calculate price ratio: fromPrice / toPrice
			const priceRatioNumerator = fromPriceInt * BigInt(10 ** swap.toToken.decimals);
			const priceRatioDenominator = toPriceInt * BigInt(10 ** driverToken.decimals);

			// Check if output/effectiveAmountIn > priceRatio * 1.0
			// output64 / normalizedEffectiveAmountInBigInt > priceRatioNumerator / priceRatioDenominator
			// Cross multiply: output64 * priceRatioDenominator > normalizedEffectiveAmountInBigInt * priceRatioNumerator
			if (output64 * priceRatioDenominator > normalizedEffectiveAmountInBigInt * priceRatioNumerator) {
				// Guard output to priceRatio * effectiveAmountIn
				output64 = (normalizedEffectiveAmountInBigInt * priceRatioNumerator) / priceRatioDenominator;
				logger.warn(
					`Oracle price differs 2.5% from aggregator. limiting bid to price for ${swap.sourceTxHash}`,
				);
			}
		}

		// Check if output > minAmountOut * 1.1 using integer arithmetic
		const minAmountOutScaled = normalizedMinAmountOut * BigInt(10 ** (swap.toToken.decimals - minAmountOutDecimals));
		const maxAllowedOutput = (minAmountOutScaled * 11n) / 10n; // 1.1 times

		if (output64 > maxAllowedOutput) {
			output64 = maxAllowedOutput;
			logger.info(
				`Output is too much more than minAmountOut. limiting bid to minAmountOut * 1.1 for ${swap.sourceTxHash}`,
			);
		}

		const outputNumber = Number(output64) / 10 ** swap.toToken.decimals;
		logger.info(
			`in bid : output: ${outputNumber} for effectiveAmountIn: ${normalizedEffectiveAmountIn} for swap ${swap.sourceTxHash}`,
		);

		const bpsFees = await this.calcProtocolAndRefBps(
			swap.fromAmount64,
			swap.fromToken,
			swap.toToken,
			swap.destChain,
			swap.referrerBps,
		);

		const userMinAmountOut =
			swap.toToken.decimals > 8
				? normalizedMinAmountOut * BigInt(10 ** (swap.toToken.decimals - 8))
				: normalizedMinAmountOut;

		const minAmountNeededForFulfill64 = (userMinAmountOut * 10000n) / (10000n - bpsFees);

		// Calculate minFulfillAmountIn using integer arithmetic
		let minFulfillAmountInBigInt: bigint;
		if (swap.minAmountOut64 === 0n) {
			minFulfillAmountInBigInt = 0n;
		} else {
			// minAmountNeededForFulfill * (effectiveAmountIn / output)
			// = minAmountNeededForFulfill64 * normalizedEffectiveAmountInBigInt / output64
			minFulfillAmountInBigInt = (minAmountNeededForFulfill64 * normalizedEffectiveAmountInBigInt) / output64;
		}

		// Check if minFulfillAmountIn > effectiveAmountIn * 1.0003 using integer arithmetic
		const maxAllowedFulfillAmount = (normalizedEffectiveAmountInBigInt * 10003n) / 10000n; // 1.0003 times
		if (minFulfillAmountInBigInt > maxAllowedFulfillAmount) {
			const minFulfillAmountInNumber = Number(minFulfillAmountInBigInt) / 10 ** driverToken.decimals;
			logger.warn(
				`Auction.normalizedBidAmount: mappedMinAmountIn > effectiveAmountIn ${minFulfillAmountInNumber} > ${normalizedEffectiveAmountIn} for ${swap.sourceTxHash}`,
			);
			throw new Error(`mappedMinAmountIn > effectiveAmountIn for ${swap.sourceTxHash}`);
		}

		const bidBpsMargin = this.getBpsMargin(driverToken, swap);
		const bidBpsMarginBigInt = BigInt(Math.floor(bidBpsMargin * 100)); // Convert to basis points in BigInt

		// Calculate fulfillAmountInWithProfit using integer arithmetic
		// (1 - bidBpsMargin / 10000) * effectiveAmountIn * (1 - bpsFees / 10000)
		const fulfillAmountInWithProfit = (normalizedEffectiveAmountInBigInt * (1000000n - bidBpsMarginBigInt) * (10000n - bpsFees)) / (1000000n * 10000n);

		// Calculate bidAmountWithProfit using integer arithmetic
		// (fulfillAmountInWithProfit * output64) / normalizedEffectiveAmountInBigInt
		const bidAmountWithProfitBigInt = (fulfillAmountInWithProfit * output64) / normalizedEffectiveAmountInBigInt;

		logger.info(`[BID] bidBpsMargin ${bidBpsMargin} | fulfillAmountInWithProfit ${fulfillAmountInWithProfit} | bidAmountWithProfitBigInt ${bidAmountWithProfitBigInt} for swap ${swap.sourceTxHash}`);

		// Convert to normalized decimals (WORMHOLE_DECIMALS or token decimals)
		const targetDecimals = Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
		const bidAmount64WithProfit = (bidAmountWithProfitBigInt * BigInt(10 ** targetDecimals)) / BigInt(10 ** swap.toToken.decimals);

		let normalizedBidAmount: bigint;
		if (bidAmount64WithProfit > normalizedMinAmountOut) {
			normalizedBidAmount = bidAmount64WithProfit;
		} else {
			normalizedBidAmount = normalizedMinAmountOut;
		}

		// get last bid from auction listener
		const auctionState = await this.auctionListener.getAuctionState(swap.auctionStateAddr);
		const lastBidFromAuctionListener = auctionState?.amountPromised;

		if ((lastBidFromAuctionListener && normalizedBidAmount <= lastBidFromAuctionListener) || (lastBid && normalizedBidAmount <= lastBid)) {
			this.cache.remove(`getEvmEquivalentOutput-${swap.sourceTxHash}`);
			this.cache.remove(`getSolanaEquivalentOutput-${swap.sourceTxHash}`);
			let bidAmount = lastBidFromAuctionListener || lastBid;
			logger.info(`in bid: normalizedBidAmount ${normalizedBidAmount} is less than lastBid ${bidAmount} for swap ${swap.sourceTxHash}`);
			throw new Error(`normalizedBidAmount ${normalizedBidAmount} is less than lastBid ${bidAmount} for swap ${swap.sourceTxHash}`);
		}

		if (auctionState?.isClosed) {
			logger.info(`in bid: auctionState is closed for swap ${swap.sourceTxHash}`);
			throw new Error(`auctionState is closed for swap ${swap.sourceTxHash}`);
		}

		///// Bidding war logic
		let changed = false;
		if (lastBidFromAuctionListener && normalizedBidAmount > lastBidFromAuctionListener) {
			normalizedBidAmount = lastBidFromAuctionListener + (normalizedBidAmount - lastBidFromAuctionListener) / 10n + 1n;
			changed = true
		}

		if (lastBid && normalizedBidAmount > lastBid) {
			normalizedBidAmount = lastBid + (normalizedBidAmount - lastBid) / 10n + 1n;
			changed = true;
		}

		if (auctionState) {
			logger.info(`saw auctionState ${auctionState.winner} for swap ${auctionState.orderId}-${swap.sourceTxHash} with lastBid ${auctionState.amountPromised}`);
		}

		if (!changed) {
			normalizedBidAmount = normalizedMinAmountOut + 1n;
		}
		///// Bidding war logic end

		// Calculate bidAmountIn using integer arithmetic
		// bidAmountIn = normalizedBidAmount * effectiveAmountIn / output / 10^decimals / (1 - bpsFees/10000)
		const bidAmountInNumerator = normalizedBidAmount * normalizedEffectiveAmountInBigInt * 10000n;
		const bidAmountInDenominator = output64 * BigInt(10 ** targetDecimals) * (10000n - bpsFees);
		swap.bidAmountIn = Number(bidAmountInNumerator / bidAmountInDenominator) / 10 ** driverToken.decimals;

		logger.info(`in bid: bidAmountIn ${swap.bidAmountIn} for swap ${swap.sourceTxHash}`);
		logger.info(`in bid: normalizedBidAmount ${normalizedBidAmount} for swap ${swap.sourceTxHash}`);

		return normalizedBidAmount;
	}

	async getEvmEquivalentOutput(
		destChain: number,
		driverToken: Token,
		effectiveAmountInDriverToken: number,
		normalizedMinAmountOut: bigint,
		toToken: Token,
		swapRetries: number,
	): Promise<bigint> {
		let output: bigint;
		if (driverToken.contract === toToken.contract) {
			output = BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals));
		} else {
			const quoteRes = await this.swapRouters.getQuote(
				{
					whChainId: destChain,
					srcToken: driverToken.contract,
					destToken: toToken.contract,
					amountIn: BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)).toString(),
					timeout: 2000,
				},
				swapRetries,
				3,
			);

			if (!quoteRes) {
				throw new Error('1inch quote for bid in swift failed');
			}

			output = BigInt(Math.floor(Number(quoteRes.toAmount)));
		}

		return output;
	}

	async getSolanaEquivalentOutput(
		driverToken: Token,
		effectiveAmountInDriverToken: number,
		toToken: Token,
	): Promise<bigint> {
		let output: bigint;
		if (driverToken.contract === toToken.contract) {
			output = BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals));
		} else {
			const quoteRes = await this.getJupQuoteWithRetry(
				BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)),
				driverToken.mint,
				toToken.mint,
				0.1, // 10%
			);

			if (!quoteRes || !quoteRes.raw) {
				throw new Error('jupiter quote for bid in swift failed');
			}

			output = BigInt(Math.floor(Number(quoteRes.expectedAmountOut)));
		}

		return output;
	}

	private normalizeUsdtIfRequired(effectiveAmountIn: number) {
		let usdtToUsdc = this.tokenList.getLatestUsdtToUsdcPrice();
		if (usdtToUsdc) {
			let safeUsdtToUsdc = Math.min(1.003, usdtToUsdc);
			// 10 bps + ratio
			return effectiveAmountIn * 0.999 * safeUsdtToUsdc;
		}
		return effectiveAmountIn / 1.002;
	}

	private getBpsMargin(driverToken: Token, swap: Swap): number {
		let bidBpsMargin = 1.3; // 1.5 bps for swap
		if (swap.toToken.contract === driverToken.contract) {
			bidBpsMargin = 0.9; // 1 bps if no swap is included
		} else if (!swap.toToken.pythUsdPriceId) {
			bidBpsMargin = 40; // 50 bps if no pyth price id (probably meme coin,...)
		}
		return bidBpsMargin;
	}

	/**
	 * Calculates the fulfillment amount using integer arithmetic to prevent floating point precision errors.
	 * This method is critical for accurate financial calculations and must maintain precision throughout.
	 * 
	 * @param driverToken - The token used by the driver for fulfillment
	 * @param effectiveAmountIn - The effective amount in (will be converted to BigInt for precision)
	 * @param swap - The swap details containing all necessary information
	 * @param costs - Swift costs including token prices
	 * @returns Promise<number> - The final fulfillment amount
	 */
	async fulfillAmount(driverToken: Token, effectiveAmountIn: number, swap: Swap, costs: SwiftCosts): Promise<number> {
		checkPaidLossWithinRange(swap.sourceTxHash);

		// Volume limit check - keep as floating point for now as it's a configuration check
		if (swap.fromAmount.toNumber() * costs.fromTokenPrice > driverConfig.volumeLimitUsd) {
			throw new Error(`Volume limit exceeded for ${swap.sourceTxHash} and dropping fulfill`);
		}

		// Convert effectiveAmountIn to precise integer representation
		// This prevents all subsequent floating point arithmetic errors
		let normalizedEffectiveAmountIn = effectiveAmountIn;
		if (
			swap.sourceChain === CHAIN_ID_BSC &&
			swap.fromTokenAddress === '0x55d398326f99059ff775485246999027b3197955'
		) {
			normalizedEffectiveAmountIn = this.normalizeUsdtIfRequired(effectiveAmountIn);
		}

		// Convert to BigInt for all subsequent calculations
		// Use driver token decimals to maintain full precision
		const effectiveAmountInBigInt = BigInt(Math.floor(normalizedEffectiveAmountIn * 10 ** driverToken.decimals));

		// Overflow protection: Check if the conversion was successful
		if (effectiveAmountInBigInt <= 0n) {
			throw new Error(`Invalid effective amount conversion for ${swap.sourceTxHash}: ${normalizedEffectiveAmountIn}`);
		}

		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);

		// Get quote output in precise BigInt format
		let output64: bigint;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			output64 = await this.getSolanaEquivalentOutput(driverToken, normalizedEffectiveAmountIn, swap.toToken);
		} else {
			output64 = await this.getEvmEquivalentOutput(
				swap.destChain,
				driverToken,
				normalizedEffectiveAmountIn,
				normalizedMinAmountOut,
				swap.toToken,
				swap.retries,
			);
		}

		// Overflow protection: Ensure output64 is valid
		if (output64 <= 0n) {
			throw new Error(`Invalid output amount from quote for ${swap.sourceTxHash}: ${output64}`);
		}

		// Only convert to number for logging purposes
		const outputNumber = Number(output64) / 10 ** swap.toToken.decimals;
		logger.info(
			`in fulfil: output: ${outputNumber} for effectiveAmountIn: ${normalizedEffectiveAmountIn} for swap ${swap.sourceTxHash}`,
		);

		// Calculate protocol and referrer fees
		const bpsFees = await this.calcProtocolAndRefBps(
			swap.fromAmount64,
			swap.fromToken,
			swap.toToken,
			swap.destChain,
			swap.referrerBps,
		);

		// Calculate real minimum amount out with proper decimal handling
		const realMinAmountOut =
			swap.toToken.decimals > 8
				? normalizedMinAmountOut * BigInt(10 ** (swap.toToken.decimals - 8))
				: normalizedMinAmountOut;

		// Calculate minimum amount needed for fulfillment using integer arithmetic
		// Formula: realMinAmountOut / (1 - bpsFees/10000)
		// Rearranged: (realMinAmountOut * 10000) / (10000 - bpsFees)
		const minAmountNeededForFulfill64BigInt = (realMinAmountOut * 10000n) / (10000n - bpsFees);

		// Calculate mapped minimum amount in using integer arithmetic
		// Formula: minAmountNeededForFulfill * (effectiveAmountIn / output)
		// Rearranged: (minAmountNeededForFulfill64BigInt * effectiveAmountInBigInt) / output64
		let mappedMinAmountInBigInt: bigint;
		if (swap.minAmountOut64 === 0n) {
			mappedMinAmountInBigInt = 0n;
		} else {
			// Overflow protection: Check for potential overflow in multiplication
			const maxSafeMultiplier = (2n ** 256n - 1n) / minAmountNeededForFulfill64BigInt;
			if (effectiveAmountInBigInt > maxSafeMultiplier) {
				throw new Error(`Potential overflow in mappedMinAmountIn calculation for ${swap.sourceTxHash}`);
			}

			mappedMinAmountInBigInt = (minAmountNeededForFulfill64BigInt * effectiveAmountInBigInt) / output64;
		}

		// Convert to number for logging (using driver token decimals)
		const mappedMinAmountInNumber = Number(mappedMinAmountInBigInt) / 10 ** driverToken.decimals;
		logger.info(`mappedMinAmountIn ${mappedMinAmountInNumber} for swap ${swap.sourceTxHash}`);

		// Calculate bidAmountIn if not set, using integer arithmetic
		let bidAmountInBigInt = 0n;
		if (!swap.bidAmountIn) {
			logger.info(`swap.bidAmountIn is not set for swap ${swap.sourceTxHash}`);
			if (swap.bidAmount64) {
				// Convert bid amount to driver token decimals
				const targetDecimals = Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
				const bidOut64 = swap.bidAmount64 * BigInt(10 ** (swap.toToken.decimals - targetDecimals));

				// Calculate bid amount in using exact arithmetic
				// Formula: (bidOut * effectiveAmountIn / output) / (1 - bpsFees/10000)
				const bidAmountInNumerator = bidOut64 * effectiveAmountInBigInt * 10000n;
				const bidAmountInDenominator = output64 * (10000n - bpsFees);

				bidAmountInBigInt = bidAmountInNumerator / bidAmountInDenominator;
				swap.bidAmountIn = Number(bidAmountInBigInt) / 10 ** driverToken.decimals;
			}
		} else {
			// Convert existing bidAmountIn to BigInt
			bidAmountInBigInt = BigInt(Math.floor(swap.bidAmountIn * 10 ** driverToken.decimals));
		}

		logger.info(`bidAmountIn ${swap.bidAmountIn} for swap ${swap.sourceTxHash}`);

		// Calculate minimum fulfill amount using integer arithmetic
		const minFulfillAmountBigInt = bidAmountInBigInt > mappedMinAmountInBigInt ? bidAmountInBigInt : mappedMinAmountInBigInt;
		const minFulfillAmountNumber = Number(minFulfillAmountBigInt) / 10 ** driverToken.decimals;
		logger.info(`minFulfillAmount ${minFulfillAmountNumber} for swap ${swap.sourceTxHash}`);

		// Handle loss calculation for English auctions when amount is insufficient
		let adjustedEffectiveAmountInBigInt = effectiveAmountInBigInt;

		if (swap.auctionMode === AUCTION_MODES.ENGLISH && (minFulfillAmountBigInt > effectiveAmountInBigInt || swap.retries > 1)) {
			// Remove previous loss if exists
			if (swap.lastloss && swap.lastloss > 0) {
				removeLoss(swap.lastloss);
			}

			// Calculate per-retry loss
			let perRetryAddedLossUsd = 0;
			if (driverToken.contract !== swap.toToken.contract) {
				perRetryAddedLossUsd = this.perRetryMinAvailableLossUSD[swap.invalidAmountRetires] || 0;
			}

			// Calculate loss amount using integer arithmetic where possible
			const deficitBigInt = minFulfillAmountBigInt > effectiveAmountInBigInt ?
				minFulfillAmountBigInt - effectiveAmountInBigInt : 0n;
			const deficitNumber = Number(deficitBigInt) / 10 ** driverToken.decimals;

			let lossAmountUsd = perRetryAddedLossUsd + costs.fromTokenPrice * deficitNumber;

			// Loss limit checks
			if (lossAmountUsd > maxLossPerSwapUSD) {
				logger.warn(`Max loss filled can not for ${minFulfillAmountNumber} > ${normalizedEffectiveAmountIn}`);
				alertForLossReach('perSwapLoss', `Max loss filled for one swap pls check ${swap.sourceTxHash}`);
				throw new Error(`max per-swap loss filled (need ${lossAmountUsd}) for ${swap.sourceTxHash}`);
			}

			// 10% cap check
			const maxLossUsd = costs.fromTokenPrice * normalizedEffectiveAmountIn * 0.1;
			if (lossAmountUsd > maxLossUsd) {
				logger.info(
					`MAX10 capped for ${swap.sourceTxHash}, ${lossAmountUsd} loss reduced to ${maxLossUsd}`,
				);
				throw Error(`Would not fulfill because capped loss ${swap.sourceTxHash}`);
			}

			logger.info(`Loss of ${lossAmountUsd} USD is going to be appended for ${swap.sourceTxHash}`);
			appendLoss(lossAmountUsd);
			swap.lastloss = lossAmountUsd;

			// Calculate safe price for added loss with minimum price guards
			const minPrices = {
				usdc: 0.9,
				eth: 2500,
			};
			let safeFromTokenPriceForAddedLoss = costs.fromTokenPrice;
			if (
				driverToken.contract === ethers.ZeroAddress ||
				driverToken.contract === '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs' // weth sol
			) {
				// ETH price guard
				safeFromTokenPriceForAddedLoss = Math.max(minPrices.eth, costs.fromTokenPrice);
			} else {
				// USDC price guard
				safeFromTokenPriceForAddedLoss = Math.max(minPrices.usdc, costs.fromTokenPrice);
			}

			// Adjust effective amount with loss compensation using integer arithmetic
			// Formula: max(effectiveAmountIn, minFulfillAmount) + perRetryAddedLossUsd / safePrice
			const baseAmount = effectiveAmountInBigInt > minFulfillAmountBigInt ? effectiveAmountInBigInt : minFulfillAmountBigInt;

			// Convert loss compensation to BigInt
			const lossCompensation = perRetryAddedLossUsd / safeFromTokenPriceForAddedLoss;
			const lossCompensationBigInt = BigInt(Math.floor(lossCompensation * 10 ** driverToken.decimals));

			// Overflow protection for addition
			const maxSafeAmount = (2n ** 256n - 1n) - lossCompensationBigInt;
			if (baseAmount > maxSafeAmount) {
				throw new Error(`Potential overflow in loss compensation calculation for ${swap.sourceTxHash}`);
			}

			adjustedEffectiveAmountInBigInt = baseAmount + lossCompensationBigInt;
		} else if (minFulfillAmountBigInt > effectiveAmountInBigInt) {
			throw new Error(`Insufficient effective amount in for ${swap.sourceTxHash}. dropping fulfill`);
		}

		// Calculate final amount using the same logic as normalizedBidAmount
		const bidBpsMargin = this.getBpsMargin(driverToken, swap);
		const bidBpsMarginBigInt = BigInt(Math.floor(bidBpsMargin * 100)); // Convert to basis points

		// Use the same calculation approach as normalizedBidAmount for consistency
		// Calculate fulfillAmountInWithProfit - apply only profit margin to driver input
		// Fees are applied to output tokens, not input tokens
		const fulfillAmountInWithProfit = (adjustedEffectiveAmountInBigInt * (1000000n - bidBpsMarginBigInt)) / 1000000n;

		// Calculate the corresponding output amount (what user would receive)
		const fulfillOutputAmount = (fulfillAmountInWithProfit * output64) / adjustedEffectiveAmountInBigInt;

		// Convert to normalized decimals for comparison with bid
		const targetDecimals = Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
		const fulfillOutputNormalized = (fulfillOutputAmount * BigInt(10 ** targetDecimals)) / BigInt(10 ** swap.toToken.decimals);

		// Calculate the amount driver needs to provide (including fees)
		let finalAmountInBigInt: bigint;

		if (swap.bidAmount64 && swap.bidAmount64 > 0n && fulfillOutputNormalized > swap.bidAmount64) {
			// We promised a specific amount to the user, so calculate the driver amount needed
			// to deliver exactly that amount after fees are deducted
			const promisedOutputInDestDecimals = swap.toToken.decimals > targetDecimals ?
				swap.bidAmount64 * BigInt(10 ** (swap.toToken.decimals - targetDecimals)) :
				swap.bidAmount64;

			// Calculate driver amount needed: driverAmount = userAmount / (1 - fees/10000)
			// Rearranged: driverAmount = (userAmount * 10000) / (10000 - fees)
			const driverAmountNeededForPromise = (promisedOutputInDestDecimals * 10000n) / (10000n - bpsFees);

			// Convert this back to driver token input amount
			finalAmountInBigInt = (driverAmountNeededForPromise * adjustedEffectiveAmountInBigInt) / output64;
		} else {
			finalAmountInBigInt = fulfillAmountInWithProfit;
		}

		// Ensure minimum amount is met exactly
		if (finalAmountInBigInt < minFulfillAmountBigInt) {
			finalAmountInBigInt = minFulfillAmountBigInt;
		}

		// Final overflow protection before conversion
		if (finalAmountInBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
			logger.warn(`Final amount too large for safe conversion: ${finalAmountInBigInt} for ${swap.sourceTxHash}`);
		}

		// Convert back to number with full precision
		const finalAmount = Number(finalAmountInBigInt) / 10 ** driverToken.decimals;

		// Sanity check: ensure final amount is positive and reasonable
		if (finalAmount <= 0 || !isFinite(finalAmount)) {
			throw new Error(`Invalid final amount calculated: ${finalAmount} for ${swap.sourceTxHash}`);
		}

		return finalAmount;
	}

	private async getJupQuoteWithRetry(
		amountIn: bigint,
		fromMint: string,
		toMint: string,
		slippage: number,
		retry: number = 10,
	): Promise<any> {
		let res;
		do {
			try {
				let params: any = {
					inputMint: fromMint,
					outputMint: toMint,
					slippageBps: slippage * 10000,
					maxAccounts: 64 - 7, // 7 accounts reserved for other instructions
					amount: amountIn,
				};
				if (!!this.rpcConfig.jupExcludedDexes) {
					params['excludeDexes'] = this.rpcConfig.jupExcludedDexes;
				}
				if (!!this.rpcConfig.jupApiKey) {
					params['token'] = this.rpcConfig.jupApiKey;
				}
				const { data } = await axios.get(`${this.rpcConfig.jupV6Endpoint}/quote`, {
					params: params,
				});
				res = data;
			} catch (err) {
				logger.warn(`error in fetch jupiter ${err} try ${retry}`);
			} finally {
				retry--;
			}
		} while ((!res || !res.outAmount) && retry > 0);

		if (!res) {
			logger.error(`juptier quote failed ${fromMint} ${toMint} ${amountIn}`);
			return null;
		}

		return {
			effectiveAmountIn: res.inAmount,
			expectedAmountOut: res.outAmount,
			priceImpact: res.priceImpactPct,
			minAmountOut: res.otherAmountThreshold,
			route: [],
			raw: res,
		};
	}

	private async calcProtocolAndRefBps(
		amountIn: bigint,
		tokenIn: Token,
		tokenOut: Token,
		destChain: number,
		referrerBps: number,
	): Promise<bigint> {
		if (referrerBps > 3) {
			return BigInt(referrerBps * 2);
		} else {
			return BigInt(3 + referrerBps);
		}
	}

	async getTokenBalanceFuture(token: Token): Promise<number> {
		if (token.wChainId === CHAIN_ID_SOLANA) {
			if (token.contract === ethers.ZeroAddress) {
				const balance = await this.connection.getBalance(this.walletConfig.solana.publicKey);
				return balance / 10 ** 9;
			} else {
				const ataKey = getAssociatedTokenAddressSync(
					new PublicKey(token.contract),
					this.walletConfig.solana.publicKey,
					false,
					token.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
				);
				const balance = await this.connection.getTokenAccountBalance(ataKey);
				return balance?.value?.uiAmount || 0;
			}
		} else if (isEvmChainId(+token.wChainId!)) {
			if (token.contract === ethers.ZeroAddress) {
				const balance = await this.evmProviders[token.wChainId!].getBalance(this.walletConfig.evm.address);
				return Number(balance) / 10 ** 18;
			} else {
				const balance64 = await getErc20Balance(
					this.evmProviders[token.wChainId!],
					token.contract,
					this.walletConfig.evm.address,
				);
				return Number(balance64) / 10 ** token.decimals;
			}
		} else {
			throw new Error(`Unsupported chain ${token.wChainId}`);
		}
	}

	getTokenBalanceFutureManagerKey(token: Token): string {
		return `auction-fulfiller-token-balance-${token.contract}-${token.wChainId}`;
	}
}
