import { Connection, Keypair, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers';
import { abi as WormholeAbi } from '../abis/wormhole';
import { CHAIN_ID_SOLANA } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConf } from '../config/global';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import { hexToUint8Array, uint8ArrayToHex } from '../utils/buffer';
import { EvmProviders } from '../utils/evm-providers';
import { getSuggestedOverrides } from '../utils/evm-trx';
import { NodeHttpTransportWithDefaultTimeout } from '../utils/grpc';
import logger from '../utils/logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from '../utils/solana-trx';
import { EVM_STATES } from '../utils/state-parser';
import { delay } from '../utils/util';
import {
	getEmitterAddressEth,
	getEmitterAddressSolana,
	getSignedVAAWithRetry,
	getWormholeSequenceFromPostedMessage,
	get_wormhole_core_accounts,
} from '../utils/wormhole';
import { SolanaIxHelper } from './solana-ix-helper';
import { WalletsHelper } from './wallet-helper';
const LogMessagePublishedSig = 'LogMessagePublished(address,uint64,uint32,bytes,uint8)';

export type UnlockableSwapBatchItem = {
	fromChain: number;
	toChain: number;
	orderHashes: string[];
};
export type UnlockableSwapSingleItem = {
	fromChain: number;
	toChain: number;
	order: {
		orderHash: string;
		unlockSequence: string;
	};
};

export class Unlocker {
	private readonly driverAddresses: string[] = [];
	private locks: { [key: string]: boolean } = {};
	private readonly wormholeInterface = new ethers.Interface(WormholeAbi);

	public interval: NodeJS.Timeout | null = null;
	public unlockInterval: NodeJS.Timeout | null = null;

	private sequenceStore: SequenceStore;

	constructor(
		private readonly gConf: GlobalConf,
		private readonly endpoints: MayanEndpoints,
		private readonly contracts: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly walletConfig: WalletConfig,
		private readonly solanaConnection: Connection,
		private readonly evmProviders: EvmProviders,
		private readonly solanaIx: SolanaIxHelper,
		private readonly priorityFeeService: PriorityFeeHelper,
		private readonly solanaSender: SolanaMultiTxSender,
		private readonly walletsHelper: WalletsHelper,
	) {
		this.sequenceStore = new SequenceStore();

		this.driverAddresses.push(this.walletConfig.solana.publicKey.toString());
		this.driverAddresses.push(this.walletConfig.evm.address);
	}

	private async getOwnedUnlockableSwaps(driverAddresses: string[]): Promise<{
		singleData: UnlockableSwapSingleItem[];
		batchData: UnlockableSwapBatchItem[];
	}> {
		const rawData = await axios.get(this.endpoints.explorerApiUrl + '/v3/unlockable-swaps', {
			params: {
				batchUnlockThreshold: this.gConf.batchUnlockThreshold,
				singleBatchChainIds: this.gConf.singleBatchChainIds.join(','),
				driverAddresses: driverAddresses.join(','),
			},
		});

		return rawData.data;
	}

	scheduleUnlockJobs() {
		this.interval = setInterval(this.fetchAndProgressUnlocks.bind(this), this.gConf.scheduleUnlockInterval * 1000);
		this.unlockInterval = setInterval(
			this.unlockPostedBatches.bind(this),
			this.gConf.scheduleUnlockInterval * 1000,
		);
	}

	private async unlockPostedBatches() {
		try {
			for (let [postTxHash, postedData] of this.sequenceStore.postedSequences.entries()) {
				await this.getPendingBatchUnlockAndUnlock(
					postedData.fromChainId,
					postedData.toChainId,
					postedData.sequence.toString(),
					postTxHash,
				);
				await delay(20); // avoid running everything together
			}
		} catch (err) {
			logger.error(`Error in unlockPostedBatches ${err}`);
		}
	}

	private async fetchAndProgressUnlocks() {
		return;
		try {
			if (Object.keys(this.locks).length > 1000) {
				throw new Error('Too many ongoing unlocks... Waiting for some of them to finish');
			}
			const freshExplorerData = await this.getOwnedUnlockableSwaps(this.driverAddresses);
			let promises: Promise<void>[] = [];
			for (let singleUnlockData of freshExplorerData.singleData) {
				promises.push(
					this.performSingleUnlocks(
						singleUnlockData.fromChain,
						singleUnlockData.toChain,
						singleUnlockData.order.orderHash,
						singleUnlockData.order.unlockSequence,
					),
				);
				await delay(20); // avoid running everything together
			}

			for (let batchUnlockData of freshExplorerData.batchData) {
				const orderHashes = batchUnlockData.orderHashes;
				let alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrder(
					batchUnlockData.fromChain,
					orderHashes,
				);
				let filteredOrderHashes = orderHashes.filter((orderHash) => !alreadyUnlocked.has(orderHash));
				let chunkSize = this.gConf.batchUnlockThreshold;
				for (let i = 0; i < filteredOrderHashes.length; i += chunkSize) {
					const chunk = filteredOrderHashes.slice(i, i + chunkSize);
					promises.push(
						this.selectAndBatchPostWhSequence(batchUnlockData.fromChain, batchUnlockData.toChain, chunk),
					);
					await delay(20); // avoid running everything together
				}
				await delay(20); // avoid running everything together
			}

			await Promise.all(promises);
		} catch (error) {
			logger.error(`Error in schedulePending for unlock ${error}`);
		}
	}

	private async selectAndBatchPostWhSequence(sourceChainId: number, destChainId: number, orderHashes: string[]) {
		const lockKey = `lock:selectAndPost:${sourceChainId}:${destChainId}`;
		try {
			const locked = this.locks[lockKey];
			if (!locked) {
				return;
			}

			if (!orderHashes || orderHashes.length < 1) {
				delete this.locks[lockKey];
				return;
			}

			if (orderHashes.length > 20) {
				throw new Error(`Too many orderHashes might not fit into block...`);
			}

			if (orderHashes.length < this.gConf.batchUnlockThreshold) {
				logger.verbose(
					`Not enough swaps to select and post for ${sourceChainId} to ${destChainId}. min ${this.gConf.batchUnlockThreshold}`,
				);
				delete this.locks[lockKey];
				return;
			}

			orderHashes = orderHashes.slice(0, this.gConf.batchUnlockThreshold); // we can not put more than this in one udp solana trx without luts or hitting inner instruction limit

			logger.info(`Posting and acquiring sequence for ${sourceChainId} to ${destChainId} for batch`);
			let sequence: bigint, txHash: string;
			if (destChainId === CHAIN_ID_SOLANA) {
				const result = await this.batchPostSolana(orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else {
				const result = await this.batchPostEvm(destChainId, orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			}
			const postSequence = sequence;
			const postTxHash = txHash;

			this.sequenceStore.addBatchPostedSequence(
				sourceChainId,
				destChainId,
				orderHashes,
				postSequence,
				postTxHash,
			);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`selectAndPostWhSequence failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async getPendingBatchUnlockAndUnlock(
		sourceChainId: number,
		destChainId: number,
		sequence: string,
		postTxHash: string,
	) {
		const lockKey = `lock:getPendingBatchUnlockAndRefund:${postTxHash}`;
		try {
			const locked = this.locks[lockKey];
			if (!locked) {
				return;
			}

			logger.info(`Getting batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			let signedVaa = await this.getSignedVaa(sequence, destChainId, 60);
			logger.info(`Got batch unlock signed VAA for ${sourceChainId}-${destChainId} with ${sequence}`);
			const txHash = await this.unlockOnEvm(signedVaa, sourceChainId, destChainId, true);
			logger.info(`Unlocked batch evm for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`getPendingBatchUnlockAndRefund failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async performSingleUnlocks(
		sourceChainId: number,
		destChainId: number,
		orderHash: string,
		unlockSequence: string,
	) {
		const lockKey = `lock:getPendingSingleUnlocksForEth:${sourceChainId}:${destChainId}:${orderHash}`;
		try {
			const locked = this.locks[lockKey];
			if (!locked) {
				return;
			}

			const sourceOrder = await this.walletsHelper.getReadContract(sourceChainId).orders(orderHash);
			if (sourceOrder.status == EVM_STATES.UNLOCKED) {
				logger.info(`Order ${orderHash} was already unlocked`);
				delete this.locks[lockKey];
				return;
			}

			let signedVaa = await this.getSignedVaa(unlockSequence, destChainId, 120);

			const txHash = await this.unlockOnEvm(signedVaa, sourceChainId, destChainId, false);

			logger.info(`Unlocked single evm for ${sourceChainId} to ${destChainId} with tx ${txHash}`);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`lock failed for ${sourceChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async batchPostEvm(
		destChain: number,
		orderHashes: string[],
	): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		const networkFeeData = await this.evmProviders[destChain].getFeeData();
		const overrides = await getSuggestedOverrides(destChain, networkFeeData);
		const tx = await (
			await this.walletsHelper.getWriteContract(destChain).postBatch(orderHashes, overrides)
		).wait();

		if (tx.status !== 1) {
			throw new Error(`Batch post failed for destChain: ${destChain}, ${tx.transactionHash}`);
		}

		const sequence = this.getWormholeSequenceFromTx(tx);

		return {
			sequence: sequence,
			txHash: tx.transactionHash,
		};
	}

	private async batchPostSolana(orderHashes: string[]): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		const swiftProgram = new PublicKey(this.contracts.contracts[CHAIN_ID_SOLANA]);
		const [swiftEmitter, _] = PublicKey.findProgramAddressSync([Buffer.from('emitter')], swiftProgram);
		const wormholeAccs = get_wormhole_core_accounts(swiftEmitter);
		const newMessageAccount = Keypair.generate();

		const states = orderHashes.map(
			(orderHash) =>
				PublicKey.findProgramAddressSync([Buffer.from('STATE'), hexToUint8Array(orderHash)], swiftProgram)[0],
		);

		const batchPostIx = this.solanaIx.getBatchPostIx(
			swiftProgram,
			swiftEmitter,
			wormholeAccs.sequence_key,
			newMessageAccount.publicKey,
			wormholeAccs.bridge_config,
			wormholeAccs.fee_collector,
			this.walletConfig.solana.publicKey,
			states,
			wormholeAccs.coreBridge,
		);
		const priorityFeeIx = await this.priorityFeeService.getPriorityFeeInstruction(
			batchPostIx.keys.map((accMeta) => accMeta.pubkey.toString()),
		);
		let instructions = [priorityFeeIx, batchPostIx];

		const { blockhash, lastValidBlockHeight } = await this.solanaConnection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConfig.solana.publicKey,
			instructions,
			recentBlockhash: blockhash,
		});

		const trx = new VersionedTransaction(msg);
		trx.sign([this.walletConfig.solana, newMessageAccount]);
		const serializedTrx = trx.serialize();

		logger.verbose(`Sending batch post Solana for unlock`);
		const txHash = await this.solanaSender.sendAndConfirmTransaction(
			serializedTrx,
			this.rpcConfig.solana.sendCount,
			'confirmed',
			30,
		);
		logger.verbose(`Batch posted Successfully Solana, getting batch sequence`);

		let wormholeMessage = await this.solanaConnection.getAccountInfo(newMessageAccount.publicKey);
		let maxRetries = 6;
		while (maxRetries-- > 0 && (!wormholeMessage || !wormholeMessage.data)) {
			await delay(2000);
			wormholeMessage = await this.solanaConnection.getAccountInfo(newMessageAccount.publicKey);
		}

		if (!wormholeMessage || !wormholeMessage.data) {
			throw new Error(`Batch post Solana failed because sequence not found. Post tx: ${txHash}`);
		}
		return {
			sequence: getWormholeSequenceFromPostedMessage(wormholeMessage.data),
			txHash: txHash,
		};
	}

	private async unlockOnEvm(
		signedVaa: string,
		sourceChain: number,
		destChain: number,
		isBatch: boolean,
	): Promise<string> {
		const swiftContract = this.walletsHelper.getWriteContract(sourceChain);

		const networkFeeData = await this.evmProviders[sourceChain].getFeeData();
		let overrides = getSuggestedOverrides(destChain, networkFeeData);

		let tx;
		if (isBatch) {
			tx = await swiftContract.unlockBatch(hexToUint8Array(signedVaa), overrides);
		} else {
			tx = await swiftContract.unlockSingle(hexToUint8Array(signedVaa), overrides);
		}
		const txResp = await tx.wait();

		if (txResp.status !== 1) {
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

	private async getAlreadyUnlockedOrPendingOrder(sourceChain: number, orderHashes: string[]): Promise<Set<string>> {
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
			const statuses = await this.walletsHelper.getReadContract(sourceChain).getOrders(chunk);
			for (let j = 0; j < chunk.length; j++) {
				if (statuses[j].status == EVM_STATES.UNLOCKED) {
					result.add(chunk[j]);
				}
			}
		}
		return result;
	}

	private async getSignedVaa(sequence: string, destChainId: number, deadlineSeconds?: number): Promise<string> {
		const contractAddress = this.contracts.contracts[destChainId];
		let mayanBridgeEmitterAddress;
		if (ethers.isAddress(contractAddress)) {
			mayanBridgeEmitterAddress = getEmitterAddressEth(contractAddress);
		} else if (destChainId === CHAIN_ID_SOLANA) {
			mayanBridgeEmitterAddress = getEmitterAddressSolana(contractAddress);
		} else {
			throw new Error('Cannot get emitter address for chainId=' + destChainId);
		}

		const startTimestamp = new Date().getTime();

		while (true) {
			if (deadlineSeconds && new Date().getTime() - startTimestamp > deadlineSeconds * 1000) {
				throw new Error('Timeout while waiting for signed VAA');
			}

			try {
				const { vaaBytes: signedVAA2 } = await getSignedVAAWithRetry(
					this.rpcConfig.wormholeGuardianRpcs,
					destChainId,
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
}

class SequenceStore {
	public postedSequences: Map<
		string,
		{
			fromChainId: number;
			toChainId: number;
			sequence: bigint;
			orderHashes: string[];
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
		orderHashes: string[],
		postSequence: bigint,
		postTxHash: string,
	) {
		for (let orderHash of orderHashes) {
			this.allPendingPostedHashes.add(orderHash);
		}

		this.postedSequences.set(postTxHash, {
			fromChainId,
			toChainId,
			sequence: postSequence,
			orderHashes,
			insertedAt: new Date(),
		});
	}

	removeBatchSequenceAfterUnlock(postTxHash: string) {
		const storedData = this.postedSequences.get(postTxHash);

		if (!storedData) {
			throw new Error(`No stored data for postTxHash ${postTxHash}!`);
		}

		for (let orderHash of storedData.orderHashes) {
			this.allPendingPostedHashes.delete(orderHash);
		}

		this.postedSequences.delete(postTxHash);
	}
}
