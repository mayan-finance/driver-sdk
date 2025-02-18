import axios from 'axios';
import logger from '../utils/logger';
import { supportedChainIds } from './chains';
import { ContractsConfig } from './contracts';
import { mayanEndpoints } from './endpoints';
import { GlobalConfig, SwiftFeeParams } from './global';
import { RpcConfig } from './rpc';

const initEndpoint = `${mayanEndpoints.priceApiUrl}/v3/driver/init`;

export async function fetchDynamicSdkParams(): Promise<{
	swiftEvmContractsV2Source: {
		[key: string]: string;
	};
	swiftEvmContractsV2Destination: {
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
	const serverChains = Object.keys(result.data.swiftEvmContractsV2Source).map((k) => +k);
	for (let chain of serverChains) {
		if (!supportedChainIds.includes(chain)) {
			delete result.data.swiftEvmContractsV2Source[chain];
			delete result.data.swiftEvmContractsV2Destination[chain];
		}
	}
	return result.data;
}

export async function refershAndPatchConfigs(gConf: GlobalConfig, contracts: ContractsConfig, rpcConfig: RpcConfig) {
	try {
		const data = await fetchDynamicSdkParams();

		for (let key of Object.keys(data.swiftEvmContractsV2Source)) {
			if (contracts.evmContractsV2Src[+key]) {
				contracts.evmContractsV2Src[+key] = data.swiftEvmContractsV2Source[key];
			}
		}
		for (let key of Object.keys(data.swiftEvmContractsV2Destination)) {
			if (contracts.evmContractsV2Dst[+key]) {
				contracts.evmContractsV2Dst[+key] = data.swiftEvmContractsV2Destination[key];
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
