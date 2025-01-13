import Decimal from 'decimal.js';
import { ethers } from 'ethers6';
import { abi as SwiftAbi } from '../abis/swift.abi';
import {
	CHAIN_ID_BSC,
	CHAIN_ID_SOLANA,
	ETH_CHAINS,
	WORMHOLE_DECIMALS,
	WhChainIdToEvm,
	supportedChainIds,
} from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { GlobalConfig } from '../config/global';
import { RpcConfig } from '../config/rpc';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { SWAP_STATUS, Swap } from '../swap.dto';
import { tryNativeToHexString, tryNativeToUint8Array } from '../utils/buffer';
import { getErc20Allowance, getErc20Balance, getEthBalance, giveErc20Allowance } from '../utils/erc20';
import { EvmProviders } from '../utils/evm-providers';
import { getSuggestedOverrides, getTypicalBlocksToConfirm } from '../utils/evm-trx';
import logger from '../utils/logger';
import { Erc20Permit, deserializePermitFromHex, generateErc20Permit } from '../utils/permit';
import { AUCTION_MODES } from '../utils/state-parser';
import { delay } from '../utils/util';
import { SwapRouters } from './routers';
import { WalletsHelper } from './wallet-helper';

export class EvmFulfiller {
	private readonly unlockWallets32: Map<number, Buffer> = new Map();
	private readonly swiftInterface = new ethers.Interface(SwiftAbi);

	constructor(
		private readonly gConf: GlobalConfig,
		private readonly walletConfig: WalletConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly contractsConfig: ContractsConfig,
		private readonly walletHelper: WalletsHelper,
		private readonly evmProviders: EvmProviders,
		private readonly tokenList: TokenList,
		private readonly swapRouters: SwapRouters,
	) {
		const evmWalletAddr = this.walletConfig.evm.address;
		for (let chainId of supportedChainIds) {
			if (chainId === CHAIN_ID_SOLANA) {
				this.unlockWallets32.set(chainId, this.walletConfig.solana.publicKey.toBuffer());
			} else {
				this.unlockWallets32.set(chainId, Buffer.from(tryNativeToUint8Array(evmWalletAddr, chainId)));
			}
		}
	}

	async init() {
		await this.lazySetAllowances();
	}

	private async lazySetAllowances() {
		let promises = [];
		for (let chainId of supportedChainIds) {
			if (chainId === CHAIN_ID_SOLANA) {
				continue;
			}
			let networkFeeData = await this.evmProviders[chainId].getFeeData();
			let driverERC20Tokens = [this.tokenList.getNativeUsdc(chainId)];
			if (chainId === CHAIN_ID_BSC) {
				driverERC20Tokens = [this.tokenList.getNativeUsdt(chainId)];
			}
			for (let driverToken of driverERC20Tokens) {
				if (!driverToken) {
					continue;
				}
				if (driverToken.supportsPermit) {
					continue;
				}
				let getAndSet = async () => {
					const current = await getErc20Allowance(
						this.walletHelper.getDriverWallet(chainId),
						driverToken.contract,
						this.walletHelper.getDriverWallet(chainId).address,
						this.contractsConfig.contracts[chainId],
					);
					console.log(`Current allowance for ${driverToken.contract} on chain ${chainId}: ${current}`);

					if (current < ethers.MaxUint256 - 1_000_000_000_000_000_000_000_000_000n) {
						logger.info(`Setting allowance for ${driverToken.contract} on chain ${chainId}`);
						await giveErc20Allowance(
							this.walletHelper.getDriverWallet(chainId),
							driverToken.contract,
							this.contractsConfig.contracts[chainId],
							ethers.MaxUint256,
							chainId,
							networkFeeData,
						);
						logger.info(`Allowance set for ${driverToken.contract} on chain ${chainId}`);
					}
				};

				promises.push(getAndSet());
			}
			await Promise.allSettled(promises);
			for (let driverToken of driverERC20Tokens) {
				if (!driverToken) {
					continue;
				}
				if (driverToken.supportsPermit) {
					continue;
				}
				let getAndSetHelper = async () => {
					const current = await getErc20Allowance(
						this.walletHelper.getDriverWallet(chainId),
						driverToken.contract,
						this.walletHelper.getDriverWallet(chainId).address,
						this.contractsConfig.evmFulfillHelpers[chainId],
					);
					console.log(
						`current helper allowance for ${driverToken.contract} on chain ${chainId} is ${current}`,
					);

					if (current < ethers.MaxUint256 - 1_000_000_000_000_000_000_000_000_000n) {
						logger.info(`Setting allowance for helper ${driverToken.contract} on chain ${chainId}`);
						await giveErc20Allowance(
							this.walletHelper.getDriverWallet(chainId),
							driverToken.contract,
							this.contractsConfig.evmFulfillHelpers[chainId],
							ethers.MaxUint256,
							chainId,
							networkFeeData,
						);
						logger.info(`Helper Allowance set for ${driverToken.contract} on chain ${chainId}`);
					}
				};
				promises.push(getAndSetHelper());
			}
		}

		const res = await Promise.allSettled(promises);
		console.log(res);
	}

	getUnlockAddress32(sourceChainId: number): Buffer {
		return this.unlockWallets32.get(sourceChainId)!;
	}

	private generateSimpleFulfillCall(amountIn64: bigint, swap: Swap, chosenDriverToken: Token, batch: boolean) {
		const fromToken = swap.fromToken;
		const fromNormalizedDecimals = Math.min(WORMHOLE_DECIMALS, fromToken.decimals);

		let orderHashHex = swap.orderHash;
		let trader32Hex = tryNativeToHexString(swap.trader, swap.sourceChain);
		let srcChain = swap.sourceChain;
		let tokenIn32Hex = tryNativeToHexString(swap.fromTokenAddress, swap.sourceChain);
		let tokenOut32Hex = tryNativeToHexString(swap.toTokenAddress, swap.destChain);
		let minAmountOut64 = swap.minAmountOut64;
		let gasDrop64 = swap.gasDrop64;
		let protocolBps = swap.mayanBps;
		let referrerBps = swap.referrerBps;
		let destRefundFee64 = ethers.parseUnits(
			swap.redeemRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let sourceRefundFee64 = ethers.parseUnits(
			swap.refundRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let deadline64 = BigInt(Math.floor(swap.deadline.getTime() / 1000));

		let destAddr32Hex = tryNativeToHexString(swap.destAddress, swap.destChain);
		let destChain = swap.destChain;

		let referrerAddr32Hex = tryNativeToHexString(swap.referrerAddress, swap.destChain);

		let random32Hex = swap.randomKey;

		const unlockAddress32 = this.getUnlockAddress32(swap.sourceChain);

		return this.swiftInterface.encodeFunctionData('fulfillSimple', [
			amountIn64,
			orderHashHex,
			srcChain,
			tokenIn32Hex,
			protocolBps,
			{
				trader: trader32Hex,
				tokenOut: tokenOut32Hex,
				minAmountOut: minAmountOut64,
				gasDrop: gasDrop64,
				cancelFee: destRefundFee64,
				refundFee: sourceRefundFee64,
				deadline: deadline64,
				destAddr: destAddr32Hex,
				destChainId: destChain,
				referrerAddr: referrerAddr32Hex,
				referrerBps: referrerBps,
				auctionMode: swap.auctionMode,
				random: random32Hex,
			},
			unlockAddress32,
			batch,
		]);
	}

	private generateAuctionFulfillCalldata(
		fulfillAmount: bigint,
		signedVaa: Buffer,
		unlockAddress32: Buffer,
		batch: boolean,
	) {
		return this.swiftInterface.encodeFunctionData('fulfillOrder', [
			fulfillAmount,
			signedVaa,
			unlockAddress32,
			batch,
		]);
	}

	async fulfillAuctionOrSimple(
		swap: Swap,
		availableAmountIn: number,
		toToken: Token,
		targetChain: number,
		driverToken: Token,
		realMinAmountOut: bigint,
		postAuctionSignedVaa?: Uint8Array,
	) {
		const amountIn64 = ethers.parseUnits(availableAmountIn.toFixed(driverToken.decimals), driverToken.decimals);
		const networkFeeData: ethers.FeeData = await this.evmProviders[targetChain].getFeeData();

		const overrides = await getSuggestedOverrides(targetChain, networkFeeData);
		const nativeCurrency = this.tokenList.nativeTokens[targetChain];

		let gasDrop = swap.gasDrop64;
		if (nativeCurrency.decimals > 8) {
			gasDrop = gasDrop * 10n ** (BigInt(nativeCurrency.decimals) - 8n);
		}
		overrides['value'] = gasDrop;
		const unlockAddress32 = this.getUnlockAddress32(swap.sourceChain);

		const batch = this.gConf.singleBatchChainIds.includes(+swap.destChain) ? false : true; // batch-post except for eth and expensive chains

		let fulfillTx: ethers.TransactionResponse;
		let swiftCallData: string;
		if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
			swiftCallData = this.generateAuctionFulfillCalldata(
				amountIn64, // overridden by swap amount in fulfill helper if it is swap. it is usde used for direct fulfill
				Buffer.from(postAuctionSignedVaa!),
				unlockAddress32,
				batch,
			);
		} else {
			swiftCallData = this.generateSimpleFulfillCall(amountIn64, swap, driverToken, batch);
		}
		let permit: Erc20Permit = {
			owner: driverToken.contract,
			spender: this.contractsConfig.evmFulfillHelpers[swap.destChain],
			value: amountIn64,
			nonce: 0,
			deadline: 0,
			chainId: WhChainIdToEvm[+swap.destChain],
			name: '',
			verifyingContract: '',
			version: '',
			v: 0,
			r: '0x' + Buffer.alloc(32).toString('hex'),
			s: '0x' + Buffer.alloc(32).toString('hex'),
		};
		if (driverToken.supportsPermit) {
			permit = await generateErc20Permit(
				this.walletHelper.getDriverWallet(swap.destChain).address,
				this.contractsConfig.evmFulfillHelpers[swap.destChain],
				driverToken.contract,
				WhChainIdToEvm[+swap.destChain],
				amountIn64,
				this.walletHelper.getDriverWallet(swap.destChain),
				this.evmProviders[swap.destChain],
			);
		}
		if (driverToken.contract === toToken.contract) {
			// no swap involved
			logger.info(`Sending no-swap auction fulfill with fulfillOrder for tx=${swap.sourceTxHash}`);

			if (swap.auctionMode === AUCTION_MODES.DONT_CARE) {
				return await this.simpleFulfill(swap, availableAmountIn, toToken!);
			} else if (driverToken.contract === ethers.ZeroAddress) {
				overrides['value'] = overrides['value'] + amountIn64;
				const args = [amountIn64, Buffer.from(postAuctionSignedVaa!), unlockAddress32, batch, overrides];
				if (!overrides['gasLimit']) {
					const estimatedGas = await this.walletHelper
						.getWriteContract(swap.destChain, false)
						.fulfillOrder.estimateGas(...args);
					overrides['gasLimit'] = (estimatedGas * BigInt(130)) / BigInt(100);
					logger.info(`gasLimit increased 30% for fulfill ${swap.sourceTxHash}`);
				}
				fulfillTx = await this.walletHelper.getWriteContract(swap.destChain, false).fulfillOrder(...args);
			} else {
				const args = [
					driverToken.contract,
					amountIn64,
					this.contractsConfig.contracts[swap.destChain],
					swiftCallData,
					{
						value: permit.value,
						deadline: permit.deadline,
						r: permit.r,
						s: permit.s,
						v: permit.v,
					},
					overrides,
				];
				if (!overrides['gasLimit']) {
					const estimatedGas = await this.walletHelper
						.getFulfillHelperWriteContract(swap.destChain)
						.directFulfill.estimateGas(...args);
					overrides['gasLimit'] = (estimatedGas * BigInt(130)) / BigInt(100);
					logger.info(`gasLimit increased 30% for fulfill ${swap.sourceTxHash}`);
				}
				fulfillTx = await this.walletHelper
					.getFulfillHelperWriteContract(swap.destChain)
					.directFulfill(...args);
			}
		} else {
			const swapParams = await this.getEvmFulfillParams(amountIn64, toToken, targetChain, driverToken);
			if (swapParams.expectedAmountOut < realMinAmountOut) {
				throw new Error(
					`Can not evm fulfill ${swap.sourceTxHash} on evm. min amount out issue ${swapParams.expectedAmountOut} ${realMinAmountOut} with input: ${amountIn64} raw input: ${swap.fromAmount64}`,
				);
			}

			if (driverToken.contract === ethers.ZeroAddress) {
				logger.info(`Sending swap fulfill with fulfillWithEth for tx=${swap.sourceTxHash}`);
				overrides['value'] = overrides['value'] + amountIn64;

				const args = [
					amountIn64,
					toToken.contract,
					swapParams.evmRouterAddress,
					swapParams.evmRouterCalldata,
					this.contractsConfig.contracts[targetChain],
					swiftCallData,
					overrides,
				];
				if (!overrides['gasLimit']) {
					const estimatedGas = await this.walletHelper
						.getFulfillHelperWriteContract(swap.destChain)
						.fulfillWithEth.estimateGas(...args);
					overrides['gasLimit'] = (estimatedGas * BigInt(130)) / BigInt(100);
					logger.info(`gasLimit increased 30% for fulfill ${swap.sourceTxHash}`);
				}
				fulfillTx = await this.walletHelper
					.getFulfillHelperWriteContract(swap.destChain)
					.fulfillWithEth(...args);
			} else {
				logger.info(`Sending swap fulfill with fulfillWithERC20 for tx=${swap.sourceTxHash}`);
				const args = [
					driverToken.contract,
					amountIn64,
					toToken.contract,
					swapParams.evmRouterAddress,
					swapParams.evmRouterCalldata,
					this.contractsConfig.contracts[targetChain],
					swiftCallData,
					{
						value: permit.value,
						deadline: permit.deadline,
						v: permit.v,
						r: permit.r,
						s: permit.s,
					}, // permit if token allows permit
					overrides,
				];

				if (!overrides['gasLimit']) {
					const estimatedGas = await this.walletHelper
						.getFulfillHelperWriteContract(swap.destChain)
						.fulfillWithERC20.estimateGas(...args);
					overrides['gasLimit'] = (estimatedGas * BigInt(130)) / BigInt(100);
					logger.info(`gasLimit increased 30% for fulfill ${swap.sourceTxHash}`);
				}
				fulfillTx = await this.walletHelper
					.getFulfillHelperWriteContract(swap.destChain)
					.fulfillWithERC20(...args);
			}
		}

		logger.info(`Waiting for fulfill on EVM for ${swap.sourceTxHash} via: ${fulfillTx.hash}`);
		const tx = await this.evmProviders[targetChain].waitForTransaction(
			fulfillTx.hash,
			getTypicalBlocksToConfirm(targetChain),
			60_000,
		);

		if (!tx || tx.status !== 1) {
			throw new Error(`Fulfill on evm reverted for ${swap.sourceTxHash} via: ${tx?.hash}`);
		} else {
			swap.status = SWAP_STATUS.ORDER_SETTLED;
		}
	}

	async getEvmFulfillParams(
		realAmountIn: bigint,
		toToken: Token,
		destChain: number,
		driverToken: Token,
	): Promise<{
		evmRouterAddress: string;
		evmRouterCalldata: string;
		expectedAmountOut: bigint;
	}> {
		const oneInchSwap = await this.swapRouters.getSwap(
			{
				amountIn: realAmountIn.toString(),
				destToken: toToken.contract,
				whChainId: destChain,
				slippagePercent: 50,
				srcToken: driverToken.contract,
				timeout: 3000,
			},
			true,
			4,
		);

		return {
			evmRouterAddress: oneInchSwap.tx.to,
			evmRouterCalldata: oneInchSwap.tx.data,
			expectedAmountOut: BigInt(oneInchSwap.toAmount),
		};
	}

	async getNormalizedBid(
		destChain: number,
		driverToken: Token,
		effectiveAmountInDriverToken: number,
		normalizedMinAmountOut: bigint,
		toToken: Token,
	): Promise<bigint> {
		let bidAmount: bigint;
		if (driverToken.contract === toToken.contract) {
			bidAmount = BigInt(Math.floor(effectiveAmountInDriverToken * 0.9999 * 10 ** driverToken.decimals));
		} else {
			const quoteRes = await this.swapRouters.getQuote(
				{
					whChainId: destChain,
					srcToken: driverToken.contract,
					destToken: toToken.contract,
					amountIn: BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)).toString(),
					timeout: 2000,
				},
				true,
				3,
			);

			if (!quoteRes) {
				throw new Error('1inch quote for bid in swift failed');
			}

			bidAmount = BigInt(Math.floor(Number(quoteRes.toAmount) * Number(0.99)));
		}

		let normalizedBidAmount = bidAmount;
		if (toToken.decimals > 8) {
			normalizedBidAmount = bidAmount / BigInt(10 ** (toToken.decimals - 8));
		}

		if (normalizedBidAmount < normalizedMinAmountOut) {
			logger.warn(`normalizedBidAmount is less than minAmountOut`);
			normalizedBidAmount = normalizedMinAmountOut;
		}

		return normalizedBidAmount;
	}

	async submitGaslessOrder(swap: Swap) {
		const fromToken = swap.fromToken;
		const fromNormalizedDecimals = Math.min(WORMHOLE_DECIMALS, fromToken.decimals);
		let trader32Hex = tryNativeToHexString(swap.trader, swap.sourceChain);
		let tokenOut32Hex = tryNativeToHexString(swap.toTokenAddress, swap.destChain);
		let minAmountOut64 = swap.minAmountOut64;
		let gasDrop64 = swap.gasDrop64;
		let referrerBps = swap.referrerBps;
		let destRefundFee64 = ethers.parseUnits(
			swap.redeemRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let sourceRefundFee64 = ethers.parseUnits(
			swap.refundRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let deadline64 = BigInt(Math.floor(swap.deadline.getTime() / 1000));
		let destAddr32Hex = tryNativeToHexString(swap.destAddress, swap.destChain);
		let destChain = swap.destChain;
		let referrerAddr32Hex = tryNativeToHexString(swap.referrerAddress, swap.destChain);
		let random32Hex = swap.randomKey;

		const permitParams = deserializePermitFromHex(swap.gaslessPermit);

		const swiftContract = this.walletHelper.getWriteContract(swap.sourceChain);
		const overrides = await getSuggestedOverrides(
			swap.sourceChain,
			await this.evmProviders[swap.sourceChain].getFeeData(),
		);
		if (overrides['gasLimit']) {
			delete overrides['gasLimit'];
		}

		const submitTx = await swiftContract.createOrderWithSig(
			swap.fromTokenAddress,
			swap.fromAmount64,
			{
				trader: trader32Hex,
				tokenOut: tokenOut32Hex,
				minAmountOut: minAmountOut64,
				gasDrop: gasDrop64,
				cancelFee: destRefundFee64,
				refundFee: sourceRefundFee64,
				deadline: deadline64,
				destAddr: destAddr32Hex,
				destChainId: destChain,
				referrerAddr: referrerAddr32Hex,
				referrerBps: referrerBps,
				auctionMode: swap.auctionMode,
				random: random32Hex,
			},
			swap.gaslessSignature,
			permitParams,
			overrides,
		);

		logger.info(`Wait for submit evm confirm for ${swap.sourceTxHash} via: ${submitTx.hash}`);
		const tx = await submitTx.wait();

		if (tx.status !== 1) {
			throw new Error(`Submitting gasless on evm tx reverted sourceTx: ${swap.sourceTxHash}, ${tx.hash}`);
		} else {
			swap.status = SWAP_STATUS.ORDER_CREATED;
			swap.createTxHash = tx.hash;
		}
	}

	async simpleFulfill(swap: Swap, availableAmountIn: number, toToken: Token) {
		const targetChain = swap.destChain;
		const driverTokens = [this.tokenList.getNativeUsdc(targetChain), this.tokenList.nativeTokens[targetChain]];

		let chosenDriverToken: Token | null = null;
		for (let driverToken of driverTokens) {
			if (driverToken?.contract === toToken.contract) {
				chosenDriverToken = driverToken;
				break;
			}
		}
		if (!chosenDriverToken) {
			await delay(4000);
			throw new Error(`No driver token found for ${toToken.contract}`);
		}

		let chosenTokenBalance: bigint;
		if (chosenDriverToken.contract === ethers.ZeroAddress) {
			// eth
			if (!ETH_CHAINS.includes(targetChain)) {
				throw new Error(`Invalid target chain for eth simple fulfill: ${targetChain}`);
			}
			chosenTokenBalance = await getEthBalance(
				this.evmProviders[targetChain],
				this.walletHelper.getDriverWallet(targetChain).address,
			);
		} else {
			// erc20
			chosenTokenBalance = await getErc20Balance(
				this.evmProviders[targetChain],
				chosenDriverToken.contract,
				this.walletHelper.getDriverWallet(targetChain).address,
			);
		}

		if (chosenTokenBalance < BigInt(Math.ceil(availableAmountIn * 10 ** chosenDriverToken.decimals))) {
			await delay(4000);
			throw new Error(`Not enough balance for and can not fullfill ${toToken.contract}`);
		}

		const networkFeeData: ethers.FeeData = await this.evmProviders[targetChain].getFeeData();

		const overrides = await getSuggestedOverrides(targetChain, networkFeeData);
		const nativeCurrency = this.tokenList.nativeTokens[targetChain];

		let gasDrop = swap.gasDrop64;
		if (nativeCurrency.decimals > 8) {
			gasDrop = gasDrop * 10n ** (BigInt(nativeCurrency.decimals) - 8n);
		}
		overrides['value'] = gasDrop;

		if (chosenDriverToken.contract === ethers.ZeroAddress) {
			overrides['value'] = overrides['value'] + ethers.parseUnits(availableAmountIn.toFixed(18), 18);
		}

		const fromToken = swap.fromToken;
		const fromNormalizedDecimals = Math.min(WORMHOLE_DECIMALS, fromToken.decimals);

		let orderHashHex = swap.orderHash;
		let trader32Hex = tryNativeToHexString(swap.trader, swap.sourceChain);
		let srcChain = swap.sourceChain;
		let tokenIn32Hex = tryNativeToHexString(swap.fromTokenAddress, swap.sourceChain);
		let tokenOut32Hex = tryNativeToHexString(swap.toTokenAddress, swap.destChain);
		let minAmountOut64 = swap.minAmountOut64;
		let gasDrop64 = swap.gasDrop64;
		let protocolBps = swap.mayanBps;
		let referrerBps = swap.referrerBps;
		let destRefundFee64 = ethers.parseUnits(
			swap.redeemRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let sourceRefundFee64 = ethers.parseUnits(
			swap.refundRelayerFee.toFixed(fromNormalizedDecimals, Decimal.ROUND_DOWN),
			fromNormalizedDecimals,
		);
		let deadline64 = BigInt(Math.floor(swap.deadline.getTime() / 1000));

		let destAddr32Hex = tryNativeToHexString(swap.destAddress, swap.destChain);
		let destChain = swap.destChain;

		let referrerAddr32Hex = tryNativeToHexString(swap.referrerAddress, swap.destChain);

		let random32Hex = swap.randomKey;

		const unlockAddress32 = this.getUnlockAddress32(swap.sourceChain);

		const batch = this.gConf.singleBatchChainIds.includes(+swap.destChain) ? false : true; // batch-post except for eth and expensive chains

		const amountIn64 = ethers.parseUnits(
			availableAmountIn.toFixed(chosenDriverToken.decimals),
			chosenDriverToken.decimals,
		);
		const callData = await this.swiftInterface.encodeFunctionData('fulfillSimple', [
			amountIn64,
			orderHashHex,
			srcChain,
			tokenIn32Hex,
			protocolBps,
			{
				trader: trader32Hex,
				tokenOut: tokenOut32Hex,
				minAmountOut: minAmountOut64,
				gasDrop: gasDrop64,
				cancelFee: destRefundFee64,
				refundFee: sourceRefundFee64,
				deadline: deadline64,
				destAddr: destAddr32Hex,
				destChainId: destChain,
				referrerAddr: referrerAddr32Hex,
				referrerBps: referrerBps,
				auctionMode: swap.auctionMode,
				random: random32Hex,
			},
			unlockAddress32,
			batch,
		]);
		const driverToken = chosenDriverToken;
		let permit: Erc20Permit = {
			owner: driverToken.contract,
			spender: this.contractsConfig.evmFulfillHelpers[swap.destChain],
			value: amountIn64,
			nonce: 0,
			deadline: 0,
			chainId: WhChainIdToEvm[+swap.destChain],
			name: '',
			verifyingContract: '',
			version: '',
			v: 0,
			r: '0x' + Buffer.alloc(32).toString('hex'),
			s: '0x' + Buffer.alloc(32).toString('hex'),
		};
		if (driverToken.supportsPermit) {
			permit = await generateErc20Permit(
				this.walletHelper.getDriverWallet(swap.destChain).address,
				this.contractsConfig.evmFulfillHelpers[swap.destChain],
				driverToken.contract,
				WhChainIdToEvm[+swap.destChain],
				amountIn64,
				this.walletHelper.getDriverWallet(swap.destChain),
				this.evmProviders[swap.destChain],
			);
		}

		const args = [
			driverToken.contract,
			amountIn64,
			this.contractsConfig.contracts[swap.destChain],
			callData,
			{
				value: permit.value,
				deadline: permit.deadline,
				r: permit.r,
				s: permit.s,
				v: permit.v,
			},
			overrides,
		];
		if (!overrides['gasLimit']) {
			const estimatedGas = await this.walletHelper
				.getFulfillHelperWriteContract(swap.destChain)
				.directFulfill.estimateGas(...args);
			overrides['gasLimit'] = (estimatedGas * BigInt(130)) / BigInt(100);
			logger.info(`gasLimit increased 30% for fulfill ${swap.sourceTxHash}`);
		}
		const fulfillTx: ethers.TransactionResponse = await this.walletHelper
			.getFulfillHelperWriteContract(swap.destChain)
			.directFulfill(...args);

		logger.info(`Wait simple-fulfill on evm confirm for ${swap.sourceTxHash} via: ${fulfillTx.hash}`);
		const tx = await this.evmProviders[targetChain].waitForTransaction(
			fulfillTx.hash,
			getTypicalBlocksToConfirm(targetChain),
			60_000,
		);

		if (!tx || tx.status !== 1) {
			throw new Error(`Fulfilling on evm tx reverted sourceTx: ${swap.sourceTxHash}, ${tx?.hash}`);
		} else {
			swap.status = SWAP_STATUS.ORDER_SETTLED;
		}
	}
}
