import { ethers } from 'ethers6';
import { hexToUint8Array } from './buffer';

export function reconstructOrderHashV2(
	payloadId: number,
	penaltyPeriod: number,
	baseBond: bigint,
	perBpsBond: bigint,
	customPayload: Buffer,
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
): string {
	const writeBuffer = Buffer.alloc(290);
	let offset = 0;

	writeBuffer.writeUint8(payloadId);
	offset += 1;

	writeBuffer.set(trader32, offset);
	offset += 32;

	writeBuffer.writeUint16BE(srcChainId, offset);
	offset += 2;

	writeBuffer.set(tokenIn32, offset);
	offset += 32;

	writeBuffer.set(destAddr32, offset);
	offset += 32;

	writeBuffer.writeUint16BE(destChainId, offset);
	offset += 2;

	writeBuffer.set(tokenOut32, offset);
	offset += 32;

	writeBuffer.writeBigUint64BE(minAmountOut64, offset);
	offset += 8;

	writeBuffer.writeBigUint64BE(gasDrop64, offset);
	offset += 8;

	writeBuffer.writeBigInt64BE(refundFeeDest64, offset);
	offset += 8;

	writeBuffer.writeBigUInt64BE(refundFeeSrc64, offset);
	offset += 8;

	const deadline64 = BigInt(deadline);
	writeBuffer.writeBigUInt64BE(deadline64, offset);
	offset += 8;

	writeBuffer.writeUint16BE(penaltyPeriod, offset);
	offset += 2;

	writeBuffer.set(referrerAddr32, offset);
	offset += 32;

	writeBuffer.writeUInt8(referrerBps, offset);
	offset += 1;

	writeBuffer.writeUInt8(mayanBps, offset);
	offset += 1;

	writeBuffer.writeUInt8(auctionMode, offset);
	offset += 1;

	writeBuffer.writeBigUint64BE(baseBond, offset);
	offset += 8;

	writeBuffer.writeBigUint64BE(perBpsBond, offset);
	offset += 8;

	const randomKey32 = Buffer.from(hexToUint8Array(random));
	writeBuffer.set(randomKey32, offset);
	offset += 32;

	writeBuffer.set(customPayload, offset);
	offset += 32;

	if (offset !== 290) {
		throw new Error('Invalid offset');
	}

	return ethers.keccak256(writeBuffer);
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
