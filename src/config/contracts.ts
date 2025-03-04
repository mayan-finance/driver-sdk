import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_UNICHAIN,
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

export const SolanaProgram = 'BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY';
export const AuctionAddressSolana = '9w1D9okTM8xNE7Ntb7LpaAaoLc6LfU9nHFs2h2KTpX1H';
export const FeeCollectorSolana = 'pSwTTFE92RsRtvMCpb3mjruv5ww2KgBNVPscwdWwbxk';

export const MayanForwarderAddress = '0x0654874eb7F59C6f5b39931FC45dC45337c967c3';

export const fulfillHelpers: { [key: number]: string } = {
	[CHAIN_ID_ARBITRUM]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_BASE]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_ETH]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_AVAX]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_OPTIMISM]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_POLYGON]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_BSC]: '0xBC0663ef63ADD180609944c58BA7D4851890cA45',
	[CHAIN_ID_UNICHAIN]: '0xAb7aC537D02003F148dc8e76873692c874Ec169b',
};

export const okxSwapHelpers: { [key: number]: string } = {
	[CHAIN_ID_ARBITRUM]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_BASE]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_ETH]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_AVAX]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_OPTIMISM]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_POLYGON]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_BSC]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
	[CHAIN_ID_UNICHAIN]: '0x5E18824Bb0e73BB9bd78E7B2D38a3289BcCdEe1D',
};
