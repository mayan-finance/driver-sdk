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
	evmContractsV2Src: {
		[chainId: number]: string;
	};
	evmContractsV2Dst: {
		[chainId: number]: string;
	};
	evmFulfillHelpers: {
		[chainId: number]: string;
	};
	suiIds: {
		packageId: string;
		stateId: string;
		feeManagerStateId: string;
		emitterId: string;
	};
	auctionAddrV2: string;
	feeCollectorSolana: string;
};

export const SolanaProgramV2 = '92peaC8g5ANAxpK2aCfLTC12JgPncRKCGULQNB2DMvRH';
export const AuctionAddressV2Solana = '9bh7SPjkNPgmq7HHWQxgCFJEnMPvAPdLcBEQL1FSG1YR';
export const FeeCollectorSolana = 'pSwTTFE92RsRtvMCpb3mjruv5ww2KgBNVPscwdWwbxk';

export const MayanForwarderAddress = '0x0654874eb7F59C6f5b39931FC45dC45337c967c3';

export const SuiPackageId = '0x974af8e76ab7655b142ac344ce550cfdf9a288f2d2b0e3deff46983c4d255954';
export const SuiStateId = '0x7ac01a7c14c53098a41593c7623823bb677b5201fb3ee35b75b47cfc6c6c6f40';
export const SuiFeeMgrStateId = '0xe42174b6d742f40bd2b67b967542b21e6d7433f2d277a80bb59866ac73ff3f52';
export const SuiEmitterId = '0x3cc868654f6d2cbe7c01d3614572e20ac760e28712bce0286b0be73397e4e821';

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
