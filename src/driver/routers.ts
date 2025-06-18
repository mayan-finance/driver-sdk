import axios, { AxiosRequestConfig } from 'axios';
import { ethers } from 'ethers6';
import { abi as OkxHelperAbi } from '../abis/okx-helper.abi';
import { abi as UniSwapV3QuoterV2ABI } from '../abis/uniswap-QuoterV2.abi';
import * as SuiTx from '@mysten/sui/transactions';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_UNICHAIN,
	CHAIN_ID_LINEA,
	WhChainIdToEvm,
} from '../config/chains';
import { ContractsConfig, okxSwapHelpers } from '../config/contracts';
import { RoutersConfig } from '../config/routers';
import { RpcConfig } from '../config/rpc';
import { writeUint24BE } from '../utils/buffer';
import { EvmProviders } from '../utils/evm-providers';
import { hmac256base64 } from '../utils/hmac';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { Aftermath, Router, RouterCompleteTradeRoute } from 'aftermath-ts-sdk';
import { buildSwapPTBFromQuote, generateRefId, getQuote, NAVISDKClient } from 'navi-sdk';
import logger from '../utils/logger';
let aftermathRouter: Router;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const okxWebsite = 'https://www.okx.com';
const apiBasePath = '/api/v5/dex/aggregator';

type EVMQuoteParams = {
	whChainId: number;
	srcToken: string;
	destToken: string;
	amountIn: string;
	timeout?: number;
}

type EVMQuoteResponse = {
	toAmount: string;
	gas: number;
}

type EVMSwapParams = {
	whChainId: number;
	srcToken: string;
	destToken: string;
	amountIn: string;
	slippagePercent: number;
	timeout?: number;
}

type EVMSwapResponse = {
	tx: {
		to: string;
		data: string;
		value: string;
		gas: string;
	};
	gas: number;
	toAmount: string;
}

export class SwapRouters {
	private naviSdkClient: NAVISDKClient | undefined;
	private aftermathRouter: Router | undefined;
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
			// this.uniswapQuoterV2Contracts[+chainId] = new ethers.Contract(
			// 	this.routersConfig.uniswapContracts[+chainId].quoterV2,
			// 	UniSwapV3QuoterV2ABI,
			// 	evmProviders[chainId],
			// );
		}
	}

	async getSuiQuote(amountIn64: bigint, cointInType: string, cointOutType: string, swapRetries?: number) {
		if (swapRetries && swapRetries % 2 === 1) {
			return this.getSuiSwapQuoteNavi({
				coinInType: cointInType,
				coinOutType: cointOutType,
				coinInAmount: amountIn64,
			});
		}

		return this.getSuiSwapQuoteAfterMath({
			coinInType: cointInType,
			coinOutType: cointOutType,
			coinInAmount: amountIn64,
		});
	}

	async getSuiSwap(
		amountIn64: bigint,
		cointInType: string,
		cointOutType: string,
		tx: SuiTx.Transaction,
		slippage: number,
		walletAddress: string,
		withCoinIn?: SuiTx.TransactionObjectArgument,
		swapRetries?: number,
	) {
		if (swapRetries && swapRetries % 2 === 1) {
			return this.getSuiSwapTxNavi(
				amountIn64,
				cointInType,
				cointOutType,
				tx,
				slippage,
				walletAddress,
				withCoinIn,
			);
		}

		return this.getSuiSwapTxAfterMath(
			amountIn64,
			cointInType,
			cointOutType,
			tx,
			slippage,
			walletAddress,
			withCoinIn,
		);
	}

	async getSuiSwapTxNavi(
		amountIn64: bigint,
		cointInType: string,
		cointOutType: string,
		tx: SuiTx.Transaction,
		slippage: number,
		walletAddress: string,
		withCoinIn?: SuiTx.TransactionObjectArgument,
	) {
		if (!this.naviSdkClient) {
			this.naviSdkClient = new NAVISDKClient({ networkType: process.env.SUI_FULLNODE_ENDPOINT });
		}

		const quote = await getQuote(cointInType, cointOutType, amountIn64, process.env.SUI_NAVI_API_KEY, {
			byAmountIn: true,
		});

		const minAmountOut = Math.floor(Number(quote.amount_out) * (1 - slippage / 100));

		const finalCoinB = await buildSwapPTBFromQuote(
			walletAddress,
			tx,
			minAmountOut,
			withCoinIn as any,
			quote,
			generateRefId(process.env.SUI_NAVI_API_KEY!),
		);

		return {
			newTx: tx,
			outCoin: finalCoinB,
		};
	}

	async getSuiSwapTxAfterMath(
		amountIn64: bigint,
		cointInType: string,
		cointOutType: string,
		tx: SuiTx.Transaction,
		slippage: number,
		walletAddress: string,
		withCoinIn?: SuiTx.TransactionObjectArgument,
	) {
		if (!this.aftermathRouter) {
			this.aftermathRouter = new Aftermath('MAINNET').Router();
		}

		const { route } = await this.getSuiSwapQuoteAfterMath({
			coinInAmount: amountIn64,
			coinInType: cointInType,
			coinOutType: cointOutType,
		});

		const controller = new globalThis.AbortController();
		let timeoutId = setTimeout(() => controller.abort(), 8000);

		const res = await this.aftermathRouter.addTransactionForCompleteTradeRoute({
			tx: tx,
			completeRoute: route,
			slippage,
			walletAddress,
			coinInId: withCoinIn,
		});

		return {
			newTx: res.tx,
			outCoin: res.coinOutId,
		};
	}

	async getSuiSwapQuoteNavi(
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
	}> {
		const quote = await getQuote(
			params.coinInType,
			params.coinOutType,
			params.coinInAmount,
			process.env.SUI_NAVI_API_KEY,
			{
				byAmountIn: true,
			},
		);

		return {
			outAmount: BigInt(quote.amount_out),
		};
	}

	async getSuiSwapQuoteAfterMath(
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
		let timeoutId: NodeJS.Timeout | undefined;

		try {
			if (!this.aftermathRouter) {
				this.aftermathRouter = new Aftermath('MAINNET').Router();
			}

			const controller = new globalThis.AbortController();
			timeoutId = setTimeout(() => controller.abort(), config?.timeout || 5000);

			const route = await this.aftermathRouter.getCompleteTradeRouteGivenAmountIn(
				{
					coinInType: params.coinInType,
					coinOutType: params.coinOutType,
					coinInAmount: params.coinInAmount,
				},
				controller.signal,
			);
			return {
				outAmount: route.coinOut.amount,
				route,
			};
		} catch (err) {
			logger.warn(`Failed to fetch Sui swap quote with aftermath: ${params} ${err}`);
			if (config?.retries && config.retries > 0) {
				return this.getSuiSwapQuoteAfterMath(params, {
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

	async getQuote(
		swapParams: EVMQuoteParams,
		swapRetries: number,
		retries: number = 3,
	): Promise<EVMQuoteResponse> {
		let quotename = [CHAIN_ID_LINEA, CHAIN_ID_UNICHAIN].includes(swapParams.whChainId) ? '0x' : 'best';

		try {
			let quoteFunction = [CHAIN_ID_LINEA, CHAIN_ID_UNICHAIN].includes(swapParams.whChainId) ? this.get0xQuote.bind(this) : this.getBestOKX0xQuote.bind(this);
			if (swapParams.whChainId === CHAIN_ID_UNICHAIN && swapRetries % 2 === 1) {
				quotename = 'uniswap';
				quoteFunction = this.getUniswapQuote.bind(this);
			} else if (swapRetries % 2 === 1) {
				quotename = '1inch';
				quoteFunction = this.get1InchQuote.bind(this);
			}

			return await quoteFunction(swapParams, retries);
		} catch (err) {
			if (swapParams.whChainId === CHAIN_ID_UNICHAIN) {
				throw err;
			}
			throw new Error(`Error using ${quotename} as quote ${err}`);
			// console.error(`Error using ${quotename} as swap ${err}. trying other`);
			// try {
			// 	return await this.getOkxQuote(swapParams, retries);
			// } catch (errrr) {
			// 	throw new Error(`${quotename} ${errrr}`);
			// }
		}
	}

	async getSwap(
		swapParams: EVMSwapParams,
		swapRetries: number,
		retries: number = 3,
	): Promise<EVMSwapResponse> {
		let quotename = [CHAIN_ID_LINEA, CHAIN_ID_UNICHAIN].includes(swapParams.whChainId) ? '0x' : 'best';
		try {
			let swapFunction = [CHAIN_ID_LINEA, CHAIN_ID_UNICHAIN].includes(swapParams.whChainId) ? this.get0xSwap.bind(this) : this.getBestOKX0xSwap.bind(this);
			if (swapParams.whChainId === CHAIN_ID_UNICHAIN && swapRetries % 2 === 1) {
				quotename = 'uniswap';
				swapFunction = this.getUniswapSwap.bind(this);
			} else if (swapParams.whChainId === CHAIN_ID_LINEA && swapRetries % 2 === 1) {
				quotename = '1inch';
				swapFunction = this.get1InchSwap.bind(this);
			} else {
				switch (swapRetries % 4) {
					case 1:
						quotename = '0x';
						swapFunction = this.get0xSwap.bind(this);
						break;
					case 2:
						quotename = 'okx';
						swapFunction = this.getOkxSwap.bind(this);
						break;
					case 3:
						quotename = '1inch';
						swapFunction = this.get1InchSwap.bind(this);
						break;
				}
			}

			return await swapFunction(swapParams, retries);
		} catch (err) {
			if (swapParams.whChainId === CHAIN_ID_UNICHAIN) {
				throw err;
			}
			throw new Error(`Error using ${quotename} as swap ${err}`);
			// console.error(`Error using ${quotename} as swap ${err}. trying other`);
			// try {
			// 	return await this.getOkxSwap(swapParams, retries);
			// } catch (errrr) {
			// 	throw errrr;
			// }
		}
	}

	async getUniswapQuote(
		swapParams: EVMQuoteParams,
		retries: number = 3,
	): Promise<EVMQuoteResponse> {
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
		swapParams: EVMSwapParams,
		retries: number = 3,
	): Promise<EVMSwapResponse> {
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
		swapParams: EVMQuoteParams,
		retries: number = 3,
	): Promise<EVMQuoteResponse> {
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
		swapParams: EVMSwapParams,
		retries: number = 3,
	): Promise<EVMSwapResponse> {
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
		swapParams: EVMQuoteParams,
		retries: number = 3,
	): Promise<EVMQuoteResponse> {
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
		swapParams: EVMSwapParams,
		retries: number = 7,
	): Promise<EVMSwapResponse> {
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
			priceImpactProtectionPercentage: 1,
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

	async get0xQuote(
		swapParams: EVMQuoteParams,
		retries: number = 3,
	): Promise<EVMQuoteResponse> {
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
				'0x-api-key': process.env.ZEROX_API_KEY,
				'0x-version': 'v2',
			},
			params: {
				chainId: WhChainIdToEvm[swapParams.whChainId],
				sellToken: swapParams.srcToken,
				buyToken: swapParams.destToken,
				sellAmount: swapParams.amountIn,
			},
		};

		try {
			const res = await axios.get('https://api.0x.org/swap/allowance-holder/price', config);
			if (!res.data.buyAmount || res.data.liquidityAvailable === false) {
				throw new Error(`Failed to get quote from 0x: ${res.data}`);
			}

			return {
				toAmount: res.data.buyAmount,
				gas: Number(res.data.gas),
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited) {
				console.log(
					`# Throttled 0x for ${timeout}ms ${swapParams.srcToken} -> ${swapParams.destToken} ${swapParams.amountIn}`,
				);
			}
			if (isRateLimited && retries > 0) {
				return this.get0xQuote(swapParams, retries - 1);
			}
			throw new Error(`Failed to get quote from 0x: ${err}`);
		}
	}

	async get0xSwap(
		swapParams: EVMSwapParams,
		retries: number = 7,
	): Promise<EVMSwapResponse> {
		if (swapParams.srcToken === '0x0000000000000000000000000000000000000000') {
			swapParams.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (swapParams.destToken === '0x0000000000000000000000000000000000000000') {
			swapParams.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}

		const swapDest = this.contractsConfig.evmFulfillHelpers[swapParams.whChainId];
		const chainId = WhChainIdToEvm[swapParams.whChainId];

		const timeout = swapParams.timeout || 1500;
		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				'0x-api-key': process.env.ZEROX_API_KEY,
				'0x-version': 'v2',
			},
			params: {
				chainId,
				sellToken: swapParams.srcToken,
				buyToken: swapParams.destToken,
				sellAmount: swapParams.amountIn,
				taker: swapDest,
				slippageBps: swapParams.slippagePercent * 100,
			},
		};

		try {
			const res = await axios.get('https://api.0x.org/swap/allowance-holder/quote', config);
			if (!res.data.liquidityAvailable) {
				throw new Error('cant swap: liquidity not available');
			}
			if (
				(chainId !== 59144 && res.data.transaction.to !== '0x0000000000001ff3684f28c67538d4d072c22734') ||
				(chainId === 59144 && res.data.transaction.to !== '0x000000000000175a8b9bc6d539b3708eed92ea6c')
			) {
				throw new Error(`cant swap: settler address has changed to ${res.data.transaction.to}`);
			}

			return {
				toAmount: res.data.buyAmount,
				gas: Number(res.data.transaction.gas),
				// approvalTarget: res.data.issues.allowance?.spender,
				tx: {
					to: res.data.transaction.to,
					data: res.data.transaction.data,
					value: res.data.transaction.value,
					gas: res.data.transaction.gas,
				},
			};
		} catch (err: any) {
			let isRateLimited = false;
			if (err.response && err.response.status === 429) {
				isRateLimited = true;
				await delay(200);
			}
			if (isRateLimited && retries > 0) {
				return this.get0xSwap(swapParams, retries - 1);
			}
			throw new Error(`Failed to get swap from 0x: ${err}`);
		}
	}

	async getBestOKX0xQuote(params: EVMQuoteParams, retries?: number): Promise<EVMQuoteResponse> {
		const results = await Promise.allSettled([
			this.getOkxQuote(params, retries),
			this.get0xQuote(params, retries),
		]);

		const quoteRess = results
			.filter(
				(result): result is PromiseFulfilledResult<EVMQuoteResponse> =>
					result.status === 'fulfilled',
			)
			.map((result) => result.value);
		if (quoteRess.length === 0) {
			throw new Error('Best quote attempts failed');
		}

		return quoteRess.reduce(
			(best, current) => (current.toAmount > best.toAmount ? current : best),
			quoteRess[0],
		);
	}

	async getBestOKX0xSwap(params: EVMSwapParams, retries?: number): Promise<EVMSwapResponse> {
		const results = await Promise.allSettled([
			this.getOkxSwap(params, retries),
			this.get0xSwap(params, retries),
		]);

		const swapRess = results
			.filter(
				(result): result is PromiseFulfilledResult<EVMSwapResponse> =>
					result.status === 'fulfilled',
			)
			.map((result) => result.value);
		if (swapRess.length === 0) {
			throw new Error('Best swap attempts failed');
		}

		return swapRess.reduce(
			(best, current) => (current.toAmount > best.toAmount ? current : best),
			swapRess[0],
		);
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
	[CHAIN_ID_UNICHAIN]: '',
};

const OkxDexRouterContracts: { [chainId: number]: string } = {
	[CHAIN_ID_ETH]: '0x6088d94C5a40CEcd3ae2D4e0710cA687b91c61d0',
	[CHAIN_ID_BSC]: '0x9b9efa5Efa731EA9Bbb0369E91fA17Abf249CFD4',
	[CHAIN_ID_POLYGON]: '0x9b9efa5Efa731EA9Bbb0369E91fA17Abf249CFD4',
	[CHAIN_ID_AVAX]: '0x9b9efa5Efa731EA9Bbb0369E91fA17Abf249CFD4',
	[CHAIN_ID_ARBITRUM]: '0x6088d94C5a40CEcd3ae2D4e0710cA687b91c61d0',
	[CHAIN_ID_OPTIMISM]: '0x9b9efa5Efa731EA9Bbb0369E91fA17Abf249CFD4',
	[CHAIN_ID_BASE]: '0x9b9efa5Efa731EA9Bbb0369E91fA17Abf249CFD4',
	[CHAIN_ID_UNICHAIN]: '',
};

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
