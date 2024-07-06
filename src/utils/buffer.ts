import { PublicKey } from '@solana/web3.js';
import { ethers, zeroPadValue } from 'ethers6';
import { CHAIN_ID_SOLANA, supportedChainIds } from '../config/chains';

const MAX_U64 = BigInt(2) ** BigInt(64) - BigInt(1);
export function getSafeU64Blob(value: bigint): Buffer {
	if (value < BigInt(0) || value > MAX_U64) {
		throw new Error(`Invalid u64: ${value}`);
	}
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64LE(value);
	return buf;
}

export const hexToUint8Array = (h: string): Uint8Array => {
	if (h.startsWith('0x')) h = h.slice(2);
	return new Uint8Array(Buffer.from(h, 'hex'));
};

export const uint8ArrayToHex = (a: Uint8Array): string => Buffer.from(a).toString('hex');

/**
 *
 * Convert an address in a chain's native representation into a 32-byte hex string
 * understood by wormhole.
 *
 * @throws if address is a malformed string for the given chain id
 */
export const tryNativeToHexString = (address: string, chainId: number): string => {
	if (supportedChainIds.includes(chainId) && chainId !== CHAIN_ID_SOLANA) {
		return zeroPadValue(address, 32);
	} else if (chainId === CHAIN_ID_SOLANA) {
		return zeroPadValue(new PublicKey(address).toBytes(), 32);
	} else {
		throw Error("Don't know how to convert address from chain " + chainId);
	}
};

/**
 *
 * Convert an address in a chain's native representation into a 32-byte array
 * understood by wormhole.
 *
 * @throws if address is a malformed string for the given chain id
 */
export function tryNativeToUint8Array(address: string, chainId: number): Uint8Array {
	return hexToUint8Array(tryNativeToHexString(address, chainId));
}

export const tryUint8ArrayToNative = (a: Uint8Array, chainId: number): string => {
	if (chainId !== CHAIN_ID_SOLANA) {
		return ethers.stripZerosLeft(ethers.hexlify(a));
	} else if (chainId === CHAIN_ID_SOLANA) {
		return new PublicKey(a).toString();
	} else {
		// This case is never reached normally
		throw Error("Don't know how to convert address for chain " + chainId);
	}
};
