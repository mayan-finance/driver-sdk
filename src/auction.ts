import axios from 'axios';
import { CHAIN_ID_SOLANA, WhChainIdToEvm } from './config/chains';
import { RpcConfig } from './config/rpc';
import { Token } from './config/tokens';
import { driverConfig } from './driver.conf';
import { get1InchQuote } from './driver/routers';
import { Swap } from './swap.dto';
import { SwiftCosts } from './utils/fees';
import logger from './utils/logger';

export class AuctionFulfillerConfig {
	private readonly bidAggressionPercent = driverConfig.bidAggressionPercent; // 1% above approximated available profit
	private readonly fulfillProfitPercent = driverConfig.fulfillProfitPercent; // 0.1% of approximated available profit
	private readonly forceBid = true;

	constructor(private readonly rpcConfig: RpcConfig) {}

	async normalizedBidAmount(
		driverToken: Token,
		effectiveAmountIn: number,
		swap: Swap,
		expenses: SwiftCosts,
	): Promise<bigint> {
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

		const profitMargin = effectiveAmountIn - mappedMinAmountIn - mappedBpsAmountIn;

		const finalAmountIn = mappedMinAmountIn + (profitMargin * bidAggressionPercent) / 100;

		const mappedAmountOut = (finalAmountIn * Number(output)) / effectiveAmountIn;
		let normalizedAmountOut;
		if (swap.toToken.decimals > 8) {
			normalizedAmountOut = BigInt(Math.floor(mappedAmountOut * 10 ** 8));
		} else {
			normalizedAmountOut = BigInt(Math.floor(mappedAmountOut * 10 ** swap.toToken.decimals));
		}

		if (normalizedAmountOut < normalizedMinAmountOut && this.forceBid) {
			logger.warn(`normalizedBidAmount is less than minAmountOut`);
			normalizedAmountOut = normalizedMinAmountOut;
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
			const quoteRes = await get1InchQuote(
				{
					realChainId: WhChainIdToEvm[destChain],
					srcToken: driverToken.contract,
					destToken: toToken.contract,
					amountIn: BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)).toString(),
					timeout: 2000,
				},
				this.rpcConfig.oneInchApiKey,
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

	async fulfillAmount(
		driverToken: Token,
		effectiveAmountIn: number,
		swap: Swap,
		costDetails: SwiftCosts,
	): Promise<number> {
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

		const profitPercent = this.fulfillProfitPercent; // 0 - 100

		const profitMargin = effectiveAmountIn - mappedMinAmountIn - mappedBpsAmountIn;

		const finalAmountIn = mappedMinAmountIn + (profitMargin * (100 - profitPercent)) / 100;

		return finalAmountIn;
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
}
