export type RpcConfig = {
    solana: {
        solanaMainRpc: string;
        solanaSendRpcs: string[];
        sendInterval: number;
        otherSendInterval: number;
    },
    evmEndpoints: {
        ethereum: string;
        bsc: string;
        polygon: string;
        avalanche: string;
        arbitrum: string;
        optimism: string;
        base: string;
    }
};

export const rpcConfig: RpcConfig = {
    solana: {
        otherSendInterval: 5000,
        sendInterval: 1000,
        solanaMainRpc: 'https://api.mainnet-beta.solana.com',
        solanaSendRpcs: [
            'https://mainnet.block-engine.jito.wtf/api/v1/transactions',
            'https://api.tatum.io/v3/blockchain/node/solana-mainnet',
        ]
    },
    evmEndpoints: {
        avalanche: 'https://1rpc.io/avax/c',
        arbitrum: 'https://arb1.arbitrum.io/rpc',
        base: 'https://mainnet.base.org',
        bsc: 'https://rpc.ankr.com/bsc	',
        ethereum: 'https://rpc.flashbots.net/fast',
        optimism: 'https://mainnet.optimism.io',
        polygon: 'https://polygon-rpc.com/',
    },
}