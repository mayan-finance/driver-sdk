import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	Signer,
	SYSVAR_CLOCK_PUBKEY,
	TransactionInstruction,
	TransactionMessage,
	TransactionSignature,
	VersionedTransaction,
} from '@solana/web3.js';
import { RpcConfig } from '../config/rpc';

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

	constructor(private rpcConfig: RpcConfig) {
		this.connection = new Connection(rpcConfig.solana.solanaMainRpc, 'confirmed');
		this.otherConnections = rpcConfig.solana.solanaSendRpcs.map((url) => new Connection(url, 'confirmed'));
		this.priorityFeeHelper = new PriorityFeeHelper(rpcConfig);
	}

	async createAndSendOptimizedTransaction(
		instructions: TransactionInstruction[],
		signers: Signer[],
		lookupTables: AddressLookupTableAccount[],
		sendCounts: number,
		addPriorityFeeIns: boolean = true,
		feePayer?: Signer,
	): Promise<string> {
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
		let { blockhash: recentBlockhash } = await this.connection.getLatestBlockhash();

		const computeBudgetIx = await this.priorityFeeHelper.getPriorityFeeInstruction([]);
		instructions.unshift(computeBudgetIx);

		const units = await this.getComputeUnits(instructions, payerKey, lookupTables);

		if (!units) {
			throw new Error(`Error fetching compute units for the instructions provided`);
		}

		// For very small transactions, such as simple transfers, default to 1k CUs
		let customersCU = units < 1000 ? 1000 : Math.ceil(units * 1.06);

		const computeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({
			units: customersCU,
		});

		instructions.unshift(computeUnitsIx);

		const v0Message = new TransactionMessage({
			instructions: instructions,
			payerKey: payerKey,
			recentBlockhash: recentBlockhash,
		}).compileToV0Message(lookupTables);
		const versionedTransaction = new VersionedTransaction(v0Message);
		const allSigners = feePayer ? [...signers, feePayer] : signers;
		versionedTransaction.sign(allSigners);

		const rawTrx = versionedTransaction.serialize();
		const trxHash = await this.sendAndConfirmTransaction(rawTrx, sendCounts);

		return trxHash;
	}

	async sendAndConfirmTransaction(
		rawTrx: Buffer | Uint8Array,
		maxConcurrentSends: number,
		confirmationLevel: 'confirmed' | 'finalized' = 'confirmed',
		timeoutSeconds: number = 59,
		maxTotalSendCount: number = 150,
	): Promise<string> {
		const sendInterval = this.rpcConfig.solana.sendInterval;
		const otherSendInterval = this.rpcConfig.solana.otherSendInterval;

		let ongoingSends: any[] = [];
		let done = false;
		const trxHash = await this.connection.sendRawTransaction(rawTrx, { skipPreflight: true });

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
			const trxStatus = await this.connection.getSignatureStatus(trxHash);
			if (trxStatus && trxStatus.value) {
				if (trxStatus.value.err) {
					done = true;
					throw new Error(`${trxHash} reverted with ${trxStatus.value.err}`);
				} else if (trxStatus.value.confirmationStatus === confirmationLevel) {
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
			console.error(`Simulation error: ${JSON.stringify(rpcResponse.value.err, null, 2)}`);
			return null;
		}

		return rpcResponse.value.unitsConsumed || null;
	}
}

export function isBadJupAggIns(
	instruction: TransactionInstruction,
	address: PublicKey,
	mints: Array<PublicKey>,
	mintsAss: Array<PublicKey>,
): boolean {
	if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
		return true;
	}
	if (instruction.programId.equals(TOKEN_PROGRAM_ID)) {
		if (instruction.data[0] === 9) {
			if (mintsAss.find((m) => instruction.keys[0].pubkey.equals(m))) {
				return true;
			}
		}
	}
	if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
		return false;
	}
	if (instruction.data.length > 0) {
		return false;
	}
	if (!instruction.keys[2].pubkey.equals(address)) {
		return false;
	}
	const currentMint = instruction.keys[3].pubkey;
	if (mints.find((m) => m.equals(currentMint))) {
		return true;
	}
	return false;
}

export class PriorityFeeHelper {
	constructor(private rpcConfig: RpcConfig) {}

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
