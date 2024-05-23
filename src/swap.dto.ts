import Decimal from "decimal.js";
import { Token } from "./config/tokens";

export type Swap = {
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

	gaslessSignature: string;
	gaslessPermit: string;

	createTxHash: string;
};
