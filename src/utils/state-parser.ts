import { Connection, PublicKey } from '@solana/web3.js';
import { ethers } from 'ethers';
import { CHAIN_ID_SOLANA } from '../config/chains';
import { tryUint8ArrayToNative } from './buffer';

export class SwiftStateParser {
	constructor(private connection: Connection) {}

	async parseSwiftStateAccount(swiftStateAddress: string): Promise<ParsedState | null> {
		const swiftStateAccount = new PublicKey(swiftStateAddress);
		const account = await this.connection.getAccountInfo(swiftStateAccount);
		if (!account || !account.data) {
			return null;
		}
		const data = account.data;
		const rawData = {
			status: data[0],

			trader: Uint8Array.from(data.subarray(1, 33)),

			sourceChainId: Number(data.readUint16LE(33)),
			tokenIn: Uint8Array.from(data.subarray(35, 67)),
			amountIn: data.readBigUInt64LE(67),

			destinationAddress: Uint8Array.from(data.subarray(75, 107)),
			destChainId: Number(data.readUint16LE(107)),
			tokenOut: Uint8Array.from(data.subarray(109, 141)),
			minAmountOut: data.readBigUInt64LE(141),
			gasDropAmount: data.readBigUInt64LE(149),

			refundFeeDest: data.readBigUInt64LE(157),
			refundFeeSrc: data.readBigUInt64LE(165),

			deadline: data.readBigUInt64LE(173),

			referrerAddress: Uint8Array.from(data.subarray(181, 213)),
			referrerBpsFee: data[213],
			mayanBpsFee: data[214],
			auctionMode: data[215],
			randomKey: Uint8Array.from(data.subarray(216, 248)),
			orderHash: Uint8Array.from(data.subarray(248, 280)),
			relayer: Uint8Array.from(data.subarray(280, 312)),
			winner: Uint8Array.from(data.subarray(312, 344)),
			amountPromised: data.readBigUInt64LE(344),
			amountOutput: data.readBigUInt64LE(352),
			patchVersion: data[360],
			timeFulfill: data.readBigUInt64LE(361),
			addrUnlocker: Uint8Array.from(data.subarray(369, 401)),
			seqMsg: data.readBigUInt64LE(401),
		};
		return {
			trader: tryUint8ArrayToNative(rawData.trader, rawData.sourceChainId),
			sourceChainId: rawData.sourceChainId,
			tokenIn: tryUint8ArrayToNative(rawData.tokenIn, rawData.sourceChainId),
			amountIn: rawData.amountIn,
			tokenOut: tryUint8ArrayToNative(rawData.tokenOut, rawData.destChainId),
			minAmountOut: rawData.minAmountOut,
			gasDropAmount: rawData.gasDropAmount,
			refundFeeDst: rawData.refundFeeDest,
			refundFeeSrc: rawData.refundFeeSrc,
			deadline: Number(rawData.deadline),
			destAddress: tryUint8ArrayToNative(rawData.destinationAddress, rawData.destChainId),
			destChainId: rawData.destChainId,
			referrerAddress: tryUint8ArrayToNative(rawData.referrerAddress, rawData.destChainId),
			randomKey: ethers.hexlify(rawData.randomKey),
			orderHash: '0x' + Buffer.from(rawData.orderHash).toString('hex'),
			status: rawData.status,
			sequence: Number(rawData.seqMsg) - 1,
			winner: tryUint8ArrayToNative(rawData.winner, CHAIN_ID_SOLANA),
			amountOut: rawData.amountOutput,
			auctionMode: Number(rawData.auctionMode),
			mayanBpsFee: Number(rawData.mayanBpsFee),
			referrerBpsFee: Number(rawData.referrerBpsFee),
		};
	}
}

export class SwiftAuctionParser {
	constructor(private readonly connection: Connection) {}

	async parseState(accountAddress: string): Promise<ParsedAuctionState | null> {
		const account = await this.connection.getAccountInfo(new PublicKey(accountAddress));
		if (!account || !account.data) {
			return null;
		}
		const data = account.data;
		const rawData = {
			orderHash: Uint8Array.from(data.subarray(0, 32)),
			winner: Uint8Array.from(data.subarray(32, 64)),
			amountPromised: data.readBigUInt64LE(64),
			validFrom: data.readBigUInt64LE(72),
			validUntil: data.readBigUInt64LE(80),
			lastSequence: data.readBigUInt64LE(88),
		};

		return {
			orderHash: tryUint8ArrayToNative(rawData.orderHash, CHAIN_ID_SOLANA),
			winner: tryUint8ArrayToNative(rawData.winner, CHAIN_ID_SOLANA),
			amountPromised: rawData.amountPromised,
			validFrom: Number(rawData.validFrom),
			validUntil: Number(rawData.validUntil),
			sequence: rawData.lastSequence,
		};
	}
}

export type ParsedAuctionState = {
	orderHash: string;
	winner: string;
	amountPromised: bigint;
	validFrom: number;
	validUntil: number;
	sequence: bigint;
};

export type ParsedState = {
	trader: string;
	sourceChainId: number;
	tokenIn: string;
	amountIn: bigint;
	tokenOut: string;
	minAmountOut: bigint;
	gasDropAmount: bigint;
	refundFeeSrc: bigint;
	refundFeeDst: bigint;
	deadline: number;
	destAddress: string;
	destChainId: number;
	referrerAddress: string;
	randomKey: string;
	orderHash: string;
	status: number;
	sequence: number;
	amountOut: bigint;
	winner: string;
	auctionMode: number;
	mayanBpsFee: number;
	referrerBpsFee: number;
} | null;

export type EvmStoredOrder = {
	status: number;
	destChainId: number;
};

export const SOLANA_STATES = {
	STATUS_CREATED: 1,
	STATUS_FULFILLED: 2,
	STATUS_SETTLED: 3,
	STATUS_UNLOCKED: 4,
	STATUS_CANCELLED: 5,
	STATUS_REFUNDED: 6,
};

export const EVM_STATES = {
	CREATED: 0,
	FULFILLED: 1,
	UNLOCKED: 2,
	CANCELED: 3,
	REFUNDED: 4,
};

export const AUCTION_MODES = {
	UNKOWNN: 0,
	DONT_CARE: 1,
	ENGLISH: 2,
};
