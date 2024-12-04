import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
} from './chains';

export enum EvmRouter {
	UNKNOWN = 0,
	ONE1INCH = 1,
	OKX = 2,
	UNISWAP_V3 = 3,
}

export interface RoutersConfig {
	selectedEvmRouter: { [chainId: number]: EvmRouter };
	uniswapContracts: {
		[chainId: number]: {
			quoterV2: string;
			universalRouter: string;
			swapRouter02: string;
		};
	};
}

export const routersConfig: RoutersConfig = {
	selectedEvmRouter: {
		[CHAIN_ID_OPTIMISM]: EvmRouter.ONE1INCH,
		[CHAIN_ID_ETH]: EvmRouter.ONE1INCH,
		[CHAIN_ID_ARBITRUM]: EvmRouter.ONE1INCH,
		[CHAIN_ID_POLYGON]: EvmRouter.ONE1INCH,
		[CHAIN_ID_BASE]: EvmRouter.OKX,
		[CHAIN_ID_BSC]: EvmRouter.ONE1INCH,
		[CHAIN_ID_AVAX]: EvmRouter.ONE1INCH,
	},
	uniswapContracts: {
		[CHAIN_ID_OPTIMISM]: {
			quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
			universalRouter: '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8',
			swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
		},
		[CHAIN_ID_ETH]: {
			quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
			universalRouter: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
			swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
		},
		[CHAIN_ID_ARBITRUM]: {
			quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
			universalRouter: '0x5E325eDA8064b456f4781070C0738d849c824258',
			swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
		},
		[CHAIN_ID_POLYGON]: {
			quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
			universalRouter: '0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2',
			swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
		},
		[CHAIN_ID_BASE]: {
			quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
			universalRouter: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
			swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481',
		},
		[CHAIN_ID_BSC]: {
			quoterV2: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
			universalRouter: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265',
			swapRouter02: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
		},
		[CHAIN_ID_AVAX]: {
			quoterV2: '0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F',
			universalRouter: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265',
			swapRouter02: '0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE',
		},
	},
};
