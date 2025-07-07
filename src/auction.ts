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
	private readonly getEvmQuoteCache = this.cache.wrap(this.getEvmEquivalentOutput.bind(this), 3000);
	private readonly getSolanaQuoteCache = this.cache.wrap(this.getSolanaEquivalentOutput.bind(this), 3000);

	constructor(
		private readonly gConf: GlobalConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly connection: Connection,
		private readonly evmProviders: EvmProviders,
		private readonly walletConfig: WalletConfig,
		private readonly swapRouters: SwapRouters,
		private readonly tokenList: TokenList,
		private readonly rebalancer: Rebalancer,
		private readonly auctionListener: AuctionListener,
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
		const balance = await this.getTokenBalance(driverToken);
		let balanceWithRebalance = balance;
		if (this.gConf.isRebalancerEnabled && context.isDstChainValidForRebalance && context.isDriverTokenUSDC) {
			try {
				balanceWithRebalance = balance + Math.max(await this.rebalancer.fetchSuiUsdcBalance(), MIN_PULL_AMOUNT);
			} catch (error) {
				logger.error(`Error fetching solana usdc balance ${error}`);
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

		if (
			swap.sourceChain === CHAIN_ID_BSC &&
			swap.fromTokenAddress === '0x55d398326f99059ff775485246999027b3197955'
		) {
			effectiveAmountIn = this.normalizeUsdtIfRequired(effectiveAmountIn);
		}

		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);
		let minAmountOutNum = Number(normalizedMinAmountOut) / 10 ** Math.min(WORMHOLE_DECIMALS, swap.toToken.decimals);

		let output64: bigint;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			output64 = await this.getSolanaQuoteCache(
				driverToken,
				effectiveAmountIn,
				swap.toToken,
				{
					key: `getSolanaEquivalentOutput-${swap.sourceTxHash}`,
				}
			);
		} else {
			output64 = await this.getEvmQuoteCache(
				swap.destChain,
				driverToken,
				effectiveAmountIn,
				normalizedMinAmountOut,
				swap.toToken,
				swap.retries,
				{
					key: `getEvmEquivalentOutput-${swap.sourceTxHash}`,
				}
			);
		}
		let output = Number(output64) / 10 ** swap.toToken.decimals;

		if (costs.fromTokenPrice && costs.toTokenPrice) {
			const priceRatio = costs.fromTokenPrice / costs.toTokenPrice;
			if (output / effectiveAmountIn > priceRatio * 1) {
				const guardedOutput = priceRatio * effectiveAmountIn * 1;
				output = guardedOutput;
				logger.warn(
					`Oracle price differs 2.5% from aggregator. limiting bid to price for ${swap.sourceTxHash}`,
				);
			}
		}
		if (output > minAmountOutNum * 1.1) {
			const guardedOutput = minAmountOutNum * 1.1;
			output = guardedOutput;
			logger.warn(
				`Output is too much more than minAmountOut. limiting bid to minAmountOut * 1.1 for ${swap.sourceTxHash}`,
			);
		}

		logger.info(
			`in bid : output: ${output} for effectiveAmountIn: ${effectiveAmountIn} for swap ${swap.sourceTxHash}`,
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
		const minAmountNeededForFulfill64 = (userMinAmountOut * 10000n) / (10000n - bpsFees) + 1n;
		const minAmountNeededForFulfill = Number(minAmountNeededForFulfill64) / 10 ** swap.toToken.decimals;

		let minFulfillAmountIn;
		if (swap.minAmountOut64 === 0n) {
			minFulfillAmountIn = 0;
		} else {
			minFulfillAmountIn = minAmountNeededForFulfill * (effectiveAmountIn / output);
		}

		if (minFulfillAmountIn > effectiveAmountIn * 1.0003) {
			logger.warn(
				`Auction.normalizedBidAmount: mappedMinAmountIn > effectiveAmountIn ${minFulfillAmountIn} > ${effectiveAmountIn} for ${swap.sourceTxHash}`,
			);
			throw new Error(`mappedMinAmountIn > effectiveAmountIn for ${swap.sourceTxHash}`);
			// continute anyway to bid min  amount out
		}

		let bidBpsMargin = 1.3; // 1.5 bps for swap
		if (swap.toToken.contract === driverToken.contract) {
			bidBpsMargin = 0.9; // 1 bps if no swap is included
		} else if (!swap.toToken.pythUsdPriceId) {
			bidBpsMargin = 45; // 50 bps if no pyth price id (probably meme coin,...)
		}
		const fulfillAmountInWithProfit =
			(1 - bidBpsMargin / 10000) * effectiveAmountIn * (1 - Number(bpsFees) / 10000);
		const bidAmountWithProfit = (fulfillAmountInWithProfit * Number(output)) / effectiveAmountIn;
		const bidAmount64WithProfit =
			BigInt(Math.floor(bidAmountWithProfit * 10 ** Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS))) + 1n;

		let normalizedBidAmount;
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
			logger.info(`in bid: normalizedBidAmount ${normalizedBidAmount} is less than lastBid ${lastBid} for swap ${swap.sourceTxHash}`);
			throw new Error(`normalizedBidAmount ${normalizedBidAmount} is less than lastBid ${lastBid} for swap ${swap.sourceTxHash}`);
		}

		if (auctionState?.isClosed) {
			logger.info(`in bid: auctionState is closed for swap ${swap.sourceTxHash}`);
			throw new Error(`auctionState is closed for swap ${swap.sourceTxHash}`);
		}

		// if (lastBid && lastBid < normalizedBidAmount && lastBid > 0n) {
		// 	normalizedBidAmount = lastBid + 5n;
		// }

		// if (lastBidFromAuctionListener && lastBidFromAuctionListener < normalizedBidAmount && lastBidFromAuctionListener > 0n) {
		// 	normalizedBidAmount = lastBidFromAuctionListener + 5n;
		// }

		swap.bidAmountIn = Number(normalizedBidAmount + 1n) * effectiveAmountIn / output / 10 ** Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
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

	async fulfillAmount(driverToken: Token, effectiveAmountIn: number, swap: Swap, costs: SwiftCosts): Promise<number> {
		checkPaidLossWithinRange(swap.sourceTxHash);

		if (swap.fromAmount.toNumber() * costs.fromTokenPrice > driverConfig.volumeLimitUsd) {
			throw new Error(`Volume limit exceeded for ${swap.sourceTxHash} and dropping fulfill`);
		}

		if (
			swap.sourceChain === CHAIN_ID_BSC &&
			swap.fromTokenAddress === '0x55d398326f99059ff775485246999027b3197955'
		) {
			effectiveAmountIn = this.normalizeUsdtIfRequired(effectiveAmountIn);
		}

		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);

		let output64: bigint;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			output64 = await this.getSolanaEquivalentOutput(driverToken, effectiveAmountIn, swap.toToken);
		} else {
			output64 = await this.getEvmEquivalentOutput(
				swap.destChain,
				driverToken,
				effectiveAmountIn,
				normalizedMinAmountOut,
				swap.toToken,
				swap.retries,
			);
		}
		let output = Number(output64) / 10 ** swap.toToken.decimals;

		logger.info(
			`in fulfil: output: ${output} for effectiveAmountIn: ${effectiveAmountIn} for swap ${swap.sourceTxHash}`,
		);

		const bpsFees = await this.calcProtocolAndRefBps(
			swap.fromAmount64,
			swap.fromToken,
			swap.toToken,
			swap.destChain,
			swap.referrerBps,
		);
		const realMinAmountOut =
			swap.toToken.decimals > 8
				? normalizedMinAmountOut * BigInt(10 ** (swap.toToken.decimals - 8))
				: normalizedMinAmountOut;
		const minAmountNeededForFulfill64 = Number(realMinAmountOut) / (1 - Number(bpsFees) / 10000);
		const minAmountNeededForFulfill = (1.000001 * minAmountNeededForFulfill64) / 10 ** swap.toToken.decimals;

		let mappedMinAmountIn;
		if (swap.minAmountOut64 === 0n) {
			mappedMinAmountIn = 0;
		} else {
			mappedMinAmountIn = minAmountNeededForFulfill * (effectiveAmountIn / output);
		}

		logger.info(`mappedMinAmountIn ${mappedMinAmountIn} for swap ${swap.sourceTxHash}`);

		if (!swap.bidAmountIn) {
			logger.info(`swap.bidAmountIn is not set for swap ${swap.sourceTxHash}`);
			if (swap.bidAmount64) {
				const bidOut = Number(swap.bidAmount64) / 10 ** Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
				swap.bidAmountIn = (1.000001 * bidOut * (effectiveAmountIn / output)) / (1 - Number(bpsFees) / 10000);
			}
		}

		logger.info(`bidAmountIn ${swap.bidAmountIn} for swap ${swap.sourceTxHash}`);

		const minFulfillAmount = Math.max(mappedMinAmountIn, swap.bidAmountIn || 0);
		logger.info(`minFulfillAmount ${minFulfillAmount} for swap ${swap.sourceTxHash}`);
		// for simple mode without auction, do not pay any loss
		if (swap.auctionMode === AUCTION_MODES.ENGLISH && (minFulfillAmount > effectiveAmountIn || swap.retries > 1)) {
			if (swap.lastloss && swap.lastloss > 0) {
				removeLoss(swap.lastloss);
			}

			let perRetryAddedLossUsd = 0;
			if (driverToken.contract !== swap.toToken.contract) {
				perRetryAddedLossUsd = this.perRetryMinAvailableLossUSD[swap.invalidAmountRetires];
			}

			let lossAmountUsd =
				perRetryAddedLossUsd + costs.fromTokenPrice * Math.max(minFulfillAmount - effectiveAmountIn, 0);

			if (lossAmountUsd > maxLossPerSwapUSD) {
				logger.warn(`Max loss filled can not for ${minFulfillAmount} > ${effectiveAmountIn}`);
				alertForLossReach('perSwapLoss', `Max loss filled for one swap pls check ${swap.sourceTxHash}`);
				throw new Error(`max per-swap loss filled (need ${lossAmountUsd})  for  ${swap.sourceTxHash}`);
			}

			if (lossAmountUsd > costs.fromTokenPrice * effectiveAmountIn * 0.1) {
				logger.info(
					`MAX10 capped for ${swap.sourceTxHash},  ${lossAmountUsd} loss reduced to ${costs.fromTokenPrice * effectiveAmountIn * 0.1}`,
				);
				throw Error(`Would not fulfill because capped loss ${swap.sourceTxHash}`);
			}

			logger.info(`Loss of ${lossAmountUsd} USD is going to be appended for ${swap.sourceTxHash}`);
			appendLoss(lossAmountUsd);
			swap.lastloss = lossAmountUsd;

			// we need a safeguard to prevent divison by small values in case we get wrong prices from server, ...
			const minPrices = {
				usdc: 0.9,
				eth: 2500,
			};
			let safeFromTokenPriceForAddedLoss = costs.fromTokenPrice;
			if (
				driverToken.contract === ethers.ZeroAddress ||
				driverToken.contract === '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs' // weth sol
			) {
				// eth
				safeFromTokenPriceForAddedLoss = Math.max(minPrices.eth, costs.fromTokenPrice);
			} else {
				safeFromTokenPriceForAddedLoss = Math.max(minPrices.usdc, costs.fromTokenPrice);
			}

			effectiveAmountIn =
				Math.max(effectiveAmountIn, minFulfillAmount * 1.000001) +
				perRetryAddedLossUsd / safeFromTokenPriceForAddedLoss;
		} else if (minFulfillAmount > effectiveAmountIn) {
			throw new Error(`Insufficient effective amount in for ${swap.sourceTxHash}. dropping fulfill`);
		}

		const aggressionPercent = this.fulfillAggressionPercent; // 0 - 100

		const profitMargin = effectiveAmountIn - mappedMinAmountIn;

		let finalAmountIn = mappedMinAmountIn + (profitMargin * aggressionPercent) / 100;
		if (finalAmountIn * (1 - 3.1 / 10000) > minFulfillAmount) {
			finalAmountIn = finalAmountIn * (1 - 3 / 10000);
		}

		return Math.max(finalAmountIn, minFulfillAmount * 1.000001);
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

	async getTokenBalance(token: Token): Promise<number> {
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
}
