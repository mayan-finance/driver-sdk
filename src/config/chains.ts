export const CHAIN_ID_UNSET = 0;
export const CHAIN_ID_SOLANA = 1;
export const CHAIN_ID_ETH = 2;
export const CHAIN_ID_BSC = 4;
export const CHAIN_ID_POLYGON = 5;
export const CHAIN_ID_AVAX = 6;
export const CHAIN_ID_ARBITRUM = 23;
export const CHAIN_ID_OPTIMISM = 24;
export const CHAIN_ID_BASE = 30;
export const CHAIN_ID_UNICHAIN = 44;

export function mapNameToWormholeChainId(name: string): number | null {
	if (!(name in chainMap)) {
		return null;
	}

	return chainMap[name];
}

export function mapChainIdToName(chainId: number): string {
	for (const name in chainMap) {
		if (chainMap[name] === chainId) {
			return name;
		}
	}
	throw new Error('Invalid chain id!');
}

export const chainMap: { [key: string]: number } = {
	solana: CHAIN_ID_SOLANA,
	ethereum: CHAIN_ID_ETH,
	bsc: CHAIN_ID_BSC,
	polygon: CHAIN_ID_POLYGON,
	avalanche: CHAIN_ID_AVAX,
	arbitrum: CHAIN_ID_ARBITRUM,
	optimism: CHAIN_ID_OPTIMISM,
	base: CHAIN_ID_BASE,
	unichain: CHAIN_ID_UNICHAIN,
};

export const supportedChainIds: number[] = [
	CHAIN_ID_SOLANA,
	CHAIN_ID_ETH,
	CHAIN_ID_BSC,
	CHAIN_ID_POLYGON,
	CHAIN_ID_AVAX,
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_BASE,
	CHAIN_ID_UNICHAIN,
];

export const ETH_CHAINS: number[] = [
	CHAIN_ID_ETH,
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_BASE,
	CHAIN_ID_UNICHAIN,
];

export const WhChainIdToEvm: { [chainId: number]: number } = {
	[CHAIN_ID_ETH]: 1,
	[CHAIN_ID_BSC]: 56,
	[CHAIN_ID_BASE]: 8453,
	[CHAIN_ID_AVAX]: 43114,
	[CHAIN_ID_OPTIMISM]: 10,
	[CHAIN_ID_ARBITRUM]: 42161,
	[CHAIN_ID_POLYGON]: 137,
	[CHAIN_ID_UNICHAIN]: 130,
};

export const WORMHOLE_DECIMALS = 8;
