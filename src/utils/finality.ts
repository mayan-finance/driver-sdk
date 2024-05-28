import { Connection } from '@solana/web3.js';
import { ethers } from 'ethers';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
} from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { EvmProviders } from './evm-providers';
import logger from './logger';
import { delay } from './util';

export class ChainFinality {
	private readonly blockGenerationTimeSecond: {
		[chainId: number]: number;
	};
	private readonly minimumBlocksToFinality: {
		[chainId: number]: number;
	};

	private readonly minSwapValueUsd = 100;
	private readonly maxSwapValueUsd = 100_000;

	constructor(
		private readonly solanaConnection: Connection,
		private readonly contracts: ContractsConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly evmProviders: EvmProviders,
	) {
		this.blockGenerationTimeSecond = {
			[CHAIN_ID_ETH]: 13,
			[CHAIN_ID_BSC]: 3,
			[CHAIN_ID_POLYGON]: 2,
			[CHAIN_ID_AVAX]: 2,
			[CHAIN_ID_ARBITRUM]: 0.3,
			[CHAIN_ID_OPTIMISM]: 2,
			[CHAIN_ID_BASE]: 2,
		};

		this.minimumBlocksToFinality = {
			[CHAIN_ID_ETH]: 2,
			[CHAIN_ID_BSC]: 2,
			[CHAIN_ID_POLYGON]: 4,
			[CHAIN_ID_AVAX]: 2,
			[CHAIN_ID_ARBITRUM]: 2,
			[CHAIN_ID_OPTIMISM]: 2,
			[CHAIN_ID_BASE]: 2,
		};
	}

	async waitForEvm(chainId: number, sourceTxHash: string, swapValueUsd: number): Promise<void> {
		const startTime = Date.now();
		let iteration = 0;
		while (true) {
			try {
				const timeToFinalize = await this.timeToFinalizeSeconds(chainId, sourceTxHash, swapValueUsd);

				if (timeToFinalize <= 0) {
					const tx = await this.evmProviders[chainId].getTransactionReceipt(sourceTxHash);
					if (!tx || tx.status === 0) {
						throw new Error('Transaction not found or has error in waiting for chain finality');
					}
					return;
				}

				await delay(timeToFinalize * 1000);
			} catch (err: any) {
				logger.error(`Error while waiting for finality for tx: ${sourceTxHash} ${err.message}`);
				await delay(3000);
			} finally {
				iteration++;

				if (Date.now() - startTime > 60000) {
					logger.warn(`Waiting for finality for tx: ${sourceTxHash} for more than 60 seconds`);
				}

				if (Date.now() - startTime > 3600_000) {
					logger.error(`Waiting for finality for tx: ${sourceTxHash} took more than 1 hour. Giving up`);
					throw new Error('Waiting for finality for tx took more than 1 hour');
				}
			}
		}
	}

	async waitForFinality(sourceChain: number, sourceTxHash: string, swapValueUsd: number): Promise<void> {
		if (sourceChain === CHAIN_ID_SOLANA) {
			await this.solanaConnection.getTransaction(sourceTxHash, {
				commitment: 'finalized',
				maxSupportedTransactionVersion: 2,
			});
		} else {
			await this.waitForEvm(sourceChain, sourceTxHash, swapValueUsd);
		}
	}

	private async getEvmCurrentFinalizedBlockNumber(provider: ethers.JsonRpcProvider): Promise<number> {
		// Taken from here: https://github.com/wormhole-foundation/wormhole/blob/eee4641f55954d2d0db47831688a2e97eb20f7ee/node/pkg/watchers/evm/watcher.go#L728
		// Beware that this might not be supported by all chains, so check rpc capabilities for future chains

		// ethers js does not support `getBlockByNumber` with `finalized` blockTag yet, so send RAW
		const resOpt = await provider.send('eth_getBlockByNumber', ['finalized', false]);
		return parseInt(resOpt.number);
	}

	private async getEvmLatestBlockNumber(provider: ethers.JsonRpcProvider): Promise<number> {
		const resOpt = await provider.send('eth_getBlockByNumber', ['latest', false]);
		return parseInt(resOpt.number);
	}

	private async timeToFinalizeSeconds(wChainId: number, txHash: string, swapValueUsd: number): Promise<number> {
		const tx = await this.evmProviders[wChainId].getTransaction(txHash);
		if (!tx) {
			throw new Error('Transaction not found in timeToFinalizeSeconds');
		}

		const finalizedBlockNumber = await this.getEvmCurrentFinalizedBlockNumber(this.evmProviders[wChainId]);
		const lastBlockNumber = await this.getEvmLatestBlockNumber(this.evmProviders[wChainId]);

		const blockCountToFinalize = lastBlockNumber - finalizedBlockNumber;

		let safeBlockForDriver = finalizedBlockNumber;

		if (swapValueUsd < this.minSwapValueUsd) {
			safeBlockForDriver = tx.blockNumber! + this.minimumBlocksToFinality[wChainId];
		} else {
			const factor = (swapValueUsd - this.minSwapValueUsd) / (this.maxSwapValueUsd - this.minSwapValueUsd);
			const blocksToSemiFinalize =
				this.minimumBlocksToFinality[wChainId] +
				(blockCountToFinalize - this.minimumBlocksToFinality[wChainId]) * factor;
			safeBlockForDriver = tx.blockNumber! + blocksToSemiFinalize;
		}

		if (lastBlockNumber >= safeBlockForDriver) {
			return 0;
		}

		const remainingBlocks = safeBlockForDriver - tx.blockNumber!;

		// every tx is polled at most 10 times so rpc usage is controlled
		return (remainingBlocks * this.blockGenerationTimeSecond[wChainId]) / 10;
	}
}
