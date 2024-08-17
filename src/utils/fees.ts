import axios from 'axios';
import * as mathjs from 'mathjs';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_BASE,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
} from '../config/chains';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { Token, TokenList } from '../config/tokens';
import { EvmProviders } from './evm-providers';
import { AUCTION_MODES } from './state-parser';

export class FeeService {
	constructor(
		private readonly evmProviders: EvmProviders,
		private readonly endpoints: MayanEndpoints,
		private readonly tokenList: TokenList,
		private readonly gConf: GlobalConfig,
	) {}

	async calculateSwiftExpensesAndUSDInFromToken(qr: ExpenseParams): Promise<SwiftCosts> {
		if (!qr.auctionMode) {
			qr.auctionMode = AUCTION_MODES.DONT_CARE;
		}
		const prices = await axios.get(this.endpoints.priceApiUrl + '/v3/price/list', {
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

		const solPrice = prices.data[this.tokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId];
		const fromTokenPrice = prices.data[qr.fromToken.coingeckoId];
		const toTokenPrice = prices.data[qr.toToken.coingeckoId];
		const nativeFromPrice = prices.data[this.tokenList.nativeTokens[qr.fromChainId].coingeckoId];
		const nativeToPrice = prices.data[this.tokenList.nativeTokens[qr.toChainId].coingeckoId];

		const sourceUsdc = this.tokenList.getNativeUsdc(qr.fromChainId);
		const sourceEth = this.tokenList.getEth(qr.fromChainId);
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
		let postUnlockVaaBase = this.gConf.feeParams.postUnlockVaaBase;
		let postUnlockVaaPerItem = this.gConf.feeParams.postUnlockVaaPerItem;
		let solTxCost = this.gConf.feeParams.solTxCost;
		let additionalSolfulfillCost = this.gConf.feeParams.additionalSolfulfillCost;
		if (qr.auctionMode === AUCTION_MODES.DONT_CARE) {
			postAuctionCost = 0;
		}

		let baseFulfillGasWithBatch = this.gConf.feeParams.baseFulfillGasWithBatchEth;
		let baseFulfillGasWithOutBatch = this.gConf.feeParams.baseFulfillGasWithOutBatchEth;
		if (qr.fromToken.contract !== sourceEth?.contract) {
			// when source is not eth, usdc (or other erc20) must be used at dest to fulfill and more gas overhead
			baseFulfillGasWithOutBatch += this.gConf.feeParams.erc20GasOverHead;
			baseFulfillGasWithBatch += this.gConf.feeParams.erc20GasOverHead;
		}
		let swapFulfillAddedGas = this.gConf.feeParams.swapFulfillAddedGas;
		let baseBatchPostGas = this.gConf.feeParams.baseBatchPostGas;
		let auctionVaaVerificationAddedGas = this.gConf.feeParams.auctionVaaVerificationAddedGas;

		const overallMultiplier = 1.05;

		const [srcFeeData, dstFeeData] = await Promise.all([
			qr.fromChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.fromChainId].getFeeData() : null,
			qr.toChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.toChainId].getFeeData() : null,
		]);
		const srcGasPrice = srcFeeData?.gasPrice!;
		const dstGasPrice = dstFeeData?.gasPrice!;

		let hasDestSwap = true;
		if (
			(sourceUsdc?.contract === qr.fromToken.contract && destUsdc?.contract === qr.toToken.contract) ||
			(sourceEth?.contract === qr.fromToken.contract && destEth?.contract === qr.toToken.contract)
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
			if (qr.toChainId === CHAIN_ID_ETH) {
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
			fulfillSolCost += ataCreationCost; // asssumes we will always create user ata
			fulfillCost = await this.calculateSolanaFee(
				fulfillSolCost,
				solPrice,
				fromTokenPrice,
				qr.gasDrop,
				overallMultiplier,
			);
		}

		let batchCount = 6; // we can send 8 unlock batches, but we consider 6 so that we can unlock with loss in case of liquidity emergencies
		let realBatchCount = 8;

		let unlockFee: number;
		if (qr.fromChainId === CHAIN_ID_SOLANA) {
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

			unlockFee = (unlockForAll + batchPostCost) / batchCount;
		} else {
			let batchPostCost = 0;
			if (qr.toChainId === CHAIN_ID_ETH) {
				batchCount = 1; // we do not batch on ethereum because eth storage is more expensive than source compute
			} else if (qr.toChainId === CHAIN_ID_SOLANA) {
				const batchPostSolUsage = batchPostBaseCost + batchPostAdddedCost * realBatchCount + solTxCost;
				batchPostCost = await this.calculateSolanaFee(
					batchPostSolUsage,
					solPrice,
					fromTokenPrice,
					0,
					overallMultiplier,
				);
				batchPostCost /= batchCount;
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
				batchPostCost /= batchCount;
			}

			const { unlock } = await this.calculateUnlockAndRefundOnEvmFee(
				srcGasPrice,
				qr.fromToken.contract,
				qr.fromChainId,
				nativeFromPrice,
				this.tokenList.nativeTokens[qr.fromChainId].contract,
				fromTokenPrice,
				batchCount,
				overallMultiplier,
			);
			unlockFee = unlock + batchPostCost;
		}

		return {
			fulfillCost: fulfillCost, //fulfillCost,
			unlockSource: unlockFee, //unlockFee,
			fulfillAndUnlock: fulfillCost + unlockFee,
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
				return 4;
			case CHAIN_ID_POLYGON:
				return 2;
			case CHAIN_ID_OPTIMISM:
			case CHAIN_ID_BASE:
				return 2;
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
}

export type SwiftCosts = {
	fulfillCost: number;
	unlockSource: number;
	fulfillAndUnlock: number;
};

export type ExpenseParams = {
	isGasless: boolean;
	auctionMode?: number;
	exactCalculation: boolean;
	fromToken: Token;
	fromChainId: number;
	toToken: Token;
	toChainId: number;
	gasDrop: number;
};
