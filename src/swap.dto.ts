import Decimal from 'decimal.js';
import { Token } from './config/tokens';

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

	bidAmount64?: bigint;
	lastloss?: number;
	bidAmountIn?: number;
};

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
