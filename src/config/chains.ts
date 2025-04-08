import { isTestNet } from "../utils/util";

export const CHAIN_ID_UNSET = 0;
export const CHAIN_ID_SOLANA = 1;
export const CHAIN_ID_ETH = isTestNet() ? 10002 : 2;
export const CHAIN_ID_BSC = 4;
export const CHAIN_ID_POLYGON = isTestNet() ? 10007 : 5;
export const CHAIN_ID_AVAX = 6;
export const CHAIN_ID_ARBITRUM = isTestNet() ? 10003 : 23;
export const CHAIN_ID_OPTIMISM = isTestNet() ? 10005 : 24;
export const CHAIN_ID_BASE = isTestNet() ? 10004 : 30;
export const CHAIN_ID_UNICHAIN = 44;
export const CHAIN_ID_MONAD = 48;

export const NETWORK_ID_ETH = isTestNet() ? 11155111 : 1;
export const NETWORK_ID_BASE = isTestNet() ? 84532 : 8453;
export const NETWORK_ID_OPTIMISM = isTestNet() ? 11155420 : 10;
export const NETWORK_ID_AVAX = isTestNet() ? 43113 : 41114;
export const NETWORK_ID_ARBITRUM = isTestNet() ? 421614 : 42161;
export const NETWORK_ID_BSC = isTestNet() ? 97 : 56;
export const NETWORK_ID_POLYGON = isTestNet() ? 80002 : 137;
export const NETWORK_ID_UNICHAIN = isTestNet() ? 1301 : 130;
export const NETWORK_ID_LINEA = isTestNet() ? 59141 : 59144;
export const NETWORK_ID_MONAD = isTestNet() ? 10143 : 10143; // TODO: add mainnet once launched

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
	monad: CHAIN_ID_MONAD,
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
	CHAIN_ID_MONAD,
];

export const ETH_CHAINS: number[] = [
	CHAIN_ID_ETH,
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_BASE,
	CHAIN_ID_UNICHAIN,
	CHAIN_ID_MONAD,
];

export const EVM_CHAINS: number[] = [
	CHAIN_ID_ETH,
	CHAIN_ID_BSC,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_POLYGON,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_UNICHAIN,
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_MONAD,
];

export const WhChainIdToEvm: { [chainId: number]: number } = {
	[CHAIN_ID_ETH]: NETWORK_ID_ETH,
	[CHAIN_ID_BSC]: NETWORK_ID_BSC,
	[CHAIN_ID_BASE]: NETWORK_ID_BASE,
	[CHAIN_ID_AVAX]: NETWORK_ID_AVAX,
	[CHAIN_ID_OPTIMISM]: NETWORK_ID_OPTIMISM,
	[CHAIN_ID_ARBITRUM]: NETWORK_ID_ARBITRUM,
	[CHAIN_ID_POLYGON]: NETWORK_ID_POLYGON,
	[CHAIN_ID_UNICHAIN]: NETWORK_ID_UNICHAIN,
	[CHAIN_ID_MONAD]: NETWORK_ID_MONAD,
};

export const WORMHOLE_DECIMALS = 8;

export function isEvmChainId(chainId: number) {
	return EVM_CHAINS.includes(chainId);
}
