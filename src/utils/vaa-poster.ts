// import { chunks } from '@certusone/wormhole-sdk';
// import {
// 	createPostVaaInstructionSolana,
// 	createVerifySignaturesInstructionsSolana,
// } from '@certusone/wormhole-sdk/lib/cjs/solana';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

import { base58_to_binary } from 'base58-js';
import logger from './logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from './solana-trx';
import { WORMHOLE_CORE_BRIDGE, chunks } from './wormhole';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class VaaPoster {
	private wallet: Keypair;

	constructor(
		private readonly wormholeConfig: {},
		private readonly connection: Connection,
		private readonly solanaTxHelper: SolanaMultiTxSender,
		private readonly priorityFeeHelper: PriorityFeeHelper,
	) {
		this.wallet = Keypair.fromSecretKey(base58_to_binary(walletConfig.solana.MayanRelayerPrivateKey));
	}

	async signTransaction(transaction: Transaction): Promise<Transaction> {
		transaction.partialSign(this.wallet);
		return transaction;
	}

	async postSignedVAA(vaaUnit8Array: Uint8Array, sourceTxHash: string) {
		const vaa = Buffer.from(vaaUnit8Array);
		const isAlreadyDone = await this.isAlreadyVaaPosted(vaa);
		if (isAlreadyDone) {
			logger.info(`VAA is Already posted for ${sourceTxHash}`);
			return true;
		}

		const bridge_id = WORMHOLE_CORE_BRIDGE;
		const payer: string = this.wallet.publicKey.toString();
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
		const finalTrxPriorityFee = await this.priorityFeeService.getPriorityFeeInstruction(
			finalInstruction.keys.map((keyAcc) => keyAcc.pubkey.toString()),
		);
		const finalTransaction = new Transaction().add(finalTrxPriorityFee).add(finalInstruction);

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
		await this.sendAndConfirmTransactionsJiri(
			this.signTransaction,
			payer,
			[finalTransaction],
			signature_set,
			maxRetries,
		);
		return Promise.resolve();
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

	async isAlreadyVaaPosted(vaa: Uint8Array): Promise<boolean> {
		const message_id = await findVaaAddress(vaa);
		const info = await this.connection.getAccountInfo(message_id, 'confirmed');
		return !!info;
	}
}
