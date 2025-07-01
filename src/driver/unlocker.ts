import { ChainId, getSignedVAAWithRetry, parseVaa } from '@certusone/wormhole-sdk';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import axios from 'axios';
import { ethers, keccak256 } from 'ethers6';
import * as SuiTx from '@mysten/sui/transactions';
import { abi as WormholeAbi } from '../abis/wormhole.abi';
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
	CHAIN_ID_UNICHAIN,
	isEvmChainId,
} from '../config/chains';
import { ContractsConfig, FeeCollectorSolana, SolanaProgramV2 } from '../config/contracts';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import {
	hexToUint8Array,
	tryNativeToUint8Array,
	tryNativeToUint8ArrayGeneral,
	tryTokenToUint8ArrayGeneral,
	tryUint8ArrayToNative,
	uint8ArrayToHex,
} from '../utils/buffer';
import { EvmProviders } from '../utils/evm-providers';
import { getSuggestedOverrides } from '../utils/evm-trx';
import { NodeHttpTransportWithDefaultTimeout } from '../utils/grpc';
import logger from '../utils/logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from '../utils/solana-trx';
import {
	EVM_STATES,
	SOLANA_SRC_STATUSES,
	getSwiftStateAddrDest,
	getSwiftStateAddrSrc,
	parseSwiftStateSrc,
} from '../utils/state-parser';
import { delay } from '../utils/util';
import { VaaPoster } from '../utils/vaa-poster';
import {
	WORMHOLE_SUI_CORE_ID,
	WORMHOLE_SUI_PACKAGE,
	addParseAndVerifySui,
	findVaaAddress,
	getEmitterAddressEth,
	getEmitterAddressSolana,
	getSequenceFromWormholeScan,
	getSignedVAAWithRetryGeneric,
	getWormholeSequenceFromPostedMessage,
	get_wormhole_core_accounts,
} from '../utils/wormhole';
import { NewSolanaIxHelper } from './solana-ix';
import { WalletsHelper } from './wallet-helper';
import { Token, TokenList, tokenTo32ByteAddress } from '../config/tokens';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { SuiClient } from '@mysten/sui/client';
const LogMessagePublishedSig = 'LogMessagePublished(address,uint64,uint32,bytes,uint8)';

export type UnlockableSwapBatchItem = {
	fromChain: number;
	toChain: number;
	orders: {
		mayanBps: number;
		referrerBps: number;
		referrerAddress: string;
		completedAt: string;
		fromTokenAddress: string;
		orderHash: string;
		volume: string;
		unlockSequence?: string;
		lockedFundObjectId: string;
	}[];
};
export type UnlockableSwapSingleItem = {
	fromChain: number;
	toChain: number;
	order: {
		fromTokenAddress: string;
		orderHash: string;
		unlockSequence: string;
		mayanBps: number;
		referrerBps: number;
		referrerAddress: string;
		completedAt: string;
		lockedFundObjectId: string;
	};
};

const MAX_BATCH_SIZE = 8;

export class Unlocker {
	private readonly solprogram = new PublicKey(SolanaProgramV2);
	private readonly driverAddresses: string[] = [];
	private locks: { [key: string]: boolean } = {};
	private readonly wormholeInterface = new ethers.Interface(WormholeAbi);

	private readonly mayanSharedLookupTableAddress = new PublicKey('7cBja9T7X4qG1drbDy6QaJMs6zgEFxXT6roqbm4oxHFT');

	public interval: NodeJS.Timeout | null = null;
	public unlockInterval: NodeJS.Timeout | null = null;

	private sequenceStore: SequenceStore;

	constructor(
		private readonly gConf: GlobalConfig,
		private readonly endpoints: MayanEndpoints,
		private readonly contracts: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly walletConfig: WalletConfig,
		private readonly solanaConnection: Connection,
		private readonly evmProviders: EvmProviders,
		private readonly solanaIx: NewSolanaIxHelper,
		private readonly priorityFeeService: PriorityFeeHelper,
		private readonly solanaSender: SolanaMultiTxSender,
		private readonly walletsHelper: WalletsHelper,
		private readonly vaaPoster: VaaPoster,
		private readonly tokenList: TokenList,
		private readonly suiClient: SuiClient,
	) {
		this.sequenceStore = new SequenceStore();

		this.driverAddresses.push(this.walletConfig.solana.publicKey.toString());
		this.driverAddresses.push(this.walletConfig.evm.address);
		this.driverAddresses.push(this.walletConfig.sui.toSuiAddress());
	}

	scheduleUnlockJobs() {
		if (this.gConf.disableUnlocker) {
			logger.info(`Unlocker is disabled and ignored.`);
			return;
		}
		this.interval = setInterval(this.fetchAndProgressUnlocks.bind(this), 1 * 1000);
		this.unlockInterval = setInterval(this.unlockPostedBatches.bind(this), 1 * 1000);
	}

	private async unlockPostedBatches() {
		try {
			for (let [postTxHash, postedData] of this.sequenceStore.postedSequences.entries()) {
				if (postedData.fromChainId === CHAIN_ID_SOLANA) {
					await this.getPendingBatchUnlockAndUnlockSolana(
						postedData.toChainId,
						postedData.sequence.toString(),
						postTxHash,
						postedData.orders,
					);
				} else if (isEvmChainId(postedData.fromChainId)) {
					await this.getPendingBatchUnlockAndUnlockEvm(
						postedData.orders,
						postedData.fromChainId,
						postedData.toChainId,
						postedData.sequence.toString(),
						postTxHash,
					);
				} else if (postedData.fromChainId === CHAIN_ID_SUI) {
					await this.getPendingBatchUnlockAndUnlockSui(
						postedData.orders,
						postedData.fromChainId,
						postedData.toChainId,
						postedData.sequence.toString(),
						postTxHash,
					);
				} else {
					throw new Error(`Unsupported chainId to unlock ${postedData.fromChainId}`);
				}
				await delay(20); // avoid running everything together
			}
		} catch (err) {
			logger.error(`Error in unlockPostedBatches ${err}`);
		}
	}

	private async fetchAndProgressUnlocks() {
		try {
			if (Object.keys(this.locks).length > 1000) {
				throw new Error('Too many ongoing unlocks... Waiting for some of them to finish unlocking');
			}
			const freshExplorerData = await this.getOwnedUnlockableSwaps(this.driverAddresses);
			let promises: Promise<void>[] = [];
			for (let singleUnlockData of freshExplorerData.singleData) {
				promises.push(
					this.performSingleUnlocks(
						singleUnlockData.fromChain,
						singleUnlockData.toChain,
						singleUnlockData.order.orderHash,
						singleUnlockData.order.fromTokenAddress,
						singleUnlockData.order.unlockSequence,
						singleUnlockData.order.referrerAddress,
						singleUnlockData.order.referrerBps,
						singleUnlockData.order.mayanBps,
					),
				);
				await delay(20); // avoid running everything together
			}
			return;

			for (let postedUnlockData of freshExplorerData.postedBatchData) {
				const orderHashs = postedUnlockData.orders.map((order) => order.orderHash);
				let alreadyUnlocked: Set<string>;
				if (+postedUnlockData.fromChain === CHAIN_ID_SOLANA) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSolana(
						orderHashs,
						postedUnlockData.toChain,
					);
				} else if (isEvmChainId(postedUnlockData.fromChain)) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
						postedUnlockData.fromChain,
						orderHashs,
					);
				} else if (postedUnlockData.fromChain === CHAIN_ID_SUI) {
					alreadyUnlocked = new Set();
				} else {
					throw new Error(`Unsupported chainId to check for already unlocked ${postedUnlockData.fromChain}`);
				}

				postedUnlockData.orders = postedUnlockData.orders.filter(
					(order) => !alreadyUnlocked.has(order.orderHash),
				);

				this.scheduleAlreadyPostedUnlocks(postedUnlockData);
			}

			for (let batchUnlockData of freshExplorerData.batchData) {
				const orderHashs = batchUnlockData.orders.map((order) => order.orderHash);
				let alreadyUnlocked: Set<string>;
				if (+batchUnlockData.fromChain === CHAIN_ID_SOLANA) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSolana(
						orderHashs,
						batchUnlockData.toChain,
					);
				} else if (isEvmChainId(batchUnlockData.fromChain)) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
						batchUnlockData.fromChain,
						orderHashs,
					);
				} else if (batchUnlockData.fromChain === CHAIN_ID_SUI) {
					alreadyUnlocked = new Set();
				} else {
					throw new Error(`Unsupported chainId to check${batchUnlockData.fromChain}`);
				}

				let filteredOrders = batchUnlockData.orders.filter((order) => !alreadyUnlocked.has(order.orderHash));
				filteredOrders.sort((a, b) => {
					// sort descending volume
					return Number(b.volume) - Number(a.volume);
				});

				let chunkSize = MAX_BATCH_SIZE;
				for (let i = 0; i < filteredOrders.length; i += chunkSize) {
					const chunk = filteredOrders.slice(i, i + chunkSize);
					promises.push(
						this.selectAndBatchPostWhSequence(batchUnlockData.fromChain, batchUnlockData.toChain, chunk),
					);
					await delay(20); // avoid running everything together
				}
				await delay(20); // avoid running everything together
			}

			await Promise.all(promises);
		} catch (error) {
			logger.error(`Unable to schedulePending for unlock ${error}`);
		}
	}

	private async selectAndBatchPostWhSequence(
		sourceChainId: number,
		destChainId: number,
		initialOrders: {
			orderHash: string;
			fromTokenAddress: string;
			volume: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			lockedFundObjectId: string;
		}[],
	) {
		const lockKey = `lock:selectAndPost:${sourceChainId}:${destChainId}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				logger.info(`Already pending selectAndBatchPostWhSequence for ${sourceChainId}-${destChainId}`);
				return;
			} else {
				this.locks[lockKey] = true;
			}

			if (!initialOrders || initialOrders.length < 1) {
				delete this.locks[lockKey];
				return;
			}

			for (let order of initialOrders) {
				if (this.sequenceStore.isOrderAlreadyPosted(order.orderHash)) {
					logger.warn(`Has already pending order hashes ignoring ${sourceChainId}-${destChainId}`);
					delete this.locks[lockKey];
					return;
				}
			}

			let alreadyUnlocked: Set<string>;
			if (sourceChainId === CHAIN_ID_SOLANA) {
				alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSolana(
					initialOrders.map((o) => o.orderHash),
					destChainId,
				);
			} else if (isEvmChainId(sourceChainId)) {
				alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
					sourceChainId,
					initialOrders.map((o) => o.orderHash),
				);
			} else if (sourceChainId === CHAIN_ID_SUI) {
				alreadyUnlocked = new Set();
			} else {
				throw new Error(`Unsupported chainId to check for already unlocked ${sourceChainId}`);
			}

			let filteredOrders = initialOrders.filter((order) => !alreadyUnlocked.has(order.orderHash));

			if (filteredOrders.length > 20) {
				throw new Error(`Too many orderHashes might not fit into block...`);
			}

			let volumeStep = 20_000;
			let desiredUnlockValue = 13000;
			switch (sourceChainId) {
				case CHAIN_ID_ARBITRUM:
				case CHAIN_ID_BASE:
				case CHAIN_ID_UNICHAIN:
				case CHAIN_ID_OPTIMISM:
				case CHAIN_ID_POLYGON:
				case CHAIN_ID_BSC:
				case CHAIN_ID_AVAX:
					volumeStep = 2000;
					break;
				case CHAIN_ID_ETH:
					volumeStep = 16000;
					break;
				default:
					break;
			}

			let totalVolume = filteredOrders.reduce((acc, order) => acc + Number(order.volume), 0);
			let volumeSteps = Math.ceil(totalVolume / volumeStep);

			if (
				filteredOrders.length < this.gConf.batchUnlockThreshold &&
				volumeSteps < this.gConf.batchUnlockThreshold - 2
			) {
				logger.verbose(
					`Not enough swaps to select and post for ${sourceChainId} to ${destChainId}. min ${filteredOrders.length} ${volumeStep} ${desiredUnlockValue}`,
				);
				delete this.locks[lockKey];
				return;
			}

			filteredOrders = filteredOrders.slice(0, MAX_BATCH_SIZE); // we can not put more than 8 this in one udp solana trx without luts or hitting inner instruction limit

			const orderHashes = filteredOrders.map((order) => order.orderHash);
			logger.info(`Posting and acquiring sequence for ${sourceChainId} to ${destChainId} for batch`);
			let sequence: bigint, txHash: string;
			if (destChainId === CHAIN_ID_SOLANA) {
				const result = await this.batchPostSolana(orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else if (isEvmChainId(destChainId)) {
				const result = await this.batchPostEvm(destChainId, orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else if (destChainId === CHAIN_ID_SUI) {
				const result = await this.batchPostSui(destChainId, orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else {
				throw new Error(`Unsupported chainId ${destChainId}`);
			}
			const postSequence = sequence;
			const postTxHash = txHash;

			this.sequenceStore.addBatchPostedSequence(
				sourceChainId,
				destChainId,
				filteredOrders,
				postSequence,
				postTxHash,
			);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`selectAndPostWhSequence failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async getPendingBatchUnlockAndUnlockSolana(
		destChainId: number,
		sequence: string,
		postTxHash: string,
		orders: {
			fromTokenAddress: string;
			orderHash: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			completedAt: string;
		}[],
	) {
		const sourceChainId = CHAIN_ID_SOLANA;
		const lockKey = `lock:getPendingBatchUnlockAndUnlockSolana:${postTxHash}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				return;
			} else {
				this.locks[lockKey] = true;
			}

			logger.info(`Getting batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			let signedVaa = await this.getSignedVaa(sequence, destChainId, 60);
			logger.info(`Got batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);

			const txHash = await this.unlockBatchOnSolana(
				Buffer.from(signedVaa.replace('0x', ''), 'hex'),
				orders,
				destChainId,
			);
			logger.info(`Unlocked batch solana for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(
				`getPendingBatchUnlockAndRefund  Solana failed for ${sourceChainId} to ${destChainId} - sequence: ${sequence} - postTX: ${postTxHash} - ${err}`,
			);
			delete this.locks[lockKey];
		}
	}

	private async unlockSingleOnSolana(
		ord: {
			referrerAddress: string;
			referrerBps: number;
			mayanBps: number;
		},
		signedVaa: Buffer,
		orderHash: string,
		fromTokenAddress: string,
		destChainId: number,
	): Promise<string> {
		const stateAddr = getSwiftStateAddrSrc(
			new PublicKey(SolanaProgramV2),
			Buffer.from(orderHash.replace('0x', ''), 'hex'),
			destChainId,
		);
		const fromMint = new PublicKey(fromTokenAddress);
		const stateFromAss = getAssociatedTokenAddressSync(fromMint, stateAddr, true);

		const parsedVaa = parseVaa(signedVaa);
		const postVaa = await this.vaaPoster.postSignedVAA(signedVaa, 'single_unlock');
		// const unlockData = this.parseSingleUnlockVaaPayload(parsedVaa.payload);
		const vaaAddr = findVaaAddress(signedVaa);
		const driver = this.walletConfig.solana.publicKey;
		const driverFromAss = getAssociatedTokenAddressSync(fromMint, driver, false);

		// const guardianSigners = Keypair.fromSecretKey(new Uint8Array([
		// 	24,161,97,164,15,255,65,66,221,231,77,49,169,208,29,53,181,105,210,2,14,215,243,151,173,25,3,199,46,59,107,220,221,242,31,59,108,34,55,5,201,219,72,13,23,93,184,159,36,202,181,102,148,216,161,58,113,138,200,111,252,208,0,250
		// ]));
		const guardianSigners = Keypair.generate();
		const postSigIx = await this.solanaIx.getPostSignaturesIx(
			this.walletConfig.solana.publicKey,
			guardianSigners.publicKey,
			parsedVaa.guardianSetIndex,
			19,
			parsedVaa.guardianSignatures.length,
			parsedVaa.guardianSignatures,
		);
		const txHash1 = await this.solanaSender.createAndSendOptimizedTransaction(
			[postSigIx],
			[this.walletConfig.solana, guardianSigners],
			[],
			30,
			true,
		);

		
		let referrerAddr = new PublicKey(ord.referrerAddress);
		let referrerFeeAcc = getAssociatedTokenAddressSync(fromMint, referrerAddr, true);
		if (ord.referrerBps === 0) {
			referrerFeeAcc = new PublicKey(SolanaProgramV2);
		}
		let mayanFeeAcc = getAssociatedTokenAddressSync(fromMint, new PublicKey(FeeCollectorSolana), true);
		if (ord.mayanBps === 0) {
			mayanFeeAcc = new PublicKey(SolanaProgramV2);
		}

		// extract vaa body (ignore vaa header):
		const sigLen = signedVaa[5];
		const vaaHeaderLength = 1 + 4 + 1 + sigLen * 66;

		const ix = await this.solanaIx.getUnlockSingleIx(
			vaaAddr,
			referrerAddr,
			referrerFeeAcc,
			mayanFeeAcc,
			driver,
			driverFromAss,
			stateAddr,
			stateFromAss,
			fromMint,
			guardianSigners.publicKey,
			parsedVaa.guardianSetIndex,
			signedVaa.subarray(vaaHeaderLength),
		);
		// const closeSigIx = await this.solanaIx.getCloseSignaturesIx(
		// 	guardianSigners.publicKey,
		// 	this.walletConfig.solana.publicKey,
		// );
		const txHash = await this. solanaSender.createAndSendOptimizedTransaction(
			[ix],
			[this.walletConfig.solana],
			[],
			30,
			true,
		);

		return txHash;
	}

	private async unlockBatchOnSolana(
		signedVaa: Buffer,
		orders: {
			fromTokenAddress: string;
			orderHash: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			completedAt: string;
		}[],
		destChainId: number,
	) {
		await this.vaaPoster.postSignedVAA(signedVaa, 'batch_unlcock');

		const foundStates = orders.map((ord) =>
			getSwiftStateAddrSrc(
				new PublicKey(SolanaProgramV2),
				Buffer.from(ord.orderHash.replace('0x', ''), 'hex'),
				destChainId,
			).toString(),
		);

		const parsedPayload = this.parseBatchUnlockVaaPayload(parseVaa(signedVaa).payload);
		if (!parsedPayload.compactHash) {
			return this.unlockBatchNonCompactSolana(signedVaa, destChainId, parsedPayload, foundStates);
		} else {
			return this.unlockBatchCompactSolana(signedVaa, orders, destChainId);
		}
	}

	private getWinner32(chain: number) {
		if (chain === CHAIN_ID_SOLANA) {
			return this.walletConfig.solana.publicKey.toBuffer();
		} else if (chain === CHAIN_ID_SUI) {
			return hexToUint8Array(this.walletConfig.sui.toSuiAddress());
		} else if (isEvmChainId(chain)) {
			return tryNativeToUint8ArrayGeneral(this.walletConfig.evm.address, chain);
		} else {
			throw new Error(`Unsupported chainId ${chain}`);
		}
	}

	private async prepareAndVerifyCompactUnlockSolana(
		signedVaa: Buffer,
		_orders: {
			orderHash: string;
			fromTokenAddress: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			completedAt: string;
		}[],
		destChain: number,
	): Promise<PublicKey> {
		const orders = destChain === CHAIN_ID_SUI ? _orders.reverse() : _orders;
		const vaaAddr = findVaaAddress(signedVaa);
		const [compactUnlock] = PublicKey.findProgramAddressSync(
			[Buffer.from('COMPACT_UNLOCK'), vaaAddr.toBuffer(), this.walletConfig.solana.publicKey.toBuffer()],
			new PublicKey(SolanaProgramV2),
		);
		const compactRes = await this.solanaConnection.getAccountInfo(compactUnlock);
		let alreadyVerified = false;
		if (compactRes) {
			logger.info(`Unlock already initiated for ${destChain}`);
			const status = compactRes.data.readUInt8(73); //8 + 1 +32 +32
			if (status === 2) {
				alreadyVerified = true;
			}
		} else {
			const initIx = await this.solanaIx.getInitCompactUnlockIx(
				orders.length,
				vaaAddr,
				compactUnlock,
				this.walletConfig.solana.publicKey,
			);
			const txHash = await this.solanaSender.createAndSendOptimizedTransaction(
				[initIx],
				[this.walletConfig.solana],
				[],
				30,
				true,
			);

			logger.info(`initCompactUnlock done for ${destChain} with ${txHash}`);
		}

		if (alreadyVerified) {
			return compactUnlock;
		}
		for (let j = 0; j < orders.length; j = j + 3) {
			const batch = orders.slice(j, j + 3);
			const dataLen = batch.length * 172;
			const data = Buffer.alloc(dataLen);
			for (let i = 0; i < batch.length; i++) {
				let offset = i * 172;
				data.set(hexToUint8Array(batch[i].orderHash), offset);
				offset += 32;
				data.writeUInt16BE(CHAIN_ID_SOLANA, offset);
				offset += 2;
				const tokenIn32 = tryNativeToUint8ArrayGeneral(batch[i].fromTokenAddress, CHAIN_ID_SOLANA);
				data.set(tokenIn32, offset);
				offset += 32;
				const refAddr32 = tryNativeToUint8ArrayGeneral(batch[i].referrerAddress, CHAIN_ID_SOLANA);
				data.set(refAddr32, offset);
				offset += 32;
				data.writeUInt8(batch[i].referrerBps, offset);
				offset += 1;
				data.writeUInt8(batch[i].mayanBps, offset);
				offset += 1;
				data.set(this.walletConfig.solana.publicKey.toBuffer(), offset);
				offset += 32;
				data.set(this.getWinner32(destChain), offset);
				offset += 32;
				data.writeBigUInt64BE(BigInt(Math.floor(new Date(batch[i].completedAt).getTime() / 1000)), offset);
			}

			const startIndex = 3 + j * 172;
			const endIndex = startIndex + dataLen;
			console.log({ startIndex, endIndex });
			const writeIx = await this.solanaIx.getWriteCompactUnlockIx(
				startIndex,
				endIndex,
				data,
				compactUnlock,
				this.walletConfig.solana.publicKey,
			);
			const writeTx = await this.solanaSender.createAndSendOptimizedTransaction(
				[writeIx],
				[this.walletConfig.solana],
				[],
				30,
				true,
			);
		}

		const verifyIx = await this.solanaIx.getVerifyCompactUnlockIx(
			compactUnlock,
			this.walletConfig.solana.publicKey,
			vaaAddr,
		);
		const verifyTx = await this.solanaSender.createAndSendOptimizedTransaction(
			[verifyIx],
			[this.walletConfig.solana],
			[],
			30,
			true,
		);
		logger.info(`verifyCompactUnlock done for ${destChain} with ${verifyTx}`);

		return compactUnlock;
	}

	private async unlockBatchCompactSolana(
		signedVaa: Buffer,
		orders: {
			orderHash: string;
			fromTokenAddress: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			completedAt: string;
		}[],
		destChainId: number,
	) {
		let instructions: TransactionInstruction[] = [];

		const compactUnlock = await this.prepareAndVerifyCompactUnlockSolana(signedVaa, orders, destChainId);
		for (let index = 0; index < orders.length; index++) {
			const ord = orders[index];
			const driver = this.walletConfig.solana.publicKey;
			const fromMint = new PublicKey(ord.fromTokenAddress);
			const driverAss = getAssociatedTokenAddressSync(fromMint, driver, false);

			const state = getSwiftStateAddrSrc(
				new PublicKey(SolanaProgramV2),
				Buffer.from(ord.orderHash.replace('0x', ''), 'hex'),
				destChainId,
			);
			const stateAss = getAssociatedTokenAddressSync(fromMint, state, true);
			const vaaAddr = findVaaAddress(signedVaa);
			let referrerAddr = new PublicKey(ord.referrerAddress);
			let referrerFeeAcc = getAssociatedTokenAddressSync(fromMint, referrerAddr, true);
			if (ord.referrerBps === 0) {
				referrerFeeAcc = new PublicKey(SolanaProgramV2);
			}
			let mayanFeeAcc = getAssociatedTokenAddressSync(fromMint, new PublicKey(FeeCollectorSolana), true);
			if (ord.mayanBps === 0) {
				mayanFeeAcc = new PublicKey(SolanaProgramV2);
			}
			const ix = await this.solanaIx.getUnlockBatchCompactIx(
				index,
				compactUnlock,
				driver,
				driverAss,
				state,
				stateAss,
				fromMint,
				referrerAddr,
				referrerFeeAcc,
				mayanFeeAcc,
			);
			instructions.push(ix);
		}

		if (instructions.length === 0) {
			logger.warn(`No instructions to unlock batch`);
			return;
		}

		const sharedLut = await this.solanaConnection.getAddressLookupTable(this.mayanSharedLookupTableAddress);

		const txHash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			[this.walletConfig.solana],
			[sharedLut.value!],
			30,
			true,
		);

		return txHash;
	}

	private async unlockBatchNonCompactSolana(
		signedVaa: Buffer,
		destChainId: number,
		parsedPayload: {
			orders: {
				orderHash: string;
				chainSource: number;
				tokenIn: Buffer;
				addrUnlocker: Uint8Array;
			}[];
			compactHash?: Buffer;
			action: number;
		},
		foundStates: string[],
	) {
		let i = -1;
		let instructions = [];
		for (let ord of parsedPayload.orders) {
			i++;
			const fromMint = new PublicKey(ord.tokenIn);
			const driver = new PublicKey(tryUint8ArrayToNative(ord.addrUnlocker, CHAIN_ID_SOLANA));

			// because driver needs to be signer, if this batch posts contains another unlockAddress than the current wallet, it is ignored
			// to unlock it we must set
			if (!driver.equals(this.walletConfig.solana.publicKey)) {
				logger.warn(
					`Ignoring unlock for ${ord.orderHash} as driver is the current set solana driver and needs to be signer`,
				);
				continue;
			}
			const driverAss = getAssociatedTokenAddressSync(fromMint, driver, false);

			const state = getSwiftStateAddrSrc(
				new PublicKey(SolanaProgramV2),
				Buffer.from(ord.orderHash.replace('0x', ''), 'hex'),
				destChainId,
			);
			if (!foundStates.includes(state.toString())) {
				logger.warn(`Ignoring unlock for ${ord.orderHash} as state is not found in the orders`);
				continue;
			}
			const stateAss = getAssociatedTokenAddressSync(fromMint, state, true);
			const vaaAddr = findVaaAddress(signedVaa);
			const ix = await this.solanaIx.getUnlockBatchIx(driver, driverAss, state, stateAss, i, fromMint, vaaAddr);
			instructions.push(ix);
		}

		if (instructions.length === 0) {
			logger.warn(`No instructions to unlock batch`);
			return;
		}

		const sharedLut = await this.solanaConnection.getAddressLookupTable(this.mayanSharedLookupTableAddress);

		const txHash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			[this.walletConfig.solana],
			[sharedLut.value!],
			30,
			true,
		);

		return txHash;
	}

	private async unlockBatchCompactSui(
		signedVaa: Buffer,
		orders: {
			orderHash: string;
			fromTokenAddress: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			lockedFundObjectId: string;
		}[],
		destChainId: number,
	) {
		let data = Buffer.alloc(orders.length * 172);
		for (let i = 0; i < orders.length; i++) {
			let offset = i * 172;
			data.set(hexToUint8Array(orders[i].orderHash), offset);
			offset += 32;
			data.writeUInt16BE(CHAIN_ID_SUI, offset);
			offset += 2;
			const fromToken = await this.tokenList.getTokenData(CHAIN_ID_SUI, orders[i].fromTokenAddress);
			const tokenIn32 = tokenTo32ByteAddress(fromToken);
			data.set(tokenIn32, offset);
			offset += 32;
			const refAddr32 = tryNativeToUint8ArrayGeneral(orders[i].referrerAddress, CHAIN_ID_SUI);
			data.set(refAddr32, offset);
			offset += 32;
			data.writeUInt8(orders[i].referrerBps, offset);
			offset += 1;
			data.writeUInt8(orders[i].mayanBps, offset);
			offset += 1;
			data.set(hexToUint8Array(this.walletConfig.sui.toSuiAddress()), offset);
			offset += 32;
			data.set(this.getWinner32(destChainId), offset);
			offset += 32;
			data.writeBigUInt64BE(BigInt(Math.floor(new Date(orders[i].completedAt).getTime() / 1000)), offset);
		}
		let txInit = new SuiTx.Transaction();
		const {tx, vaa} = addParseAndVerifySui(txInit, signedVaa);
		const unlockBatchReceipt = tx.moveCall({
			package: this.contracts.suiIds.packageId,
			module: 'unlock_batch',
			function: 'prepare_unlock_batch_compact',
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				vaa,
				tx.pure.vector('u8', data),
			],
		});
		for (let index = 0; index < orders.length; index++) {
			const order = orders[index];
			const fromToken = await this.tokenList.getTokenData(CHAIN_ID_SUI, order.fromTokenAddress);
			const unlockBatchReceiptAfter = tx.moveCall({
				package: this.contracts.suiIds.packageId,
				module: 'unlock_batch',
				function: 'unlock_batch_item',
				typeArguments: [order.fromTokenAddress],
				arguments: [
					tx.object(this.contracts.suiIds.stateId),
					tx.object(this.contracts.suiIds.feeManagerStateId),
					tx.object(order.lockedFundObjectId!),
					tx.object(fromToken.verifiedAddress!),
					unlockBatchReceipt,
					tx.pure.u16(index),
				],
			});

			tx.moveCall({
				package: this.contracts.suiIds.packageId,
				module: 'unlock_batch',
				function: 'complete_unlock_batch',
				arguments: [
					unlockBatchReceiptAfter,
				],
			});
		}

		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {
				showEvents: true,
			},
		});
		console.log(result);
	}

	private async getPendingBatchUnlockAndUnlockSui(
		orders: {
			orderHash: string;
			fromTokenAddress: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			lockedFundObjectId: string;
		}[],
		sourceChainId: number,
		destChainId: number,
		sequence: string,
		postTxHash: string,
	) {
		const lockKey = `lock:getPendingBatchUnlockAndUnlockSui:${postTxHash}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				return;
			} else {
				this.locks[lockKey] = true;
			}


			logger.info(`Getting batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			let signedVaa = await this.getSignedVaa(sequence, destChainId, 60);
			logger.info(`Got batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			const parsedPayload = this.parseBatchUnlockVaaPayload(parseVaa(hexToUint8Array(signedVaa)).payload);


			if (!parsedPayload.compactHash) {
				throw new Error('Not implemented non compact unlock for sui');
				// return this.unlockBatchNonCompactSolana(signedVaa, destChainId, parsedPayload, foundStates);
			} else {
				await this.unlockBatchCompactSui(
					Buffer.from(signedVaa.replace('0x', ''), 'hex'),
					orders,
					destChainId,
				);
			}

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(
				`getPendingBatchUnlockAndUnlockSui failed for ${sourceChainId} to ${destChainId} - sequence: ${sequence} - postTX: ${postTxHash} - ${err}`,
			);
			delete this.locks[lockKey];
		}
	}

	private async getPendingBatchUnlockAndUnlockEvm(
		orders: {
			orderHash: string;
			fromTokenAddress: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
		}[],
		sourceChainId: number,
		destChainId: number,
		sequence: string,
		postTxHash: string,
	) {
		const lockKey = `lock:getPendingBatchUnlockAndRefund:${postTxHash}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				return;
			} else {
				this.locks[lockKey] = true;
			}

			logger.info(`Getting batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			let signedVaa = await this.getSignedVaa(sequence, destChainId, 60);
			logger.info(`Got batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);

			const txHash = await this.unlockOnEvm(orders, signedVaa, sourceChainId, destChainId, true);
			logger.info(`Unlocked batch evm for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(
				`getPendingBatchUnlockAndRefund EVM failed for ${sourceChainId} to ${destChainId} - sequence: ${sequence} - postTX: ${postTxHash} - ${err}`,
			);
			delete this.locks[lockKey];
		}
	}

	private async isUnlocked(sourceChainId: number, orderHash: string, destChainId: number): Promise<boolean> {
		if (sourceChainId === CHAIN_ID_SOLANA) {
			const solProgram = this.solprogram;
			const stateAddr = getSwiftStateAddrSrc(
				solProgram,
				Buffer.from(orderHash.replace('0x', ''), 'hex'),
				destChainId,
			);
			const accountInfos = await this.solanaConnection.getAccountInfo(stateAddr);
			if (accountInfos && accountInfos.data.length > 0) {
				const state = parseSwiftStateSrc(accountInfos.data);
				if (state.status === SOLANA_SRC_STATUSES.UNLOCKED) {
					return true;
				}
			}
		} else {
			const sourceOrder = await this.walletsHelper.getSourceReadContract(sourceChainId).orders(orderHash);
			if (sourceOrder.status == EVM_STATES.UNLOCKED) {
			}
		}

		return false;
	}

	private async performSingleUnlocks(
		sourceChainId: number,
		destChainId: number,
		orderHash: string,
		fromTokenAddress: string,
		unlockSequence: string,
		referrerAddress: string,
		referrerBps: number,
		mayanBps: number,
	) {
		const lockKey = `lock:getPendingSingleUnlocksForEth:${sourceChainId}:${destChainId}:${orderHash}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				return;
			} else {
				this.locks[lockKey] = true;
			}

			if (await this.isUnlocked(sourceChainId, orderHash, destChainId)) {
				logger.info(`Order ${orderHash} was already unlocked`);
				delete this.locks[lockKey];
				return;
			}

			let signedVaa = await this.getSignedVaa(unlockSequence, destChainId, 120);

			let txHash: string;
			if (sourceChainId === CHAIN_ID_SOLANA) {
				txHash = await this.unlockSingleOnSolana(
					{
						referrerAddress: referrerAddress,
						referrerBps: referrerBps,
						mayanBps: mayanBps,
					},
					Buffer.from(signedVaa.replace('0x', ''), 'hex'),
					orderHash,
					fromTokenAddress,
					destChainId,
				);
			} else if (isEvmChainId(sourceChainId)) {
				txHash = await this.unlockOnEvm([], signedVaa, sourceChainId, destChainId, false); // orders do not matter for single unlock
			} else if (sourceChainId === CHAIN_ID_SUI) {
				throw new Error('Not implemented yet sui unlock single');
				// txHash = await this.unlockSingleOnSui(
				// 	Buffer.from(signedVaa.replace('0x', ''), 'hex'),
				// 	orderHash,
				// 	fromTokenAddress,
				// );
			} else {
				throw new Error(`Unsupported chainId for single unlock: ${sourceChainId}`);
			}

			logger.info(`Unlocked single evm for ${sourceChainId} to ${destChainId} with tx ${txHash}`);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`single unlock failed for ${sourceChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async batchPostSui(
		destChainId: number,
		orderHashes: string[],
	): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		const compact = true;
		const tx = new SuiTx.Transaction();
		const messageTicket = tx.moveCall({
			package: this.contracts.suiIds.packageId,
			module: 'batch_post',
			function: 'post_batch',
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				tx.pure.vector('address', orderHashes),
				tx.pure.bool(compact),
			],
		});

		const [bridgeFee] = tx.splitCoins(tx.gas, [0]);
		tx.moveCall({
			target: `${WORMHOLE_SUI_PACKAGE}::publish_message::publish_message`,
			arguments: [tx.object(WORMHOLE_SUI_CORE_ID), bridgeFee, messageTicket, tx.object(SUI_CLOCK_OBJECT_ID)],
		});

		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {
				showEvents: true,
			},
		});

		const postWhEvent = result.events!.find(
			(e) => e.type === `${WORMHOLE_SUI_PACKAGE}::publish_message::WormholeMessage`,
		);
		if (!postWhEvent) {
			throw new Error('No post event found');
		}
		return {
			txHash: result.digest,
			sequence: BigInt((postWhEvent.parsedJson as any).sequence),
		};
	}

	private async batchPostEvm(
		destChain: number,
		orderHashes: string[],
	): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		const networkFeeData = await this.evmProviders[destChain].getFeeData();
		const overrides = await getSuggestedOverrides(destChain, networkFeeData.gasPrice!);
		const compress = true;
		const txResp = await this.walletsHelper
			.getDestWriteContract(destChain)
			.postBatch(orderHashes, compress, overrides);
		const tx: ethers.TransactionReceipt = await txResp.wait();

		if (tx.status !== 1) {
			throw new Error(`Batch post failed for destChain: ${destChain}, ${tx.hash}`);
		}

		const sequence = this.getWormholeSequenceFromTx(tx);

		return {
			sequence: sequence,
			txHash: tx.hash,
		};
	}

	private async batchPostSolana(orderHashes: string[]): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		const swiftProgram = new PublicKey(SolanaProgramV2);
		const [swiftEmitter, _] = PublicKey.findProgramAddressSync([Buffer.from('emitter')], swiftProgram);
		const wormholeAccs = get_wormhole_core_accounts(swiftEmitter);

		const states = orderHashes.map((orderHash) =>
			getSwiftStateAddrDest(swiftProgram, Buffer.from(orderHash.replace('0x', ''), 'hex')),
		);

		const batchPostIx = await this.solanaIx.getBatchPostShimIx(
			true,
			this.walletConfig.solana.publicKey,
			wormholeAccs.bridge_config,
			wormholeAccs.coreBridge,
			swiftEmitter,
			wormholeAccs.sequence_key,
			wormholeAccs.fee_collector,
			states,
		);

		logger.verbose(`Sending batch post Solana for unlock`);
		const txHash = await this.solanaSender.createAndSendOptimizedTransaction(
			[batchPostIx],
			[this.walletConfig.solana],
			[],
			30,
			true,
		);
		logger.verbose(`Batch posted Successfully Solana, getting batch sequence`);

		const sequence = await getSequenceFromWormholeScan(txHash);
		return {
			sequence: BigInt(sequence),
			txHash: txHash,
		};
	}

	private async getWallet32(chainId: number): Promise<Buffer> {
		if (chainId === CHAIN_ID_SOLANA) {
			return Buffer.from(this.walletConfig.solana.publicKey.toBytes());
		} else if (isEvmChainId(chainId)) {
			return Buffer.from(tryNativeToUint8Array(this.walletConfig.evm.address, chainId));
		} else if (chainId === CHAIN_ID_SUI) {
			return Buffer.from(hexToUint8Array(this.walletConfig.sui.toSuiAddress()));
		} else {
			throw new Error(`Unsupported chainId: ${chainId}`);
		}
	}

	private async unlockOnEvm(
		orders: {
			orderHash: string;
			fromTokenAddress: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
		}[],
		signedVaa: string,
		sourceChain: number,
		destChain: number,
		isBatch: boolean,
	): Promise<string> {
		const swiftContract = this.walletsHelper.getSourceWriteContract(sourceChain, false);

		const parsedVaa = parseVaa(hexToUint8Array(signedVaa));
		const unlockPayload = parsedVaa.payload;
		let payloadMode: 'unlock' | 'batch' | 'compress_batch' =
			unlockPayload[0] === 2 ? 'unlock' : unlockPayload[0] === 4 ? 'batch' : 'compress_batch';
		const networkFeeData = await this.evmProviders[sourceChain].getFeeData();
		let overrides = await getSuggestedOverrides(sourceChain, networkFeeData.gasPrice!);
		let tx: ethers.TransactionResponse;
		if (payloadMode === 'batch') {
			tx = await swiftContract.unlockBatch(hexToUint8Array(signedVaa), overrides);
		} else if (payloadMode === 'compress_batch') {
			let unlockMsgs = [];
			let indexes = [];
			let i = 0;
			for (let order of orders) {
				const tokenIn = await this.tokenList.getTokenData(sourceChain, order.fromTokenAddress);
				unlockMsgs.push({
					driver32: await this.getWallet32(sourceChain),
					orderHash: order.orderHash,
					fulfillTime: order.completedAt,
					protocolBps: order.mayanBps,
					referrerBps: order.referrerBps,
					referrerAddr: order.referrerAddress,
					tokenIn: tokenIn,
					srcChainId: sourceChain,
					unlockReceiver32: await this.getWallet32(destChain),
					destChainId: destChain,
				});
				indexes.push(i);
				i++;
			}
			const compactPayload = reconstructCompactPayload(unlockMsgs);
			tx = await swiftContract.unlockCompressedBatch(
				hexToUint8Array(signedVaa),
				compactPayload,
				indexes,
				overrides,
			);
		} else {
			tx = await swiftContract.unlockSingle(hexToUint8Array(signedVaa), overrides);
		}
		const txResp = await tx.wait();

		if (!txResp || txResp.status !== 1) {
			throw new Error(`unlocking for ${sourceChain}-${destChain} failed with tx ${tx.hash} , isBatch=${isBatch}`);
		}

		return tx.hash;
	}

	private getWormholeSequenceFromTx(tx: ethers.TransactionReceipt): bigint {
		const wormholeLogs = tx.logs.filter((log) => log.topics.includes(ethers.id(LogMessagePublishedSig)));
		if (!wormholeLogs) {
			throw new Error(`Err On getWormholeSequenceFromTx for destChain: ${tx.hash}`);
		}

		const whLog = wormholeLogs[0];

		const eventData = this.wormholeInterface.decodeEventLog(LogMessagePublishedSig, whLog.data, whLog.topics);

		return eventData.sequence;
	}

	private async getAlreadyUnlockedOrPendingOrderSolana(
		orderHashes: string[],
		destChainId: number,
	): Promise<Set<string>> {
		let result: Set<string> = new Set();
		const maxFetchPerCall = 100;

		for (let orderHash of orderHashes) {
			if (this.sequenceStore.isOrderAlreadyPosted(orderHash)) {
				result.add(orderHash);
			}
		}
		const solProgram = this.solprogram;
		// Fetching orderHashes in chunks of maxFetchPerCall
		for (let i = 0; i < orderHashes.length; i += maxFetchPerCall) {
			const chunk = orderHashes.slice(i, i + maxFetchPerCall);
			const stateAddresses = chunk.map((orderHash) =>
				getSwiftStateAddrSrc(solProgram, Buffer.from(orderHash.replace('0x', ''), 'hex'), destChainId),
			);
			const accountInfos = await this.solanaConnection.getMultipleAccountsInfo(stateAddresses);
			for (let j = 0; j < chunk.length; j++) {
				if (accountInfos && accountInfos[j]!.data.length > 0) {
					const state = parseSwiftStateSrc(accountInfos[j]!.data);
					if (
						state.status === SOLANA_SRC_STATUSES.UNLOCKED ||
						state.status === SOLANA_SRC_STATUSES.REFUNDED
					) {
						result.add(chunk[j]);
					}
				}
			}
		}
		return result;
	}

	private scheduleAlreadyPostedUnlocks(batchUnlockData: UnlockableSwapBatchItem): Set<string> {
		let result: Set<string> = new Set();

		let posts: {
			[key: string]: {
				fromTokenAddress: string;
				orderHash: string;
				volume: number;
				completedAt: string;
				mayanBps: number;
				referrerBps: number;
				referrerAddress: string;
				lockedFundObjectId: string;
			}[];
		} = {};
		for (let item of batchUnlockData.orders) {
			if (item.unlockSequence && item.unlockSequence !== '0') {
				result.add(item.orderHash);
				if (!posts[item.unlockSequence]) {
					posts[item.unlockSequence] = [];
				}
				posts[item.unlockSequence].push({
					volume: Number(item.volume),
					fromTokenAddress: item.fromTokenAddress,
					orderHash: item.orderHash,
					completedAt: item.completedAt,
					mayanBps: item.mayanBps,
					referrerBps: item.referrerBps,
					referrerAddress: item.referrerAddress,
					lockedFundObjectId: item.lockedFundObjectId!,
				});
			}
		}

		for (let [sequence, val] of Object.entries(posts)) {
			this.sequenceStore.addBatchPostedSequence(
				batchUnlockData.fromChain,
				batchUnlockData.toChain,
				val,
				BigInt(sequence),
				`${batchUnlockData.fromChain}-${batchUnlockData.toChain}-${sequence}`,
			);
		}

		return result;
	}

	private async getAlreadyUnlockedOrPendingOrderEvm(
		sourceChain: number,
		orderHashes: string[],
	): Promise<Set<string>> {
		let result: Set<string> = new Set();
		const maxFetchPerCall = 1000;
		for (let orderHash of orderHashes) {
			if (this.sequenceStore.isOrderAlreadyPosted(orderHash)) {
				result.add(orderHash);
			}
		}
		// Fetching orderHashes in chunks of 1000
		for (let i = 0; i < orderHashes.length; i += maxFetchPerCall) {
			const chunk = orderHashes.slice(i, i + maxFetchPerCall);
			const statuses = await this.walletsHelper.getSourceReadContract(sourceChain).getOrders(chunk);
			for (let j = 0; j < chunk.length; j++) {
				if (statuses[j].status == EVM_STATES.UNLOCKED) {
					result.add(chunk[j]);
				}
			}
		}
		return result;
	}

	private async getOwnedUnlockableSwaps(driverAddresses: string[]): Promise<{
		singleData: UnlockableSwapSingleItem[];
		batchData: UnlockableSwapBatchItem[];
		postedBatchData: UnlockableSwapBatchItem[];
	}> {
		const rawData = await axios.get(this.endpoints.explorerApiUrl + '/v3/unlockable-swaps', {
			params: {
				batchUnlockThreshold: 1,
				singleBatchChainIds: this.gConf.singleBatchChainIds.join(','),
				driverAddresses: driverAddresses.join(','),
				protocolVersion: 'v2',
			},
		});

		return rawData.data;
	}

	private async getSignedVaa(sequence: string, destChainId: number, deadlineSeconds?: number): Promise<string> {
		let mayanBridgeEmitterAddress;
		if (isEvmChainId(destChainId)) {
			mayanBridgeEmitterAddress = getEmitterAddressEth(this.contracts.evmContractsV2Dst[destChainId]);
		} else if (destChainId === CHAIN_ID_SUI) {
			mayanBridgeEmitterAddress = this.contracts.suiIds.emitterId.replace('0x', '');
		} else if (destChainId === CHAIN_ID_SOLANA) {
			mayanBridgeEmitterAddress = getEmitterAddressSolana(SolanaProgramV2);
		} else {
			throw new Error('Cannot get emitter address for chainId=' + destChainId);
		}

		const startTimestamp = new Date().getTime();

		while (true) {
			if (deadlineSeconds && new Date().getTime() - startTimestamp > deadlineSeconds * 1000) {
				throw new Error('Timeout while waiting for signed VAA');
			}

			try {
				const { vaaBytes: signedVAA2 } = await getSignedVAAWithRetryGeneric(
					this.rpcConfig.wormholeGuardianRpcs,
					destChainId as ChainId,
					mayanBridgeEmitterAddress,
					sequence,
					{
						transport: NodeHttpTransportWithDefaultTimeout(3000),
					},
					3000,
					6 * this.rpcConfig.wormholeGuardianRpcs.length,
				);

				return uint8ArrayToHex(signedVAA2);
			} catch (err) {
				logger.info(`Unable to fetch signed VAA ${err}. Retrying..`);
				await delay(2000);
			}
		}
	}

	private parseSingleUnlockVaaPayload(payload: Buffer): {
		action: number;
		order: {
			orderHash: string;
			chainSource: number;
			tokenIn: string;
			addrUnlocker: Uint8Array;
		};
	} {
		// action: u8
		// hash: blob(32)
		// chain_source: u16
		// token_in: blob(32)
		// addr_unlocker: blob(32)

		return {
			action: payload.readUint8(0),
			order: {
				orderHash: '0x' + payload.subarray(1, 33).toString('hex'),
				chainSource: payload.readUInt16BE(33),
				tokenIn: payload.subarray(35, 67).toString('hex'),
				addrUnlocker: Uint8Array.from(payload.subarray(67, 99)),
			},
		};
	}

	private parseBatchUnlockVaaPayload(payload: Buffer): {
		orders: {
			orderHash: string;
			chainSource: number;
			tokenIn: Buffer;
			addrUnlocker: Uint8Array;
		}[];
		compactHash?: Buffer;
		action: number;
	} {
		// action: u8
		// len: u16
		// Array<[
		// hash: blob(32)
		// chain_source: u16
		// token_in: blob(32)
		// addr_unlocker: blob(32)
		// ]>
		const action = payload.readUint8(0);
		const batchCount = payload.readUInt16BE(1);
		let payloadMode: 'batch' | 'compress_batch' | 'unknown' =
			action === 5 ? 'compress_batch' : action === 4 ? 'batch' : 'unknown';
		if (payloadMode === 'unknown') {
			throw new Error(`Unknown payload mode: ${action}`);
		}

		if (payloadMode === 'compress_batch') {
			return {
				action,
				orders: [],
				compactHash: payload.subarray(3, 35),
			};
		}

		let offset = 3;
		let result = [];
		for (let i = 0; i < batchCount; i++) {
			const orderHash = '0x' + payload.subarray(offset, offset + 32).toString('hex');
			offset += 32;
			const chainSource = payload.readUInt16BE(offset);
			offset += 2;
			const tokenIn = payload.subarray(offset, offset + 32);
			offset += 32;
			const addrUnlocker = payload.subarray(offset, offset + 32);
			offset += 32;

			result.push({
				orderHash,
				chainSource,
				tokenIn,
				addrUnlocker: Uint8Array.from(addrUnlocker),
			});
		}

		return {
			action,
			orders: result,
		};
	}
}

class SequenceStore {
	public postedSequences: Map<
		string,
		{
			fromChainId: number;
			toChainId: number;
			sequence: bigint;
			orders: {
				fromTokenAddress: string;
				orderHash: string;
				completedAt: string;
				mayanBps: number;
				referrerBps: number;
				referrerAddress: string;
				lockedFundObjectId: string;
			}[];
			insertedAt: Date;
		}
	> = new Map();
	private allPendingPostedHashes: Set<string> = new Set();

	isOrderAlreadyPosted(orderHash: string): boolean {
		return this.allPendingPostedHashes.has(orderHash);
	}

	addBatchPostedSequence(
		fromChainId: number,
		toChainId: number,
		orders: {
			fromTokenAddress: string;
			orderHash: string;
			completedAt: string;
			mayanBps: number;
			referrerBps: number;
			referrerAddress: string;
			lockedFundObjectId: string;
		}[],
		postSequence: bigint,
		postTxHash: string,
	) {
		for (let order of orders) {
			this.allPendingPostedHashes.add(order.orderHash);
		}

		this.postedSequences.set(postTxHash, {
			fromChainId,
			toChainId,
			sequence: postSequence,
			orders,
			insertedAt: new Date(),
		});
	}

	removeBatchSequenceAfterUnlock(postTxHash: string) {
		const storedData = this.postedSequences.get(postTxHash);

		if (!storedData) {
			throw new Error(`No stored data for postTxHash ${postTxHash}!`);
		}

		for (let order of storedData.orders) {
			this.allPendingPostedHashes.delete(order.orderHash);
		}

		this.postedSequences.delete(postTxHash);
	}
}

type UnlockMsg = {
	orderHash: Buffer;
	srcChainId: number;
	tokenIn: Buffer;
	referrerAddr: Buffer;
	referrerBps: number;
	protocolBps: number;
	unlockReceiver: Buffer;
	driver: Buffer;
	fulfillTime: bigint;
};

function reconstructCompactPayload(
	unlockMsgsRaw: {
		driver32: Buffer;
		fulfillTime: string;
		protocolBps: number;
		referrerBps: number;
		referrerAddr: string;
		tokenIn: Token;
		orderHash: string;
		srcChainId: number;
		destChainId: number;
		unlockReceiver32: Buffer;
	}[],
): Buffer {
	let result = Buffer.alloc(unlockMsgsRaw.length * 172);
	for (let i = 0; i < unlockMsgsRaw.length; i++) {
		const rawMsg = unlockMsgsRaw[i];
		const refAddr32 = Buffer.from(tryNativeToUint8Array(rawMsg.referrerAddr, rawMsg.srcChainId));
		const tokenIn32 = Buffer.from(tryTokenToUint8ArrayGeneral(rawMsg.tokenIn, rawMsg.srcChainId));

		encodeUnlockMsg({
			driver: rawMsg.driver32,
			orderHash: Buffer.from(hexToUint8Array(rawMsg.orderHash)),
			srcChainId: rawMsg.srcChainId,
			tokenIn: tokenIn32,
			referrerAddr: refAddr32,
			referrerBps: rawMsg.referrerBps,
			protocolBps: rawMsg.protocolBps,
			unlockReceiver: rawMsg.unlockReceiver32,
			fulfillTime: BigInt(new Date(rawMsg.fulfillTime).getTime() / 1000),
		}).copy(result, i * 172);
	}
	return result;
}

function encodeUnlockMsg(params: UnlockMsg): Buffer {
	const result = Buffer.alloc(172); // unlock msgs minus action is 172 bytes
	// Write order hash (32 bytes)
	params.orderHash.copy(result, 0);

	// Write source chain ID (2 bytes)
	result.writeUInt16LE(params.srcChainId, 32);

	// Write token in address (32 bytes)
	params.tokenIn.copy(result, 34);

	// Write referrer address (32 bytes)
	params.referrerAddr.copy(result, 66);

	// Write referrer bps (1 bytes)
	result.writeUInt8(params.referrerBps, 98);

	// Write protocol bps (1 bytes)
	result.writeUInt8(params.protocolBps, 99);

	// Write unlock receiver (32 bytes)
	params.unlockReceiver.copy(result, 100);

	// Write driver address (32 bytes)
	params.driver.copy(result, 132);

	// Write fulfill time (8 bytes)
	result.writeBigUInt64LE(params.fulfillTime, 164);

	return result;
}
