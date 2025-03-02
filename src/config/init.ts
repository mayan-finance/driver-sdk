import axios from 'axios';
import logger from '../utils/logger';
import { supportedChainIds } from './chains';
import { ContractsConfig } from './contracts';
import { mayanEndpoints } from './endpoints';
import { GlobalConfig, SwiftFeeParams } from './global';
import { RpcConfig } from './rpc';

const initEndpoint = `${mayanEndpoints.priceApiUrl}/v3/driver/init`;

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
	feeParams: SwiftFeeParams;
	ignoreReferrers: string[];
}> {
	const result = await axios.get(initEndpoint);
	const serverChains = Object.keys(result.data.swiftContracts).map((k) => +k);
	for (let chain of serverChains) {
		if (!supportedChainIds.includes(chain)) {
			delete result.data.swiftContracts[chain];
		}
	}
	return result.data;
}

export async function refershAndPatchConfigs(gConf: GlobalConfig, contracts: ContractsConfig, rpcConfig: RpcConfig) {
	try {
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
		gConf.feeParams = data.feeParams;

		rpcConfig.wormholeGuardianRpcs = data.wormholeGuardianRpcs.split(',');
	} catch (err) {
		logger.warn(`Unable to update configs`);
	}
}
