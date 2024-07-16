import { Connection, Keypair, MessageV0, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import { chunks } from '@certusone/wormhole-sdk';
import {
	createPostVaaInstructionSolana,
	createVerifySignaturesInstructionsSolana,
} from '@certusone/wormhole-sdk/lib/cjs/solana';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import logger from './logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from './solana-trx';
import { WORMHOLE_CORE_BRIDGE, findVaaAddress } from './wormhole';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class VaaPoster {
	constructor(
		private readonly rpcConfi: RpcConfig,
		private readonly walletConf: WalletConfig,
		private readonly connection: Connection,
		private readonly solanaTxHelper: SolanaMultiTxSender,
		private readonly priorityFeeHelper: PriorityFeeHelper,
	) {}

	async signTransaction(transaction: Transaction): Promise<Transaction> {
		transaction.partialSign(this.walletConf.solana);
		return transaction;
	}

	async postSignedVAA(vaa: Buffer, sourceTxHash: string) {
		const isAlreadyDone = await this.isAlreadyVaaPosted(vaa);
		if (isAlreadyDone) {
			logger.info(`VAA is Already posted for ${sourceTxHash}`);
			return true;
		}

		const bridge_id = WORMHOLE_CORE_BRIDGE;
		const payer: string = this.walletConf.solana.publicKey.toString();
		const maxRetries = 17;
		const unsignedTransactions: Transaction[] = [];
		const signature_set = Keypair.generate();
		const instructions = await createVerifySignaturesInstructionsSolana(
			this.connection,
			bridge_id,
			payer,
			vaa,
			signature_set.publicKey,
		);
		const finalInstruction = createPostVaaInstructionSolana(bridge_id, payer, vaa, signature_set.publicKey);
		if (!finalInstruction) {
			return Promise.reject('Failed to construct the transaction.');
		}

		let allAccountKeys: string[] = [];
		for (const instruction of instructions) {
			allAccountKeys.push(instruction.programId.toString());
			for (const key of instruction.keys) {
				allAccountKeys.push(key.pubkey.toString());
			}
		}

		const trxFee = await this.priorityFeeHelper.getPriorityFeeInstruction(allAccountKeys);

		//The verify signatures instructions can be batched into groups of 2 safely,
		//reducing the total number of transactions.
		const batchableChunks = chunks(instructions, 2);
		batchableChunks.forEach((chunk) => {
			let transaction;
			if (chunk.length === 1) {
				transaction = new Transaction().add(chunk[0]).add(trxFee);
			} else {
				transaction = new Transaction().add(chunk[0], chunk[1]).add(trxFee);
			}
			unsignedTransactions.push(transaction);
		});

		//the postVaa instruction can only execute after the verifySignature transactions have
		//successfully completed.
		const finalTrxPriorityFee = await this.priorityFeeHelper.getPriorityFeeInstruction(
			finalInstruction.keys.map((keyAcc) => keyAcc.pubkey.toString()),
		);

		const { blockhash } = await this.connection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConf.solana.publicKey,
			instructions: [finalTrxPriorityFee, finalInstruction],
			recentBlockhash: blockhash,
			addressLookupTableAccounts: [
				(
					await this.connection.getAddressLookupTable(
						new PublicKey('AAJD5ef3combuWT586MxuWPwff3VtWu3FXVUPBJesoiy'),
					)
				).value!,
			],
		});

		const finalTrx = new VersionedTransaction(msg);
		finalTrx.sign([this.walletConf.solana]);

		//The signature_set keypair also needs to sign the verifySignature transactions, thus a wrapper is needed.
		const partialSignWrapper = (transaction: Transaction) => {
			transaction.partialSign(signature_set);
			return this.signTransaction(transaction);
		};

		await this.sendAndConfirmTransactionsJiri(
			partialSignWrapper,
			payer,
			unsignedTransactions,
			signature_set,
			maxRetries,
		);
		await delay(2000);
		const setInfo = await this.connection.getAccountInfo(signature_set.publicKey);
		console.log(
			'SIGNATURE_SET for',
			sourceTxHash,
			`https://explorer.solana.com/address/${signature_set.publicKey.toString()}`,
			`${!!(setInfo && setInfo.data) ? 'EXIST' : 'NON_EXIST'}`,
		);
		//While the signature_set is used to create the final instruction, it doesn't need to sign it.
		console.log('Sending postVaa finalized');
		await this.solanaTxHelper.sendAndConfirmTransaction(finalTrx.serialize(), this.rpcConfi.solana.sendCount);
		console.log('Sent postVaa finalized');
	}

	async sendAndConfirmTransactionsJiri(
		signedTransaction: (trx: Transaction) => Promise<Transaction>,
		payer: string,
		unsignedTransactions: Transaction[],
		signature_set: Keypair,
		maxRetries: number,
	) {
		const payerKey = new PublicKey(payer);
		if (!(unsignedTransactions && unsignedTransactions.length)) {
			return Promise.reject('No transactions provided to send.');
		}

		return await Promise.all(
			unsignedTransactions.map((unTrx) =>
				this.sendAndConfirmTransactionJiri(signedTransaction, payerKey, unTrx, signature_set, maxRetries),
			),
		);
	}

	async sendAndConfirmTransactionJiri(
		signTransaction: (transaction: Transaction) => Promise<Transaction>,
		payer: PublicKey,
		unTrx: Transaction,
		signature_set: Keypair,
		maxRetries: number,
	) {
		let currentRetries = 0;
		let transaction = null;
		let signed: Transaction | null = null;
		let finalRes: string | null = null;
		while (!(currentRetries > maxRetries)) {
			transaction = unTrx;
			try {
				const { blockhash } = await this.connection.getLatestBlockhash();
				transaction.recentBlockhash = blockhash;
				transaction.feePayer = payer;
				signed = await signTransaction(transaction);
				if (signature_set) {
					for (let ins of signed.instructions) {
						let s = false;
						for (let key of ins.keys) {
							if (key.pubkey.equals(signature_set.publicKey) && key.isSigner) {
								signed.partialSign(signature_set);
								s = true;
								break;
							}
						}
						if (s) {
							break;
						}
					}
				}
				logger.info(`Sending postVaa`);
				const txid = await this.solanaTxHelper.sendAndConfirmTransaction(
					signed.serialize(),
					this.rpcConfi.solana.sendCount,
				);
				logger.info(`Sent postVaa with tx ${txid}`);
				finalRes = txid;
				break;
			} catch (e) {
				console.error(e);
				currentRetries++;
				if (currentRetries > maxRetries) {
					throw e;
				}
			}
		}
		if (!finalRes) {
			throw new Error('Failed to send transaction');
		}
		return finalRes;
	}

	async isAlreadyVaaPosted(vaa: Buffer): Promise<boolean> {
		const message_id = findVaaAddress(vaa);
		const info = await this.connection.getAccountInfo(message_id, 'confirmed');
		return !!info;
	}
}
