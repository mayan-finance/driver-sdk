import { Connection, PublicKey } from '@solana/web3.js';
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
			status: rawData.status,
			winner: tryUint8ArrayToNative(rawData.winner, CHAIN_ID_SOLANA),
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
			winner: tryUint8ArrayToNative(rawData.winner, CHAIN_ID_SOLANA),
			validFrom: Number(rawData.validFrom),
			validUntil: Number(rawData.validUntil),
			sequence: rawData.lastSequence,
		};
	}
}

export type ParsedAuctionState = {
	winner: string;
	validFrom: number;
	validUntil: number;
	sequence: bigint;
};

export type ParsedState = {
	status: number;
	winner: string;
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
