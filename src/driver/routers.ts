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
import { delay, isNativeToken } from '../utils/util';
import logger from '../utils/logger';
import {
	AddressLookupTableAccount,
	Connection,
	TransactionMessage,
	VersionedMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { base58_to_binary } from '../utils/base58';
import { getOkxQuote, getOkxSwap } from '../utils/okx';

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

type SolQuoteParams = {
	inputMint: string;
	outputMint: string;
	slippageBps: number;
	amount: number | string;
	maxAccounts: number;
	dexes?: string[];
	excludeDexes?: string[];
	timeout?: number;
};

type SolQuoteResponse = {
	inputMint: string;
	inAmount: string;
	outputMint: string;
	outAmount: string;
	otherAmountThreshold: string;
	priceImpactPct: string;
	raw: any;
};

type SolSwapParams = SolQuoteParams & {
	userPublicKey: string;
	destinationTokenAccount: string;
	ledger: string;
	wrapUnwrapSol: boolean;
	connection?: Connection;
};

type SolSwapResponse = {
	swapTransaction: string;
	outAmount: string;
	otherAmountThreshold: string;
	versionedMessage: VersionedMessage;
	addressLookupTableAccounts?: AddressLookupTableAccount[];
	transactionMessage?: TransactionMessage;
};

export class SwapRouters {
	private readonly okxIface = new ethers.Interface(OkxHelperAbi);

	constructor(
		private readonly contractsConfig: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
	) {}

	async getEVMQuote(quoteParams: EVMQuoteParams, retries: number = 3): Promise<EVMQuoteResponse> {
		try {
			return await this.get1InchQuote(quoteParams, retries);
		} catch (err) {
			console.error(`Error using 1inch as swap ${err}. trying okx`);
			try {
				return await this.getOkxEVMQuote(quoteParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async getEVMSwap(params: EVMSwapParams, retries: number = 3): Promise<EVMSwapResponse> {
		try {
			return await this.get1InchSwap(params, retries);
		} catch (err) {
			console.error(`Error using 1inch as swap ${err}. trying okx`);
			try {
				return await this.getOkxEVMSwap(params, retries);
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

	async get1InchSwap(params: EVMSwapParams, retries: number = 3): Promise<EVMSwapResponse> {
		const apiUrl = `https://api.1inch.dev/swap/v6.0/${WhChainIdToEvm[params.whChainId]}/swap`;

		if (params.srcToken === ZeroAddress) {
			params.srcToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		if (params.destToken === ZeroAddress) {
			params.destToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
		}
		params.includeGas = params.includeGas ?? true;

		const timeout = params.timeout || 1500;
		const swapSourceDst = this.contractsConfig.evmFulfillHelpers[params.whChainId];
		const config: AxiosRequestConfig = {
			timeout: timeout,
			headers: {
				Authorization: `Bearer ${this.rpcConfig.oneInchApiKey}`,
			},
			params: {
				src: params.srcToken,
				dst: params.destToken,
				amount: params.amountIn,
				from: swapSourceDst,
				slippage: params.slippagePercent,
				disableEstimate: true,
				includeGas: params.includeGas!,
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
				return this.get1InchSwap(params, retries - 1);
			}
			throw new Error(`Failed to get swap from 1inch: ${err}`);
		}
	}

	async getOkxEVMQuote(params: EVMQuoteParams, retries: number = 3): Promise<EVMQuoteResponse> {
		const res = await getOkxQuote(
			{
				amountIn: params.amountIn,
				destToken: params.destToken,
				realChainId: WhChainIdToEvm[params.whChainId],
				srcToken: params.srcToken,
				timeout: params.timeout,
			},
			this.rpcConfig.okxApiKey,
			this.rpcConfig.okxPassPhrase,
			this.rpcConfig.okxSecretKey,
			retries,
		);
		return {
			toAmount: res.toTokenAmount,
			gas: Number(res.estimateGasFee),
		};
	}

	async getOkxEVMSwap(params: EVMSwapParams, retries: number = 7): Promise<EVMSwapResponse> {
		let swapDest = this.contractsConfig.evmFulfillHelpers[params.whChainId];
		let swapSource = this.contractsConfig.evmFulfillHelpers[params.whChainId];
		if (!isNativeToken(params.srcToken)) {
			swapSource = okxSwapHelpers[params.whChainId];
		}

		const res = await getOkxSwap(
			{
				amountIn: params.amountIn,
				destToken: params.destToken,
				realChainId: WhChainIdToEvm[params.whChainId],
				srcToken: params.srcToken,
				slippagePercent: params.slippagePercent / 100,
				userWalletAddress: swapSource,
				swapReceiverAddress: swapDest,
				timeout: params.timeout,
			},
			this.rpcConfig.okxApiKey,
			this.rpcConfig.okxPassPhrase,
			this.rpcConfig.okxSecretKey,
			retries || 3,
		);

		if (!isNativeToken(params.srcToken)) {
			// erc 20
			const data = this.okxIface.encodeFunctionData('approveAndForward', [
				params.srcToken,
				params.amountIn,
				tokenApprovalContracts[params.whChainId],
				res.tx.to,
				res.tx.data,
			]);
			res.tx.data = this.okxIface.getFunction('approveAndForward')?.selector + data.slice(10);
			res.tx.to = okxSwapHelpers[params.whChainId];
		}

		return {
			tx: res.tx,
			gas: Number(res.tx.gas),
			toAmount: res.routerResult.toTokenAmount,
		};
	}

	async getSolQuote(quoteParams: SolQuoteParams, retries: number = 3): Promise<SolQuoteResponse | null> {
		try {
			return await this.fetchJupQuote(quoteParams, retries);
		} catch (err) {
			console.error(`Error using jup as swap ${err}. trying okx`);
			try {
				return await this.getOkxSolQuote(quoteParams, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async getSolSwap(params: SolSwapParams, retries: number = 3): Promise<SolSwapResponse> {
		try {
			return await this.fetchJupSwap(params, retries);
		} catch (err) {
			console.error(`Error using jup as swap ${err}. trying okx`);
			try {
				return await this.getOkxSolSwap(params, retries);
			} catch (errrr) {
				throw errrr;
			}
		}
	}

	async fetchJupQuote(quoteParams: SolQuoteParams, retries: number = 10): Promise<SolQuoteResponse | null> {
		let res;
		do {
			try {
				let params: any = {
					inputMint: quoteParams.inputMint,
					outputMint: quoteParams.outputMint,
					slippageBps: quoteParams.slippageBps,
					maxAccounts: quoteParams.maxAccounts,
					amount: quoteParams.amount,
					token: this.rpcConfig.jupApiKey,
				};
				if (!!this.rpcConfig.jupExcludedDexes) {
					params['excludeDexes'] = this.rpcConfig.jupExcludedDexes;
				}

				const { data } = await axios.get(`${this.rpcConfig.jupV6Endpoint}/quote`, {
					params,
				});
				res = data;
			} catch (err) {
				logger.warn(`error in fetch jupiter ${err} try ${retries}`);
			} finally {
				retries--;
			}
		} while ((!res || !res.outAmount) && retries > 0);

		if (!res) {
			logger.error(
				`juptier quote failed ${quoteParams.inputMint} ${quoteParams.outputMint} ${quoteParams.amount}`,
			);
			return null;
		}

		return {
			inputMint: res.inputMint,
			inAmount: res.inAmount,
			outputMint: res.outputMint,
			outAmount: res.outAmount,
			otherAmountThreshold: res.otherAmountThreshold,
			priceImpactPct: res.priceImpactPct,
			raw: res,
		};
	}

	async fetchJupSwap(params: SolSwapParams, retries?: number): Promise<SolSwapResponse> {
		try {
			const quoteRes = await this.fetchJupQuote(params, retries);
			const { data } = await axios.post(`${this.rpcConfig.jupV6Endpoint}/swap`, {
				quoteResponse: quoteRes!.raw,
				userPublicKey: params.userPublicKey,
				destinationTokenAccount: params.destinationTokenAccount,
				wrapAndUnwrapSol: params.wrapUnwrapSol,
				dynamicComputeUnitLimit: false, // 14m
				prioritizationFeeLamports: 'auto',
			});

			const vm = VersionedTransaction.deserialize(Buffer.from(data.swapTransaction, 'base64')).message;

			let jupLookupTables: AddressLookupTableAccount[] | undefined, decompiledMsg: TransactionMessage | undefined;
			if (params.connection) {
				const lt = await Promise.all(
					vm.addressTableLookups.map((a) => params.connection!.getAddressLookupTable(a.accountKey)),
				);
				jupLookupTables = lt.map((l) => l.value!);

				decompiledMsg = TransactionMessage.decompile(vm, {
					addressLookupTableAccounts: jupLookupTables,
				});
			}

			return {
				swapTransaction: data.swapTransaction,
				otherAmountThreshold: quoteRes!.otherAmountThreshold,
				outAmount: quoteRes!.outAmount,
				versionedMessage: vm,
				addressLookupTableAccounts: jupLookupTables,
				transactionMessage: decompiledMsg,
			};
		} catch (error) {
			logger.warn(`Failed to fetch Jup swap instructions: ${params} ${error}`);
			if (retries && retries > 0) {
				return this.fetchJupSwap(params, retries - 1);
			}
			throw error;
		}
	}

	async getOkxSolQuote(params: SolQuoteParams, retries?: number): Promise<SolQuoteResponse | null> {
		// On sol quote we need otherAmountThreshold in response so we have to use OKX
		// swap API.
		const res = await getOkxSwap(
			{
				amountIn: params.amount.toString(),
				destToken: params.outputMint,
				realChainId: 501,
				srcToken: params.inputMint,
				slippagePercent: params.slippageBps / 100,
				// For OKX swap API we need user wallet which we dont use for quote, So
				// we just give a valid arbitrary address.
				userWalletAddress: '4ZgCP2idpqrxuQNfsjakJEm9nFyZ2xnT4CrDPKPULJPk',
				swapReceiverAddress: '4ZgCP2idpqrxuQNfsjakJEm9nFyZ2xnT4CrDPKPULJPk',
				timeout: params.timeout,
			},
			this.rpcConfig.okxApiKey,
			this.rpcConfig.okxPassPhrase,
			this.rpcConfig.okxSecretKey,
			retries || 3,
		);

		return {
			inputMint: res.routerResult.fromToken.tokenContractAddress,
			inAmount: res.routerResult.fromTokenAmount,
			outputMint: res.routerResult.toToken.tokenContractAddress,
			outAmount: res.routerResult.toTokenAmount,
			otherAmountThreshold: res.tx.minReceiveAmount,
			priceImpactPct: res.routerResult.priceImpactPercentage,
			raw: res,
		};
	}

	async getOkxSolSwap(params: SolSwapParams, retries?: number): Promise<SolSwapResponse> {
		const res = await getOkxSwap(
			{
				amountIn: params.amount.toString(),
				destToken: params.outputMint,
				realChainId: 501,
				srcToken: params.inputMint,
				slippagePercent: params.slippageBps / 100,
				userWalletAddress: params.userPublicKey,
				swapReceiverAddress: params.ledger,
				timeout: params.timeout,
			},
			this.rpcConfig.okxApiKey,
			this.rpcConfig.okxPassPhrase,
			this.rpcConfig.okxSecretKey,
			retries || 3,
		);
		const vm = VersionedTransaction.deserialize(base58_to_binary(res.tx.data)).message;

		let addressLookupTableAccounts: AddressLookupTableAccount[] | undefined,
			transactionMessage: TransactionMessage | undefined;
		if (params.connection) {
			const lt = await Promise.all(
				vm.addressTableLookups.map((a) => params.connection!.getAddressLookupTable(a.accountKey)),
			);
			addressLookupTableAccounts = lt.map((l) => l.value!).filter((v) => v !== null);
			transactionMessage = TransactionMessage.decompile(vm, {
				addressLookupTableAccounts,
			});
		}

		return {
			swapTransaction: res.tx.data,
			outAmount: res.routerResult.toTokenAmount,
			otherAmountThreshold: res.tx.minReceiveAmount,
			versionedMessage: vm,
			addressLookupTableAccounts,
			transactionMessage,
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
