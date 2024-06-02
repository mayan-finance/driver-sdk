import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
} from './chains';

export type ContractsConfig = {
	contracts: {
		[chainId: number]: string;
	};
	evmFulfillHelpers: {
		[chainId: number]: string;
	};
	auctionAddr: string;
	feeCollectorSolana: string;
};

export const SolanaProgram = '5vBpQGxxnzjhv3FNFVpVmGWsUhhNFu4xTbyGs3W2Sbbx';
export const AuctionAddressSolana = '4oUq8HocfbPUpvu1j5ZVbLcoak7DFz2CLK3f91qUuQzH';
export const FeeCollectorSolana = 'pSwTTFE92RsRtvMCpb3mjruv5ww2KgBNVPscwdWwbxk';

export const MayanForwarderAddress = '0x0654874eb7F59C6f5b39931FC45dC45337c967c3';

export const fulfillHelpers: { [key: number]: string } = {
	[CHAIN_ID_ARBITRUM]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_BASE]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_ETH]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_AVAX]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_OPTIMISM]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_POLYGON]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
	[CHAIN_ID_BSC]: '0x53bc894F60F55D8113396Ce63398b48E175A3CeE',
};
