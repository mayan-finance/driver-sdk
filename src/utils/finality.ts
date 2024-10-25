import { SuiClient } from '@mysten/sui/client';
import { Connection } from '@solana/web3.js';
import { ethers } from 'ethers6';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	CHAIN_ID_SUI,
	isEVMChainId,
} from '../config/chains';
import { EvmProviders } from './evm-providers';
import logger from './logger';
import { delay } from './util';

export class ChainFinality {
	private readonly blockGenerationTimeSecond: {
		[chainId: number]: number;
	};
	private readonly minimumBlocksToFinality: {
		[chainId: number]: number;
	};

	private readonly finalizedBlocks: { [chainId: number]: number } = {
		[CHAIN_ID_ETH]: 20,
		[CHAIN_ID_BSC]: 8,
		[CHAIN_ID_POLYGON]: 80,
		[CHAIN_ID_AVAX]: 2,
		[CHAIN_ID_ARBITRUM]: 1,
		[CHAIN_ID_OPTIMISM]: 1,
		[CHAIN_ID_BASE]: 1,
	};

	private readonly minSwapValueUsd = 100;
	private readonly maxSwapValueUsd = 1_000_000;

	constructor(
		private readonly solanaConnection: Connection,
		private readonly suiClient: SuiClient,
		private readonly evmProviders: EvmProviders,
		private readonly secondaryEvmProviders: EvmProviders,
	) {
		this.blockGenerationTimeSecond = {
			[CHAIN_ID_ETH]: 13,
			[CHAIN_ID_BSC]: 3,
			[CHAIN_ID_POLYGON]: 2,
			[CHAIN_ID_AVAX]: 2,
			[CHAIN_ID_ARBITRUM]: 0.3,
			[CHAIN_ID_OPTIMISM]: 3,
			[CHAIN_ID_BASE]: 3,
		};

		this.minimumBlocksToFinality = {
			[CHAIN_ID_ETH]: 1,
			[CHAIN_ID_BSC]: 3,
			[CHAIN_ID_POLYGON]: 16,
			[CHAIN_ID_AVAX]: 1,
			[CHAIN_ID_ARBITRUM]: 1,
			[CHAIN_ID_OPTIMISM]: 1,
			[CHAIN_ID_BASE]: 1,
		};
	}

	async waitForEvm(chainId: number, sourceTxHash: string, swapValueUsd: number): Promise<void> {
		const startTime = Date.now();
		let iteration = 0;
		while (true) {
			try {
				const timeToFinalize = await this.timeToFinalizeSeconds(chainId, sourceTxHash, swapValueUsd);

				if (timeToFinalize <= 0) {
					if ([CHAIN_ID_ETH, CHAIN_ID_POLYGON].includes(chainId)) {
						const [tx, tx2] = await Promise.all([
							await this.evmProviders[chainId].getTransactionReceipt(sourceTxHash),
							await this.secondaryEvmProviders[chainId].getTransactionReceipt(sourceTxHash),
						]);
						if (!tx || tx.status !== 1 || !tx2 || tx2.status !== 1) {
							throw new Error('Transaction (eth)not found or has error in waiting for chain finality');
						}
						return;
					} else {
						const tx = await this.evmProviders[chainId].getTransactionReceipt(sourceTxHash);
						if (!tx || tx.status !== 1) {
							throw new Error('Transaction not found or has error in waiting for chain finality');
						}
						return;
					}
				}

				await delay(timeToFinalize * 1000);
			} catch (err: any) {
				logger.error(`Error while waiting for finality for tx: ${sourceTxHash} ${err.message}`);
				await delay(3000);
			} finally {
				iteration++;

				if (Date.now() - startTime > 60000) {
					logger.warn(`Waiting for finality for tx: ${sourceTxHash} for more than 60 seconds`);
				}

				if (Date.now() - startTime > 3600_000) {
					logger.error(`Waiting for finality for tx: ${sourceTxHash} took more than 1 hour. Giving up`);
					throw new Error('Waiting for finality for tx took more than 1 hour');
				}
			}
		}
	}

	async waitForFinality(sourceChain: number, sourceTxHash: string, swapValueUsd: number): Promise<void> {
		if (sourceChain === CHAIN_ID_SOLANA) {
			await this.solanaConnection.getTransaction(sourceTxHash, {
				commitment: 'confirmed',
				maxSupportedTransactionVersion: 2,
			});
		} else if (sourceChain === CHAIN_ID_SUI) {
			const res = await this.suiClient.getTransactionBlock({
				digest: sourceTxHash,
			});
			if (!res) {
				throw new Error('Transaction not found in waiting for finality');
			}
			// TODO add parser
		} else if (isEVMChainId(sourceChain)) {
			await this.waitForEvm(sourceChain, sourceTxHash, swapValueUsd);
		} else {
			throw new Error(`Chain ${sourceChain} is not supported`);
		}
	}

	private async getEvmLatestBlockNumber(provider: ethers.JsonRpcProvider): Promise<number> {
		const resOpt = await provider.send('eth_getBlockByNumber', ['latest', false]);
		return parseInt(resOpt.number);
	}

	private async timeToFinalizeSeconds(wChainId: number, txHash: string, swapValueUsd: number): Promise<number> {
		const tx = await this.evmProviders[wChainId].getTransaction(txHash);
		if (!tx) {
			throw new Error('Transaction not found in timeToFinalizeSeconds');
		}

		const finalizedBlockNumber = tx.blockNumber! + this.finalizedBlocks[wChainId];

		let safeBlockForDriver = finalizedBlockNumber;

		if (swapValueUsd < this.minSwapValueUsd) {
			safeBlockForDriver = tx.blockNumber! + this.minimumBlocksToFinality[wChainId];
		} else {
			const factor = (swapValueUsd - this.minSwapValueUsd) / (this.maxSwapValueUsd - this.minSwapValueUsd);
			const blocksToSemiFinalize =
				this.minimumBlocksToFinality[wChainId] +
				(this.finalizedBlocks[wChainId] - this.minimumBlocksToFinality[wChainId]) * factor;
			safeBlockForDriver = tx.blockNumber! + blocksToSemiFinalize;
		}

		const lastBlockNumber = await this.getEvmLatestBlockNumber(this.evmProviders[wChainId]);
		const remainingBlocks = safeBlockForDriver - lastBlockNumber;

		// every tx is polled at most 10 times so rpc usage is controlled
		return (remainingBlocks * this.blockGenerationTimeSecond[wChainId]) / 10;
	}
}

// class SwapVerifier {
// 	private readonly swiftInterface = new ethers.Interface(SwiftAbi);
// 	constructor() {}

// 	async parseEvmSwiftOrderHash(evmProvider: ethers.JsonRpcProvider, txHash: string): Promise<string> {
// 		const txReceipt = await evmProvider.getTransactionReceipt(txHash);
// 		if (txReceipt?.status !== 1) {
// 			throw new Error(`Failed creation transaction ${txHash}`);
// 		}

// 		for (let log of txReceipt?.logs || []) {
// 			if (log.topics.includes(ethers.id('OrderCreated(bytes32)'))) {
// 				const createLog = this.swiftInterface.decodeEventLog('OrderCreated(bytes32)', log.data, log.topics);
// 				const orderHash = createLog.key;
// 				return orderHash;
// 			}
// 		}

// 		throw new Error('OrderCreated event not found');
// 	}

// 	async parseSolanaSwift() {

// 	}

// 	async parseAndCreateInitOrder(sig: string, trx: ParsedTransactionWithMeta, parsedData: Instruction, instruction: PartiallyDecodedInstruction) {
// 		if (parsedData.name !== 'initOrder') {
// 			throw new Error('parsedData.name must be initOrder');
// 		}

// 		let forwardedTokenAddress: string = null;
// 		let forwardedFromAmount: string = null;
// 		let forwardedFromSymbol: string = null;
// 		for (let ix of trx.transaction.message.instructions) {
// 			if (ix.programId.toString() === this.providersConfig.JUP_V6_PROGRAM_ID) {
// 				const parsedJupAmount = await this.jupParser.extractJupSwapOriginalInput(trx, sig);
// 				if (parsedJupAmount) {
// 					forwardedTokenAddress = parsedJupAmount.inMint; // todo check if available in our tokens
// 					forwardedFromSymbol = parsedJupAmount.inSymbol;
// 					let token = await getTokenDataGeneral(
// 						CHAIN_ID_SOLANA,
// 						forwardedTokenAddress,
// 					);
// 					if (!token) {
// 						forwardedTokenAddress = null;
// 					} else {
// 						forwardedFromAmount = ethers.utils.formatUnits(
// 							parsedJupAmount.inAmount,
// 							token.decimals,
// 						);
// 					}
// 				}
// 			}
// 		}

// 		const {
// 			amountInMin, // BN
// 			nativeInput, // boolean
// 			feeSubmit, // BN
// 			addrDest, // bytes32. js array of number
// 			chainDest, // u8 js number
// 			tokenOut, // bytes32. js array of number
// 			amountOutMin, // BN
// 			gasDrop, // BN
// 			feeCancel, // BN
// 			feeRefund, // BN
// 			deadline, // BN
// 			addrRef, // bytes32. js array of number
// 			feeRateRef, // u8 js number
// 			feeRateMayan, // u8 js number
// 			auctionMode, // u8 js number
// 			keyRnd, // bytes32. js array of number
// 		} = (parsedData.data as any).params;

// 		const trader = instruction.accounts[0].toString();
// 		const stateAddr = instruction.accounts[2].toString();
// 		const stateFromAcc = instruction.accounts[3];
// 		const stateFromAccIdx = trx.transaction.message.accountKeys.findIndex(acc => acc.pubkey.equals(stateFromAcc));
// 		const mintFrom = instruction.accounts[5].toString();

// 		let fromAmount: bigint = null;
// 		for (let log of this.eventParser.parseLogs(trx.meta.logMessages, false)) {
// 			if (log.name === 'OrderInitialized') {
// 				fromAmount = BigInt(log.data.amountIn as any);
// 			}
// 		}

// 		if (!fromAmount) {
// 			const statePostBalance = trx.meta.postTokenBalances.find((tok) => tok.accountIndex === stateFromAccIdx);
// 			const statePreBalance = trx.meta.preTokenBalances.find((tok) => tok.accountIndex === stateFromAccIdx);

// 			if (!statePostBalance) {
// 				throw new Error(`fromAmount not found for sig ${sig}`);
// 			}
// 			const postAmount64  = BigInt(statePostBalance.uiTokenAmount.amount);
// 			const preAmount64 = BigInt(statePreBalance?.uiTokenAmount?.amount || '0');
// 			fromAmount = postAmount64 - preAmount64;
// 		}

// 		const randomKey = '0x' + Buffer.from(keyRnd).toString('hex');

// 		const fromToken = nativeInput ? NativeTokens[CHAIN_ID_SOLANA] : (await getTokenDataGeneral(CHAIN_ID_SOLANA, mintFrom));
// 		const toNativeToken = NativeTokens[chainDest];
// 		const destTokenAddress = tryUint8ArrayToNative(Uint8Array.from(tokenOut), chainDest);
// 		const toToken = (await getTokenDataGeneral(chainDest, destTokenAddress));
// 		const referrerAddress = tryUint8ArrayToNative(Uint8Array.from(addrRef), chainDest);
// 		const destAddress = tryUint8ArrayToNative(Uint8Array.from(addrDest), chainDest);
// 		if (!forwardedFromAmount) {
// 			forwardedTokenAddress = fromToken.contract;
// 			forwardedFromAmount = ethers.utils.formatUnits(fromAmount + BigInt(feeSubmit), fromToken.decimals);
// 		}

// 		const orderHash = reconstructOrderHash(
// 			trader,
// 			CHAIN_ID_SOLANA,
// 			fromToken.contract,
// 			fromToken.decimals,
// 			chainDest,
// 			toToken.contract,
// 			toToken.decimals,
// 			BigInt(amountOutMin),
// 			BigInt(gasDrop),
// 			BigInt(feeCancel),
// 			BigInt(feeRefund),
// 			deadline,
// 			destAddress,
// 			referrerAddress,
// 			feeRateRef,
// 			feeRateMayan,
// 			auctionMode,
// 			randomKey,
// 		);

// 		const calculatedState = getSwiftStateAddrSrc(instruction.programId, orderHash);

// 		if (calculatedState.toString() !== stateAddr) {
// 			throw new Error(`calculated state ${calculatedState.toString()} not equal to stateAddr ${stateAddr} for sig ${sig}`);
// 		}

// 		const newswap = await this.swapService.createSwap({
// 			id: uuidv4(),
// 			trader: trader,
// 			sourceTxBlockNo: trx.slot,
// 			sourceTxHash: sig,
// 			status: SWAP_STATUS.ORDER_CREATED,
// 			orderHash: '0x' + orderHash.toString('hex'),
// 			randomKey: randomKey,
// 			payloadId: null,
// 			statusUpdatedAt: new Date(trx.blockTime * 1000),
// 			deadline: new Date(Number(deadline) * 1000),
// 			sourceChain: CHAIN_ID_SOLANA.toString(),
// 			swapChain: chainDest.toString(),
// 			fromTokenAddress: fromToken.contract,
// 			fromTokenChain: fromToken.wChainId.toString(),
// 			fromTokenSymbol: fromToken.symbol,

// 			auctionMode: auctionMode,

// 			fromAmount: ethers.utils.formatUnits(fromAmount.toString(), fromToken.decimals),
// 			fromAmount64: fromAmount.toString(),
// 			forwardedFromAmount: forwardedFromAmount,
// 			forwardedTokenAddress: forwardedTokenAddress,
// 			forwardedTokenSymbol: forwardedFromSymbol,

// 			toTokenChain: toToken.wChainId.toString(),
// 			toTokenAddress: toToken.contract,
// 			toTokenSymbol: toToken.symbol,
// 			destChain: chainDest.toString(),
// 			destAddress: destAddress,
// 			bridgeFee: 0,

// 			submissionRelayerFee: ethers.utils.formatUnits(
// 				feeSubmit.toString(),
// 				Math.min(WORMHOLE_DECIMALS, fromToken.decimals),
// 			),
// 			redeemRelayerFee: ethers.utils.formatUnits(
// 				feeCancel.toString(),
// 				Math.min(WORMHOLE_DECIMALS, fromToken.decimals),
// 			),
// 			refundRelayerFee: ethers.utils.formatUnits(
// 				feeRefund.toString(),
// 				Math.min(WORMHOLE_DECIMALS, fromToken.decimals),
// 			),
// 			auctionAddress: this.swiftConfig.auctionAddr,

// 			mayanAddress: instruction.programId.toString(),
// 			posAddress: instruction.programId.toString(),
// 			referrerBps: feeRateRef,
// 			mayanBps: feeRateMayan,
// 			referrerAddress: referrerAddress,

// 			stateAddr: stateAddr,
// 			auctionStateAddr: PublicKey.findProgramAddressSync(
// 				[Buffer.from('AUCTION'), orderHash],
// 				this.auction,
// 			)[0].toString(),

// 			minAmountOut: ethers.utils.formatUnits(
// 				amountOutMin.toString(),
// 				Math.min(WORMHOLE_DECIMALS, toToken.decimals),
// 			),
// 			minAmountOut64: amountOutMin.toString(),

// 			gasDrop: ethers.utils.formatUnits(
// 				gasDrop.toString(),
// 				Math.min(WORMHOLE_DECIMALS, toNativeToken.decimals),
// 			),
// 			gasDrop64: gasDrop.toString(),

// 			service: SERVICE_TYPE.SWIFT_SWAP,
// 			savedAt: new Date(),
// 			initiatedAt: new Date(trx.blockTime * 1000),
// 		});
// 		return newswap;
// 	}
// }
