export type RpcConfig = {
	solana: {
		sendCount: number;
		solanaMainRpc: string;
		solanaSendRpcs: string[];
		sendInterval: number;
		otherSendInterval: number;
		priorityFee: number | null;
	};
	evmEndpoints: {
		ethereumFlashBot: string;
		ethereum: string;
		bsc: string;
		polygon: string;
		avalanche: string;
		arbitrum: string;
		optimism: string;
		base: string;
	};
	oneInchApiKey: string;
	jupApiKey: string;
	wormholeGuardianRpcs: string[];
};

export const rpcConfig: RpcConfig = {
	solana: {
		otherSendInterval: 5000,
		sendInterval: 1000,
		sendCount: 50,
		solanaMainRpc: 'https://api.mainnet-beta.solana.com',
		solanaSendRpcs: [
			'https://mainnet.block-engine.jito.wtf/api/v1/transactions',
			'https://api.tatum.io/v3/blockchain/node/solana-mainnet',
		],
		priorityFee: parseInt(process.env.SOLANA_PRIORITY_FEE || '') || null,
	},
	evmEndpoints: {
		avalanche: 'https://1rpc.io/avax/c',
		arbitrum: 'https://arb1.arbitrum.io/rpc',
		base: 'https://mainnet.base.org',
		bsc: 'https://rpc.ankr.com/bsc	',
		ethereumFlashBot: 'https://rpc.flashbots.net/fast',
		ethereum: 'https://rpc.ankr.com/eth',
		optimism: 'https://mainnet.optimism.io',
		polygon: 'https://polygon-rpc.com/',
	},
	oneInchApiKey: process.env.ONE_INCH_API_KEY || '',
	jupApiKey: process.env.JUP_API_KEY || '',
	wormholeGuardianRpcs: process.env.WORMHOLE_GUARDIAN_RPCS!.split(','),
};
