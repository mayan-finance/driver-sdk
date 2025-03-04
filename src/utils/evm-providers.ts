import { ethers } from 'ethers6';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_UNICHAIN,
} from '../config/chains';
import { RpcConfig } from '../config/rpc';

export type EvmProviders = { [evmNetworkId: number | string]: ethers.JsonRpcProvider };

let activeProviders: { [chain: number]: ethers.JsonRpcProvider } = {};
let allProviders: { [chain: number]: ethers.JsonRpcProvider[] } = {};

async function setFirstActiveProvider() {
	for (let chainId of Object.keys(allProviders)) {
		for (let provider of allProviders[+chainId]) {
			try {
				await provider.getBlockNumber();
				activeProviders[+chainId] = provider;
				break;
			} catch (e) {
				console.error(`Error when trying to find active chain rpc ${e}`);
			}
		}
	}
}

export async function refreshEvmProvidersPeriodically() {
	while (true) {
		try {
			await setFirstActiveProvider();
			await setFirstActive2nProvider();
			await new Promise((resolve) => setTimeout(resolve, 15_000));
		} catch (err) {
			console.error(`Error when trying to refresh evm providers ${err}`);
		}
	}
}

export async function makeEvmProviders(chainIds: number[], rpcConfig: RpcConfig): Promise<EvmProviders> {
	for (const chainId of chainIds) {
		allProviders[chainId] = [];
		let realChainId: number = -1;
		let endpoints: string[] = [];
		if (chainId === CHAIN_ID_BSC) {
			realChainId = 56;
			endpoints = rpcConfig.evmEndpoints.bsc.split(',');
		} else if (chainId === CHAIN_ID_POLYGON) {
			realChainId = 137;
			endpoints = rpcConfig.evmEndpoints.polygon.split(',');
		} else if (chainId === CHAIN_ID_ETH) {
			realChainId = 1;
			endpoints = rpcConfig.evmEndpoints.ethereum.split(',');
		} else if (chainId === CHAIN_ID_AVAX) {
			realChainId = 43114;
			endpoints = rpcConfig.evmEndpoints.avalanche.split(',');
		} else if (chainId === CHAIN_ID_ARBITRUM) {
			realChainId = 42161;
			endpoints = rpcConfig.evmEndpoints.arbitrum.split(',');
		} else if (chainId === CHAIN_ID_OPTIMISM) {
			realChainId = 10;
			endpoints = rpcConfig.evmEndpoints.optimism.split(',');
		} else if (chainId === CHAIN_ID_BASE) {
			realChainId = 8453;
			endpoints = rpcConfig.evmEndpoints.base.split(',');
		} else if (chainId === CHAIN_ID_UNICHAIN) {
			realChainId = 130;
			endpoints = rpcConfig.evmEndpoints.unichain.split(',');
		}

		for (let endpoint of endpoints) {
			const provider = new ethers.JsonRpcProvider(endpoint, realChainId, {
				staticNetwork: ethers.Network.from(realChainId),
			});
			allProviders[chainId].push(provider);
		}
	}

	await setFirstActiveProvider();

	return activeProviders;
}

let active2ndProviders: { [chain: number]: ethers.JsonRpcProvider } = {};
let all2ndProviders: { [chain: number]: ethers.JsonRpcProvider[] } = {};

async function setFirstActive2nProvider() {
	for (let chainId of Object.keys(all2ndProviders)) {
		for (let provider of all2ndProviders[+chainId]) {
			try {
				await provider.getBlockNumber();
				active2ndProviders[+chainId] = provider;
				break;
			} catch (e) {
				console.error(`Error when trying to find active  2ndry chain rpc ${e}`);
			}
		}
	}
}

export async function makeSecondEvmProviders(chainIds: number[], rpcConfig: RpcConfig): Promise<EvmProviders> {
	let realChainId: number = -1;
	let endpoints: string[] = [];

	for (const chainId of chainIds) {
		if (chainId === CHAIN_ID_BSC) {
			realChainId = 56;
			endpoints = rpcConfig.evmEndpoints.bsc2nd.split(',');
		} else if (chainId === CHAIN_ID_POLYGON) {
			realChainId = 137;
			endpoints = rpcConfig.evmEndpoints.polygon2nd.split(',');
		} else if (chainId === CHAIN_ID_ETH) {
			realChainId = 1;
			endpoints = rpcConfig.evmEndpoints.ethereum2nd.split(',');
		} else if (chainId === CHAIN_ID_AVAX) {
			realChainId = 43114;
			endpoints = rpcConfig.evmEndpoints.avalanche2nd.split(',');
		} else if (chainId === CHAIN_ID_ARBITRUM) {
			realChainId = 42161;
			endpoints = rpcConfig.evmEndpoints.arbitrum2nd.split(',');
		} else if (chainId === CHAIN_ID_OPTIMISM) {
			realChainId = 10;
			endpoints = rpcConfig.evmEndpoints.optimism2nd.split(',');
		} else if (chainId === CHAIN_ID_BASE) {
			realChainId = 8453;
			endpoints = rpcConfig.evmEndpoints.base2nd.split(',');
		} else if (chainId === CHAIN_ID_UNICHAIN) {
			realChainId = 130;
			endpoints = rpcConfig.evmEndpoints.unichain2nd.split(',');
		}

		for (let endpoint of endpoints) {
			const provider = new ethers.JsonRpcProvider(endpoint, realChainId, {
				staticNetwork: ethers.Network.from(realChainId),
			});
			all2ndProviders[chainId] = [provider];
		}
	}

	await setFirstActive2nProvider();

	return active2ndProviders;
}
