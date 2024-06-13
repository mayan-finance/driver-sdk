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
		solanaMainRpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
		solanaSendRpcs: process.env.SOLANA_SEND_RPCS?.split(',') || [
			'https://mainnet.block-engine.jito.wtf/api/v1/transactions',
			'https://api.tatum.io/v3/blockchain/node/solana-mainnet',
		],
		priorityFee: parseInt(process.env.SOLANA_PRIORITY_FEE || '') || null,
	},
	evmEndpoints: {
		avalanche: process.env.AVALANCHE_RPC || 'https://1rpc.io/avax/c',
		arbitrum: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
		base: process.env.BASE_RPC || 'https://mainnet.base.org',
		bsc: process.env.BSC_RPC || 'https://rpc.ankr.com/bsc	',
		ethereumFlashBot: process.env.ETHEREUM_FLASHBOT_RPC || 'https://rpc.flashbots.net/fast',
		ethereum: process.env.ETHEREUM_RPC || 'https://rpc.ankr.com/eth',
		optimism: process.env.OPTIMISM_RPC || 'https://mainnet.optimism.io',
		polygon: process.env.POLYGON_RPC || 'https://polygon-rpc.com/',
	},
	oneInchApiKey: process.env.ONE_INCH_API_KEY || '',
	jupApiKey: process.env.JUP_API_KEY || '',
	wormholeGuardianRpcs: process.env.WORMHOLE_GUARDIAN_RPCS!.split(','),
};
