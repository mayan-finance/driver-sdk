import { blob, struct, u16, u8 } from '@solana/buffer-layout';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createTransferInstruction } from '@solana/spl-token';
import {
	AccountMeta,
	ComputeBudgetProgram,
	PublicKey,
	SYSVAR_CLOCK_PUBKEY,
	SYSVAR_RENT_PUBKEY,
	SystemProgram,
	TransactionInstruction,
} from '@solana/web3.js';
import { ethers } from 'ethers';
import { WORMHOLE_DECIMALS } from '../config/chains';
import { getSafeU64Blob, hexToUint8Array, tryNativeToUint8Array } from '../utils/buffer';

const BatchPostLayout = struct<any>([u8('instruction'), u8('states_len')]);

const PostLayout = struct<any>([u8('instruction')]);

const SettleLayout = struct<any>([u8('instruction')]);

const FullfillLayout = struct<any>([u8('instruction'), blob(32, 'addr_unlocker')]);

const RegisterWinnerLayout = struct<any>([u8('instruction')]);

const RegisterOrderLayout = struct<any>([
	u8('instruction'),
	blob(32, 'trader'),
	u16('chain_source'),
	blob(32, 'token_in'),
	blob(8, 'amount_in'),
	blob(32, 'token_out'),
	blob(8, 'amount_out_min'),
	blob(8, 'gas_drop'),
	blob(8, 'fee_refund_dest'),
	blob(8, 'fee_refund_source'),
	blob(8, 'deadline'),
	blob(32, 'addr_dest'),
	u16('chain_dest'),
	blob(32, 'addr_ref'),
	u8('fee_rate_ref'),
	u8('fee_rate_mayan'),
	u8('auction_mode'),
	blob(32, 'key_rnd'),
	blob(32, 'order_hash'),
]);

const BidLayout = struct<any>([u8('instruction'), blob(8, 'amount_bid')]);

const PostAuctionLayout = struct<any>([u8('instruction'), blob(32, 'driver_addr')]);

export class SolanaIxHelper {
	constructor() {}

	getBatchPostIx(
		swiftProgramId: PublicKey,
		emitter: PublicKey,
		seqKey: PublicKey,
		messageKey: PublicKey,
		bridgeConfig: PublicKey,
		whFeeAcc: PublicKey,
		payer: PublicKey,
		states: PublicKey[],
		wormholeCoreBridge: PublicKey,
	) {
		let prefixAccounts: Array<AccountMeta> = [
			{ pubkey: emitter, isWritable: false, isSigner: false },
			{ pubkey: seqKey, isWritable: true, isSigner: false },
			{ pubkey: messageKey, isWritable: true, isSigner: true },
			{ pubkey: bridgeConfig, isWritable: true, isSigner: false },
			{ pubkey: whFeeAcc, isWritable: true, isSigner: false }, //wormhole_accounts.fee_collector
			{ pubkey: payer, isWritable: true, isSigner: true },
		];

		let stateAccounts = states.map((stateAddr) => {
			return { pubkey: stateAddr, isWritable: true, isSigner: false };
		});

		let postfixAccounts = [
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
			{ pubkey: wormholeCoreBridge, isWritable: false, isSigner: false },
		];

		const accounts = prefixAccounts.concat(stateAccounts).concat(postfixAccounts);

		let data = Buffer.alloc(BatchPostLayout.span);
		const fields = {
			instruction: 61,
			states_len: states.length,
		};
		BatchPostLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgramId,
			data,
		});
	}

	getPostIx(
		swiftProgramId: PublicKey,
		stateAddr: PublicKey,
		emitter: PublicKey,
		seqKey: PublicKey,
		messageKey: PublicKey,
		bridgeConfig: PublicKey,
		whFeeAcc: PublicKey,
		payer: PublicKey,
		wormholeCoreBridge: PublicKey,
	): TransactionInstruction {
		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: emitter, isWritable: false, isSigner: false },
			{ pubkey: seqKey, isWritable: true, isSigner: false },
			{ pubkey: messageKey, isWritable: true, isSigner: true },
			{ pubkey: bridgeConfig, isWritable: true, isSigner: false },
			{ pubkey: whFeeAcc, isWritable: true, isSigner: false }, //wormhole_accounts.fee_collector
			{ pubkey: payer, isWritable: true, isSigner: true },
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
			{ pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
			{ pubkey: wormholeCoreBridge, isWritable: false, isSigner: false },
		];

		let data = Buffer.alloc(PostLayout.span);
		const fields = {
			instruction: 60,
		};

		PostLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgramId,
			data,
		});
	}

	getSettleIx(
		swiftProgramId: PublicKey,
		stateAddr: PublicKey,
		stateToAss: PublicKey,
		to: PublicKey,
		toAss: PublicKey,
		mayanFeeAss: PublicKey,
		referrerFeeAss: PublicKey,
		agent: PublicKey,
	): TransactionInstruction {
		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: stateToAss, isWritable: true, isSigner: false },
			{ pubkey: to, isWritable: true, isSigner: false },
			{ pubkey: toAss, isWritable: true, isSigner: false },
			{ pubkey: mayanFeeAss, isWritable: true, isSigner: false },
			{ pubkey: referrerFeeAss, isWritable: true, isSigner: false },
			{ pubkey: agent, isWritable: true, isSigner: true },
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
		];

		let data = Buffer.alloc(SettleLayout.span);
		const fields = {
			instruction: 50,
		};
		SettleLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgramId,
			data,
		});
	}

	getSplTransferIx(
		fromAss: PublicKey,
		toAss: PublicKey,
		fromOwner: PublicKey,
		amount: bigint,
	): TransactionInstruction {
		const ix = createTransferInstruction(fromAss, toAss, fromOwner, amount);
		return ix;
	}

	getFullfillIx(
		swiftProgram: PublicKey,
		stateAddr: PublicKey,
		agent: PublicKey,
		mintTo: PublicKey,
		stateToAss: PublicKey,
		destAddr: PublicKey,
		payer: PublicKey,
		unlockerAddr: string,
		sourceChainId: number,
	): TransactionInstruction {
		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: agent, isWritable: false, isSigner: false },
			{ pubkey: mintTo, isWritable: false, isSigner: false },
			{ pubkey: stateToAss, isWritable: true, isSigner: false },
			{ pubkey: destAddr, isWritable: true, isSigner: false },
			{ pubkey: payer, isWritable: true, isSigner: true },
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
		];

		const unlockerAddr32 = tryNativeToUint8Array(unlockerAddr, sourceChainId);

		let data = Buffer.alloc(FullfillLayout.span);
		const fields = {
			instruction: 40,
			addr_unlocker: unlockerAddr32,
		};
		FullfillLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgram,
			data,
		});
	}

	getRegisterWinnerIx(
		swiftProgram: PublicKey,
		stateAddr: PublicKey,
		auctionStateAddr: PublicKey,
	): TransactionInstruction {
		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: auctionStateAddr, isWritable: false, isSigner: false },
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
		];

		let data = Buffer.alloc(RegisterWinnerLayout.span);
		const fields = {
			instruction: 30,
		};
		RegisterWinnerLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgram,
			data,
		});
	}

	getPostAuctionIx(
		auctionProgram: PublicKey,
		stateAddr: PublicKey,
		driverAddr: PublicKey,
		payer: PublicKey,
		whEmitter: PublicKey,
		whSeqKey: PublicKey,
		whMessageKey: PublicKey,
		whBridgeConf: PublicKey,
		whFeeAcc: PublicKey,
		driverDestChainAddress: Uint8Array,
		whCore: PublicKey,
	): TransactionInstruction {
		const [auctionStateAddr] = this.getAuctionStateAddr(stateAddr, auctionProgram);

		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: auctionStateAddr, isWritable: true, isSigner: false },
			{ pubkey: driverAddr, isWritable: false, isSigner: false },
			{ pubkey: payer, isWritable: true, isSigner: true },

			{ pubkey: whEmitter, isWritable: false, isSigner: false },
			{ pubkey: whSeqKey, isWritable: true, isSigner: false },
			{ pubkey: whMessageKey, isWritable: true, isSigner: true },
			{ pubkey: whBridgeConf, isWritable: true, isSigner: false },
			{ pubkey: whFeeAcc, isWritable: true, isSigner: false }, //wormhole_accounts.fee_collector

			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
			{ pubkey: whCore, isWritable: false, isSigner: false },
		];

		let data = Buffer.alloc(PostAuctionLayout.span);
		const fields = {
			instruction: 20,
			driver_addr: driverDestChainAddress,
		};
		PostAuctionLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: auctionProgram,
			data,
		});
	}

	getBidIx(
		auctionProgram: PublicKey,
		amount: bigint,
		stateAddr: PublicKey,
		bidder: PublicKey,
		payer: PublicKey,
	): TransactionInstruction {
		const [auctionStateAddr] = this.getAuctionStateAddr(stateAddr, auctionProgram);
		const [bidStateAddr] = this.getBidStateAddr(auctionStateAddr, auctionProgram, bidder);

		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: false, isSigner: false },
			{ pubkey: auctionStateAddr, isWritable: true, isSigner: false },
			{ pubkey: bidStateAddr, isWritable: true, isSigner: false },
			{ pubkey: bidder, isWritable: false, isSigner: false },
			{ pubkey: payer, isWritable: true, isSigner: true },
			{ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
		];

		let data = Buffer.alloc(BidLayout.span);
		const fields = {
			instruction: 10,
			amount_bid: getSafeU64Blob(amount),
		};
		BidLayout.encode(fields, data);

		return new TransactionInstruction({
			keys: accounts,
			programId: auctionProgram,
			data,
		});
	}

	getRegisterOrderIx(
		swiftProgram: PublicKey,
		stateAddr: PublicKey,
		payer: PublicKey,
		sourceChainId: number,
		destChainId: number,
		trader: string,
		destAddress: string,
		fromTokenAddress: string,
		fromTokenDecimals: number,
		fromAmount: string,
		toTokenAddress: string,
		toTokenDecimals: number,
		minAmountOut: string,
		orderRandomKey: string,
		referrerAddress: string,
		gasDrop: string,
		auctionMode: number,
		mayanFeeRateBps: number,
		referrerFeeRateBps: number,
		orderHashHex: string,
		refundFeeSource: bigint,
		refundFeeDest: bigint,
		deadline: bigint,
	): TransactionInstruction {
		const accounts: Array<AccountMeta> = [
			{ pubkey: stateAddr, isWritable: true, isSigner: false },
			{ pubkey: payer, isWritable: true, isSigner: true },
			{ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
			{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
		];

		const trader32 = Buffer.from(tryNativeToUint8Array(trader, sourceChainId));
		const tokenIn32 = Buffer.from(tryNativeToUint8Array(fromTokenAddress, sourceChainId));
		const tokenOut32 = Buffer.from(tryNativeToUint8Array(toTokenAddress, destChainId));
		const destinationAddress32 = Buffer.from(tryNativeToUint8Array(destAddress, destChainId));
		const randomKey32 = Buffer.from(hexToUint8Array(orderRandomKey));
		const referrerAddress32 = Buffer.from(tryNativeToUint8Array(referrerAddress, destChainId));

		const amountIn64 = this.getAmountOfFractionalAmount(fromAmount, Math.min(fromTokenDecimals, WORMHOLE_DECIMALS));
		const gasDrop64 = this.getAmountOfFractionalAmount(gasDrop, WORMHOLE_DECIMALS);

		const minAmountOut64 = this.getAmountOfFractionalAmount(
			minAmountOut,
			Math.min(toTokenDecimals, WORMHOLE_DECIMALS),
		);

		let data = Buffer.alloc(RegisterOrderLayout.span);
		const fields = {
			instruction: 20,
			trader: trader32,
			chain_source: sourceChainId,
			token_in: tokenIn32,
			amount_in: getSafeU64Blob(amountIn64),
			token_out: tokenOut32,
			amount_out_min: getSafeU64Blob(minAmountOut64),
			gas_drop: getSafeU64Blob(gasDrop64),
			addr_dest: destinationAddress32,
			chain_dest: destChainId,
			addr_ref: referrerAddress32,
			key_rnd: randomKey32,
			fee_rate_ref: referrerFeeRateBps,
			fee_rate_mayan: mayanFeeRateBps,
			auction_mode: auctionMode,
			order_hash: hexToUint8Array(orderHashHex),

			fee_refund_source: getSafeU64Blob(refundFeeSource),
			fee_refund_dest: getSafeU64Blob(refundFeeDest),
			deadline: getSafeU64Blob(deadline),
		};
		try {
			RegisterOrderLayout.encode(fields, data);
		} catch (err) {
			throw err;
		}

		return new TransactionInstruction({
			keys: accounts,
			programId: swiftProgram,
			data,
		});
	}

	private truncateExtraFraction(input: string | number, decimals: number): string {
		const p1 = `^-?\\d+(?:\\.\\d{0,`;
		const p3 = `})?`;
		const regex = new RegExp(p1 + decimals.toString() + p3);
		return input.toString().match(regex)![0];
	}
	private getAmountOfFractionalAmount(amount: string | number, decimals: string | number): bigint {
		const fixedAmount = this.truncateExtraFraction(amount, Number(decimals));
		return ethers.parseUnits(fixedAmount, Number(decimals));
	}

	private getAuctionStateAddr(stateAddr: PublicKey, auctionProgram: PublicKey): [address: PublicKey, nonce: number] {
		return PublicKey.findProgramAddressSync([Buffer.from('AUCTION'), stateAddr.toBytes()], auctionProgram);
	}

	private getBidStateAddr(
		auctionStateAddr: PublicKey,
		auctionProgram: PublicKey,
		bidder: PublicKey,
	): [address: PublicKey, nonce: number] {
		return PublicKey.findProgramAddressSync(
			[Buffer.from('BID'), auctionStateAddr.toBytes(), bidder.toBytes()],
			auctionProgram,
		);
	}

	isBadAggIns(
		instruction: TransactionInstruction,
		address: PublicKey,
		mints: Array<PublicKey>,
		mintsAss: Array<PublicKey>,
	): boolean {
		if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
			return true;
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
}
