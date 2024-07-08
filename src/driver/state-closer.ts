import { Connection, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { WalletConfig } from '../config/wallet';
import logger from '../utils/logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from '../utils/solana-trx';
import { NewSolanaIxHelper } from './solana-ix';

export class StateCloser {
	constructor(
		private readonly walletConf: WalletConfig,
		private readonly connection: Connection,
		private readonly solanaIx: NewSolanaIxHelper,
		private readonly solanaTxSender: SolanaMultiTxSender,
		private readonly priorityFeeHelper: PriorityFeeHelper,
	) {}

	private async closeBatchDestSolanaStates(destSolanaStates: string[]) {
		let ixes = [];
		for (let destSolanaState of destSolanaStates) {
			const ix = await this.solanaIx.getCloseStateDestIx(
				new PublicKey(destSolanaState),
				this.walletConf.solana.publicKey,
			);
			ixes.push(ix);
		}
		let accountKeys: string[] = [];
		for (let ix of ixes) {
			accountKeys = accountKeys.concat(ix.keys.map((k) => k.pubkey.toString()));
			accountKeys.push(ix.programId.toString());
		}
		ixes.unshift(await this.priorityFeeHelper.getPriorityFeeInstruction(accountKeys));

		const { blockhash } = await this.connection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConf.solana.publicKey,
			instructions: ixes,
			recentBlockhash: blockhash,
			addressLookupTableAccounts: [],
		});
		const trx = new VersionedTransaction(msg);
		trx.sign([this.walletConf.solana]);
		const serializedTrx = trx.serialize();

		logger.info(`Closing ${destSolanaStates.length} dest swap states`);
		await this.solanaTxSender.sendAndConfirmTransaction(serializedTrx, 10);
		logger.info(`Closed ${destSolanaStates.length} dest swap states`);
	}

	private async closeBatchAuctionStates(auctionStates: string[]) {
		let ixes = [];
		for (let auctionState of auctionStates) {
			const ix = await this.solanaIx.getCloseAuctionIx(
				new PublicKey(auctionState),
				this.walletConf.solana.publicKey,
			);
			ixes.push(ix);
		}
		let accountKeys: string[] = [];
		for (let ix of ixes) {
			accountKeys = accountKeys.concat(ix.keys.map((k) => k.pubkey.toString()));
			accountKeys.push(ix.programId.toString());
		}
		ixes.unshift(await this.priorityFeeHelper.getPriorityFeeInstruction(accountKeys));

		const { blockhash } = await this.connection.getLatestBlockhash();
		const msg = MessageV0.compile({
			payerKey: this.walletConf.solana.publicKey,
			instructions: ixes,
			recentBlockhash: blockhash,
			addressLookupTableAccounts: [],
		});
		const trx = new VersionedTransaction(msg);
		trx.sign([this.walletConf.solana]);
		const serializedTrx = trx.serialize();

		logger.info(`Closing ${auctionStates.length} auction states`);
		await this.solanaTxSender.sendAndConfirmTransaction(serializedTrx, 10);
		logger.info(`Closed ${auctionStates.length} auction states`);
	}

	async closeAuctionStates(auctionStates: string[]) {
		auctionStates = auctionStates.slice(0, 200);
		const states = await this.connection.getMultipleAccountsInfo(auctionStates.map((a) => new PublicKey(a)));

		let finalAuctionStates = [];
		for (let i = 0; i < states.length; i++) {
			if (states[i]?.data) {
				finalAuctionStates.push(auctionStates[i]);
			} else {
				logger.warn(`Auction state ${auctionStates[i]} already closed and skipped`);
			}
		}

		const chunkSize = 4;
		for (let i = 0; i < finalAuctionStates.length; i += chunkSize) {
			const chunk = finalAuctionStates.slice(i, i + chunkSize);
			await this.closeBatchAuctionStates(chunk);
		}
	}

	async closeDestSolanaStates(destSolanaStates: string[]) {
		const chunkSize = 6;
		for (let i = 0; i < destSolanaStates.length; i += chunkSize) {
			const chunk = destSolanaStates.slice(i, i + chunkSize);
			await this.closeBatchDestSolanaStates(chunk);
		}
	}
}
