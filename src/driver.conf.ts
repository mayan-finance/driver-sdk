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
} from './config/chains';

export const driverConfig = {
	maxPendingOrders: 5, // do not bid on anything else if you already have 5 pending orders. Try fulfilling them first
	bidAggressionPercent: 0, // 0% above minamout out
	fulfillAggressionPercent: 100, // take 0% of approximated available profit
	volumeLimitUsd: 5000, // 5k USD
	acceptedInputChains: new Set([
		// CHAIN_ID_BSC,
		CHAIN_ID_AVAX,
		// CHAIN_ID_ETH,
		CHAIN_ID_ARBITRUM,
		// CHAIN_ID_POLYGON,
		// CHAIN_ID_OPTIMISM,
		CHAIN_ID_BASE,
		CHAIN_ID_SOLANA,
		// CHAIN_ID_UNICHAIN,
	]),
	acceptedOutputChains: new Set([
		// CHAIN_ID_BSC,
		CHAIN_ID_AVAX,
		// CHAIN_ID_ETH,
		CHAIN_ID_ARBITRUM,
		// CHAIN_ID_POLYGON,
		// CHAIN_ID_OPTIMISM,
		CHAIN_ID_BASE,
		CHAIN_ID_SOLANA,
		// CHAIN_ID_UNICHAIN,
	]),
};
