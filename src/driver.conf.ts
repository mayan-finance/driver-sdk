import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	CHAIN_ID_UNICHAIN,
	CHAIN_ID_SUI,
} from './config/chains';

export const driverConfig = {
	maxPendingOrders: 10, // do not bid on anything else if you already have 10 pending orders. Try fulfilling them first
	bidAggressionPercent: 0, // 0% above minamout out
	fulfillAggressionPercent: 100, // take 0% of approximated available profit
	volumeLimitUsd: 105_000, // 20k USD
	acceptedInputChains: new Set([
		CHAIN_ID_BSC,
		CHAIN_ID_AVAX,
		CHAIN_ID_ETH,
		CHAIN_ID_ARBITRUM,
		CHAIN_ID_POLYGON,
		CHAIN_ID_OPTIMISM,
		CHAIN_ID_BASE,
		CHAIN_ID_SOLANA,
		CHAIN_ID_UNICHAIN,
		CHAIN_ID_SUI,
	]),
	acceptedOutputChains: new Set([
		CHAIN_ID_BSC,
		CHAIN_ID_AVAX,
		CHAIN_ID_ETH,
		CHAIN_ID_ARBITRUM,
		CHAIN_ID_POLYGON,
		CHAIN_ID_OPTIMISM,
		CHAIN_ID_BASE,
		CHAIN_ID_SOLANA,
		CHAIN_ID_UNICHAIN,
		CHAIN_ID_SUI,
	]),
};
