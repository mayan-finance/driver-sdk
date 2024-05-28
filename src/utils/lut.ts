import {
	AddressLookupTableAccount,
	AddressLookupTableProgram,
	Connection,
	Keypair,
	PublicKey,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import { MayanEndpoints } from '../config/endpoints';
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
		console.log(transaction.serialize().length);
		transaction.sign(signers);
		return true;
	} catch (err) {
		if (err instanceof RangeError) {
			return false;
		}

		throw err;
	}
}

export class LookupTableOptimizer {
	constructor(
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
			usableLuts: [],
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

		const suggestedLuts = await this.getSuggestedLookupTables(instructions);

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
			}
		}

		let allKeys = new Set<string>();
		for (let ix of instructions) {
			for (let key of ix.keys) {
				allKeys.add(key.pubkey.toString());
			}
			allKeys.add(ix.programId.toString());
		}

		let notFoundKeys: string[] = [];
		for (let lut of lookupTables) {
			for (let key of allKeys) {
				if (!lut.state.addresses.map((a) => a.toString()).includes(key)) {
					notFoundKeys.push(key.toString());
				}
			}
		}

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

		return [lut.value, ...lookupTables];
	}
}

type SuggestedLuts = {
	tableAddr: string;
	accounts: string[];
};
