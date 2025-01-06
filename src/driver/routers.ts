import axios, { AxiosRequestConfig } from 'axios';
import { ZeroAddress, ethers } from 'ethers6';
import { abi as OkxHelperAbi } from '../abis/okx-helper.abi';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	WhChainIdToEvm,
} from '../config/chains';
import { ContractsConfig, okxSwapHelpers } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { hmac256base64 } from '../utils/hmac';
import { delay } from '../utils/util';

const okxWebsite = 'https://www.okx.com';
const apiBasePath = '/api/v5/dex/aggregator';

type EVMQuoteParams = {
	whChainId: number;
	srcToken: string;
	destToken: string;
	amountIn: string;
	includeGas?: boolean;
	timeout?: number;
};

type EVMSwapParams = EVMQuoteParams & {
	slippagePercent: number;
};

type EVMQuoteResponse = {
	toAmount: string;
	gas: number;
};

type EVMSwapResponse = EVMQuoteResponse & {
	tx: {
		to: string;
		data: string;
		value: string;
		gas: string;
	};
};

export class SwapRouters {
	private readonly okxIface = new ethers.Interface(OkxHelperAbi);

	constructor(
		private readonly contractsConfig: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
	) {}

	async getQuote(quoteParams: EVMQuoteParams, retries: number = 3): Promise<EVMQuoteResponse> {
		try {
			return await this.get1InchQuote(quoteParams, retries);
		} catch (err) {
			console.error(`Error using 1inch as swap ${err}. trying okx`);
			try {
				return await this.getOkxQuote(quoteParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async getSwap(swapParams: EVMSwapParams, retries: number = 3): Promise<EVMSwapResponse> {
		try {
			return await this.get1InchSwap(swapParams, retries);
		} catch (err) {
			console.error(`Error using 1inch as swap ${err}. trying okx`);
			try {
				return await this.getOkxSwap(swapParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async get1InchQuote(quoteParams: EVMQuoteParams, retries: number = 3): Promise<EVMQuoteResponse> {
		const apiUrl = `https://api.1inch.dev/swap/v6.0/${WhChainIdToEvm[quoteParams.whChainId]}/quote`;

		if (quoteParams.srcToken === ZeroAddress) {
			quoteParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (quoteParams.destToken === ZeroAddress) {
			quoteParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		quoteParams.includeGas = quoteParams.includeGas ?? true;

		const timeout = quoteParams.timeout || 1500;

		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				Authorization: `Bearer ${this.rpcConfig.oneInchApiKey}`,
			},
			params: {
				src: quoteParams.srcToken,
				dst: quoteParams.destToken,
				amount: quoteParams.amountIn,
				includeGas: quoteParams.includeGas!,
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
				return this.get1InchQuote(quoteParams, retries - 1);
			}
			throw new Error(`Failed to get quote from 1inch: ${err}`);
		}
	}

	async get1InchSwap(swapParams: EVMSwapParams, retries: number = 3): Promise<EVMSwapResponse> {
		const apiUrl = `https://api.1inch.dev/swap/v6.0/${WhChainIdToEvm[swapParams.whChainId]}/swap`;

		if (swapParams.srcToken === ZeroAddress) {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (swapParams.destToken === ZeroAddress) {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		swapParams.includeGas = swapParams.includeGas ?? true;

		const timeout = swapParams.timeout || 1500;
		const swapSourceDst = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				Authorization: `Bearer ${this.rpcConfig.oneInchApiKey}`,
			},
			params: {
				src: swapParams.srcToken,
				dst: swapParams.destToken,
				amount: swapParams.amountIn,
				from: swapSourceDst,
				slippage: swapParams.slippagePercent,
				disableEstimate: true,
				includeGas: swapParams.includeGas!,
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
				return this.get1InchSwap(swapParams, retries - 1);
			}
			throw new Error(`Failed to get swap from 1inch: ${err}`);
		}
	}

	async getOkxQuote(quoteParams: EVMQuoteParams, retries: number = 3): Promise<EVMQuoteResponse> {
		const apiUrl = `${okxWebsite}${apiBasePath}/quote`;

		if (quoteParams.srcToken === ZeroAddress) {
			quoteParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (quoteParams.destToken === ZeroAddress) {
			quoteParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		const queryParams: any = {
			chainId: WhChainIdToEvm[quoteParams.whChainId],
			fromTokenAddress: quoteParams.srcToken,
			toTokenAddress: quoteParams.destToken,
			amount: quoteParams.amountIn,
		};
		const config = this.genOkxReqConf(`${apiBasePath}/quote`, queryParams);
		config.timeout = quoteParams.timeout || 1500;

		try {
			const response = await axios.get(apiUrl, config);
			return {
				toAmount: response.data.data[0].toTokenAmount,
				gas: Number(response.data.data[0].estimateGasFee),
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited) {
				console.log(
					`# Throttled okx for ${config.timeout}ms ${quoteParams.srcToken} -> ${quoteParams.destToken} ${quoteParams.amountIn}`,
				);
			}
			if (isRateLimited && retries > 0) {
				return this.getOkxQuote(quoteParams, retries - 1);
			}
			throw new Error(`Failed to get quote from okx: ${err}`);
		}
	}

	async getOkxSwap(swapParams: EVMSwapParams, retries: number = 7): Promise<EVMSwapResponse> {
		const apiUrl = `${okxWebsite}${apiBasePath}/swap`;

		let swapDest = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		let swapSource = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		if (swapParams.srcToken !== ethers.ZeroAddress) {
			swapSource = okxSwapHelpers[swapParams.whChainId];
		}

		if (swapParams.srcToken === ZeroAddress) {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (swapParams.destToken === ZeroAddress) {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		const queryParams: any = {
			chainId: WhChainIdToEvm[swapParams.whChainId],
			fromTokenAddress: swapParams.srcToken,
			toTokenAddress: swapParams.destToken,
			amount: swapParams.amountIn,
			slippage: swapParams.slippagePercent / 100,
			userWalletAddress: swapSource,
			swapReceiverAddress: swapDest,
		};
		const config = this.genOkxReqConf(`${apiBasePath}/swap`, queryParams);
		config.timeout = swapParams.timeout || 1500;

		try {
			const response = await axios.get(apiUrl, config);
			const tx = response.data.data[0].tx;

			if (swapParams.srcToken !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
				// erc 20
				const data = this.okxIface.encodeFunctionData('approveAndForward', [
					swapParams.srcToken,
					swapParams.amountIn,
					tokenApprovalContracts[swapParams.whChainId],
					tx.to,
					tx.data,
				]);
				tx.data = this.okxIface.getFunction('approveAndForward')?.selector + data.slice(10);
				tx.to = okxSwapHelpers[swapParams.whChainId];
			}

			return {
				tx: tx,
				gas: Number(tx.gas),
				toAmount: response.data.data[0].routerResult.toTokenAmount.toString(),
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited && retries > 0) {
				return this.getOkxSwap(swapParams, retries - 1);
			}
			throw new Error(`Failed to get swap from okx: ${err}`);
		}
	}

	private genOkxReqConf(path: string, queryParams: any): AxiosRequestConfig {
		const timestamp = new Date().toISOString();
		return {
			headers: {
				'OK-ACCESS-KEY': this.rpcConfig.okxApiKey,
				'OK-ACCESS-SIGN': hmac256base64(
					`${timestamp}GET${path}?${new URLSearchParams(queryParams).toString()}`,
					this.rpcConfig.okxSecretKey!,
				),
				'OK-ACCESS-PASSPHRASE': this.rpcConfig.okxPassPhrase,
				'OK-ACCESS-TIMESTAMP': timestamp,
			},
			params: queryParams,
		};
	}
}

const tokenApprovalContracts: { [chainId: number]: string } = {
	[CHAIN_ID_ETH]: '0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f',
	[CHAIN_ID_BSC]: '0x2c34A2Fb1d0b4f55de51E1d0bDEfaDDce6b7cDD6',
	[CHAIN_ID_POLYGON]: '0x3B86917369B83a6892f553609F3c2F439C184e31',
	[CHAIN_ID_AVAX]: '0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f',
	[CHAIN_ID_ARBITRUM]: '0x70cBb871E8f30Fc8Ce23609E9E0Ea87B6b222F58',
	[CHAIN_ID_OPTIMISM]: '0x68D6B739D2020067D1e2F713b999dA97E4d54812',
	[CHAIN_ID_BASE]: '0x57df6092665eb6058DE53939612413ff4B09114E',
};
