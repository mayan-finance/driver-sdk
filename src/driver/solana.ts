import { Account, createTransferInstruction, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { AddressLookupTableAccount, Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { CHAIN_ID_SOLANA, supportedChainIds } from '../config/chains';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { Swap } from '../swap.dto';
import { tryNativeToUint8Array } from '../utils/buffer';
import logger from '../utils/logger';
import { LookupTableOptimizer } from '../utils/lut';
import { NewSolanaIxHelper } from './solana-ix';
import { WalletsHelper } from './wallet-helper';
import { SwapRouters } from './routers';

type WalletAss = {
	mint: string;
	ass: PublicKey;
	token: Token;
};

type WalletInfo = {
	account: Account;
	token: Token;
};

export class SolanaFulfiller {
	private wallets: WalletAss[] = [];

	private readonly unlockWallets: Map<number, string> = new Map();

	constructor(
		private readonly solanaConnection: Connection,
		private readonly walletConfig: WalletConfig,
		private readonly solanaIxHelper: NewSolanaIxHelper,
		private readonly lutOptimizer: LookupTableOptimizer,
		private readonly swapRouters: SwapRouters,
		walletHelper: WalletsHelper,
		tokenList: TokenList,
	) {
		for (let token of [tokenList.getNativeUsdc(CHAIN_ID_SOLANA)!, tokenList.getWethSol()]) {
			this.wallets.push({
				ass: getAssociatedTokenAddressSync(new PublicKey(token.contract), this.walletConfig.solana.publicKey),
				mint: token.contract,
				token: token,
			});
		}

		for (let chainId of supportedChainIds) {
			if (chainId === CHAIN_ID_SOLANA) {
				continue;
			}
			this.unlockWallets.set(chainId, walletHelper.getDriverWallet(chainId).address);
		}
	}

	private async getWalletInfo(): Promise<WalletInfo[]> {
		const accounts = await Promise.all(this.wallets.map((x) => getAccount(this.solanaConnection, x.ass)));
		let result = [];

		for (let i = 0; i < accounts.length; i++) {
			const token = this.wallets[i].token;
			result.push({
				account: accounts[i],
				token: token,
			});
		}

		return result;
	}

	async getNormalizedBid(
		driverToken: Token,
		effectiveAmountInDriverToken: number,
		normalizedMinAmountOut: bigint,
		toToken: Token,
	): Promise<bigint> {
		let bidAmount: bigint;
		if (driverToken.contract === toToken.contract) {
			bidAmount = BigInt(Math.floor(effectiveAmountInDriverToken * 0.99 * 10 ** driverToken.decimals));
		} else {
			const quoteRes = await this.swapRouters.getSolQuote({
				inputMint: driverToken.mint,
				outputMint: toToken.mint,
				slippageBps: 1000,
				amount: BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)).toString(),
				maxAccounts: 64 - 7,
			});

			if (!quoteRes || !quoteRes.raw) {
				throw new Error('jupiter quote for bid in swift failed');
			}

			bidAmount = BigInt(Math.floor(Number(quoteRes.outputMint) * Number(0.99)));
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

	async getSimpleFulfillIxPackage(
		swiftProgram: PublicKey,
		stateAddress: PublicKey,
		stateToAss: PublicKey,
		targetToken: Token,
		effectiveAmountIn: number,
		swap: Swap,
	): Promise<TransactionInstruction[]> {
		let result = [];
		const walletInfo = await this.getWalletInfo();
		let chosenWallet: WalletInfo | null = null;
		for (let wallet of walletInfo) {
			if (wallet.token.contract === targetToken.contract) {
				chosenWallet = wallet;
			}
		}

		if (!chosenWallet) {
			throw new Error(`no wallet found for simple-fulfilling target token: ${targetToken.contract}`);
		}

		result.push(
			createTransferInstruction(
				chosenWallet.account.address,
				stateToAss,
				this.walletConfig.solana.publicKey,
				Math.floor(effectiveAmountIn * 10 ** chosenWallet.token.decimals),
			),
		);

		result.push(
			await this.solanaIxHelper.getFullfillIx(
				this.getUnlockAddress(swap.sourceChain),
				swap.destAddress,
				this.walletConfig.solana.publicKey,
				new PublicKey(targetToken.mint),
				stateAddress,
				stateToAss,
				targetToken.standard === 'spl2022',
			),
		);

		return result;
	}

	async getFulfillTransferTrxData(
		driverToken: Token,
		stateAddress: PublicKey,
		stateToAss: PublicKey,
		effectiveAmountInDriverToken: number,
		realMinAmountOut: bigint,
		toToken: Token,
		swap: Swap,
	): Promise<{
		instructions: TransactionInstruction[];
		lookupTables: AddressLookupTableAccount[];
		signers: Array<Keypair>;
	}> {
		const fullFillIx = await this.solanaIxHelper.getFullfillIx(
			this.getUnlockAddress(swap.sourceChain),
			swap.destAddress,
			this.walletConfig.solana.publicKey,
			new PublicKey(toToken.mint),
			stateAddress,
			stateToAss,
			toToken.standard === 'spl2022',
		);

		let fulfillAmountIxs = [];
		let fulfillLookupTables: AddressLookupTableAccount[] = [];

		if (driverToken.contract === toToken.contract) {
			const driverAss = getAssociatedTokenAddressSync(
				new PublicKey(driverToken.mint),
				this.walletConfig.solana.publicKey,
				false,
			);
			fulfillAmountIxs = [
				createTransferInstruction(
					driverAss,
					stateToAss,
					this.walletConfig.solana.publicKey,
					Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals),
				),
			];
		} else {
			const swapRes = await this.swapRouters.getSolSwap({
				inputMint: driverToken.mint,
				outputMint: toToken.mint,
				slippageBps: 1000,
				amount: BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)).toString(),
				maxAccounts: 64 - 7,
				userPublicKey: this.walletConfig.solana.publicKey.toString(),
				destinationTokenAccount: stateToAss.toString(),
				ledger: stateAddress.toString(),
				wrapUnwrapSol: false,
			});

			if (!swapRes) {
				throw new Error(`jupiter quote for fulfill in swift swap failed`);
			}

			if (BigInt(swapRes.outAmount) < realMinAmountOut) {
				logger.warn(`min amount out issues on ${swap.sourceTxHash}`);
			}
			logger.verbose(`got jupiter swap data for fulfill ${swap.sourceTxHash}`);

			const driverWalletAss = getAssociatedTokenAddressSync(
				new PublicKey(driverToken.mint),
				this.walletConfig.solana.publicKey,
			);

			const instructions = swapRes.transactionMessage!.instructions.filter(
				(ix) =>
					!this.solanaIxHelper.isBadAggIns(
						ix,
						this.walletConfig.solana.publicKey,
						[new PublicKey(driverToken.mint), new PublicKey(toToken.mint)],
						[driverWalletAss, stateToAss],
					),
			);

			let accountsSet = new Set<string>();
			for (let ins of instructions) {
				accountsSet.add(ins.programId.toBase58());
				for (let key of ins.keys) {
					accountsSet.add(key.pubkey.toBase58());
				}
			}

			fulfillAmountIxs = instructions;
			fulfillLookupTables = swapRes.addressLookupTableAccounts!;
		}

		let signers: Array<Keypair> = [];
		signers.push(this.walletConfig.solana);

		let instructions = [...fulfillAmountIxs, fullFillIx];

		const optimizedLuts = await this.lutOptimizer.getOptimizedLookupTables(
			instructions,
			fulfillLookupTables,
			signers,
			this.walletConfig.solana.publicKey,
			`fulfill ${swap.sourceTxHash}`,
		);

		return {
			instructions: instructions,
			lookupTables: optimizedLuts,
			signers: signers,
		};

		// const { blockhash } = await this.solanaConnection.getLatestBlockhash();
		// const messageV0 = new TransactionMessage({
		// 	payerKey: this.walletConfig.solana.publicKey,
		// 	recentBlockhash: blockhash,
		// 	instructions: instructions,
		// }).compileToV0Message(optimizedLuts);
		// const transaction = new VersionedTransaction(messageV0);
		// transaction.sign([this.walletConfig.solana]);

		// return transaction;
	}

	getUnlockAddress(sourceChainId: number): Uint8Array {
		if (sourceChainId === CHAIN_ID_SOLANA) {
			return tryNativeToUint8Array(this.walletConfig.solana.publicKey.toString(), CHAIN_ID_SOLANA);
		} else {
			return tryNativeToUint8Array(this.walletConfig.evm.address, sourceChainId);
		}
	}
}
