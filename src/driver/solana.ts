import { Account, createTransferInstruction, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import { CHAIN_ID_SOLANA, supportedChainIds } from '../config/chains';
import { RpcConfig } from '../config/rpc';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { Swap } from '../swap.dto';
import logger from '../utils/logger';
import { LookupTableOptimizer } from '../utils/lut';
import { PriorityFeeHelper } from '../utils/solana-trx';
import { NewSolanaIxHelper } from './solana-ix';
import { WalletsHelper } from './wallet-helper';

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
		private readonly rpcConfig: RpcConfig,
		private readonly walletConfig: WalletConfig,
		private readonly solanaIxHelper: NewSolanaIxHelper,
		private readonly priorityFeeHelper: PriorityFeeHelper,
		private readonly lutOptimizer: LookupTableOptimizer,
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

	private async getQuoteWithRetry(
		amountIn: bigint,
		fromMint: string,
		toMint: string,
		slippage: number,
		retry: number = 10,
	): Promise<any> {
		let res;
		do {
			try {
				let params: any = {
					inputMint: fromMint,
					outputMint: toMint,
					slippageBps: slippage * 10000,
					maxAccounts: 64 - 7, // 7 accounts reserved for other instructions
					amount: amountIn,
				};
				if (!!this.rpcConfig.jupApiKey) {
					params['token'] = this.rpcConfig.jupApiKey;
				}
				const { data } = await axios.get('https://quote-api.jup.ag/v6/quote', {
					params: params,
				});
				res = data;
			} catch (err) {
				logger.warn(`error in fetch jupiter ${err} try ${retry}`);
			} finally {
				retry--;
			}
		} while ((!res || !res.outAmount) && retry > 0);

		if (!res) {
			logger.error(`juptier quote failed ${fromMint} ${toMint} ${amountIn}`);
			return null;
		}

		return {
			effectiveAmountIn: res.inAmount,
			expectedAmountOut: res.outAmount,
			priceImpact: res.priceImpactPct,
			minAmountOut: res.otherAmountThreshold,
			route: [],
			raw: res,
		};
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
			const quoteRes = await this.getQuoteWithRetry(
				BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)),
				driverToken.mint,
				toToken.mint,
				0.1, // 10%
			);

			if (!quoteRes || !quoteRes.raw) {
				throw new Error('jupiter quote for bid in swift failed');
			}

			bidAmount = BigInt(Math.floor(Number(quoteRes.expectedAmountOut) * Number(0.99)));
		}

		let normalizedBidAmount = bidAmount;
		if (toToken.decimals > 8) {
			normalizedBidAmount = bidAmount / BigInt(10 ** (toToken.decimals - 8));
		}

		if (normalizedBidAmount < normalizedMinAmountOut) {
			throw new Error(`normalizedBidAmount is less than minAmountOut`);
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
				swap.destAddress,
				this.walletConfig.solana.publicKey,
				new PublicKey(targetToken.mint),
				stateAddress,
				stateToAss,
			),
		);

		return result;
	}

	async getFulfillTransferTrx(
		driverToken: Token,
		stateAddress: PublicKey,
		stateToAss: PublicKey,
		effectiveAmountInDriverToken: number,
		realMinAmountOut: bigint,
		toToken: Token,
		swap: Swap,
	): Promise<VersionedTransaction> {
		const fullFillIx = await this.solanaIxHelper.getFullfillIx(
			swap.destAddress,
			this.walletConfig.solana.publicKey,
			new PublicKey(toToken.mint),
			stateAddress,
			stateToAss,
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
			const quoteRes = await this.getQuoteWithRetry(
				BigInt(Math.floor(effectiveAmountInDriverToken * 10 ** driverToken.decimals)),
				driverToken.mint,
				toToken.mint,
				0.1, // 10%
			);

			if (!quoteRes || !quoteRes.raw) {
				throw new Error(`jupiter quote for fulfill in swift swap failed`);
			}

			if (quoteRes.expectedAmountOut < realMinAmountOut) {
				logger.warn(`min amount out issues on ${swap.sourceTxHash}`);
			}
			const { data } = await axios.post('https://quote-api.jup.ag/v6/swap', {
				quoteResponse: quoteRes.raw,
				userPublicKey: this.walletConfig.solana.publicKey.toString(),
				destinationTokenAccount: stateToAss,
				wrapAndUnwrapSol: false,
				dynamicComputeUnitLimit: false, // 14m
				prioritizationFeeLamports: 'auto',
			});
			logger.verbose(`got jupiter swap data for fulfill ${swap.sourceTxHash}`);

			const vt = VersionedTransaction.deserialize(Buffer.from(data.swapTransaction, 'base64')).message;
			const lt = await Promise.all(
				vt.addressTableLookups.map((a) => this.solanaConnection.getAddressLookupTable(a.accountKey)),
			);
			const jupLookupTables: AddressLookupTableAccount[] = lt.map((l) => l.value!);

			let decompiledMsg = TransactionMessage.decompile(vt, { addressLookupTableAccounts: jupLookupTables });

			const driverWalletAss = getAssociatedTokenAddressSync(
				new PublicKey(driverToken.mint),
				this.walletConfig.solana.publicKey,
			);

			const jupInstructions = decompiledMsg.instructions.filter(
				(ix) =>
					!this.solanaIxHelper.isBadAggIns(
						ix,
						this.walletConfig.solana.publicKey,
						[new PublicKey(driverToken.mint), new PublicKey(toToken.mint)],
						[driverWalletAss, stateToAss],
					),
			);

			let jupAccountsSet = new Set<string>();
			for (let ins of jupInstructions) {
				jupAccountsSet.add(ins.programId.toBase58());
				for (let key of ins.keys) {
					jupAccountsSet.add(key.pubkey.toBase58());
				}
			}

			fulfillAmountIxs = jupInstructions;
			fulfillLookupTables = jupLookupTables;
		}

		const computeIns = ComputeBudgetProgram.setComputeUnitLimit({
			units: 100000 * 7,
		});

		let signers: Array<Keypair> = [];
		signers.push(this.walletConfig.solana);

		let instructions = [...fulfillAmountIxs, fullFillIx];
		let allAccountKeys: string[] = [];
		for (const instruction of instructions) {
			for (const key of instruction.keys) {
				allAccountKeys.push(key.pubkey.toString());
			}
		}
		instructions = await this.priorityFeeHelper.addPriorityFeeInstruction(instructions, allAccountKeys);

		instructions = [computeIns, ...instructions];

		const optimizedLuts = await this.lutOptimizer.getOptimizedLookupTables(
			instructions,
			fulfillLookupTables,
			signers,
			this.walletConfig.solana.publicKey,
			`fulfill ${swap.sourceTxHash}`,
		);

		const { blockhash } = await this.solanaConnection.getLatestBlockhash();
		const messageV0 = new TransactionMessage({
			payerKey: this.walletConfig.solana.publicKey,
			recentBlockhash: blockhash,
			instructions: instructions,
		}).compileToV0Message(optimizedLuts);
		const transaction = new VersionedTransaction(messageV0);
		transaction.sign([this.walletConfig.solana]);

		return transaction;
	}

	getUnlockAddress(sourceChainId: number): string {
		if (sourceChainId === CHAIN_ID_SOLANA) {
			return this.walletConfig.solana.publicKey.toString();
		} else {
			return this.walletConfig.evm.address;
		}
	}
}
