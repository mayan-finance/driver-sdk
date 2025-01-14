import axios, { AxiosRequestConfig } from 'axios';
import { isNativeToken } from './util';
import { hmac256base64 } from './hmac';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const okxWebsite = 'https://www.okx.com';
const apiBasePath = '/api/v5/dex/aggregator';

export async function getOkxQuote(
	swapParams: {
		realChainId: number;
		srcToken: string;
		destToken: string;
		amountIn: string;
		timeout?: number;
	},
	apiKey: string,
	passPhrase: string,
	secretKey: string,
	retries: number = 3,
): Promise<any> {
	if (isNativeToken(swapParams.srcToken)) {
		swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}
	if (swapParams.srcToken === 'So11111111111111111111111111111111111111112') {
		swapParams.srcToken = '11111111111111111111111111111111';
	}
	if (isNativeToken(swapParams.destToken)) {
		swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	const queryParams: any = {
		chainId: swapParams.realChainId,
		fromTokenAddress: swapParams.srcToken,
		toTokenAddress: swapParams.destToken,
		amount: swapParams.amountIn,
	};

	const config = genOkxReqConf(`${apiBasePath}/quote`, queryParams, apiKey, passPhrase, secretKey);
	config.timeout = swapParams.timeout || 1500;
	const timeout = swapParams.timeout || 1500;
	const apiUrl = `${okxWebsite}${apiBasePath}/quote`;

	try {
		const response = await axios.get(apiUrl, config);
		if (!response.data.data || response.data.data.length == 0) {
			throw new Error(response.data.msg ?? 'okx error no data');
		}
		return response.data.data[0];
	} catch (err: any) {
		let isRateLimited = false;
		if (err.response && err.response.status === 429) {
			isRateLimited = true;
			await delay(200);
		}
		if (isRateLimited) {
			console.log(
				`# Throttled okx for ${timeout}ms ${swapParams.srcToken} -> ${swapParams.destToken} ${swapParams.amountIn}`,
			);
		}
		if (isRateLimited && retries > 0) {
			return getOkxQuote(swapParams, apiKey, passPhrase, secretKey, retries - 1);
		}
		throw new Error(`Failed to get quote from okx: ${err}`);
	}
}

export async function getOkxSwap(
	swapParams: {
		realChainId: number;
		srcToken: string;
		destToken: string;
		amountIn: string;
		userWalletAddress: string;
		swapReceiverAddress: string;
		slippagePercent: number;
		timeout?: number;
	},
	apiKey: string,
	passPhrase: string,
	secretKey: string,
	retries: number = 7,
): Promise<any> {
	if (isNativeToken(swapParams.srcToken)) {
		swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}
	if (swapParams.srcToken === 'So11111111111111111111111111111111111111112') {
		swapParams.srcToken = '11111111111111111111111111111111';
	}
	if (isNativeToken(swapParams.destToken)) {
		swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
	}

	const queryParams: any = {
		chainId: swapParams.realChainId,
		fromTokenAddress: swapParams.srcToken,
		toTokenAddress: swapParams.destToken,
		amount: swapParams.amountIn,
		slippage: swapParams.slippagePercent / 100,
		userWalletAddress: swapParams.userWalletAddress,
		swapReceiverAddress: swapParams.swapReceiverAddress,
	};

	const config = genOkxReqConf(`${apiBasePath}/swap`, queryParams, apiKey, passPhrase, secretKey);
	config.timeout = swapParams.timeout || 1500;
	const apiUrl = `${okxWebsite}${apiBasePath}/swap`;

	try {
		const response = await axios.get(apiUrl, config);
		if (!response.data.data || response.data.data.length == 0) {
			throw new Error(response.data.msg ?? 'okx error no data');
		}
		return response.data.data[0];
	} catch (err: any) {
		let isRateLimited = false;
		if (err.response && err.response.status === 429) {
			isRateLimited = true;
			await delay(200);
		}
		if (isRateLimited && retries > 0) {
			return getOkxSwap(swapParams, apiKey, passPhrase, secretKey, retries - 1);
		}
		throw new Error(`Failed to get swap from okx: ${err}`);
	}
}

function genOkxReqConf(
	path: string,
	queryParams: any,
	apiKey: string,
	passPhrase: string,
	secretKey: string,
): AxiosRequestConfig {
	const timestamp = new Date().toISOString();
	return {
		headers: {
			'OK-ACCESS-KEY': apiKey,
			'OK-ACCESS-SIGN': hmac256base64(
				`${timestamp}GET${path}?${new URLSearchParams(queryParams).toString()}`,
				secretKey!,
			),
			'OK-ACCESS-PASSPHRASE': passPhrase,
			'OK-ACCESS-TIMESTAMP': timestamp,
		},
		params: queryParams,
	};
}
