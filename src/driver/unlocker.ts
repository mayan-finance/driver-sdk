import { ChainId, getSignedVAAWithRetry, parseVaa } from '@certusone/wormhole-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers6';
import { abi as WormholeAbi } from '../abis/wormhole.abi';
import { CHAIN_ID_SOLANA, CHAIN_ID_SUI, isEVMChainId } from '../config/chains';
import { ContractsConfig, SolanaProgram } from '../config/contracts';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { RpcConfig } from '../config/rpc';
import { TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { hexToUint8Array, tryUint8ArrayToNative, uint8ArrayToHex } from '../utils/buffer';
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
	getWormholeSequenceFromPostedMessage,
	get_wormhole_core_accounts,
} from '../utils/wormhole';
import { NewSolanaIxHelper } from './solana-ix';
import { WalletsHelper } from './wallet-helper';

const LogMessagePublishedSig = 'LogMessagePublished(address,uint64,uint32,bytes,uint8)';

export type UnlockableSwapBatchItem = {
	fromChain: number;
	toChain: number;
	orders: {
		fromTokenAddress: string;
		orderHash: string;
		unlockSequence?: string;
		lockedFundObjectId?: string;
	}[];
};
export type UnlockableSwapSingleItem = {
	fromChain: number;
	toChain: number;
	order: {
		fromTokenAddress: string;
		orderHash: string;
		unlockSequence: string;
		lockedFundObjectId?: string;
	};
};

const MAX_BATCH_SIZE = 8;

export class Unlocker {
	private readonly solprogram = new PublicKey(SolanaProgram);
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
		private readonly suiClient: SuiClient,
		private readonly evmProviders: EvmProviders,
		private readonly solanaIx: NewSolanaIxHelper,
		private readonly priorityFeeService: PriorityFeeHelper,
		private readonly solanaSender: SolanaMultiTxSender,
		private readonly walletsHelper: WalletsHelper,
		private readonly vaaPoster: VaaPoster,
		private readonly tokenList: TokenList,
	) {
		this.sequenceStore = new SequenceStore();

		this.driverAddresses.push(this.walletConfig.solana.publicKey.toString());
		this.driverAddresses.push(this.walletConfig.evm.address);
		this.driverAddresses.push(this.walletConfig.evm.address.toLowerCase());
		this.driverAddresses.push(this.walletConfig.sui.getPublicKey().toSuiAddress());
	}

	scheduleUnlockJobs() {
		if (this.gConf.disableUnlocker) {
			logger.info(`Unlocker is disabled and ignored.`);
			return;
		}
		this.interval = setInterval(this.fetchAndProgressUnlocks.bind(this), this.gConf.scheduleUnlockInterval * 1000);
		this.unlockInterval = setInterval(
			this.unlockPostedBatches.bind(this),
			this.gConf.scheduleUnlockInterval * 1000,
		);
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
				} else if (postedData.fromChainId === CHAIN_ID_SUI) {
					await this.getPendingBatchUnlockAndUnlockSui(
						postedData.toChainId,
						postedData.sequence.toString(),
						postTxHash,
						postedData.orders,
					);
				} else if (isEVMChainId(postedData.fromChainId)) {
					await this.getPendingBatchUnlockAndUnlockEvm(
						postedData.fromChainId,
						postedData.toChainId,
						postedData.sequence.toString(),
						postTxHash,
					);
				} else {
					logger.error(`Unknown from chainId ${postedData.fromChainId} in unlockPostedBatches`);
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
						singleUnlockData.order.lockedFundObjectId,
					),
				);
				await delay(20); // avoid running everything together
			}

			for (let postedUnlockData of freshExplorerData.postedBatchData) {
				const orderHashs = postedUnlockData.orders.map((order) => order.orderHash);
				let alreadyUnlocked: Set<string>;
				if (+postedUnlockData.fromChain === CHAIN_ID_SOLANA) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSolana(orderHashs);
				} else if (+postedUnlockData.fromChain === CHAIN_ID_SUI) {
					// TODO
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSui(orderHashs);
				} else if (isEVMChainId(+postedUnlockData.fromChain)) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
						postedUnlockData.fromChain,
						orderHashs,
					);
				} else {
					throw new Error(`Unknown from chainId ${postedUnlockData.fromChain} in fetchAndProgressUnlocks`);
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
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSolana(orderHashs);
				} else if (+batchUnlockData.fromChain === CHAIN_ID_SUI) {
					// TODO
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSui(orderHashs);
				} else if (isEVMChainId(+batchUnlockData.fromChain)) {
					alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
						batchUnlockData.fromChain,
						orderHashs,
					);
				} else {
				}

				let filteredOrders = batchUnlockData.orders.filter((order) => !alreadyUnlocked.has(order.orderHash));

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
				);
			} else if (sourceChainId === CHAIN_ID_SUI) {
				// TODO
				alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderSui(initialOrders.map((o) => o.orderHash));
			} else if (isEVMChainId(sourceChainId)) {
				alreadyUnlocked = await this.getAlreadyUnlockedOrPendingOrderEvm(
					sourceChainId,
					initialOrders.map((o) => o.orderHash),
				);
			} else {
				throw new Error(`Unknown from chainId ${sourceChainId} in selectAndPostWhSequence`);
			}

			let filteredOrders = initialOrders.filter((order) => !alreadyUnlocked.has(order.orderHash));

			if (filteredOrders.length > 20) {
				throw new Error(`Too many orderHashes might not fit into block...`);
			}

			if (filteredOrders.length < this.gConf.batchUnlockThreshold) {
				logger.verbose(
					`Not enough swaps to select and post for ${sourceChainId} to ${destChainId}. min ${this.gConf.batchUnlockThreshold}`,
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
			} else if (destChainId === CHAIN_ID_SUI) {
				const result = await this.batchPostSui(orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else if (isEVMChainId(destChainId)) {
				const result = await this.batchPostEvm(destChainId, orderHashes);
				sequence = result.sequence;
				txHash = result.txHash;
			} else {
				throw new Error(`Unknown to chainId ${destChainId} in selectAndPostWhSequence`);
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

	private async getPendingBatchUnlockAndUnlockSui(
		destChainId: number,
		sequence: string,
		postTxHash: string,
		orders: { fromTokenAddress: string; orderHash: string; lockedFundObjectId?: string }[],
	) {
		const sourceChainId = CHAIN_ID_SUI;
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

			const txHash = await this.unlockBatchOnSui(Buffer.from(signedVaa.replace('0x', ''), 'hex'), orders);
			logger.info(`Unlocked batch sui for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);

			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`getPendingBatchUnlockAndUnlockSui failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async getPendingBatchUnlockAndUnlockSolana(
		destChainId: number,
		sequence: string,
		postTxHash: string,
		orders: { fromTokenAddress: string; orderHash: string }[],
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

			const txHash = await this.unlockBatchOnSolana(Buffer.from(signedVaa.replace('0x', ''), 'hex'), orders);
			logger.info(`Unlocked batch solana for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`getPendingBatchUnlockAndRefund failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async unlockSingleOnSui(
		signedVaa: Buffer,
		fromTokenAddress: string,
		lockedFundId: string,
	): Promise<string> {
		let tx = new Transaction();

		let results = addParseAndVerifySui(tx, signedVaa);
		tx = results.tx;
		const vaa = results.vaa;

		const fromToken = await this.tokenList.getTokenData(CHAIN_ID_SUI, fromTokenAddress);

		tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::unlock::unlock`,
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				tx.object(lockedFundId),
				tx.object(fromToken.verifiedAddress!),
				vaa,
			],
			typeArguments: [fromToken.contract],
		});

		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {},
		});

		return result.digest;
	}

	private async unlockSingleOnSolana(
		signedVaa: Buffer,
		orderHash: string,
		fromTokenAddress: string,
	): Promise<string> {
		const stateAddr = getSwiftStateAddrSrc(
			new PublicKey(SolanaProgram),
			Buffer.from(orderHash.replace('0x', ''), 'hex'),
		);
		const fromMint = new PublicKey(fromTokenAddress);
		const stateFromAss = getAssociatedTokenAddressSync(fromMint, stateAddr, true);

		await this.vaaPoster.postSignedVAA(signedVaa, orderHash);
		const vaaAddr = findVaaAddress(signedVaa);

		const parsedVaa = parseVaa(signedVaa);
		const unlockData = this.parseSingleUnlockVaaPayload(parsedVaa.payload);
		const driver = new PublicKey(tryUint8ArrayToNative(unlockData.order.addrUnlocker, CHAIN_ID_SOLANA));
		const driverFromAss = getAssociatedTokenAddressSync(fromMint, driver, false);

		const ix = await this.solanaIx.getUnlockSingleIx(
			driver,
			driverFromAss,
			stateAddr,
			stateFromAss,
			fromMint,
			vaaAddr,
		);
		const priorityFeeIx = await this.priorityFeeService.getPriorityFeeInstruction([
			ix.programId.toString(),
			...ix.keys.map((accMeta) => accMeta.pubkey.toString()),
		]);

		let instructions = [priorityFeeIx, ix];
		const { blockhash } = await this.solanaConnection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConfig.solana.publicKey,
			instructions,
			recentBlockhash: blockhash,
		});
		const trx = new VersionedTransaction(msg);
		trx.sign([this.walletConfig.solana]);
		const serializedTrx = trx.serialize();

		const txHash = await this.solanaSender.sendAndConfirmTransaction(
			serializedTrx,
			this.rpcConfig.solana.sendCount,
			'confirmed',
			30,
			100,
			false,
		);

		return txHash;
	}

	private async unlockBatchOnSui(
		signedVaa: Buffer,
		orders: { fromTokenAddress: string; orderHash: string; lockedFundObjectId?: string }[],
	): Promise<string> {
		let i = -1;
		let tx = new Transaction();

		let results = addParseAndVerifySui(tx, signedVaa);
		tx = results.tx;
		const vaa = results.vaa;

		let [unlockBatchReceipt] = tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::unlock_batch::prepare_unlock_batch`,
			arguments: [tx.object(this.contracts.suiIds.stateId), vaa],
		});

		const parsedPayload = this.parseBatchUnlockVaaPayload(parseVaa(signedVaa).payload);

		for (let ord of parsedPayload.orders) {
			i++;
			const relatedOrder = orders.find((o) => o.orderHash === ord.orderHash);
			if (!relatedOrder) {
				throw new Error(`Could not find related order for ${ord.orderHash}`);
			}
			// const fromMint = new PublicKey(ord.tokenIn);
			const driver = '0x' + Buffer.from(ord.addrUnlocker).toString('hex');
			const fromToken = await this.tokenList.getTokenData(CHAIN_ID_SUI, '0x' + ord.tokenIn.toString('hex'));

			// because driver needs to be signer, if this batch posts contains another unlockAddress than the current wallet, it is ignored
			// to unlock it we must set
			if (this.walletConfig.sui.getPublicKey().toSuiAddress() !== driver) {
				logger.warn(
					`Ignoring unlock for ${ord.orderHash} as driver is the current set solana driver and needs to be signer`,
				);
				continue;
			}

			[unlockBatchReceipt] = tx.moveCall({
				target: `${this.contracts.suiIds.packageId}::unlock_batch::unlock_batch_item`,
				arguments: [
					tx.object(this.contracts.suiIds.stateId),
					tx.object(relatedOrder.lockedFundObjectId!),
					tx.object(fromToken.verifiedAddress!),
					unlockBatchReceipt,
					tx.pure.u16(i),
				],
				typeArguments: [fromToken.contract],
			});
		}

		tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::unlock_batch::complete_unlock_batch`,
			arguments: [unlockBatchReceipt],
		});

		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {
				showEvents: true,
				showEffects: true,
			},
		});

		if (!!result.errors) {
			throw new Error(`Error unlocking batch on SUI ${result.errors}`);
		}

		return result.digest;
	}

	private async unlockBatchOnSolana(signedVaa: Buffer, orders: { fromTokenAddress: string; orderHash: string }[]) {
		let i = -1;
		let instructions = [];

		await this.vaaPoster.postSignedVAA(signedVaa, 'batch_unlcock');

		const parsedPayload = this.parseBatchUnlockVaaPayload(parseVaa(signedVaa).payload);
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
				new PublicKey(SolanaProgram),
				Buffer.from(ord.orderHash.replace('0x', ''), 'hex'),
			);
			const stateAss = getAssociatedTokenAddressSync(fromMint, state, true);
			const vaaAddr = findVaaAddress(signedVaa);
			const ix = await this.solanaIx.getUnlockBatchIx(driver, driverAss, state, stateAss, i, fromMint, vaaAddr);
			instructions.push(ix);
		}

		if (instructions.length === 0) {
			logger.warn(`No instructions to unlock batch`);
			return;
		}

		let keys = [];
		for (let ix of instructions) {
			keys.push(ix.programId.toString());
			keys.push(...ix.keys.map((accMeta) => accMeta.pubkey.toString()));
		}
		const priorityFeeIx = await this.priorityFeeService.getPriorityFeeInstruction(keys);

		instructions = [priorityFeeIx, ...instructions];

		const sharedLut = await this.solanaConnection.getAddressLookupTable(this.mayanSharedLookupTableAddress);
		const { blockhash } = await this.solanaConnection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConfig.solana.publicKey,
			instructions,
			recentBlockhash: blockhash,
			addressLookupTableAccounts: [sharedLut.value!], // tx should fit with this lut
		});
		const trx = new VersionedTransaction(msg);
		trx.sign([this.walletConfig.solana]);
		const serializedTrx = trx.serialize();

		const txHash = await this.solanaSender.sendAndConfirmTransaction(
			serializedTrx,
			this.rpcConfig.solana.sendCount,
			'confirmed',
			60,
			100,
			false,
		);

		return txHash;
	}

	private async getPendingBatchUnlockAndUnlockEvm(
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

			const txHash = await this.unlockOnEvm(signedVaa, sourceChainId, destChainId, true);
			logger.info(`Unlocked batch evm for ${sourceChainId} to ${destChainId} with ${txHash}`);

			this.sequenceStore.removeBatchSequenceAfterUnlock(postTxHash);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`getPendingBatchUnlockAndRefund failed for ${sourceChainId} to ${destChainId} ${err}`);
			delete this.locks[lockKey];
		}
	}

	private async isUnlocked(sourceChainId: number, orderHash: string): Promise<boolean> {
		if (sourceChainId === CHAIN_ID_SOLANA) {
			const solProgram = this.solprogram;
			const stateAddr = getSwiftStateAddrSrc(solProgram, Buffer.from(orderHash.replace('0x', ''), 'hex'));
			const accountInfos = await this.solanaConnection.getAccountInfo(stateAddr);
			if (accountInfos && accountInfos.data.length > 0) {
				const state = parseSwiftStateSrc(accountInfos.data);
				if (state.status === SOLANA_SRC_STATUSES.UNLOCKED) {
					return true;
				}
			}
		} else if (isEVMChainId(sourceChainId)) {
			const sourceOrder = await this.walletsHelper.getReadContract(sourceChainId).orders(orderHash);
			if (sourceOrder.status == EVM_STATES.UNLOCKED) {
				return true;
			}
		} else if (sourceChainId === CHAIN_ID_SUI) {
			return false;
		} else {
			throw new Error(`Unknown chainId ${sourceChainId} in isUnlocked`);
		}

		return false;
	}

	private async performSingleUnlocks(
		sourceChainId: number,
		destChainId: number,
		orderHash: string,
		fromTokenAddress: string,
		unlockSequence: string,
		lockedFundObjectId?: string,
	) {
		const lockKey = `lock:getPendingSingleUnlocksForEth:${sourceChainId}:${destChainId}:${orderHash}`;
		try {
			const locked = this.locks[lockKey];
			if (locked) {
				return;
			} else {
				this.locks[lockKey] = true;
			}

			if (await this.isUnlocked(sourceChainId, orderHash)) {
				logger.info(`Order ${orderHash} was already unlocked`);
				delete this.locks[lockKey];
				return;
			}

			let signedVaa = await this.getSignedVaa(unlockSequence, destChainId, 120);

			let txHash: string;
			if (sourceChainId === CHAIN_ID_SOLANA) {
				txHash = await this.unlockSingleOnSolana(
					Buffer.from(signedVaa.replace('0x', ''), 'hex'),
					orderHash,
					fromTokenAddress,
				);
			} else if (sourceChainId === CHAIN_ID_SUI) {
				txHash = await this.unlockSingleOnSui(
					Buffer.from(signedVaa.replace('0x', ''), 'hex'),
					fromTokenAddress,
					lockedFundObjectId!,
				);
			} else if (isEVMChainId(sourceChainId)) {
				txHash = await this.unlockOnEvm(signedVaa, sourceChainId, destChainId, false);
			} else {
				throw new Error(`Unknown chainId ${sourceChainId} in performSingleUnlocks`);
			}

			logger.info(`Unlocked single evm for ${sourceChainId} to ${destChainId} with tx ${txHash}`);
			delete this.locks[lockKey];
		} catch (err) {
			logger.error(`single unlock failed for ${sourceChainId} ${err}`);
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
		const tx: ethers.TransactionReceipt = await (
			await this.walletsHelper.getWriteContract(destChain).postBatch(orderHashes, overrides)
		).wait();

		if (tx.status !== 1) {
			throw new Error(`Batch post failed for destChain: ${destChain}, ${tx.hash}`);
		}

		const sequence = this.getWormholeSequenceFromTx(tx);

		return {
			sequence: sequence,
			txHash: tx.hash,
		};
	}

	private async batchPostSui(orderHashes: string[]): Promise<{
		sequence: bigint;
		txHash: string;
	}> {
		let tx = new Transaction();
		const [ticket] = tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::batch_post::post_batch`,
			arguments: [tx.object(this.contracts.suiIds.stateId), tx.pure.vector('address', orderHashes)],
		});

		const [whFeeCoin] = tx.splitCoins(tx.gas, [0n]);

		tx.moveCall({
			target: `${WORMHOLE_SUI_PACKAGE}::publish_message::publish_message`,
			arguments: [tx.object(WORMHOLE_SUI_CORE_ID), whFeeCoin, ticket, tx.object(SUI_CLOCK_OBJECT_ID)],
		});

		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {
				showEvents: true,
			},
		});

		let wormholeEvent = result.events?.find(
			(e) => e.type === `${WORMHOLE_SUI_PACKAGE}::publish_message::WormholeMessage`,
		);

		return {
			sequence: BigInt((wormholeEvent?.parsedJson as any).sequence),
			txHash: result.digest,
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

		const states = orderHashes.map((orderHash) =>
			getSwiftStateAddrDest(swiftProgram, Buffer.from(orderHash.replace('0x', ''), 'hex')),
		);

		const batchPostIx = await this.solanaIx.getBatchPostIx(
			this.walletConfig.solana.publicKey,
			wormholeAccs.bridge_config,
			wormholeAccs.coreBridge,
			swiftEmitter,
			wormholeAccs.sequence_key,
			newMessageAccount.publicKey,
			wormholeAccs.fee_collector,
			states,
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
			100,
			false,
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
		let overrides = await getSuggestedOverrides(sourceChain, networkFeeData);
		let tx: ethers.TransactionResponse;
		if (isBatch) {
			tx = await swiftContract.unlockBatch(hexToUint8Array(signedVaa), overrides);
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

	private async getAlreadyUnlockedOrPendingOrderSui(orderHashes: string[]): Promise<Set<string>> {
		let result: Set<string> = new Set();
		for (let orderHash of orderHashes) {
			if (this.sequenceStore.isOrderAlreadyPosted(orderHash)) {
				result.add(orderHash);
			}
		}

		return result;
	}

	private async getAlreadyUnlockedOrPendingOrderSolana(orderHashes: string[]): Promise<Set<string>> {
		let result: Set<string> = new Set();
		const maxFetchPerCall = 200;

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
				getSwiftStateAddrSrc(solProgram, Buffer.from(orderHash.replace('0x', ''), 'hex')),
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

		let posts: { [key: string]: { fromTokenAddress: string; orderHash: string; lockedFundObjectId?: string }[] } =
			{};
		for (let item of batchUnlockData.orders) {
			if (item.unlockSequence && item.unlockSequence !== '0') {
				result.add(item.orderHash);
				if (!posts[item.unlockSequence]) {
					posts[item.unlockSequence] = [];
				}
				posts[item.unlockSequence].push({
					fromTokenAddress: item.fromTokenAddress,
					orderHash: item.orderHash,
					lockedFundObjectId: item.lockedFundObjectId,
				});
			}
		}

		for (let [sequence, val] of Object.entries(posts)) {
			if (val.length >= this.gConf.batchUnlockThreshold) {
				this.sequenceStore.addBatchPostedSequence(
					batchUnlockData.fromChain,
					batchUnlockData.toChain,
					val,
					BigInt(sequence),
					`${batchUnlockData.fromChain}-${batchUnlockData.toChain}-${sequence}`,
				);
			}
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
			const statuses = await this.walletsHelper.getReadContract(sourceChain).getOrders(chunk);
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
				batchUnlockThreshold: this.gConf.batchUnlockThreshold,
				singleBatchChainIds: this.gConf.singleBatchChainIds.join(','),
				driverAddresses: driverAddresses.join(','),
			},
		});

		return rawData.data;
	}

	private async getSignedVaa(sequence: string, destChainId: number, deadlineSeconds?: number): Promise<string> {
		const contractAddress = this.contracts.contracts[destChainId];
		let mayanBridgeEmitterAddress;
		if (ethers.isAddress(contractAddress)) {
			mayanBridgeEmitterAddress = getEmitterAddressEth(contractAddress);
		} else if (destChainId === CHAIN_ID_SOLANA) {
			mayanBridgeEmitterAddress = getEmitterAddressSolana(contractAddress);
		} else if (destChainId === CHAIN_ID_SUI) {
			mayanBridgeEmitterAddress = this.contracts.suiIds.emitterId.slice(2);
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
				lockedFundObjectId?: string; // only for sui source
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
