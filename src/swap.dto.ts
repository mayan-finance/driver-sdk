import Decimal from 'decimal.js';
import { Token, tokenTo32ByteAddress } from './config/tokens';
import { hexToUint8Array } from './utils/buffer';

export type Swap = {
	orderId: string;
	trader: string;
	trader32: Buffer;
	sourceTxHash: string;
	orderHash: string;
	status: string;
	service: string;
	deadline: Date;
	sourceChain: number;
	destChain: number;
	destAddress: string;
	destAddress32: Buffer;
	fromToken: Token;
	fromTokenAddress: string;
	fromTokenSymbol: string;
	fromAmount: Decimal;
	fromAmount64: bigint;
	toToken: Token;
	toTokenAddress: string;
	toTokenSymbol: string;
	toAmount?: Decimal;
	stateAddr: string;
	auctionStateAddr: string;
	initiatedAt: Date;
	swapRelayerFee: Decimal;
	redeemRelayerFee: Decimal;
	redeemRelayerFee64: bigint;
	refundRelayerFee: Decimal;
	refundRelayerFee64: bigint;
	auctionAddress: string;
	posAddress: string;
	mayanAddress: string;
	referrerAddress: string;
	referrerAddress32: Buffer;
	unlockRecipient: string;
	minAmountOut: Decimal;
	minAmountOut64: bigint;
	gasDrop: Decimal;
	gasDrop64: bigint;
	randomKey: string;

	auctionMode: number;
	mayanBps: number;
	referrerBps: number;

	driverAddress: string;

	gasless: boolean;
	gaslessTx: string;
	gaslessSignature: string;
	gaslessPermit: string;

	payloadId: number;
	customPayload?: string;
	penaltyPeriod: number;
	baseBond: bigint;
	perBpsBond: bigint;

	createTxHash: string;

	retries: number;
	invalidAmountRetires: number;

	bidAmount64?: bigint;
	lastloss?: number;
	bidAmountIn?: number;
};

export function swapToOrderParams(swap: Swap): {
	payloadType: number,
	trader: Buffer, // 32 byte
	destAddr: Buffer,  // 32 byte
	destChainId: number,
	referrerAddr: Buffer, // 32 byte
	tokenOut: Buffer, // 32 byte
	minAmountOut: bigint,
	gasDrop: bigint,
	cancelFee: bigint,
	refundFee: bigint,
	deadline: bigint,
	penaltyPeriod: number,
	referrerBps: number,
	auctionMode: number,
	baseBond: bigint,
	perBpsBond: bigint,
	random: Buffer, // 32 byte
} {
	return {
		payloadType: swap.payloadId,
		penaltyPeriod: swap.penaltyPeriod,
		trader: swap.trader32,
		destAddr: swap.destAddress32,
		destChainId: swap.destChain,
		referrerAddr: swap.referrerAddress32,
		tokenOut: tokenTo32ByteAddress(swap.toToken),
		minAmountOut: swap.minAmountOut64,
		gasDrop: swap.gasDrop64,
		cancelFee: swap.redeemRelayerFee64,
		refundFee: swap.refundRelayerFee64,
		deadline: BigInt(Math.floor(swap.deadline.getTime() / 1000)),
		referrerBps: swap.referrerBps,
		auctionMode: swap.auctionMode,
		baseBond: swap.baseBond,
		perBpsBond: swap.perBpsBond,
		random: Buffer.from(hexToUint8Array(swap.randomKey)),
	}
}

export function swapToExtraParams(swap: Swap): {
	srcChainId: number,
	tokenIn: Buffer, // 32 byte
	protocolBps: number,
	customPayloadHash: Buffer, // 32 byte
} {
	return {
		srcChainId: swap.sourceChain,
		tokenIn: tokenTo32ByteAddress(swap.fromToken),
		protocolBps: swap.mayanBps,
		customPayloadHash: swap.customPayload ? Buffer.from(hexToUint8Array(swap.customPayload)) : Buffer.alloc(32),
	}
}

export const SWAP_STATUS = {
	ORDER_SUBMITTED: 'ORDER_SUBMITTED',
	ORDER_EXPIRED: 'ORDER_EXPIRED',
	ORDER_CREATED: 'ORDER_CREATED',
	ORDER_FULFILLED: 'ORDER_FULFILLED',
	ORDER_SETTLED: 'ORDER_SETTLED',
	ORDER_UNLOCKED: 'ORDER_UNLOCKED',
	ORDER_CANCELED: 'ORDER_CANCELED',
	ORDER_REFUNDED: 'ORDER_REFUNDED',
};
