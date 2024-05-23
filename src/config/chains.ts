export const CHAIN_ID_UNSET = 0;
export const CHAIN_ID_SOLANA = 1;
export const CHAIN_ID_ETH = 2;
export const CHAIN_ID_BSC = 4;
export const CHAIN_ID_POLYGON = 5;
export const CHAIN_ID_AVAX = 6;
export const CHAIN_ID_ARBITRUM = 23;
export const CHAIN_ID_OPTIMISM = 24;
export const CHAIN_ID_BASE = 30;

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
];
