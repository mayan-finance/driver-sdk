import { ethers } from 'ethers';
import { WORMHOLE_DECIMALS } from '../config/chains';
import { hexToUint8Array, tryNativeToUint8Array } from './buffer';

export function reconstructOrderHash(
	trader: string,
	srcChainId: number,
	tokenIn: string,
	destChainId: number,
	tokenOut: string,
	minAmountOut64: bigint,
	gasDrop64: bigint,
	refundFeeDest64: bigint,
	refundFeeSrc64: bigint,
	deadline: number,
	destAddr: string,
	referrerAddr: string,
	referrerBps: number,
	mayanBps: number,
	auctionMode: number,
	random: string,
): Buffer {
	const writeBuffer = Buffer.alloc(239);
	let offset = 0;

	const trader32 = Buffer.from(tryNativeToUint8Array(trader, srcChainId));
	writeBuffer.set(trader32, offset);
	offset += 32;

	writeBuffer.writeUInt16BE(srcChainId, offset);
	offset += 2;

	const tokenIn32 = Buffer.from(tryNativeToUint8Array(tokenIn, srcChainId));
	writeBuffer.set(tokenIn32, offset);
	offset += 32;

	const destinationAddress32 = Buffer.from(tryNativeToUint8Array(destAddr, destChainId));
	writeBuffer.set(destinationAddress32, offset);
	offset += 32;

	writeBuffer.writeUInt16BE(destChainId, offset);
	offset += 2;

	const tokenOut32 = Buffer.from(tryNativeToUint8Array(tokenOut, destChainId));
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

	const referrerAddress32 = Buffer.from(tryNativeToUint8Array(referrerAddr, destChainId));
	writeBuffer.set(referrerAddress32, offset);
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
	tokenIn: string,
	tokenInDecimals: number,
	destChainId: number,
	tokenOut: string,
	tokenOutDecimals: number,
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
	const minAmountOut64 = getAmountOfFractionalAmount(minAmountOut, Math.min(WORMHOLE_DECIMALS, tokenOutDecimals));
	const gasDrop64 = getAmountOfFractionalAmount(gasDrop, WORMHOLE_DECIMALS);
	const refundFeeDest64 = getAmountOfFractionalAmount(refundFeeDest, Math.min(tokenInDecimals, WORMHOLE_DECIMALS));
	const refundFeeSrc64 = getAmountOfFractionalAmount(refundFeeSrc, Math.min(tokenInDecimals, WORMHOLE_DECIMALS));

	const orderHash = reconstructOrderHash(
		trader,
		srcChainId,
		tokenIn,
		destChainId,
		tokenOut,
		minAmountOut64,
		gasDrop64,
		refundFeeDest64,
		refundFeeSrc64,
		deadline,
		destAddr,
		referrerAddr,
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
