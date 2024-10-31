import { ChainId, isEVMChain } from '@certusone/wormhole-sdk';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers6';
import { CHAIN_ID_BSC, CHAIN_ID_SOLANA, WhChainIdToEvm, WORMHOLE_DECIMALS } from './config/chains';
import { RpcConfig } from './config/rpc';
import { Token } from './config/tokens';
import { WalletConfig } from './config/wallet';
import { driverConfig } from './driver.conf';
import { SwapRouters } from './driver/routers';
import { appendLoss, maxLossPerSwapUSD, removeLoss } from './loss-tracker';
import { Swap } from './swap.dto';
import { getErc20Balance } from './utils/erc20';
import { EvmProviders } from './utils/evm-providers';
import { SwiftCosts } from './utils/fees';
import logger from './utils/logger';

export class AuctionFulfillerConfig {
	private readonly bidAggressionPercent = driverConfig.bidAggressionPercent;
	private readonly fulfillAggressionPercent = driverConfig.fulfillAggressionPercent;
	private readonly forceBid = true;

	constructor(
		private readonly rpcConfig: RpcConfig,
		private readonly connection: Connection,
		private readonly evmProviders: EvmProviders,
		private readonly walletConfig: WalletConfig,
		private readonly swapRouters: SwapRouters,
	) {}

	async normalizedBidAmount(
		driverToken: Token,
		effectiveAmountIn: number,
		swap: Swap,
		costs: SwiftCosts,
	): Promise<bigint> {
		const balance = await this.getTokenBalance(driverToken);
		if (balance < effectiveAmountIn) {
			throw new Error(`Insufficient balance for ${swap.sourceTxHash}. Dropping bid`);
		} else {
			logger.info(`Balance is ${balance} for ${swap.sourceTxHash}`);
		}

		if (swap.fromAmount.toNumber() * costs.fromTokenPrice > driverConfig.volumeLimitUsd) {
			throw new Error(`Volume limit exceeded for ${swap.sourceTxHash} and dropping bid`);
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
			);
		}
		let output = Number(output64) / 10 ** swap.toToken.decimals;

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
		const minAmountNeededForFulfill64 = realMinAmountOut + (realMinAmountOut * bpsFees) / 10000n;
		const minAmountNeededForFulfill = Number(minAmountNeededForFulfill64) / 10 ** swap.toToken.decimals;

		const mappedMinAmountIn = minAmountNeededForFulfill * (effectiveAmountIn / output);
		const mappedBpsAmountIn = (swap.fromAmount.toNumber() * Number(bpsFees)) / 10000; // upper estimate

		if (mappedMinAmountIn > effectiveAmountIn - mappedBpsAmountIn) {
			logger.warn(
				`AuctionFulfillerConfig.normalizedBidAmount: mappedMinAmountIn > effectiveAmountIn ${mappedMinAmountIn} > ${effectiveAmountIn}`,
			);
			throw new Error(`mappedMinAmountIn > effectiveAmountIn for ${swap.sourceTxHash}`);
		}

		const bidAggressionPercent = this.bidAggressionPercent; // 0 - 100

		const profitMargin = effectiveAmountIn - mappedBpsAmountIn;

		const marginFinalBidIn = mappedMinAmountIn + (profitMargin * bidAggressionPercent) / 100 - mappedBpsAmountIn;
		const marginAmountOut = (marginFinalBidIn * Number(output)) / effectiveAmountIn;

		const finalFullAmountIn = 0.98 * (effectiveAmountIn - mappedBpsAmountIn);
		const fullMappedAmountOut = (finalFullAmountIn * Number(output)) / effectiveAmountIn; // 20 bps test for now

		const mappedAmountOut = Math.max(marginAmountOut, fullMappedAmountOut);
		swap.bidAmountIn = Math.max(marginFinalBidIn, finalFullAmountIn) + mappedBpsAmountIn;
		let normalizedAmountOut;
		if (swap.toToken.decimals > 8) {
			normalizedAmountOut = BigInt(Math.floor(mappedAmountOut * 10 ** 8));
		} else {
			normalizedAmountOut = BigInt(Math.floor(mappedAmountOut * 10 ** swap.toToken.decimals));
		}

		if (normalizedAmountOut < normalizedMinAmountOut && this.forceBid) {
			logger.warn(`normalizedBidAmount is less than minAmountOut`);
			normalizedAmountOut = normalizedMinAmountOut;
			swap.bidAmountIn = mappedMinAmountIn;
		}

		return normalizedAmountOut;
	}

	async getEvmEquivalentOutput(
		destChain: number,
		driverToken: Token,
		effectiveAmountInDriverToken: number,
		normalizedMinAmountOut: bigint,
		toToken: Token,
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
				true,
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

	async fulfillAmount(driverToken: Token, effectiveAmountIn: number, swap: Swap, costs: SwiftCosts): Promise<number> {
		if (swap.fromAmount.toNumber() * costs.fromTokenPrice > driverConfig.volumeLimitUsd) {
			throw new Error(`Volume limit exceeded for ${swap.sourceTxHash} and dropping fulfill`);
		}

		if (
			swap.sourceChain === CHAIN_ID_BSC &&
			swap.fromTokenAddress === '0x55d398326f99059ff775485246999027b3197955'
		) {
			effectiveAmountIn = effectiveAmountIn / 1.0019;
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
			);
		}
		let output = Number(output64) / 10 ** swap.toToken.decimals;

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
		const minAmountNeededForFulfill64 = realMinAmountOut + (realMinAmountOut * bpsFees) / 10000n;
		const minAmountNeededForFulfill = Number(minAmountNeededForFulfill64) / 10 ** swap.toToken.decimals;

		const mappedMinAmountIn = minAmountNeededForFulfill * (effectiveAmountIn / output);

		if (!swap.bidAmountIn) {
			if (swap.bidAmount64) {
				const bidOut = Number(swap.bidAmount64) / 10 ** Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS);
				swap.bidAmountIn = 1.000001 * bidOut * (effectiveAmountIn / output);
			}
		}

		const minFulfillAmount = Math.max(mappedMinAmountIn, swap.bidAmountIn || 0);
		if (minFulfillAmount > effectiveAmountIn) {
			if (swap.lastloss && swap.lastloss > 0) {
				removeLoss(swap.lastloss);
			}
			const lossAmountUsd = costs.fromTokenPrice * (minFulfillAmount - effectiveAmountIn);

			if (lossAmountUsd > maxLossPerSwapUSD) {
				logger.warn(
					`AuctionFulfillerConfig.normalizedBidAmount: mappedMinAmountIn > effectiveAmountIn ${minFulfillAmount} > ${effectiveAmountIn}`,
				);
				throw new Error(`mappedMinAmountIn > effectiveAmountIn for ${swap.sourceTxHash}`);
			}

			logger.info(`Loss of ${lossAmountUsd} USD is going to be appended for ${swap.sourceTxHash}`);
			appendLoss(lossAmountUsd);
			swap.lastloss = lossAmountUsd;
			effectiveAmountIn = minFulfillAmount * 1.0001;
		}

		const aggressionPercent = this.fulfillAggressionPercent; // 0 - 100

		const profitMargin = effectiveAmountIn - mappedMinAmountIn;

		const finalAmountIn = mappedMinAmountIn + (profitMargin * aggressionPercent) / 100;

		return Math.max(finalAmountIn * (1 - 3 / 10000), mappedMinAmountIn * 1.00001);
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

	private async getTokenBalance(token: Token): Promise<number> {
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
		} else if (isEVMChain(token.wChainId as ChainId)) {
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
