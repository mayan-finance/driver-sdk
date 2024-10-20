import { ethers } from 'ethers6';
import { CHAIN_ID_SUI, WORMHOLE_DECIMALS } from '../config/chains';
import { Token } from '../config/tokens';
import { hexToUint8Array, tryNativeToUint8Array } from './buffer';

export function reconstructOrderHash(
	trader32: Buffer,
	srcChainId: number,
	tokenIn32: Buffer,
	destChainId: number,
	tokenOut32: Buffer,
	minAmountOut64: bigint,
	gasDrop64: bigint,
	refundFeeDest64: bigint,
	refundFeeSrc64: bigint,
	deadline: number,
	destAddr32: Buffer,
	referrerAddr32: Buffer,
	referrerBps: number,
	mayanBps: number,
	auctionMode: number,
	random: string,
): Buffer {
	const writeBuffer = Buffer.alloc(239);
	let offset = 0;

	writeBuffer.set(trader32, offset);
	offset += 32;

	writeBuffer.writeUInt16BE(srcChainId, offset);
	offset += 2;

	writeBuffer.set(tokenIn32, offset);
	offset += 32;

	writeBuffer.set(destAddr32, offset);
	offset += 32;

	writeBuffer.writeUInt16BE(destChainId, offset);
	offset += 2;

	writeBuffer.set(tokenOut32, offset);
	offset += 32;

	writeBuffer.writeBigUInt64BE(minAmountOut64, offset);
	offset += 8;

	writeBuffer.writeBigUInt64BE(gasDrop64, offset);
	offset += 8;

	writeBuffer.writeBigUInt64BE(refundFeeDest64, offset);
	offset += 8;

	writeBuffer.writeBigUInt64BE(refundFeeSrc64, offset);
	offset += 8;

	const deadline64 = BigInt(deadline);
	writeBuffer.writeBigUInt64BE(deadline64, offset);
	offset += 8;

	writeBuffer.set(referrerAddr32, offset);
	offset += 32;

	writeBuffer.writeUInt8(referrerBps, offset);
	offset += 1;

	writeBuffer.writeUInt8(mayanBps, offset);
	offset += 1;

	writeBuffer.writeUInt8(auctionMode, offset);
	offset += 1;

	const randomKey32 = Buffer.from(hexToUint8Array(random));
	writeBuffer.set(randomKey32, offset);
	offset += 32;

	if (offset !== 239) {
		throw new Error('Invalid offset');
	}

	const orderHash = ethers.keccak256(writeBuffer);
	return Buffer.from(hexToUint8Array(orderHash));
}

export function verifyOrderHash(
	givenOrderHashHex: string,
	trader: string,
	srcChainId: number,
	fromToken: Token,
	destChainId: number,
	toToken: Token,
	minAmountOut: string,
	gasDrop: string,
	refundFeeDest: string,
	refundFeeSrc: string,
	deadline: number,
	destAddr: string,
	referrerAddr: string,
	referrerBps: number,
	mayanBps: number,
	auctionMode: number,
	random: string,
) {
	const minAmountOut64 = getAmountOfFractionalAmount(minAmountOut, Math.min(WORMHOLE_DECIMALS, toToken.decimals));
	const gasDrop64 = getAmountOfFractionalAmount(gasDrop, WORMHOLE_DECIMALS);
	const refundFeeDest64 = getAmountOfFractionalAmount(refundFeeDest, Math.min(fromToken.decimals, WORMHOLE_DECIMALS));
	const refundFeeSrc64 = getAmountOfFractionalAmount(refundFeeSrc, Math.min(fromToken.decimals, WORMHOLE_DECIMALS));

	let trader32: Buffer,
		tokenIn32: Buffer,
		tokenOut32: Buffer,
		destinationAddress32: Buffer,
		referrerAddress32: Buffer;
	if (srcChainId !== CHAIN_ID_SUI) {
		trader32 = Buffer.from(tryNativeToUint8Array(trader, srcChainId));
		tokenIn32 = Buffer.from(tryNativeToUint8Array(fromToken.contract, srcChainId));
	} else {
		trader32 = Buffer.from(hexToUint8Array(trader));
		tokenIn32 = Buffer.from(hexToUint8Array(fromToken.verifiedAddress!));
	}

	if (destChainId !== CHAIN_ID_SUI) {
		tokenOut32 = Buffer.from(tryNativeToUint8Array(toToken.contract, destChainId));
		destinationAddress32 = Buffer.from(tryNativeToUint8Array(destAddr, destChainId));
		referrerAddress32 = Buffer.from(tryNativeToUint8Array(referrerAddr, destChainId));
	} else {
		tokenOut32 = Buffer.from(hexToUint8Array(toToken.verifiedAddress!));
		destinationAddress32 = Buffer.from(hexToUint8Array(destAddr));
		referrerAddress32 = Buffer.from(hexToUint8Array(referrerAddr));
	}

	const orderHash = reconstructOrderHash(
		trader32,
		srcChainId,
		tokenIn32,
		destChainId,
		tokenOut32,
		minAmountOut64,
		gasDrop64,
		refundFeeDest64,
		refundFeeSrc64,
		deadline,
		destinationAddress32,
		referrerAddress32,
		referrerBps,
		mayanBps,
		auctionMode,
		random,
	);

	if (Buffer.from(givenOrderHashHex.slice(2), 'hex').compare(orderHash) !== 0) {
		throw new Error('Invalid order hash');
	}
}

function truncateExtraFraction(input: string | number, decimals: number): string {
	const p1 = `^-?\\d+(?:\\.\\d{0,`;
	const p3 = `})?`;
	const regex = new RegExp(p1 + decimals.toString() + p3);
	return input.toString().match(regex)![0];
}
function getAmountOfFractionalAmount(amount: string | number, decimals: string | number): bigint {
	const fixedAmount = truncateExtraFraction(amount, Number(decimals));
	return ethers.parseUnits(fixedAmount, Number(decimals));
}
