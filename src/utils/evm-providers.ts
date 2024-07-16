import { ethers } from "ethers6";
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
} from "../config/chains";
import { RpcConfig } from "../config/rpc";

export type EvmProviders = { [evmNetworkId: number | string]: ethers.JsonRpcProvider };

export function makeEvmProviders(chainIds: number[], rpcConfig: RpcConfig): EvmProviders {
	const result: { [key: number]: ethers.JsonRpcProvider } = {};

	for (const chainId of chainIds) {
		if (chainId === CHAIN_ID_BSC) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.bsc, 56, {
				staticNetwork: ethers.Network.from(56),
			});
		} else if (chainId === CHAIN_ID_POLYGON) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.polygon, 137, {
				staticNetwork: ethers.Network.from(137),
			});
		} else if (chainId === CHAIN_ID_ETH) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.ethereum, 1, {
				staticNetwork: ethers.Network.from(1),
			});
		} else if (chainId === CHAIN_ID_AVAX) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.avalanche, 43114, {
				staticNetwork: ethers.Network.from(43114),
			});
		} else if (chainId === CHAIN_ID_ARBITRUM) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.arbitrum, 42161, {
				staticNetwork: ethers.Network.from(42161),
			});
		} else if (chainId === CHAIN_ID_OPTIMISM) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.optimism, 10, {
				staticNetwork: ethers.Network.from(10),
			});
		} else if (chainId === CHAIN_ID_BASE) {
			result[chainId] = new ethers.JsonRpcProvider(rpcConfig.evmEndpoints.base, 8453, {
				staticNetwork: ethers.Network.from(8453),
			});
		}
	}

	return result;
}
