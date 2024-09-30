import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
} from './config/chains';

export const driverConfig = {
	bidAggressionPercent: 1, // 1% above approximated available profit
	fulfillProfitPercent: 0.1, // 0.1% of approximated available profit
	volumeLimitUsd: 20_000, // 20k USD
	acceptedInputChains: new Set([
		CHAIN_ID_BSC,
		CHAIN_ID_AVAX,
		CHAIN_ID_ETH,
		CHAIN_ID_ARBITRUM,
		CHAIN_ID_POLYGON,
		CHAIN_ID_OPTIMISM,
		CHAIN_ID_BASE,
		CHAIN_ID_SOLANA,
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
	]),
};
