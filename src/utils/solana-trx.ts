import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	MessageV0,
	PublicKey,
	Signer,
	SystemProgram,
	SYSVAR_CLOCK_PUBKEY,
	TransactionInstruction,
	TransactionMessage,
	TransactionSignature,
	VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import { binary_to_base58 } from './base58';
import logger from './logger';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeSendAuxiliaryTrx(
	conn: Connection,
	rawTrx: Buffer | Uint8Array,
): Promise<TransactionSignature | undefined> {
	try {
		return await conn.sendRawTransaction(rawTrx, { skipPreflight: true });
	} catch (e) {
		console.warn(`Failed to send auxiliary transaction: ${e}`);
	}
}

export class SolanaMultiTxSender {
	private readonly connection: Connection;
	private readonly otherConnections: Connection[];
	private readonly priorityFeeHelper: PriorityFeeHelper;

	private readonly jitoTipAccounts: PublicKey[] = [
		new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
		new PublicKey('HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'),
		new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
		new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'),
		new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
		new PublicKey('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
		new PublicKey('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
		new PublicKey('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
	];

	private minJitoTipAmount = Number(process.env.MIN_JITO_TIP || 0.0001);
	private maxJitoTipAmount = Number(process.env.MAX_JITO_TIP || 0.0002);

	constructor(
		private rpcConfig: RpcConfig,
		private readonly walletConfig: WalletConfig,
	) {
		this.connection = new Connection(rpcConfig.solana.solanaMainRpc, 'confirmed');
		this.otherConnections = rpcConfig.solana.solanaSendRpcs.map((url) => new Connection(url, 'confirmed'));
		this.priorityFeeHelper = new PriorityFeeHelper(rpcConfig);

		try {
			setInterval(() => {
				this.updateJitoTips();
			}, 5000);
			this.updateJitoTips();
		} catch (error) {
			logger.error(`Error initializing jito interval: ${error}`);
		}
	}

	async updateJitoTips(): Promise<void> {
		try {
			const { data } = await axios.get('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
			this.minJitoTipAmount = Math.min(
				this.maxJitoTipAmount,
				Math.max(data[0]['landed_tips_75th_percentile'], this.minJitoTipAmount),
			);
			// console.log(`Updated jito tips: ${this.minJitoTipAmount}`);
		} catch (error) {
			logger.error(`Error updating jito tips: ${error}`);
		}
	}

	getRandomJitoTransferIx(tipAmount: number | null = null): TransactionInstruction {
		const ix = SystemProgram.transfer({
			fromPubkey: this.walletConfig.solana.publicKey,
			toPubkey: this.chooseJitoTipAccount(),
			lamports: Math.floor(tipAmount || this.minJitoTipAmount * 10 ** 9),
		});
		return ix;
	}

	async createAndSendJitoBundle(
		txDatas: {
			instructions: TransactionInstruction[];
			signers: Signer[];
			lookupTables: AddressLookupTableAccount[];
		}[],
		timeoutSeconds: number,
		tipAmount: number | null = null,
	): Promise<string> {
		if (txDatas.length > 5) {
			throw new Error('Cannot send more than 5 transactions in a single bundle');
		}

		let txs: string[] = [];
		let { blockhash: recentBlockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
		for (let i = 0; i < txDatas.length; i++) {
			const txData = txDatas[i];
			let instructions = txData.instructions;
			if (i === txDatas.length - 1) {
				instructions.push(this.getRandomJitoTransferIx(tipAmount));
			}
			const msg = MessageV0.compile({
				payerKey: this.walletConfig.solana.publicKey,
				instructions: instructions,
				addressLookupTableAccounts: txData.lookupTables,
				recentBlockhash,
			});
			const trx = new VersionedTransaction(msg);
			trx.sign([this.walletConfig.solana, ...txData.signers]);
			const trxBS58 = binary_to_base58(trx.serialize());
			txs.push(trxBS58);
		}

		logger.info(`Posting ${txs.length} transactions to jito`);
		let headers: { [key: string]: string } = { 'Content-Type': 'application/json' };
		if (this.rpcConfig.solana.jitoUUID) {
			headers['x-jito-auth'] = this.rpcConfig.solana.jitoUUID;
		}
		const res = await axios.post(
			`${this.rpcConfig.solana.jitoEndpoint}/api/v1/bundles`,
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'sendBundle',
				params: [txs],
			},
			{
				headers: headers,
			},
		);
		const bundleId = res.data.result;

		const timeout = timeoutSeconds * 1000;
		const interval = 500;
		const startTime = Date.now();

		while (Date.now() - startTime < timeout && (await this.connection.getBlockHeight()) <= lastValidBlockHeight) {
			const bundleStatuses = await getBundleStatuses(
				[bundleId],
				`${this.rpcConfig.solana.jitoEndpoint}/api/v1/bundles`,
			);

			if (bundleStatuses && bundleStatuses.value && bundleStatuses.value.length > 0) {
				const status = bundleStatuses.value[0].confirmation_status;
				if (status === 'confirmed' || status === 'finalized') {
					const txHash = bundleStatuses.value[0].transactions[0];
					const tx = await this.connection.getSignatureStatus(txHash);
					if (!tx || !tx.value) {
						continue;
					}
					if (tx.value?.err) {
						throw new Error(`Bundle failed with error: ${tx.value.err}`);
					}

					logger.info(
						`Posted ${status} transactions to jito with ${bundleId} ${bundleStatuses.value[0].transactions}`,
					);

					return txHash;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, interval));
		}
		throw new Error('Bundle failed to confirm within the timeout period');
	}

	async createAndSendOptimizedTransaction(
		instructions: TransactionInstruction[],
		signers: Signer[],
		lookupTables: AddressLookupTableAccount[],
		sendCounts: number,
		addPriorityFeeIns: boolean = true,
		feePayer?: Signer,
		manualComputeUnits?: number,
	): Promise<string> {
		const { trx } = await this.createOptimizedVersionedTransaction(
			instructions,
			signers,
			lookupTables,
			addPriorityFeeIns,
			feePayer,
			manualComputeUnits,
		);
		const rawTrx = trx.serialize();
		const trxHash = await this.sendAndConfirmTransaction(rawTrx, sendCounts);

		return trxHash;
	}

	async createOptimizedVersionedTransaction(
		instructions: TransactionInstruction[],
		signers: Signer[],
		lookupTables: AddressLookupTableAccount[],
		addPriorityFeeIns: boolean = true,
		feePayer?: Signer,
		manualComputeUnits?: number,
	): Promise<{ trx: VersionedTransaction; lastValidBlockheight: number }> {
		if (!signers.length) {
			throw new Error('The transaction must have at least one signer');
		}

		if (addPriorityFeeIns) {
			// Check if any of the instructions provided set the compute unit price and/or limit, and throw an error if true
			const existingComputeBudgetInstructions = instructions.filter((instruction) =>
				instruction.programId.equals(ComputeBudgetProgram.programId),
			);

			if (existingComputeBudgetInstructions.length > 0) {
				throw new Error('Cannot provide instructions that set the compute unit price and/or limit');
			}
		}

		const payerKey = feePayer ? feePayer.publicKey : signers[0].publicKey;
		let { blockhash: recentBlockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

		if (addPriorityFeeIns) {
			const computeBudgetIx = await this.priorityFeeHelper.getPriorityFeeInstruction([]);
			instructions.unshift(computeBudgetIx);
		}

		let units: number | null;
		if (manualComputeUnits) {
			units = manualComputeUnits;
		} else {
			units = await this.getComputeUnits(instructions, payerKey, lookupTables);
		}

		if (!units) {
			throw new Error(`Error fetching compute units for the instructions provided`);
		}

		// For very small transactions, such as simple transfers, default to 1k CUs
		let customersCU = units < 1000 ? 1000 : Math.ceil(units * 1.06);

		if (addPriorityFeeIns) {
			const computeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({
				units: customersCU,
			});

			instructions.unshift(computeUnitsIx);
		}

		const v0Message = new TransactionMessage({
			instructions: instructions,
			payerKey: payerKey,
			recentBlockhash: recentBlockhash,
		}).compileToV0Message(lookupTables);
		const versionedTransaction = new VersionedTransaction(v0Message);
		const allSigners = feePayer ? [...signers, feePayer] : signers;
		versionedTransaction.sign(allSigners);
		return {
			trx: versionedTransaction,
			lastValidBlockheight: lastValidBlockHeight,
		};
	}

	async sendAndConfirmTransaction(
		rawTrx: Buffer | Uint8Array,
		maxConcurrentSends: number,
		confirmationLevel: 'confirmed' | 'finalized' = 'confirmed',
		timeoutSeconds: number = 59,
		maxTotalSendCount: number = 150,
		skipPreflightFirst: boolean = true,
	): Promise<string> {
		const sendInterval = this.rpcConfig.solana.sendInterval;
		const otherSendInterval = this.rpcConfig.solana.otherSendInterval;

		let ongoingSends: any[] = [];
		let done = false;
		const trxHash = await this.connection.sendRawTransaction(rawTrx, { skipPreflight: skipPreflightFirst });

		let startTime = new Date().getTime();
		const backgroundSend = async () => {
			let totalSent = 0;
			while (!done && new Date().getTime() - startTime < timeoutSeconds * 1000 && totalSent < maxTotalSendCount) {
				ongoingSends.push(safeSendAuxiliaryTrx(this.connection, rawTrx));
				if (ongoingSends.length > maxConcurrentSends) {
					await Promise.allSettled(ongoingSends);
					ongoingSends = [];
				} else {
					await delay(sendInterval);
				}

				totalSent++;
			}
		};
		backgroundSend();

		let ongoingSends2: any[] = [];
		const otherEnginesBackgroundSend = async () => {
			let totalSent2 = 0;
			while (
				!done &&
				new Date().getTime() - startTime < timeoutSeconds * 1000 &&
				totalSent2 < maxTotalSendCount
			) {
				for (let engine of this.otherConnections) {
					ongoingSends2.push(safeSendAuxiliaryTrx(engine, rawTrx));
				}
				if (ongoingSends2.length > maxConcurrentSends) {
					await Promise.allSettled(ongoingSends2);
					ongoingSends2 = [];
				} else {
					await delay(otherSendInterval);
				}

				totalSent2++;
			}
		};
		otherEnginesBackgroundSend();

		while (!done && new Date().getTime() - startTime < timeoutSeconds * 1000) {
			const sigStatuses = await this.connection.getSignatureStatuses([trxHash]);
			const trxStatus = sigStatuses && sigStatuses.value[0];
			if (trxStatus) {
				if (trxStatus.err) {
					done = true;
					throw new Error(`${trxHash} reverted with ${trxStatus.err}`);
				} else if (trxStatus.confirmationStatus === confirmationLevel) {
					done = true;
					return trxHash;
				}
			}
			await delay(900);
		}

		done = true;
		throw new Error('CONFIRM_TIMED_OUT');
	}

	private async getComputeUnits(
		instructions: TransactionInstruction[],
		payer: PublicKey,
		lookupTables: AddressLookupTableAccount[],
	): Promise<number | null> {
		const testInstructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...instructions];

		const testTransaction = new VersionedTransaction(
			new TransactionMessage({
				instructions: testInstructions,
				payerKey: payer,
				recentBlockhash: (await this.connection.getLatestBlockhash()).blockhash,
			}).compileToV0Message(lookupTables),
		);

		const rpcResponse = await this.connection.simulateTransaction(testTransaction, {
			replaceRecentBlockhash: true,
			sigVerify: false,
		});

		if (rpcResponse.value.err) {
			console.error(
				`Simulation error: ${JSON.stringify(rpcResponse.value.err, null, 2)} logs: ${rpcResponse.value.logs}`,
			);
			throw {
				message: `Simulation error: ${JSON.stringify(rpcResponse.value.err, null, 2)} logs: ${rpcResponse.value.logs}`,
				solError: rpcResponse.value.err,
				solLogs: rpcResponse.value.logs,
			};
		}

		return rpcResponse.value.unitsConsumed || null;
	}

	private chooseJitoTipAccount(): PublicKey {
		const idx = Math.floor(Math.random() * (this.jitoTipAccounts.length - 1));
		return this.jitoTipAccounts[idx];
	}
}

export class PriorityFeeHelper {
	constructor(private rpcConfig: RpcConfig) { }

	private async getPriorityFeeEstimate(priorityLevel: string, accountKeys: string[]): Promise<number | null> {
		// const response = await axios.post(this.providersConfig.heliusRpc, {
		// 	jsonrpc: '2.0',
		// 	id: '1',
		// 	method: 'getPriorityFeeEstimate',
		// 	params: [
		// 		{
		// 			accountKeys: accountKeys,
		// 			options: { priority_level: priorityLevel },
		// 		},
		// 	],
		// });
		// const priorityFeeEstimate = +response.data.result.priorityFeeEstimate;

		return this.rpcConfig.solana.priorityFee;
	}

	public async getPriorityFeeInstruction(
		accountKeys: string[],
		minLamports?: number,
	): Promise<TransactionInstruction> {
		let estimatedPriorityFee = await this.getPriorityFeeEstimate('VERY_HIGH', accountKeys);

		if (minLamports && (!estimatedPriorityFee || estimatedPriorityFee < minLamports)) {
			estimatedPriorityFee = minLamports;
		}

		return ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: Number(estimatedPriorityFee),
		});
	}

	public async addPriorityFeeInstruction(
		currentIxs: TransactionInstruction[],
		accountKeys: string[],
		minLamports?: number,
	): Promise<TransactionInstruction[]> {
		let estimatedPriorityFee = await this.getPriorityFeeEstimate('VERY_HIGH', accountKeys);
		if (isNaN(Number(estimatedPriorityFee))) {
			return currentIxs;
		}

		if (minLamports && (!estimatedPriorityFee || estimatedPriorityFee < minLamports)) {
			estimatedPriorityFee = minLamports;
		}

		const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: Number(estimatedPriorityFee),
		});
		currentIxs.unshift(priorityFeeIx);
		return currentIxs;
	}
}

export async function getCurrentSolanaTimeMS(connection: Connection, retry: number = 4): Promise<number> {
	try {
		const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
		if (!info) {
			throw new Error('Failed to get clock account');
		}
		const x = info.data.subarray(32, 40).reverse();
		const y = Buffer.from(x).toString('hex');
		return Number(`0x${y}`) * 1000;
	} catch (err) {
		if (retry > 0) {
			const result = await getCurrentSolanaTimeMS(connection, retry - 1);
			return result;
		}
		throw err;
	}
}

async function getBundleStatuses(bundleIds: string[], jitoApiUrl: string): Promise<any> {
	const response = await axios.post(
		jitoApiUrl,
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'getBundleStatuses',
			params: [bundleIds],
		},
		{
			headers: { 'Content-Type': 'application/json' },
		},
	);

	if (response.data.error) {
		throw new Error(`Error getting bundle statuses: ${JSON.stringify(response.data.error, null, 2)}`);
	}

	return response.data.result;
}

const RPC_TIMEOUT = parseInt(process.env.RPC_TIMEOUT_MS || '30000');
async function fetchWithTimeout(
	input: URL | RequestInfo,
	init?: RequestInit & { timeout?: number }
): Promise<Response> {
	const { timeout = RPC_TIMEOUT, ...rest } = init || {};
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);

	try {
		return await fetch(input, {
			...rest,
			signal: controller.signal
		});
	} finally {
		clearTimeout(id);
	}
}

export class FailsafeSolanaConnectionHandler {
	private connections: Connection[];
	private activeConnection: Connection;

	getConnectionProxy(): Connection {
		return new Proxy(this, {
			get: (target, prop) => {
				return this.activeConnection[prop as keyof Connection];
			},
		}) as any;
	}

	constructor(rpcUrls: string) {
		this.connections = [];
		for (let rpcUrl of rpcUrls.split(',')) {
			this.connections.push(new Connection(rpcUrl, {
				commitment: 'confirmed',
				fetch: fetchWithTimeout,
			}));
		}

		this.activeConnection = this.connections[0];
		this.scheduleHealthCheck();
	}

	private scheduleHealthCheck() {
		setInterval(this.setActiveConnection.bind(this), 5000);
	}

	private async setActiveConnection() {
		for (let con of this.connections) {
			try {
				await con.getLatestBlockhash();
				this.activeConnection = con;
				return;
			} catch (error) {
				logger.error(`Failed to set active connection: ${error}`);
			}
		}
	}
}
