import axios, { AxiosRequestConfig } from 'axios';
import { ethers } from 'ethers6';
import { abi as OkxHelperAbi } from '../abis/okx-helper.abi';
import { abi as UniSwapV3QuoterV2ABI } from '../abis/uniswap-QuoterV2.abi';
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
import { RoutersConfig } from '../config/routers';
import { RpcConfig } from '../config/rpc';
import { writeUint24BE } from '../utils/buffer';
import { EvmProviders } from '../utils/evm-providers';
import { hmac256base64 } from '../utils/hmac';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const okxWebsite = 'https://www.okx.com';
const apiBasePath = '/api/v5/dex/aggregator';

export class SwapRouters {
	private readonly uniswapQuoterV2Contracts: {
		[chainId: number]: ethers.Contract;
	} = {};

	private readonly okxIface = new ethers.Interface(OkxHelperAbi);

	constructor(
		private readonly contractsConfig: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly routersConfig: RoutersConfig,
		evmProviders: EvmProviders,
		private readonly priceApiUri: string,
	) {
		for (let chainId in evmProviders) {
			this.uniswapQuoterV2Contracts[+chainId] = new ethers.Contract(
				this.routersConfig.uniswapContracts[+chainId].quoterV2,
				UniSwapV3QuoterV2ABI,
				evmProviders[chainId],
			);
		}
	}

	async getQuote(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			timeout?: number;
		},
		swapRetries: number,
		retries: number = 3,
	): Promise<{
		toAmount: string;
		gas: number;
	}> {
		let quotename = '1inch';

		try {
			let quoteFunction = this.get1InchQuote.bind(this);
			if (swapRetries % 2 === 0) {
				quoteFunction = this.getOkxQuote.bind(this);
				quotename = 'okx';
			}
			if (swapParams.whChainId === 44) {
				quotename = 'uniswap';
				quoteFunction = this.getUniswapQuote.bind(this);
			}
			return await quoteFunction(swapParams, retries);
		} catch (err) {
			if (swapParams.whChainId === 44) {
				throw err;
			}
			console.error(`Error using ${quotename} as swap ${err}. trying other`);
			try {
				return await this.getOkxQuote(swapParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async getSwap(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			slippagePercent: number;
			timeout?: number;
		},
		swapRetries: number,
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
		let quotename = '1inch';
		try {
			let swapFunction = this.get1InchSwap.bind(this);
			if (swapRetries % 2 === 0) {
				quotename = 'okx';
				swapFunction = this.getOkxSwap.bind(this);
			}
			if (swapParams.whChainId === 44) {
				quotename = 'uniswap';
				swapFunction = this.getUniswapSwap.bind(this);
			}
			return await swapFunction(swapParams, retries);
		} catch (err) {
			if (swapParams.whChainId === 44) {
				throw err;
			}
			console.error(`Error using ${quotename} as swap ${err}. trying other`);
			try {
				return await this.getOkxSwap(swapParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	// async getUniswapQuote(
	// 	nativeTokens: { [index: string]: Token },
	// 	targetChain: number,
	// 	params: {
	// 		fromTokenAddr: Buffer;
	// 		toTokenAddr: Buffer;
	// 		fromAmount64: string;
	// 	},
	// ): Promise<{
	// 	toAmount: string;
	// 	gas: number;
	// }> {
	// let middleTokens = [];
	// let fees = [100];

	// if (params.toTokenAddr.toString('hex') === '0000000000000000000000000000000000000000') {
	// 	const token = nativeTokens[targetChain];
	// 	params.toTokenAddr = Buffer.from(hexToUint8Array(token.wrappedAddress!));
	// }

	// try {
	// 	const optimalRoute = await fetchUniswapV3PathFromApi(
	// 		'0x' + params.fromTokenAddr.toString('hex'),
	// 		targetChain,
	// 		'0x' + params.toTokenAddr.toString('hex'),
	// 		params.fromAmount64,
	// 	);
	// 	for (let i = 0; i < optimalRoute.length - 1; i++) {
	// 		const item = optimalRoute[i];
	// 		middleTokens.push(item.tokenOut.address);
	// 		fees.push(parseInt(item.fee));
	// 	}
	// } catch (err) {
	// 	logger.error(`Failed to fetch optimal route from api for Uniswap V3: ${err} falling back to direct route`);
	// }
	// const paths = encodeUniswapPath(
	// 	[params.fromTokenAddr, ...middleTokens.map((x) => Buffer.from(hexToUint8Array(x))), params.toTokenAddr],
	// 	fees,
	// );

	// const quotedAmountOut = await this.uniswapQuoterV2Contracts[targetChain].callStatic.quoteExactInput(
	// 	paths.uniSwapPath,
	// 	params.fromAmount64,
	// );

	// return {
	// 	amountOut: BigInt(quotedAmountOut.amountOut.toString()),
	// 	path: paths.uniSwapPath,
	// };
	// }

	async get1InchQuote(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			timeout?: number;
		},
		retries: number = 3,
	): Promise<{
		toAmount: string;
		gas: number;
	}> {
		const apiUrl = `https://api.1inch.dev/swap/v6.0/${WhChainIdToEvm[swapParams.whChainId]}/quote`;

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
				Authorization: `Bearer ${this.rpcConfig.oneInchApiKey}`,
			},
			params: {
				src: swapParams.srcToken,
				dst: swapParams.destToken,
				excludedProtocols: 'BASE_MAVERICK,BASE_UNISWAP_V2,BASE_UNISWAP_V3',
				amount: swapParams.amountIn,
				includeGas: true,
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
				return this.get1InchQuote(swapParams, retries - 1);
			}
			throw new Error(`Failed to get quote from 1inch: ${err}`);
		}
	}

	async get1InchSwap(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			slippagePercent: number;
			timeout?: number;
		},
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
		const apiUrl = `https://api.1inch.dev/swap/v6.0/${WhChainIdToEvm[swapParams.whChainId]}/swap`;

		if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

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
				excludedProtocols: 'BASE_MAVERICK,BASE_UNISWAP_V2,BASE_UNISWAP_V3',
				amount: swapParams.amountIn,
				from: swapSourceDst,
				slippage: swapParams.slippagePercent,
				disableEstimate: true,
				includeGas: true,
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

	async getOkxQuote(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			timeout?: number;
		},
		retries: number = 3,
	): Promise<{
		toAmount: string;
		gas: number;
	}> {
		const apiUrl = `${okxWebsite}${apiBasePath}/quote`;

		if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		const timeout = swapParams.timeout || 1500;
		const timestamp = new Date().toISOString();

		const queryParams: any = {
			chainId: WhChainIdToEvm[swapParams.whChainId],
			fromTokenAddress: swapParams.srcToken,
			toTokenAddress: swapParams.destToken,
			amount: swapParams.amountIn,
		};

		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				'OK-ACCESS-KEY': process.env.OKX_API_KEY,
				'OK-ACCESS-SIGN': hmac256base64(
					`${timestamp}GET${apiBasePath}/quote?${new URLSearchParams(queryParams).toString()}`,
					process.env.OKX_SECRET_KEY!,
				),
				'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
				'OK-ACCESS-TIMESTAMP': timestamp,
			},
			params: queryParams,
		};

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
					`# Throttled okx for ${timeout}ms ${swapParams.srcToken} -> ${swapParams.destToken} ${swapParams.amountIn}`,
				);
			}
			if (isRateLimited && retries > 0) {
				return this.getOkxQuote(swapParams, retries - 1);
			}
			throw new Error(`Failed to get quote from okx: ${err}`);
		}
	}

	async getOkxSwap(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			slippagePercent: number;
			timeout?: number;
		},
		retries: number = 7,
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
		const apiUrl = `${okxWebsite}${apiBasePath}/swap`;

		let swapDest = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		let swapSource = okxSwapHelpers[swapParams.whChainId];
		if (swapParams.srcToken === ethers.ZeroAddress) {
			swapSource = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		}

		if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		const timeout = swapParams.timeout || 1500;
		const timestamp = new Date().toISOString();

		const queryParams: any = {
			chainId: WhChainIdToEvm[swapParams.whChainId],
			fromTokenAddress: swapParams.srcToken,
			toTokenAddress: swapParams.destToken,
			amount: swapParams.amountIn,
			slippage: swapParams.slippagePercent / 100,
			userWalletAddress: swapSource,
			swapReceiverAddress: swapDest,
		};

		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				'OK-ACCESS-KEY': process.env.OKX_API_KEY,
				'OK-ACCESS-SIGN': hmac256base64(
					`${timestamp}GET${apiBasePath}/swap?${new URLSearchParams(queryParams).toString()}`,
					process.env.OKX_SECRET_KEY!,
				),
				'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
				'OK-ACCESS-TIMESTAMP': timestamp,
			},
			params: queryParams,
		};

		try {
			const response = await axios.get(apiUrl, config);
			const tx = response.data.data[0].tx;

			if (tx.to.toLowerCase() !== OkxDexRouterContracts[swapParams.whChainId].toLowerCase()) {
				throw new Error(`Invalid okx router address ${tx.to}`);
			}

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

	async getUniswapQuote(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			timeout?: number;
		},
		retries: number = 3,
	): Promise<{
		toAmount: string;
		gas: number;
	}> {
		const apiUrl = `${this.priceApiUri}/v3/quote/on-chain`;

		const timeout = swapParams.timeout || 3000;
		const config: AxiosRequestConfig = {
			timeout: timeout,
			params: {
				fromToken: swapParams.srcToken,
				toToken: swapParams.destToken,
				chain: 'unichain',
				amountIn64: swapParams.amountIn,
			},
		};

		try {
			const response = await axios.get(apiUrl, config);
			return {
				toAmount: response.data.toAmount,
				gas: Number(response.data.gas),
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited && retries > 0) {
				return this.getUniswapQuote(swapParams, retries - 1);
			}
			throw new Error(`Failed to get quote from uniswap(price-api): ${err}`);
		}
	}

	async getUniswapSwap(
		swapParams: {
			whChainId: number;
			srcToken: string;
			destToken: string;
			amountIn: string;
			slippagePercent: number;
			timeout?: number;
		},
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
		const apiUrl = `${this.priceApiUri}/v3/quote/on-chain`;

		const timeout = swapParams.timeout || 3000;
		const swapSourceDst = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		const config: AxiosRequestConfig = {
			timeout: timeout,
			params: {
				fromToken: swapParams.srcToken,
				toToken: swapParams.destToken,
				chain: 'unichain',
				amountIn64: swapParams.amountIn,
				recipient: swapSourceDst,
				slippageBps: swapParams.slippagePercent * 100,
			},
		};

		try {
			const response = await axios.get(apiUrl, config);
			return {
				tx: response.data.tx,
				gas: Number(response.data.tx.gas),
				toAmount: response.data.toAmount,
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited && retries > 0) {
				return this.getUniswapSwap(swapParams, retries - 1);
			}
			throw new Error(`Failed to get swap from uniswap (price-api): ${err}`);
		}
	}
}

async function fetchUniswapV3PathFromApi(
	fromToken: string,
	whChainId: number,
	toToken: string,
	amountIn64: string,
): Promise<
	{
		tokenIn: {
			address: string;
			symbol: string;
		};
		tokenOut: {
			address: string;
			symbol: string;
		};
		fee: string;
	}[]
> {
	const reallChainId = WhChainIdToEvm[whChainId];
	const { data } = await axios.post(
		'https://interface.gateway.uniswap.org/v2/quote',
		{
			tokenInChainId: reallChainId,
			tokenIn: fromToken,
			tokenOutChainId: reallChainId,
			tokenOut: toToken,
			amount: amountIn64,
			sendPortionEnabled: false,
			type: 'EXACT_INPUT',
			intent: 'pricing',
			configs: [{ enableUniversalRouter: true, protocols: ['V3'], routingType: 'CLASSIC' }],
			useUniswapX: false,
			slippageTolerance: '0.5',
		},
		{
			headers: {
				origin: 'https://app.uniswap.org',
			},
			timeout: 3000,
		},
	);
	return data.quote.route[0];
}

function encodeUniswapPath(
	tokens: Buffer[],
	fees: number[],
): {
	uniSwapPath: Buffer;
} {
	if (tokens.length !== fees.length + 1) {
		throw new Error('Tokens length should be one more than fees length');
	}

	let uniSwapPath = Buffer.alloc(tokens.length * 20 + fees.length * 3);
	let offset = 0;
	for (let i = 0; i < tokens.length - 1; i++) {
		tokens[i].copy(uniSwapPath, offset);
		offset += 20;
		const fee = fees[i];
		writeUint24BE(uniSwapPath, fee, offset);
		offset += 3;
	}
	tokens[tokens.length - 1].copy(uniSwapPath, offset);

	return {
		uniSwapPath,
	};
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

const OkxDexRouterContracts: { [chainId: number]: string } = {
	[CHAIN_ID_ETH]: '0x7D0CcAa3Fac1e5A943c5168b6CEd828691b46B36',
	[CHAIN_ID_BSC]: '0x9333C74BDd1E118634fE5664ACA7a9710b108Bab',
	[CHAIN_ID_POLYGON]: '0xA748D6573acA135aF68F2635BE60CB80278bd855',
	[CHAIN_ID_AVAX]: '0x1daC23e41Fc8ce857E86fD8C1AE5b6121C67D96d',
	[CHAIN_ID_ARBITRUM]: '0xf332761c673b59B21fF6dfa8adA44d78c12dEF09',
	[CHAIN_ID_OPTIMISM]: '0xf332761c673b59B21fF6dfa8adA44d78c12dEF09',
	[CHAIN_ID_BASE]: '0x6b2C0c7be2048Daa9b5527982C29f48062B34D58',
};
