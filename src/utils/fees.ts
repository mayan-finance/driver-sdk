import axios from 'axios';
import * as mathjs from 'mathjs';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	CHAIN_ID_UNICHAIN,
	isEvmChainId,
} from '../config/chains';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { Token, TokenList } from '../config/tokens';
import { EvmProviders } from './evm-providers';
import { AUCTION_MODES } from './state-parser';
import { FutureManager } from '../future-manager';

export class FeeService {
	constructor(
		private readonly evmProviders: EvmProviders,
		private readonly endpoints: MayanEndpoints,
		private readonly tokenList: TokenList,
		private readonly gConf: GlobalConfig,
		private readonly futureManager: FutureManager,
	) { }

	async calculateSwiftExpensesAndUSDInFromToken(qr: ExpenseParams): Promise<SwiftCosts> {
		if (!qr.auctionMode) {
			qr.auctionMode = AUCTION_MODES.DONT_CARE;
		}

		let prices: any;
		try {
			prices = await this.futureManager.await(this.getPriceFutureManagerKey(qr));
		} catch (e) {
			prices = await this.getPriceFuture(qr);
		}

		const solPrice = prices.data[this.tokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId];
		const fromTokenPrice = prices.data[qr.fromToken.coingeckoId];
		let toTokenPrice = 0;
		if (qr.toToken.contract === "mzerokyEX9TNDoK4o2YZQBDmMzjokAeN6M2g2S3pLJo") {
			let usdcOnSolana = this.tokenList.getNativeUsdc(CHAIN_ID_SOLANA);
			toTokenPrice = prices.data[usdcOnSolana?.coingeckoId!];
		} else {
			toTokenPrice = prices.data[qr.toToken.coingeckoId];
		}
		const nativeFromPrice = prices.data[this.tokenList.nativeTokens[qr.fromChainId].coingeckoId];
		const nativeToPrice = prices.data[this.tokenList.nativeTokens[qr.toChainId].coingeckoId];

		const sourceUsdt = this.tokenList.getNativeUsdt(qr.fromChainId);
		const sourceUsdc = this.tokenList.getNativeUsdc(qr.fromChainId);
		const sourceEth = this.tokenList.getEth(qr.fromChainId);
		const sourceSolEth = qr.fromChainId === CHAIN_ID_SOLANA ? this.tokenList.getWethSol() : null;
		const destUsdt = this.tokenList.getNativeUsdt(qr.toChainId);
		const destUsdc = this.tokenList.getNativeUsdc(qr.toChainId);
		const destEth = this.tokenList.getEth(qr.toChainId);

		let shrinkedStateCost = this.gConf.feeParams.shrinkedStateCost; // state cost after shrink rent
		let sourceStateCost = this.gConf.feeParams.sourceStateCost; // source state rent
		let solanaSimpleCost = this.gConf.feeParams.solanaSimpleCost; // state cost + tx fees
		let postAuctionCost = this.gConf.feeParams.postAuctionCost; // 2x because we might post twice + tx costss
		let ataCreationCost = this.gConf.feeParams.ataCreationCost; // ata creation cost per ata
		let postCancelCost = this.gConf.feeParams.postCancelCost;
		let batchPostBaseCost = this.gConf.feeParams.batchPostBaseCost;
		let batchPostAdddedCost = this.gConf.feeParams.batchPostAdddedCost;
		let postUnlockVaaSingle = this.gConf.feeParams.postUnlockVaaSingle;
		let postUnlockVaaBase = this.gConf.feeParams.postUnlockVaaBase;
		let postUnlockVaaPerItem = this.gConf.feeParams.postUnlockVaaPerItem;
		let solTxCost = this.gConf.feeParams.solTxCost;
		let additionalSolfulfillCost = this.gConf.feeParams.additionalSolfulfillCost;
		if (qr.auctionMode === AUCTION_MODES.DONT_CARE) {
			postAuctionCost = 0;
		}

		let baseFulfillGasWithBatch = this.gConf.feeParams.baseFulfillGasWithBatchEth;
		let baseFulfillGasWithOutBatch = this.gConf.feeParams.baseFulfillGasWithOutBatchEth;
		if (qr.fromToken.contract !== sourceEth?.contract && qr.fromToken.contract !== sourceSolEth?.contract) {
			// when source is not eth, usdc (or other erc20) must be used at dest to fulfill and more gas overhead
			baseFulfillGasWithOutBatch += this.gConf.feeParams.erc20GasOverHead;
			baseFulfillGasWithBatch += this.gConf.feeParams.erc20GasOverHead;
		}
		let swapFulfillAddedGas = qr.toChainId === 6 ? 800_000 : this.gConf.feeParams.swapFulfillAddedGas;
		let baseBatchPostGas = this.gConf.feeParams.baseBatchPostGas;
		let auctionVaaVerificationAddedGas = this.gConf.feeParams.auctionVaaVerificationAddedGas;

		const overallMultiplier = 1.05;
		const isSingleUnlock = qr.toChainId === CHAIN_ID_ETH;

		let srcFeeData: any;
		let dstFeeData: any;
		try {
			[srcFeeData, dstFeeData] = await this.futureManager.await(this.getChainFeeDataFutureManagerKey(qr));
		} catch (e) {
			[srcFeeData, dstFeeData] = await this.getChainFeeDataFuture(qr);
		}
		// const [srcFeeData, dstFeeData] = await Promise.all([
		// 	qr.fromChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.fromChainId].getFeeData() : null,
		// 	qr.toChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.toChainId].getFeeData() : null,
		// ]);
		const srcGasPrice = srcFeeData?.gasPrice!;
		const dstGasPrice = dstFeeData?.gasPrice!;
		// const [srcGasPrice, dstGasPrice] = await Promise.all([
		// 	qr.fromChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.fromChainId].send("eth_gasPrice", []) : null,
		// 	qr.toChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.toChainId].send("eth_gasPrice", []) : null,
		// ]);

		let hasDestSwap = true;
		if (
			(sourceUsdc?.contract === qr.fromToken.contract &&
				destUsdt?.contract === qr.toToken.contract &&
				qr.toChainId === CHAIN_ID_BSC) ||
			(sourceUsdt?.contract === qr.fromToken.contract &&
				qr.fromChainId === CHAIN_ID_BSC &&
				destUsdc?.contract === qr.toToken.contract) ||
			(sourceUsdc?.contract === qr.fromToken.contract && destUsdc?.contract === qr.toToken.contract) ||
			(sourceEth?.contract === qr.fromToken.contract && destEth?.contract === qr.toToken.contract) ||
			(sourceSolEth?.contract === qr.fromToken.contract && destEth?.contract === qr.toToken.contract)
		) {
			hasDestSwap = false;
		}

		let fulfillCost = 0;
		if (qr.toChainId !== CHAIN_ID_SOLANA) {
			fulfillCost = await this.calculateSolanaFee(
				postAuctionCost,
				solPrice,
				fromTokenPrice,
				0,
				overallMultiplier,
			);
			let baseFulfillGas = baseFulfillGasWithBatch;
			if (isSingleUnlock) {
				// when destination is eth we do not use batch unlock. so fulfill is cheaper (no storage)
				baseFulfillGas = baseFulfillGasWithOutBatch;
			}

			if (hasDestSwap) {
				baseFulfillGas += swapFulfillAddedGas; // extra gas for swap on aggregators
			}

			if (qr.auctionMode !== AUCTION_MODES.DONT_CARE) {
				baseFulfillGas += auctionVaaVerificationAddedGas; // extra gas for swap on evm
			}

			let fulfillGas = baseFulfillGas * this.getChainPriceFactor(qr.toChainId);

			fulfillCost += await this.calculateGenericEvmFee(
				fulfillGas,
				dstGasPrice,
				nativeToPrice,
				fromTokenPrice,
				qr.gasDrop,
				overallMultiplier,
			);
		} else {
			let fulfillSolCost = solTxCost + additionalSolfulfillCost; // base tx fees;
			fulfillSolCost += shrinkedStateCost;
			if (qr.toToken.contract !== '0x0000000000000000000000000000000000000000') {
				// pure sol doesn't require creating atas
				fulfillSolCost += ataCreationCost; // asssumes we will always create user ata
			}
			fulfillCost = await this.calculateSolanaFee(
				fulfillSolCost,
				solPrice,
				fromTokenPrice,
				qr.gasDrop,
				overallMultiplier,
			);
		}

		let maxBatchCount = 6; // we can send 8 unlock batches, but we consider 6 so that we can unlock with loss in case of liquidity emergencies
		let estimatedBatchCount = this.calculateBatchCount(
			qr.fromChainId,
			qr.toChainId,
			qr.fromAmount,
			fromTokenPrice,
			maxBatchCount,
		);
		let realBatchCount = 8;

		let unlockFee: number;
		if (qr.fromChainId === CHAIN_ID_SOLANA) {
			if (isSingleUnlock) {
				let unlockTotal = await this.calculateSolanaFee(
					postUnlockVaaSingle + solTxCost,
					solPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);
				let postOnDestCost = 0; // already posted on fulfill

				unlockFee = unlockTotal + postOnDestCost;
			} else {
				let postUnlockVaaSol =
					postUnlockVaaBase + postUnlockVaaPerItem * realBatchCount + solTxCost - ataCreationCost; // source state Ata is closed and paid to unlocker/refunder on solana
				postUnlockVaaSol = Math.max(0, postUnlockVaaSol);
				let unlockForAll = await this.calculateSolanaFee(
					postUnlockVaaSol,
					solPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);

				let batchPostGas = baseBatchPostGas * this.getChainPriceFactor(qr.toChainId);
				const batchPostCost = await this.calculateGenericEvmFee(
					batchPostGas,
					dstGasPrice,
					nativeToPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);

				unlockFee = (unlockForAll + batchPostCost) / estimatedBatchCount;
			}
		} else {
			let batchPostCost = 0;
			if (isSingleUnlock) {
				estimatedBatchCount = 1; // we do not batch on ethereum because eth storage is more expensive than source compute
			} else if (qr.toChainId === CHAIN_ID_SOLANA) {
				const batchPostSolUsage = batchPostBaseCost + batchPostAdddedCost * realBatchCount + solTxCost;
				batchPostCost = await this.calculateSolanaFee(
					batchPostSolUsage,
					solPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);
				batchPostCost /= estimatedBatchCount;
			} else {
				let batchPostGas = baseBatchPostGas * this.getChainPriceFactor(qr.toChainId);
				batchPostCost = await this.calculateGenericEvmFee(
					batchPostGas,
					dstGasPrice,
					nativeToPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);
				batchPostCost /= estimatedBatchCount;
			}

			const { unlock } = await this.calculateUnlockAndRefundOnEvmFee(
				srcGasPrice,
				qr.fromToken.contract,
				qr.fromChainId,
				nativeFromPrice,
				this.tokenList.nativeTokens[qr.fromChainId].contract,
				fromTokenPrice,
				estimatedBatchCount,
				overallMultiplier,
			);
			unlockFee = unlock + batchPostCost;
		}

		const compensationsSol = {
			evmToSolana: 0.0009,
			evmToEvm: 0.0031,
			solanaToEvm: 0.004,
		};

		let compensation = 0.0;
		// comepnsation is not active anymore
		// if (isEvmChainId(qr.fromChainId) && qr.toChainId === CHAIN_ID_SOLANA) {
		// 	compensation = compensationsSol.evmToSolana;
		// } else if (isEvmChainId(qr.fromChainId) && isEvmChainId(qr.toChainId)) {
		// 	compensation = compensationsSol.evmToEvm;
		// } else if (qr.fromChainId === CHAIN_ID_SOLANA && isEvmChainId(qr.toChainId)) {
		// 	compensation = compensationsSol.solanaToEvm;
		// }

		let totalCost = fulfillCost + unlockFee;
		totalCost = totalCost - (compensation * solPrice) / fromTokenPrice;
		totalCost = Math.max(0.0, totalCost);

		return {
			fulfillCost: fulfillCost, //fulfillCost,
			unlockSource: unlockFee, //unlockFee,
			fulfillAndUnlock: totalCost,
			fromTokenPrice: fromTokenPrice,
			toTokenPrice: toTokenPrice,
			srcGasPrice,
			dstGasPrice,
		};
	}

	async calculateGenericEvmFee(
		gas: number,
		gasPrice: BigInt,
		nativeTokenPrice: number,
		referenceTokenPrice: number,
		gasDrop: number,
		factor: number = 1.05,
	): Promise<number> {
		return mathjs
			.bignumber(gasPrice.toString())
			.mul(gas)
			.add(gasDrop * 10 ** 18)
			.mul(nativeTokenPrice)
			.div(10 ** 18)
			.mul(factor)
			.div(referenceTokenPrice)
			.mul(10 ** 8)
			.ceil()
			.div(10 ** 8)
			.toNumber();
	}

	private getChainPriceFactor(chainId: number): number {
		switch (chainId) {
			case CHAIN_ID_ARBITRUM:
				return 1;
			case CHAIN_ID_POLYGON:
				return 2;
			case CHAIN_ID_OPTIMISM:
			case CHAIN_ID_BASE:
			case CHAIN_ID_UNICHAIN:
				return 1;
			default:
				return 1;
		}
	}

	async calculateUnlockAndRefundOnEvmFee(
		gasPrice: bigint,
		tokenContract: string,
		chainId: number,
		nativeTokenPrice: number,
		nativeTokenContract: string,
		fromTokenPrice: number,
		batchCount: number,
		multiplier: number,
	): Promise<{
		unlock: number;
	}> {
		let batchFactor = batchCount === 1 ? 1 : 1 / batchCount;
		const singleBatchGas = 20_000;
		let baseGas = tokenContract === nativeTokenContract ? 240_000 : 230_000;
		let gas = baseGas + batchCount * singleBatchGas; // each batch adds ~20k gas
		if (chainId === CHAIN_ID_ARBITRUM) {
			// let estimatedFeeData: { gasLimit: BigNumber };
			// if (tokenContract === nativeTokenContract) {
			//     estimatedFeeData = await this.gasEstimator.estimateFees(
			//         chainId,
			//         this.evmProviders[chainId],
			//         SwiftConsts.samples[chainId].native.toContract,
			//         SwiftConsts.samples[chainId].native.txData,
			//     );
			// } else {
			//     estimatedFeeData = await this.gasEstimator.estimateFees(
			//         chainId,
			//         this.evmProviders[chainId],
			//         SwiftConsts.samples[chainId].wrapped.toContract,
			//         SwiftConsts.samples[chainId].wrapped.txData,
			//     );
			// }

			gas *= 4;
		} else if (chainId === CHAIN_ID_POLYGON) {
			gas *= 2;
		} else if (chainId === CHAIN_ID_OPTIMISM || chainId === CHAIN_ID_BASE) {
			gas *= 3;

			// const ethFeeData = await this.evmProviders[CHAIN_ID_ETH].getFeeData();
			// // https://docs.optimism.io/stack/transactions/fees
			// // https://github.com/ethereum-optimism/optimism/blob/129032f15b76b0d2a940443a39433de931a97a44/packages/contracts-bedrock/deploy-config/mainnet.json
			// const baseL1Gas = (20000 + 188) * 0.684; // aproximate l1 gas for transaction data + fixed cost * dynamic cost
			// gas += baseL1Gas * mathjs.bignumber(ethFeeData.gasPrice.toString()).div(feeData.gasPrice.toString()).toNumber();
		}

		const batchUnlock = mathjs
			.bignumber(gasPrice.toString())
			.mul(gas)
			.mul(nativeTokenPrice)
			.mul(batchFactor)
			.div(10 ** 18)
			.mul(multiplier)
			.div(fromTokenPrice)
			.mul(10 ** 8)
			.ceil()
			.div(10 ** 8)
			.toNumber();
		return {
			unlock: batchUnlock,
		};
	}

	async calculateSolanaFee(
		feeInSol: number,
		soPrice: number,
		fromTokenPrice: number,
		gasDrop: number,
		multiplier: number,
	): Promise<number> {
		if (soPrice === null) {
			return Promise.reject('Native token price of Solana is needed for fee calculation but is not available');
		}

		return mathjs
			.bignumber(soPrice)
			.mul(feeInSol + gasDrop)
			.mul(10 ** 8)
			.div(fromTokenPrice)
			.mul(multiplier)
			.ceil()
			.div(10 ** 8)
			.toNumber();
	}

	private calculateBatchCount(
		fromChain: number,
		toChain: number,
		fromAmount: number,
		fromTokenPrice: number,
		maxBatchSize: number,
	): number {
		const volume = fromAmount * fromTokenPrice;

		let volumeStep = 20_000;
		switch (fromChain) {
			case CHAIN_ID_ARBITRUM:
			case CHAIN_ID_BASE:
			case CHAIN_ID_UNICHAIN:
			case CHAIN_ID_OPTIMISM:
			case CHAIN_ID_POLYGON:
			case CHAIN_ID_BSC:
				volumeStep = 2000;
				break;
			case CHAIN_ID_AVAX:
				volumeStep = 3000;
				break;
			case CHAIN_ID_ETH:
				volumeStep = 6000;
				break;
			default:
				break;
		}

		return maxBatchSize - Math.min(maxBatchSize - 1, Math.floor(volume / volumeStep));
	}

	async getPriceFuture(qr: ExpenseParams): Promise<any> {
		let fut = axios.get(this.endpoints.priceApiUrl + '/v3/price/list', {
			params: {
				ids: [
					qr.fromToken.coingeckoId,
					qr.toToken.coingeckoId,
					this.tokenList.nativeTokens[qr.fromChainId].coingeckoId,
					this.tokenList.nativeTokens[qr.toChainId].coingeckoId,
					this.tokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId,
				].join(','),
			},
		});
		return fut;
	}

	getPriceFutureManagerKey(qr: ExpenseParams): string {
		return `fee-service-${qr.fromToken.coingeckoId}-${qr.toToken.coingeckoId}-${this.tokenList.nativeTokens[qr.fromChainId].coingeckoId}-${this.tokenList.nativeTokens[qr.toChainId].coingeckoId}-${this.tokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId}`;
	}

	async getChainFeeDataFuture(qr: ExpenseParams): Promise<any> {
		let fut = Promise.all([
			qr.fromChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.fromChainId].getFeeData() : null,
			qr.toChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.toChainId].getFeeData() : null,
		]);
		return fut;
	}

	getChainFeeDataFutureManagerKey(qr: ExpenseParams): string {
		return `fee-service-${qr.fromChainId}-${qr.toChainId}`;
	}

}
export type SwiftCosts = {
	fulfillCost: number;
	unlockSource: number;
	fulfillAndUnlock: number;
	fromTokenPrice: number;
	toTokenPrice: number;
	srcGasPrice: bigint;
	dstGasPrice: bigint;
};

export type ExpenseParams = {
	isGasless: boolean;
	auctionMode?: number;
	exactCalculation: boolean;
	fromToken: Token;
	fromChainId: number;
	fromAmount: number;
	toToken: Token;
	toChainId: number;
	gasDrop: number;
};
