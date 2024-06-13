import {
	AddressLookupTableAccount,
	AddressLookupTableProgram,
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PACKET_DATA_SIZE,
	PublicKey,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { WalletConfig } from '../config/wallet';
import logger from './logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from './solana-trx';

export function transactionFits(
	instructions: TransactionInstruction[],
	lookupTables: AddressLookupTableAccount[],
	signers: Keypair[],
	payer: PublicKey,
): boolean {
	const messageV0 = new TransactionMessage({
		payerKey: payer,
		recentBlockhash: '5VLPGTsrTrxf9nkonHdfeRQyB7DRLRFM1yWqKur2hCbr',
		instructions: instructions,
	}).compileToV0Message(lookupTables);
	const transaction = new VersionedTransaction(messageV0);
	try {
		let serialized = transaction.serialize();
		transaction.sign(signers);
		serialized = transaction.serialize();
		if (serialized.length > PACKET_DATA_SIZE) {
			return false;
		}
		return true;
	} catch (err: any) {
		if (err instanceof RangeError) {
			return false;
		}
		if (err.message === 'Invalid Request: base64 encoded too large') {
			return false;
		}

		throw err;
	}
}

export class LookupTableOptimizer {
	private jobLock = false;
	constructor(
		private readonly gConf: GlobalConfig,
		private readonly walletConf: WalletConfig,
		private readonly mayanEndpoints: MayanEndpoints,
		private readonly solanaConnection: Connection,
		private readonly priorityFeeHelper: PriorityFeeHelper,
		private readonly solanaSender: SolanaMultiTxSender,
	) {}

	private async getSuggestedLookupTables(instructions: TransactionInstruction[]): Promise<any> {
		return await axios.post(`${this.mayanEndpoints.lutApiUrl}/v3/tx/suggest`, {
			lookupTables: [],
			instructions: instructions.map((ix) => ({
				programId: ix.programId.toBase58(),
				accounts: ix.keys.map((k) => k.pubkey.toBase58()),
			})),
		});
	}

	async initAndScheduleLutClose() {
		await this.closeOwnedLookupTables();
		setInterval(this.closeOwnedLookupTables.bind(this), this.gConf.closeLutsInterval * 1000);
	}

	private async closeOwnedLookupTables() {
		if (this.jobLock) {
			return;
		}
		try {
			this.jobLock = true;
			const { data: tables } = await axios.get(`${this.mayanEndpoints.lutApiUrl}/v3/tx/owned`, {
				params: {
					authority: this.walletConf.solana.publicKey.toString(),
				},
			});

			let pendingPromises: Promise<any>[] = [];

			for (let activeTable of tables.actives) {
				const deact = AddressLookupTableProgram.deactivateLookupTable({
					authority: this.walletConf.solana.publicKey,
					lookupTable: new PublicKey(activeTable),
				});
				const { blockhash } = await this.solanaConnection.getLatestBlockhash();
				const messageV0 = new TransactionMessage({
					payerKey: this.walletConf.solana.publicKey,
					recentBlockhash: blockhash,
					instructions: [
						ComputeBudgetProgram.setComputeUnitPrice({
							microLamports: 5000,
						}),
						deact,
					],
				}).compileToV0Message();
				const trx = new VersionedTransaction(messageV0);
				trx.sign([this.walletConf.solana]);
				pendingPromises.push(this.solanaSender.sendAndConfirmTransaction(trx.serialize(), 10));

				if (pendingPromises.length > 10) {
					await Promise.all(pendingPromises);
					pendingPromises = [];
				}
			}

			for (let deactiveTable of tables.deactives) {
				const closeix = AddressLookupTableProgram.closeLookupTable({
					authority: this.walletConf.solana.publicKey,
					lookupTable: new PublicKey(deactiveTable),
					recipient: this.walletConf.solana.publicKey,
				});
				const { blockhash } = await this.solanaConnection.getLatestBlockhash();
				const messageV0 = new TransactionMessage({
					payerKey: this.walletConf.solana.publicKey,
					recentBlockhash: blockhash,
					instructions: [
						ComputeBudgetProgram.setComputeUnitPrice({
							microLamports: 5000,
						}),
						closeix,
					],
				}).compileToV0Message();
				const trx = new VersionedTransaction(messageV0);
				trx.sign([this.walletConf.solana]);
				pendingPromises.push(this.solanaSender.sendAndConfirmTransaction(trx.serialize(), 10));
				if (pendingPromises.length > 10) {
					await Promise.all(pendingPromises);
					pendingPromises = [];
				}
			}

			await Promise.all(pendingPromises);
		} catch (err: any) {
			logger.error(`Failed to close owned lookup table ${err}`);
		} finally {
			this.jobLock = false;
		}
	}

	private async fitsWithSuggestions(
		tableSuggestsions: SuggestedLuts[],
		instructions: TransactionInstruction[],
		lookupTables: AddressLookupTableAccount[],
		signers: Keypair[],
		payer: PublicKey,
	): Promise<{
		fits: boolean;
		usableLuts: AddressLookupTableAccount[];
	}> {
		let newLuts: AddressLookupTableAccount[] = [];
		let fetchedLuts: { [key: string]: AddressLookupTableAccount | null } = {};
		let limitedSuggestions = tableSuggestsions.slice(0, 10);
		for (let suggestion of limitedSuggestions) {
			let lut = await this.solanaConnection.getAddressLookupTable(new PublicKey(suggestion.tableAddr));
			fetchedLuts[suggestion.tableAddr] = lut.value;
			if (lut.value?.isActive) {
				newLuts.push(lut.value);
				if (transactionFits(instructions, newLuts, signers, payer)) {
					return {
						fits: true,
						usableLuts: newLuts,
					};
				}
			}
		}

		// if can't fit with suggestions try using the given+suggestion
		newLuts = lookupTables;
		for (let suggestion of limitedSuggestions) {
			let lut = fetchedLuts[suggestion.tableAddr];
			if (lut?.isActive) {
				newLuts.push(lut);
				if (transactionFits(instructions, newLuts, signers, payer)) {
					return {
						fits: true,
						usableLuts: newLuts,
					};
				}
			}
		}

		return {
			fits: false,
			usableLuts: newLuts.slice(0, 4),
		};
	}

	async getOptimizedLookupTables(
		instructions: TransactionInstruction[],
		lookupTables: AddressLookupTableAccount[],
		signers: Keypair[],
		payer: PublicKey,
		contextMessage?: string,
	): Promise<AddressLookupTableAccount[]> {
		if (transactionFits(instructions, lookupTables, signers, payer)) {
			return lookupTables;
		}

		const { data: suggestedLuts } = await this.getSuggestedLookupTables(instructions);

		for (let [heatThreshold, tableSuggestsions] of Object.entries<SuggestedLuts[]>(suggestedLuts)) {
			const fitResult = await this.fitsWithSuggestions(
				tableSuggestsions,
				instructions,
				lookupTables,
				signers,
				payer,
			);

			if (fitResult.fits) {
				return fitResult.usableLuts;
			} else {
				const newLookupTables = fitResult.usableLuts;

				let allKeys = new Set<string>();
				for (let ix of instructions) {
					for (let key of ix.keys) {
						allKeys.add(key.pubkey.toString());
					}
					allKeys.add(ix.programId.toString());
				}

				let notFoundKeys: string[] = [];
				for (let lut of newLookupTables) {
					for (let key of allKeys) {
						if (!lut.state.addresses.map((a) => a.toString()).includes(key)) {
							notFoundKeys.push(key.toString());
						}
					}
				}

				notFoundKeys = [...new Set(notFoundKeys)].slice(0, 20);

				logger.info(`Creating new lookup table for ${notFoundKeys.length} keys ${contextMessage || ''}`);
				// Create and extend from scratch. we will later close these
				let lutCreateIxs = await this.priorityFeeHelper.addPriorityFeeInstruction(
					[],
					[this.walletConf.solana.publicKey.toString()],
				);
				const currentSlot = await this.solanaConnection.getSlot();
				const slots = await this.solanaConnection.getBlocks(currentSlot - 100);
				if (slots.length < 1) {
					throw new Error(`Could find any slot with block on the main fork`);
				}
				const [createIns, tableAddr] = AddressLookupTableProgram.createLookupTable({
					authority: this.walletConf.solana.publicKey,
					payer: this.walletConf.solana.publicKey,
					recentSlot: slots[0],
				});
				lutCreateIxs.push(createIns);
				const newKeys = notFoundKeys.splice(0, Math.min(30, notFoundKeys.length));
				const appendIns = AddressLookupTableProgram.extendLookupTable({
					addresses: newKeys.map((k) => new PublicKey(k)),
					authority: this.walletConf.solana.publicKey,
					payer: this.walletConf.solana.publicKey,
					lookupTable: tableAddr,
				});
				lutCreateIxs.push(appendIns);

				const { blockhash, lastValidBlockHeight } = await this.solanaConnection.getLatestBlockhash();
				const messageV0 = new TransactionMessage({
					payerKey: this.walletConf.solana.publicKey,
					recentBlockhash: blockhash,
					instructions: lutCreateIxs,
				}).compileToV0Message();
				const transaction = new VersionedTransaction(messageV0);

				if (!transactionFits(lutCreateIxs, [], [this.walletConf.solana], this.walletConf.solana.publicKey)) {
					logger.warn(`Failed to fit lut with ${heatThreshold}. Continuing...`);
					continue;
				}

				transaction.sign([this.walletConf.solana]);
				await this.solanaSender.sendAndConfirmTransaction(transaction.serialize(), 10);

				let lut = await this.solanaConnection.getAddressLookupTable(tableAddr);
				let retries = 5;
				while (retries > 0 && (!lut || !lut.value)) {
					lut = await this.solanaConnection.getAddressLookupTable(tableAddr);
					retries--;
				}
				if (!lut || !lut.value) {
					throw new Error(`Failed to create lookup table ${tableAddr}`);
				}

				logger.info(`Created new lookup table for ${contextMessage || ''}`);

				return [lut.value, ...newLookupTables];
			}
		}

		return lookupTables;
	}
}

type SuggestedLuts = {
	tableAddr: string;
	accounts: string[];
};
