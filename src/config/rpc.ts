export type RpcConfig = {
	solana: {
		fulfillTxMode: 'NORMAL' | 'JITO';
		jitoEndpoint: string;
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
		ethereum2nd: string;
		bsc: string;
		bsc2nd: string;
		polygon: string;
		polygon2nd: string;
		avalanche: string;
		avalanche2nd: string;
		arbitrum: string;
		arbitrum2nd: string;
		optimism: string;
		optimism2nd: string;
		base: string;
		base2nd: string;
	};
	jupV6Endpoint: string;
	oneInchApiKey: string;
	jupApiKey: string;
	jupExcludedDexes: string;
	wormholeGuardianRpcs: string[];
	okxApiKey: string;
	okxPassPhrase: string;
	okxSecretKey: string;
};

export const rpcConfig: RpcConfig = {
	solana: {
		fulfillTxMode: process.env.SOLANA_TX_MODE === 'JITO' ? 'JITO' : 'NORMAL',
		jitoEndpoint: process.env.JITO_ENDPOINT || 'https://frankfurt.mainnet.block-engine.jito.wtf',
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
		avalanche2nd: process.env.AVALANCHE_2ND_RPC || 'https://1rpc.io/avax/c',
		arbitrum: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
		arbitrum2nd: process.env.ARBITRUM_2ND_RPC || 'https://arb1.arbitrum.io/rpc',
		base: process.env.BASE_RPC || 'https://mainnet.base.org',
		base2nd: process.env.BASE_2ND_RPC || 'https://mainnet.base.org',
		bsc: process.env.BSC_RPC || 'https://rpc.ankr.com/bsc	',
		bsc2nd: process.env.BSC_2ND_RPC || 'https://rpc.ankr.com/bsc',
		ethereumFlashBot: process.env.ETHEREUM_FLASHBOT_RPC || 'https://rpc.flashbots.net/fast',
		ethereum: process.env.ETHEREUM_RPC || 'https://rpc.ankr.com/eth',
		ethereum2nd: process.env.ETHEREUM_2ND_RPC || 'https://rpc.ankr.com/eth',
		optimism: process.env.OPTIMISM_RPC || 'https://mainnet.optimism.io',
		optimism2nd: process.env.OPTIMISM_2ND_RPC || 'https://mainnet.optimism.io',
		polygon: process.env.POLYGON_RPC || 'https://polygon-rpc.com/',
		polygon2nd: process.env.POLYGON_2ND_RPC || 'https://polygon-rpc.com/',
	},
	jupV6Endpoint: process.env.JUP_V6_ENDPOINT || 'https://quote-api.jup.ag/v6',
	oneInchApiKey: process.env.ONE_INCH_API_KEY || '',
	jupApiKey: process.env.JUP_API_KEY || '',
	jupExcludedDexes: process.env.JUP_EXCLUDED_DEXES || '',
	wormholeGuardianRpcs: process.env.WORMHOLE_GUARDIAN_RPCS!.split(','),
	okxApiKey: process.env.OKX_API_KEY || '',
	okxPassPhrase: process.env.OKX_PASSPHRASE || '',
	okxSecretKey: process.env.OKX_SECRET_KEY || '',
};
