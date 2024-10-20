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
	suiIds: {
		packageId: string;
		stateId: string;
		feeManagerStateId: string;
		emitterId: string;
	};
	evmFulfillHelpers: {
		[chainId: number]: string;
	};
	auctionAddr: string;
	feeCollectorSolana: string;
};

export const SolanaProgram = '92peaC8g5ANAxpK2aCfLTC12JgPncRKCGULQNB2DMvRH';
export const AuctionAddressSolana = '9w1D9okTM8xNE7Ntb7LpaAaoLc6LfU9nHFs2h2KTpX1H';
export const FeeCollectorSolana = 'pSwTTFE92RsRtvMCpb3mjruv5ww2KgBNVPscwdWwbxk';

export const MayanForwarderAddress = '0x0654874eb7F59C6f5b39931FC45dC45337c967c3';

export const SuiPackageId = '0x177eea31d9cf4dc8f708498596e3a187b2ded292a51c76cedaa37908a100286a';
export const SuiStateId = '0x676052d39fa50d9384a8a0ab02ba98c5cdc509b0d9e186a36fee1b9853c8f09d';
export const SuiFeeMgrId = '0xeb0ef6904a20489668584b4d5d27c5d3ddafb4ac9f3f0fe94c27cc3e475b8ae3';
export const SuiEmitterId = '0xdcd390d6b4da6e4630ff93b38d764cc67d62c8ce4cc04c194a40dd930c3fa837';

export const fulfillHelpers: { [key: number]: string } = {
	[CHAIN_ID_ARBITRUM]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_BASE]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_ETH]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_AVAX]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_OPTIMISM]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_POLYGON]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
	[CHAIN_ID_BSC]: '0x6DaEA6e2B30010BF8F5aeCDe9741a9D86f3DA919',
};
