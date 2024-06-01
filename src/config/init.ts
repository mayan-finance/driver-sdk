import axios from 'axios';
import { supportedChainIds } from './chains';
import { ContractsConfig } from './contracts';
import { GlobalConf } from './global';
import { RpcConfig } from './rpc';

const initEndpoint = 'https://price-api.mayan.finance/v3/driver/init';

export async function fetchDynamicSdkParams(): Promise<{
	swiftContracts: {
		[key: string]: string;
	};
	registerInterval: number;
	refreshTokenInterval: number;
	wormholeGuardianRpcs: string;
	auctionTimeSeconds: number;
	batchUnlockThreshold: number;
	singleBatchChainIds: string;
	scheduleUnlockInterval: number;
}> {
	const result = await axios.get(initEndpoint);
	const serverChains = Object.keys(result.data.swiftContracts).map((k) => +k);
	for (let chain of serverChains) {
		if (!supportedChainIds.includes(chain)) {
			delete result.data.swiftContract[chain];
		}
	}
	return result.data;
}

export async function refershAndPatchConfigs(gConf: GlobalConf, contracts: ContractsConfig, rpcConfig: RpcConfig) {
	const data = await fetchDynamicSdkParams();

	for (let key of Object.keys(data.swiftContracts)) {
		if (contracts.contracts[+key]) {
			contracts.contracts[+key] = data.swiftContracts[key];
		}
	}

	gConf.auctionTimeSeconds = data.auctionTimeSeconds;
	gConf.batchUnlockThreshold = data.batchUnlockThreshold;
	gConf.scheduleUnlockInterval = data.scheduleUnlockInterval;
	gConf.singleBatchChainIds = data.singleBatchChainIds.split(',').map((x) => +x);
	gConf.registerInterval = data.registerInterval;

	rpcConfig.wormholeGuardianRpcs = data.wormholeGuardianRpcs.split(',');
}
