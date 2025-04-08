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
	if (address === '0x0000000000000000000000000000000000000000') {
		return '0x' + Buffer.alloc(32).toString('hex');
	}
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

export function writeBigUint256ToBuffer(bigUint256: bigint): Buffer {
	if (typeof bigUint256 !== 'bigint') {
		throw new Error('Input must be a BigInt');
	}

	// 256 bits = 32 bytes
	const byteLength = 32;
	const buffer = Buffer.alloc(byteLength);

	// Convert BigInt to hex string
	let hex = bigUint256.toString(16);

	// Ensure the hex string is padded to the correct byte length
	if (hex.length > byteLength * 2) {
		throw new Error('BigInt exceeds 256 bits');
	}
	hex = hex.padStart(byteLength * 2, '0');

	// Write the hex string into the buffer
	buffer.write(hex, 'hex');

	return buffer;
}

export function writeUint24BE(buffer: Buffer, value: number, offset = 0) {
	// Ensure the value is within the range of 24-bit unsigned integer
	if (value < 0 || value > 0xffffff) {
		throw new RangeError('Value out of range for 24-bit unsigned integer');
	}

	buffer[offset] = (value >> 16) & 0xff; // Write the first 8 bits (most significant byte)
	buffer[offset + 1] = (value >> 8) & 0xff; // Write the next 8 bits
	buffer[offset + 2] = value & 0xff; // Write the last 8 bits (least significant byte)
}
