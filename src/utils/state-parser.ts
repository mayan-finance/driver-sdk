import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { IDL as AuctionIdl } from '../abis/swift-auction.idl';
import { IDL as SwiftIdl } from '../abis/swift.idl';

const SWIFT_SOLANA_SOURCE_STATE_SEED = Buffer.from('STATE_SOURCE');
const SWIFT_SOLANA_DEST_STATE_SEED = Buffer.from('STATE_DEST');
const accCoder = new BorshAccountsCoder(SwiftIdl);
const auctionAccCoder = new BorshAccountsCoder(AuctionIdl);

export async function getSwiftStateDest(connection: Connection, stateAddr: PublicKey): Promise<SwiftDestState | null> {
	const stateAccount = await connection.getAccountInfo(stateAddr);

	if (!stateAccount || !stateAccount.data) {
		return null;
	}

	if (stateAccount.data.length === 9) {
		return {
			status: stateAccount.data[8] ? SOLANA_DEST_STATUSES.CLOSED_SETTLE : SOLANA_DEST_STATUSES.CLOSED_CANCEL,
		};
	}

	const data = accCoder.decode('swiftDestSolanaState', stateAccount.data);

	if (data.status.created) {
		return {
			status: SOLANA_DEST_STATUSES.CREATED,
		};
	} else if (data.status.fulfilled) {
		return {
			status: SOLANA_DEST_STATUSES.FULFILLED,
			winner: data.fulfill.winner.toString(),
		};
	} else if (data.status.settled) {
		return {
			status: SOLANA_DEST_STATUSES.SETTLED,
			winner: data.fulfill.winner.toString(),
		};
	} else if (data.status.posted) {
		return {
			status: SOLANA_DEST_STATUSES.POSTED,
		};
	} else if (data.status.cancelled) {
		return {
			status: SOLANA_DEST_STATUSES.CANCELLED,
		};
	} else {
		throw new Error('Invalid status for dest');
	}
}

export async function getSwiftStateSrc(connection: Connection, stateAddr: PublicKey): Promise<SwiftSourceState | null> {
	const stateAccount = await connection.getAccountInfo(stateAddr);

	if (!stateAccount || !stateAccount.data) {
		return null;
	}

	return parseSwiftStateSrc(stateAccount.data);
}

export function parseSwiftStateSrc(accountData: Buffer): SwiftSourceState {
	const data = accCoder.decode('swiftSourceSolanaState', accountData);

	if (data.status.locked) {
		return {
			status: SOLANA_SRC_STATUSES.LOCKED,
		};
	} else if (data.status.unlocked) {
		return {
			status: SOLANA_SRC_STATUSES.UNLOCKED,
		};
	} else if (data.status.refunded) {
		return {
			status: SOLANA_SRC_STATUSES.REFUNDED,
		};
	} else {
		throw new Error('Invalid status for source');
	}
}

export async function getAuctionState(
	connection: Connection,
	auctionStateAddr: PublicKey,
): Promise<AuctionState | null> {
	const stateAccount = await connection.getAccountInfo(auctionStateAddr);

	if (!stateAccount || !stateAccount.data) {
		return null;
	}

	const data = auctionAccCoder.decode('auctionState', stateAccount.data);

	return {
		winner: data.winner.toString(),
		validFrom: data.validFrom.toNumber(),
		sequence: data.seqMsg ? BigInt(data.seqMsg.toString()) : BigInt(0),
	};
}

export function getSwiftStateAddrSrc(programId: PublicKey, orderHash: Buffer): PublicKey {
	return PublicKey.findProgramAddressSync([SWIFT_SOLANA_SOURCE_STATE_SEED, orderHash], programId)[0];
}

export function getSwiftStateAddrDest(programId: PublicKey, orderHash: Buffer): PublicKey {
	return PublicKey.findProgramAddressSync([SWIFT_SOLANA_DEST_STATE_SEED, orderHash], programId)[0];
}

export type SwiftDestState = {
	status: string;
	winner?: string; // only valid for fulfilled/setlled status
};

export type SwiftSourceState = {
	status: string;
};

export type AuctionState = {
	winner: string;
	validFrom: number;
	sequence: bigint;
};

export const SOLANA_DEST_STATUSES = {
	CREATED: 'CREATED',
	FULFILLED: 'FULFILLED',
	SETTLED: 'SETTLED',
	POSTED: 'POSTED',
	CANCELLED: 'CANCELLED',
	CLOSED_CANCEL: 'CLOSED_CANCEL',
	CLOSED_SETTLE: 'CLOSED_SETTLE',
};

export const POST_CREATE_STATUSES = [
	SOLANA_DEST_STATUSES.FULFILLED,
	SOLANA_DEST_STATUSES.SETTLED,
	SOLANA_DEST_STATUSES.POSTED,
	SOLANA_DEST_STATUSES.CLOSED_SETTLE,
	SOLANA_DEST_STATUSES.CANCELLED,
	SOLANA_DEST_STATUSES.CLOSED_CANCEL,
];

export const POST_FULFILL_STATUSES = [
	SOLANA_DEST_STATUSES.SETTLED,
	SOLANA_DEST_STATUSES.POSTED,
	SOLANA_DEST_STATUSES.CLOSED_SETTLE,
];

export const SOLANA_SRC_STATUSES = {
	LOCKED: 'LOCKED',
	UNLOCKED: 'UNLOCKED',
	REFUNDED: 'REFUNDED',
};

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
