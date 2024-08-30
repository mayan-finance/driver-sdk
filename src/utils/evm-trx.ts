import axios from 'axios';
import { FeeData, ethers } from 'ethers6';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
} from '../config/chains';
import logger from './logger';

export async function getSuggestedOverrides(targetChain: number, networkFeeData: FeeData): Promise<any> {
	let overrides: {
		maxPriorityFeePerGas?: bigint;
		maxFeePerGas?: bigint;
		gasPrice?: bigint;
	} = {};
	if (targetChain === CHAIN_ID_POLYGON) {
		try {
			const { data } = await axios.get('https://gasstation.polygon.technology/v2');
			overrides['maxFeePerGas'] = ethers.parseUnits(Math.ceil(data.fast.maxFee).toString(), 'gwei');
			overrides['maxPriorityFeePerGas'] = ethers.parseUnits(
				Math.ceil(data.fast.maxPriorityFee).toString(),
				'gwei',
			);
		} catch (err) {
			logger.warn('failed to get gas price from polygon gas station', err);
		}
	} else if (targetChain === CHAIN_ID_BSC) {
		overrides['gasPrice'] = ethers.parseUnits('1.5', 'gwei');
	} else if (targetChain === CHAIN_ID_OPTIMISM) {
		overrides['gasPrice'] = networkFeeData.gasPrice!;
	} else if (targetChain === CHAIN_ID_BASE) {
		overrides['gasPrice'] = networkFeeData.gasPrice!;
	}

	return overrides;
}

export function getTypicalBlocksToConfirm(targetChain: number): number {
	switch (targetChain) {
		case CHAIN_ID_POLYGON:
			return 16;
		case CHAIN_ID_BSC:
			return 10;
		case CHAIN_ID_OPTIMISM:
			return 8;
		case CHAIN_ID_AVAX:
			return 1;
		case CHAIN_ID_ARBITRUM:
			return 40;
		case CHAIN_ID_BASE:
			return 8;
		case CHAIN_ID_ETH:
			return 2;
		default:
			return 10;
	}
}
