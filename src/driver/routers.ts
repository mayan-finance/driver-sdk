import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { Aftermath, Router, RouterCompleteTradeRoute } from 'aftermath-ts-sdk';
import axios, { AxiosRequestConfig } from 'axios';
import logger from '../utils/logger';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let aftermathRouter: Router;

export async function getSuiSwapQuote(
	params: {
		coinInType: string;
		coinOutType: string;
		coinInAmount: bigint;
	},
	config?: {
		timeout?: number;
		retries?: number;
	},
): Promise<{
	outAmount: bigint;
	route: RouterCompleteTradeRoute;
}> {
	let timeoutId: NodeJS.Timeout | null = null;

	try {
		if (!aftermathRouter) {
			aftermathRouter = new Aftermath('MAINNET').Router();
		}

		const controller = new globalThis.AbortController();
		timeoutId = setTimeout(() => controller.abort(), config?.timeout || 5000);

		const route = await aftermathRouter.getCompleteTradeRouteGivenAmountIn(
			{
				coinInType: params.coinInType,
				coinOutType: params.coinOutType,
				coinInAmount: params.coinInAmount,
			},
			controller.signal,
		);
		return {
			outAmount: route.coinOut.amount,
			route: route,
		};
	} catch (err) {
		logger.warn(`Failed to fetch Sui swap quote: ${params} ${err}`);
		if (!!config?.retries && config?.retries > 0) {
			return getSuiSwapQuote(params, {
				...config,
				retries: config.retries - 1,
			});
		}
		throw err;
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

export async function addSuiSwapTx(
	tx: Transaction,
	wallet: string,
	route: RouterCompleteTradeRoute,
): Promise<[TransactionObjectArgument, Transaction]> {
	const router = new Aftermath('MAINNET').Router();
	const res = await router.addTransactionForCompleteTradeRoute({
		completeRoute: route,
		slippage: 0.01,
		tx,
		walletAddress: wallet,
	});
	return [res.coinOutId!, res.tx];
}

export async function getAftermathSuiTx(swapParams: {
	route: RouterCompleteTradeRoute;
	walletAddress: string;
	slippageBps: number;
}): Promise<Transaction> {
	const router = new Aftermath('MAINNET').Router();
	const tx = await router.getTransactionForCompleteTradeRoute({
		walletAddress: swapParams.walletAddress,
		completeRoute: swapParams.route,
		slippage: swapParams.slippageBps / 10000,
	});
	return tx;
}

export async function get1InchQuote(
	swapParams: {
		realChainId: number;
		srcToken: string;
		destToken: string;
		amountIn: string;
		timeout?: number;
	},
	apiKey: string,
	includeGas: boolean = true,
	retries: number = 3,
): Promise<{
	toAmount: string;
	gas: number;
}> {
	const apiUrl = `https://api.1inch.dev/swap/v6.0/${swapParams.realChainId}/quote`;

	if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
		swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
		swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	const timeout = swapParams.timeout || 1500;

	const config: AxiosRequestConfig = {
		timeout: timeout,
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		params: {
			src: swapParams.srcToken,
			dst: swapParams.destToken,
			amount: swapParams.amountIn,
			includeGas: includeGas,
		},
	};

	try {
		const response = await axios.get(apiUrl, config);
		return {
			toAmount: response.data.dstAmount,
			gas: Number(response.data.gas),
		};
	} catch (err: any) {
		let isRateLimited = false;
		if (err.response && err.response.status === 429) {
			isRateLimited = true;
			await delay(200);
		}
		if (isRateLimited && retries > 0) {
			return get1InchQuote(swapParams, apiKey, includeGas, retries - 1);
		}
		throw new Error(`Failed to get quote from 1inch: ${err}`);
	}
}

export async function get1InchSwap(
	swapParams: {
		realChainId: number;
		srcToken: string;
		destToken: string;
		amountIn: string;
		from: string;
		slippagePercent: number;
		timeout?: number;
	},
	apiKey: string,
	includeGas: boolean = true,
	retries: number = 3,
): Promise<{
	tx: {
		to: string;
		data: string;
		value: string;
		gas: string;
	};
	gas: number;
	toAmount: string;
}> {
	const apiUrl = `https://api.1inch.dev/swap/v6.0/${swapParams.realChainId}/swap`;

	if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
		swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
		swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	const timeout = swapParams.timeout || 1500;

	const config: AxiosRequestConfig = {
		timeout: timeout,
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		params: {
			src: swapParams.srcToken,
			dst: swapParams.destToken,
			amount: swapParams.amountIn,
			from: swapParams.from,
			slippage: swapParams.slippagePercent,
			disableEstimate: true,
			includeGas: includeGas,
		},
	};

	try {
		const response = await axios.get(apiUrl, config);
		return {
			tx: response.data.tx,
			gas: Number(response.data.tx.gas),
			toAmount: response.data.dstAmount,
		};
	} catch (err: any) {
		let isRateLimited = false;
		if (err.response && err.response.status === 429) {
			isRateLimited = true;
			await delay(200);
		}
		if (isRateLimited && retries > 0) {
			return get1InchSwap(swapParams, apiKey, includeGas, retries - 1);
		}
		throw new Error(`Failed to get swap from 1inch: ${err}`);
	}
}
