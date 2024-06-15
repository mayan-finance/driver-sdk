import axios from 'axios';
import * as mathjs from 'mathjs';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_BASE,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	WORMHOLE_DECIMALS,
} from '../config/chains';
import { MayanEndpoints } from '../config/endpoints';
import { Token, TokenList } from '../config/tokens';
import { EvmProviders } from './evm-providers';
import { AUCTION_MODES } from './state-parser';

export class FeeService {
	constructor(
		private readonly evmProviders: EvmProviders,
		private readonly endpoints: MayanEndpoints,
		private readonly tokenList: TokenList,
	) {}

	async calculateSwiftExpensesAndUSDInFromToken(qr: ExpenseParams): Promise<SwiftCosts> {
		if (qr.fromChainId === CHAIN_ID_SOLANA) {
			throw new Error('Solana source swaps are not supported yet'); // TODO
		}
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

		let solanaSimpleCost = 0.00384888 + 0.0005; // state cost + tx costs
		let solanaAuctionCost = 0.00384888 + 0.0009744 + 0.0016704 + 0.0005; // state + bid state + auction state + tx costs
		if (qr.toChainId !== CHAIN_ID_SOLANA) {
			const postAuctionCost = 0.002; // when fulfill auction on evm
			solanaAuctionCost += postAuctionCost;
		}
		if (qr.auctionMode === AUCTION_MODES.DONT_CARE) {
			solanaAuctionCost = 0;
		}

		const [srcFeeData, dstFeeData] = await Promise.all([
			qr.fromChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.fromChainId].getFeeData() : null,
			qr.toChainId !== CHAIN_ID_SOLANA ? this.evmProviders[qr.toChainId].getFeeData() : null,
		]);

		let fulfillCost = 0;
		if (qr.toChainId !== CHAIN_ID_SOLANA) {
			fulfillCost = await this.calculateSolanaFee(solanaAuctionCost, solPrice, fromTokenPrice);
			let baseFulfillGas = 290_000;
			if (qr.toChainId === CHAIN_ID_ETH) {
				// when destination is eth we do not use batch unlock. so fulfill is cheaper (no storage)
				baseFulfillGas = 185_000;
			}
			if (qr.auctionMode !== AUCTION_MODES.DONT_CARE) {
				baseFulfillGas += 600_000; // extra gas for swap on evm
			}

			let fulfillGas = baseFulfillGas * this.getChainPriceFactor(qr.toChainId);

			fulfillCost += await this.calculateGenericEvmFee(
				fulfillGas,
				dstFeeData!.gasPrice!,
				nativeToPrice,
				fromTokenPrice,
				qr.gasDrop,
			);
		} else {
			let fulfillSolCost = 0.0001; // base tx fees;
			if (qr.auctionMode === AUCTION_MODES.DONT_CARE) {
				fulfillSolCost += solanaSimpleCost;
			} else {
				fulfillSolCost += solanaAuctionCost;
			}
			fulfillCost = await this.calculateSolanaFee(fulfillSolCost, solPrice, fromTokenPrice, qr.gasDrop);
		}

		let cancelRelayerFeeDst: number;
		if (qr.toChainId === CHAIN_ID_SOLANA) {
			const cancelSolFee = solanaSimpleCost + 0.00234256 + 0.0003; // create state + post wormhole message + approx tx fees
			cancelRelayerFeeDst = await this.calculateSolanaFee(cancelSolFee, solPrice, fromTokenPrice);
		} else {
			const cancelGas = 110_000 * this.getChainPriceFactor(qr.toChainId);
			cancelRelayerFeeDst = await this.calculateGenericEvmFee(
				cancelGas,
				dstFeeData!.gasPrice!,
				nativeToPrice,
				fromTokenPrice,
				0,
			);
		}

		let batchCount = 6; // we can send 20 unlock batches, but we consider 10 so that we can unlock with loss in case of liquidity emergencies

		let unlockFee: number;
		let refundRelayerFeeSrc: number;
		if (qr.fromChainId === CHAIN_ID_SOLANA) {
			unlockFee = 0; //TODO
			refundRelayerFeeSrc = await this.calculateSolanaFee(0.0001, solPrice, fromTokenPrice);
		} else {
			let batchPostCost = 0;
			if (qr.toChainId === CHAIN_ID_ETH) {
				batchCount = 1; // we do not batch on ethereum because eth storage is more expensive than source compute
			} else if (qr.toChainId === CHAIN_ID_SOLANA) {
				const batchPostSolUsage = 0.00164256 + 0.0007 * batchCount + 0.0005;
				batchPostCost = await this.calculateSolanaFee(batchPostSolUsage, solPrice, fromTokenPrice);
			} else {
				let batchPostGas = 120_000 * this.getChainPriceFactor(qr.toChainId);
				batchPostCost = await this.calculateGenericEvmFee(
					batchPostGas,
					dstFeeData!.gasPrice!,
					nativeToPrice,
					fromTokenPrice,
					0,
				);
			}

			const { unlock, refund } = await this.calculateUnlockAndRefundOnEvmFee(
				srcFeeData!.gasPrice!,
				qr.fromToken.contract,
				qr.fromChainId,
				nativeFromPrice,
				this.tokenList.nativeTokens[qr.fromChainId].contract,
				fromTokenPrice,
				batchCount,
			);
			unlockFee = unlock + batchPostCost;
			refundRelayerFeeSrc = refund;
		}

		let submissionCost: number = 0;
		if (qr.isGasless) {
			// gasless swaps are registed via mayan relayer and taken into account separately
			// let submissionGas;
			// if (qr.fromToken.contract === ethers.ZeroAddress) {
			// 	submissionGas = 120_000 * this.getChainPriceFactor(qr.fromChainId); // ETH
			// } else {
			// 	submissionGas = 250_000 * this.getChainPriceFactor(qr.fromChainId); // ERC20
			// }
			// submissionCost = await this.calculateGenericEvmFee(
			// 	submissionGas,
			// 	srcFeeData!.gasPrice!,
			// 	nativeFromPrice,
			// 	fromTokenPrice,
			// 	0,
			// );
		}

		return {
			submissionCost: submissionCost,
			fulfillCost: fulfillCost,
			refundFeeDst: cancelRelayerFeeDst,
			refundFeeDst64: BigInt(
				Math.ceil(cancelRelayerFeeDst * 10 ** Math.min(WORMHOLE_DECIMALS, qr.fromToken.decimals)),
			),
			refundFeeSrc: refundRelayerFeeSrc,
			refundFeeSrc64: BigInt(
				Math.ceil(refundRelayerFeeSrc * 10 ** Math.min(WORMHOLE_DECIMALS, qr.fromToken.decimals)),
			),
			unlockSource: unlockFee,
			fromPrice: fromTokenPrice,
			toPrice: toTokenPrice,
			nativePrices: {
				[qr.fromChainId]: nativeFromPrice,
				[qr.toChainId]: nativeToPrice,
				[CHAIN_ID_SOLANA]: solPrice,
			},
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
		gasPrice: BigInt,
		tokenContract: string,
		chainId: number,
		nativeTokenPrice: number,
		nativeTokenContract: string,
		fromTokenPrice: number,
		batchCount: number,
	): Promise<{
		refund: number;
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
			.mul(1.05)
			.div(fromTokenPrice)
			.mul(10 ** 8)
			.ceil()
			.div(10 ** 8)
			.toNumber();
		const refund = mathjs
			.bignumber(gasPrice.toString())
			.mul(baseGas + singleBatchGas)
			.mul(nativeTokenPrice)
			.div(10 ** 18)
			.mul(1.05)
			.div(fromTokenPrice)
			.mul(10 ** 8)
			.ceil()
			.div(10 ** 8)
			.toNumber();
		return {
			refund,
			unlock: batchUnlock,
		};
	}

	async calculateSolanaFee(feeInSol: number, soPrice: number, fromTokenPrice: number, gasDrop = 0): Promise<number> {
		if (soPrice === null) {
			return Promise.reject('Native token price of Solana is needed for fee calculation but is not available');
		}

		return mathjs
			.bignumber(soPrice)
			.mul(feeInSol + gasDrop)
			.mul(10 ** 8)
			.div(fromTokenPrice)
			.mul(1.05)
			.ceil()
			.div(10 ** 8)
			.toNumber();
	}
}

export type SwiftCosts = {
	fulfillCost: number;
	unlockSource: number;
	submissionCost: number;
	refundFeeDst64: bigint;
	refundFeeDst: number;
	refundFeeSrc64: bigint;
	refundFeeSrc: number; // both refund fees are paid in input token
	fromPrice: number;
	toPrice: number;
	nativePrices: { [chainId: number]: number };
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
