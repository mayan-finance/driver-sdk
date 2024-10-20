import { parseVaa } from '@certusone/wormhole-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { ethers } from 'ethers6';
import { CHAIN_ID_SOLANA, CHAIN_ID_SUI, isEVMChainId, supportedChainIds } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { Swap } from '../swap.dto';
import { tryNativeToUint8Array } from '../utils/buffer';
import logger from '../utils/logger';
import { addParseAndVerifySui } from '../utils/wormhole';
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
		this.suiFulfillTxHelper = new SuiFulfillTxHelper(contracts);

		const evmWalletAddr = this.walletConfig.evm.address;

		for (let chainId of supportedChainIds) {
			if (chainId === CHAIN_ID_SOLANA) {
				this.unlockWallets32.set(chainId, this.walletConfig.solana.publicKey.toBuffer());
			} else if (chainId === CHAIN_ID_SUI) {
				this.unlockWallets32.set(
					chainId,
					Buffer.from(this.walletConfig.sui.getPublicKey().toSuiAddress().slice(2), 'hex'),
				);
			} else if (isEVMChainId(chainId)) {
				this.unlockWallets32.set(chainId, Buffer.from(tryNativeToUint8Array(evmWalletAddr, chainId)));
			} else {
				throw new Error(`Invalid chainId for unlock wallet sui: ${chainId}`);
			}
		}
	}

	async fulfillAuction(
		swap: Swap,
		availableAmountIn: number,
		toToken: Token,
		driverToken: Token,
		postAuctionSignedVaa: Uint8Array,
		realMinAmountOut: bigint,
	): Promise<void> {
		const nativeCurrency = this.tokenList.nativeTokens[CHAIN_ID_SUI];

		let gasDrop = swap.gasDrop64;
		if (nativeCurrency.decimals > 8) {
			gasDrop = gasDrop * 10n ** (BigInt(nativeCurrency.decimals) - 8n);
		}
		const amountIn64 = ethers.parseUnits(availableAmountIn.toFixed(driverToken.decimals), driverToken.decimals);

		let tx = new Transaction();


		const coins = await this.suiClient.getCoins({
			owner: this.walletConfig.sui.getPublicKey().toSuiAddress(),
			coinType: driverToken.contract,
		});

		let fulfillCoinFund;
		if (driverToken.contract === toToken.contract) {
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
				coinOutType: toToken.contract,
			});

			const results = await addSuiSwapTx(tx, this.walletConfig.sui.getPublicKey().toSuiAddress(), quote.route);
			fulfillCoinFund = results[0];
			tx = results[1];
		}

		const gasDropMetadata = nativeCurrency.verifiedAddress!;
		const [gasDropCoin] = tx.splitCoins(tx.gas, [gasDrop]);

		const { fulfillMsg } = this.suiFulfillTxHelper.addPrepareFulfillWinner(tx, postAuctionSignedVaa);
		this.suiFulfillTxHelper.addCompleteFulfill(
			tx,
			toToken.contract,
			toToken.verifiedAddress!,
			fulfillCoinFund,
			gasDropCoin,
			gasDropMetadata,
			fulfillMsg,
			'0x' + this.unlockWallets32.get(swap.sourceChain)!.toString('hex'),
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
	constructor(private readonly contracts: ContractsConfig) {}

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

	addCompleteFulfill(
		tx: Transaction,
		coinType: string,
		coinMetadataId: string,
		fulfillCoinFund: any,
		gasDropCoin: any,
		gasDropCoinMetadataId: any,
		fulfillMsg: {
			$kind: 'NestedResult';
			NestedResult: [number, number];
		},
		addrUnlocker32: string,
	) {
		tx.moveCall({
			target: `${this.contracts.suiIds.packageId}::fulfill::complete_fulfill`,
			arguments: [
				tx.object(this.contracts.suiIds.stateId),
				tx.object(this.contracts.suiIds.feeManagerStateId),
				tx.object(SUI_CLOCK_OBJECT_ID),
				fulfillMsg,
				fulfillCoinFund,
				tx.object(coinMetadataId),
				gasDropCoin,
				tx.object(gasDropCoinMetadataId),
				tx.pure.address(addrUnlocker32),
			],
			typeArguments: [coinType],
		});
		console.log('1');
	}
}
