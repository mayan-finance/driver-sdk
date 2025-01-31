import { Connection, PublicKey } from '@solana/web3.js';
import { WalletConfig } from '../config/wallet';
import logger from '../utils/logger';
import { SolanaMultiTxSender } from '../utils/solana-trx';
import { NewSolanaIxHelper } from './solana-ix';

export class StateCloser {
	constructor(
		private readonly walletConf: WalletConfig,
		private readonly connection: Connection,
		private readonly solanaIx: NewSolanaIxHelper,
		private readonly solanaTxSender: SolanaMultiTxSender,
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

		logger.info(`Closing ${destSolanaStates.length} dest swap states`);
		await this.solanaTxSender.createAndSendOptimizedTransaction(ixes, [this.walletConf.solana], [], 10, true);
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

		logger.info(`Closing ${auctionStates.length} auction states`);
		await this.solanaTxSender.createAndSendOptimizedTransaction(ixes, [this.walletConf.solana], [], 10, true);
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
		const chunkSize = 16;
		for (let i = 0; i < destSolanaStates.length; i += chunkSize) {
			const chunk = destSolanaStates.slice(i, i + chunkSize);
			await this.closeBatchDestSolanaStates(chunk);
		}
	}
}
