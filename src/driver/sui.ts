import { parseVaa } from '@certusone/wormhole-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { ethers } from 'ethers6';
import { CHAIN_ID_SOLANA, CHAIN_ID_SUI, isEvmChainId, supportedChainIds } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { Token, TokenList, tokenTo32ByteAddress } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { Swap } from '../swap.dto';
import { tryNativeToUint8Array } from '../utils/buffer';
import logger from '../utils/logger';
import { addParseAndVerifySui, WORMHOLE_SUI_CORE_ID, WORMHOLE_SUI_PACKAGE } from '../utils/wormhole';
import { addSuiSwapTx, getSuiSwapQuote } from './routers';

export class SuiFulfiller {
	private readonly unlockWallets32: Map<number, Buffer> = new Map();
	private readonly suiFulfillTxHelper: SuiFulfillTxHelper;

	constructor(
		private readonly suiClient: SuiClient,
		private readonly walletConfig: WalletConfig,
		private readonly contracts: ContractsConfig,
		private readonly tokenList: TokenList,
	) {
		this.suiFulfillTxHelper = new SuiFulfillTxHelper(contracts, suiClient);

		const evmWalletAddr = this.walletConfig.evm.address;

		for (let chainId of supportedChainIds) {
			if (chainId === CHAIN_ID_SOLANA) {
				this.unlockWallets32.set(chainId, this.walletConfig.solana.publicKey.toBuffer());
			} else if (chainId === CHAIN_ID_SUI) {
				this.unlockWallets32.set(
					chainId,
					Buffer.from(this.walletConfig.sui.getPublicKey().toSuiAddress().slice(2), 'hex'),
				);
			} else if (isEvmChainId(chainId)) {
				this.unlockWallets32.set(chainId, Buffer.from(tryNativeToUint8Array(evmWalletAddr, chainId)));
			} else {
				throw new Error(`Invalid chainId for unlock wallet sui: ${chainId}`);
			}
		}
	}

	async fulfillAuctionOrSimple(
		swap: Swap,
		availableAmountIn: number,
		driverToken: Token,
		realMinAmountOut: bigint,
		postAuctionSignedVaa?: Uint8Array,
	): Promise<void> {
		const nativeCurrency = this.tokenList.nativeTokens[CHAIN_ID_SUI];

		let gasDrop = swap.gasDrop64;
		if (nativeCurrency.decimals > 8) {
			gasDrop = gasDrop * 10n ** (BigInt(nativeCurrency.decimals) - 8n);
		}
		const amountIn64 = ethers.parseUnits(availableAmountIn.toFixed(driverToken.decimals), driverToken.decimals);

		let tx = new Transaction();

		let fulfillTicket: TransactionObjectArgument;
		if (postAuctionSignedVaa) {
			const vaa = addParseAndVerifySui(tx, postAuctionSignedVaa!).vaa;
			fulfillTicket = this.suiFulfillTxHelper.addFulfillTicket(tx, vaa, swap);
		} else {
			fulfillTicket = this.suiFulfillTxHelper.addSimpleFulfillTicket(tx, swap);
		}

		const coins = await this.suiClient.getCoins({
			owner: this.walletConfig.sui.getPublicKey().toSuiAddress(),
			coinType: driverToken.contract,
		});

		let fulfillCoinFund;
		if (driverToken.contract === swap.toToken.contract) {
			const usdcCoin = coins.data[0];
			if (coins.data.length > 1) {
				tx.mergeCoins(
					tx.object(usdcCoin.coinObjectId),
					coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
				);
			}
			const [coin] = tx.splitCoins(tx.object(usdcCoin.coinObjectId), [tx.pure.u64(amountIn64)]);

			fulfillCoinFund = coin;
		} else {
			// TODO: provide fulfillCoinFund from Swap
			const quote = await getSuiSwapQuote({
				coinInAmount: amountIn64,
				coinInType: driverToken.contract,
				coinOutType: swap.toToken.contract,
			});

			const results = await addSuiSwapTx(tx, this.walletConfig.sui.getPublicKey().toSuiAddress(), quote.route);
			fulfillCoinFund = results[0];
			tx = results[1];
		}

		const gasDropMetadata = nativeCurrency.verifiedAddress!;
		const [gasDropCoin] = tx.splitCoins(tx.gas, [gasDrop]);

		await this.suiFulfillTxHelper.addCompleteFulfill(
			tx,
			swap,
			fulfillTicket,
			fulfillCoinFund,
			gasDropCoin,
			gasDropMetadata,
			this.unlockWallets32.get(swap.sourceChain)!,
		);

		logger.info(`Fulfilling auction on SUI with amountIn64: ${amountIn64}, realMinAmountOut: ${realMinAmountOut}`);
		const result = await this.suiClient.signAndExecuteTransaction({
			signer: this.walletConfig.sui,
			transaction: tx,
			options: {
				showEvents: true,
				showEffects: true,
			},
		});

		if (!!result.errors) {
			throw new Error(`Error fulfilling auction on SUI ${result.errors}`);
		}

		logger.info(`Fulfilled auction on SUI with ${result.digest}`);
	}
}

class SuiFulfillTxHelper {
	constructor(
		private readonly contracts: ContractsConfig,
		private readonly suiClient: SuiClient,
	) {}

	addSimpleFulfillTicket(tx: Transaction, swap: Swap): TransactionObjectArgument {
		return tx.moveCall({
			package: this.contracts.suiIds.packageId,
			module: 'fulfill',
			function: 'prepare_fulfill_simple',
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				tx.object(SUI_CLOCK_OBJECT_ID),
				tx.pure.address(swap.orderHash),
				tx.pure.u8(swap.payloadId),
				tx.pure.address('0x' + swap.trader32.toString('hex')),
				tx.pure.u16(swap.sourceChain),
				tx.pure.address('0x' + tokenTo32ByteAddress(swap.fromToken).toString('hex')),
				tx.pure.address('0x' + swap.destAddress32.toString('hex')),
				tx.pure.u16(swap.destChain),
				tx.pure.address('0x' + tokenTo32ByteAddress(swap.toToken).toString('hex')),
				tx.pure.u64(swap.minAmountOut64),
				tx.pure.u64(swap.gasDrop64),
				tx.pure.u64(swap.redeemRelayerFee64),
				tx.pure.u64(swap.refundRelayerFee64),
				tx.pure.u64(BigInt(swap.deadline.getTime() / 1000)),
				tx.pure.u16(swap.penaltyPeriod),
				tx.pure.address('0x' + swap.referrerAddress32.toString('hex')),
				tx.pure.u8(swap.referrerBps),
				tx.pure.u8(swap.mayanBps),
				tx.pure.u8(swap.auctionMode),
				tx.pure.u64(swap.baseBond),
				tx.pure.u64(swap.perBpsBond),
				tx.pure.address(swap.randomKey),
				tx.pure.address(swap.customPayload!),
			],
		});
	}

	addFulfillTicket(tx: Transaction, vaa: TransactionObjectArgument, swap: Swap): TransactionObjectArgument {
		return tx.moveCall({
			package: this.contracts.suiIds.packageId,
			module: 'fulfill',
			function: 'prepare_fulfill_winner',
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				vaa,
				tx.object(SUI_CLOCK_OBJECT_ID),
				tx.pure.u8(swap.payloadId),
				tx.pure.address('0x' + swap.trader32.toString('hex')),
				tx.pure.u16(swap.sourceChain),
				tx.pure.address('0x' + tokenTo32ByteAddress(swap.fromToken).toString('hex')),
				tx.pure.address('0x' + swap.destAddress32.toString('hex')),
				tx.pure.u16(swap.destChain),
				tx.pure.address('0x' + tokenTo32ByteAddress(swap.toToken).toString('hex')),
				tx.pure.u64(swap.minAmountOut64),
				tx.pure.u64(swap.gasDrop64),
				tx.pure.u64(swap.redeemRelayerFee64),
				tx.pure.u64(swap.refundRelayerFee64),
				tx.pure.u64(BigInt(swap.deadline.getTime() / 1000)),
				tx.pure.u16(swap.penaltyPeriod),
				tx.pure.address('0x' + swap.referrerAddress32.toString('hex')),
				tx.pure.u8(swap.referrerBps),
				tx.pure.u8(swap.mayanBps),
				tx.pure.u8(swap.auctionMode),
				tx.pure.u64(swap.baseBond),
				tx.pure.u64(swap.perBpsBond),
				tx.pure.address(swap.randomKey),
				tx.pure.address(swap.customPayload!),
			],
		});
	}

	addPrepareFulfillWinner(
		tx: Transaction,
		signedVaa: Uint8Array,
	): {
		fulfillMsg: {
			$kind: 'NestedResult';
			NestedResult: [number, number];
		};
	} {
		const parsed = parseVaa(signedVaa);
		const results = addParseAndVerifySui(tx, signedVaa);

		const [fulfillMsg] = tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::fulfill::prepare_fulfill_winner`,
			arguments: [tx.object(this.contracts.suiIds.stateId), results.vaa],
		});

		return {
			fulfillMsg: fulfillMsg,
		};
	}

	async addCompleteFulfill(
		tx: Transaction,
		swap: Swap,
		fulfillTicket: TransactionObjectArgument,
		fulfillCoinFund: TransactionObjectArgument,
		gasDropCoin: any,
		gasDropCoinMetadataId: any,
		addrUnlocker32: Buffer,
	) {
		const stateShareVersion = await this.suiClient.getObject({
			id: this.contracts.suiIds.stateId,
		});
		const [ticket ] =tx.moveCall({
			package: this.contracts.suiIds.packageId,
			module: 'fulfill',
			function: 'complete_fulfill_with_post',
			typeArguments: [swap.toToken.contract],
			arguments: [
				tx.sharedObjectRef({
					initialSharedVersion: stateShareVersion.data?.version!,
					mutable: true,
					objectId: this.contracts.suiIds.stateId,
				}),
				// tx.object(this.contracts.suiIds.stateId),
				tx.object(SUI_CLOCK_OBJECT_ID),
				fulfillTicket!,
				fulfillCoinFund,
				tx.object(swap.toToken.verifiedAddress!),
				gasDropCoin,
				tx.object(gasDropCoinMetadataId),
				tx.pure.address('0x' + addrUnlocker32.toString('hex')),
			],
		});
		const [bridgeFee] = tx.splitCoins(tx.gas, [0]);
		const whstateShareVersion = await this.suiClient.getObject({
			id: WORMHOLE_SUI_CORE_ID,
		});
		tx.moveCall({
			target: `${WORMHOLE_SUI_PACKAGE}::publish_message::publish_message`,
			arguments: [tx.sharedObjectRef({
				initialSharedVersion: whstateShareVersion.data?.version!,
				mutable: true,
				objectId: WORMHOLE_SUI_CORE_ID,
			}), bridgeFee, ticket, tx.object(SUI_CLOCK_OBJECT_ID)],
		});
		// tx.moveCall({
		// 	package: this.contracts.suiIds.packageId,
		// 	module: 'fulfill',
		// 	function: 'complete_fulfill',
		// 	typeArguments: [swap.toToken.contract],
		// 	arguments: [
		// 		// tx.sharedObjectRef({
		// 		// 	initialSharedVersion: stateShareVersion.data?.version!,
		// 		// 	mutable: true,
		// 		// 	objectId: this.contracts.suiIds.stateId,
		// 		// }),
		// 		tx.object(this.contracts.suiIds.stateId),
		// 		tx.object(SUI_CLOCK_OBJECT_ID),
		// 		fulfillTicket!,
		// 		fulfillCoinFund,
		// 		tx.object(swap.toToken.verifiedAddress!),
		// 		gasDropCoin,
		// 		tx.object(gasDropCoinMetadataId),
		// 		tx.pure.address('0x' + addrUnlocker32.toString('hex')),
		// 	],
		// });
	}
}
