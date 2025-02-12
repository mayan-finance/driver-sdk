import Decimal from 'decimal.js';
import { Token } from './config/tokens';

export type Swap = {
	orderId: string;
	trader: string;
	sourceTxHash: string;
	orderHash: string;
	status: string;
	service: string;
	deadline: Date;
	sourceChain: number;
	destChain: number;
	destAddress: string;
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
	refundRelayerFee: Decimal;
	auctionAddress: string;
	posAddress: string;
	mayanAddress: string;
	referrerAddress: string;
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
	UNLOCK_SEQUENCE_RECEIVED: 'UNLOCK_SEQUENCE_RECEIVED',
	ORDER_CANCELED: 'ORDER_CANCELED',
	ORDER_REFUNDED: 'ORDER_REFUNDED',
};
