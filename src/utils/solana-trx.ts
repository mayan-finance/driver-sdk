import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { RpcConfig } from "../config/rpc";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeSendAuxiliaryTrx(conn: Connection, rawTrx: Buffer | Uint8Array): Promise<TransactionSignature | undefined> {
	try {
		return await conn.sendRawTransaction(rawTrx, { skipPreflight: true });
	} catch (e) {
		console.warn(`Failed to send auxiliary transaction: ${e}`);
	}
}

export class SolanaMultiTxSender {
	private readonly connection: Connection;
	private readonly otherConnections: Connection[];
	constructor(private rpcConfig: RpcConfig) {
		this.connection = new Connection(rpcConfig.solana.solanaMainRpc, "confirmed");
		this.otherConnections = rpcConfig.solana.solanaSendRpcs.map((url) => new Connection(url, "confirmed"));
	}

	async sendAndConfirmTransaction(
		rawTrx: Buffer | Uint8Array,
		maxConcurrentSends: number,
		confirmationLevel: "confirmed" | "finalized" = "confirmed",
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
			while (!done && new Date().getTime() - startTime < timeoutSeconds * 1000 && totalSent2 < maxTotalSendCount) {
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
		throw new Error("CONFIRM_TIMED_OUT");
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
