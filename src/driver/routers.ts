import axios, { AxiosRequestConfig } from 'axios';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
