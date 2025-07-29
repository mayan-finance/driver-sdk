import {
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AddressLookupTableAccount, Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import axios from 'axios';
import { AuctionFulfillerConfig } from '../auction';
import { CHAIN_ID_ARBITRUM, CHAIN_ID_AVAX, CHAIN_ID_BASE, CHAIN_ID_ETH, CHAIN_ID_OPTIMISM, CHAIN_ID_POLYGON, CHAIN_ID_SOLANA, CHAIN_ID_UNICHAIN, WORMHOLE_DECIMALS } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { driverConfig } from '../driver.conf';
import { SimpleFulfillerConfig } from '../simple';
import { Swap } from '../swap.dto';
import { tryNativeToUint8Array } from '../utils/buffer';
import { FeeService } from '../utils/fees';
import logger from '../utils/logger';
import { binary_to_base58 } from '../utils/base58';
import { SolanaMultiTxSender } from '../utils/solana-trx';
import { DB_PATH, insertTransactionLog } from '../utils/sqlite3';
import { AUCTION_MODES, getAuctionState } from '../utils/state-parser';
import { delay } from '../utils/util';
import { get_wormhole_core_accounts, getWormholeSequenceFromPostedMessage } from '../utils/wormhole';
import { EvmFulfiller } from './evm';
import { SolanaFulfiller } from './solana';
import { NewSolanaIxHelper } from './solana-ix';
import { WalletsHelper } from './wallet-helper';
import { GlobalConfig } from '../config/global';
import { sendAlert, sendLossAlert } from '../utils/alert';
import { REBALANCE_ENABLED_CHAIN_IDS } from '../rebalancer';

export class DriverService {
	private readonly swiftProgram: PublicKey;
	private readonly swiftAuctionProgram: PublicKey;
	public pendingAuctionCount = 0;

	constructor(
		private readonly simpleFulfillerCfg: SimpleFulfillerConfig,
		private readonly auctionFulfillerCfg: AuctionFulfillerConfig,
		private readonly globalConfig: GlobalConfig,
		private readonly solanaConnection: Connection,
		private readonly walletConfig: WalletConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly contractsConfig: ContractsConfig,
		private readonly solanaIxService: NewSolanaIxHelper,
		private readonly feeService: FeeService,
		private readonly solanaFulfiller: SolanaFulfiller,
		private readonly walletsHelper: WalletsHelper,
		private readonly evmFulFiller: EvmFulfiller,
		private readonly tokenList: TokenList,
		private readonly solanaSender: SolanaMultiTxSender,
	) {
		this.swiftProgram = new PublicKey(contractsConfig.contracts[CHAIN_ID_SOLANA]);
		this.swiftAuctionProgram = new PublicKey(contractsConfig.auctionAddr);
	}

	getStateAddr(swap: Swap): PublicKey {
		return new PublicKey(swap.stateAddr);
	}

	getMayanAndReferrerFeeAssesInstructions(
		mayanBps: number,
		referrerBps: number,
		referrerAddress: string,
		destChain: number,
		toTokenMint: PublicKey,
		isToken2022: boolean,
	): { ixs: TransactionInstruction[]; mayan: PublicKey; mayanAss: PublicKey; referrerAss: PublicKey } {
		let result: {
			ixs: TransactionInstruction[];
			mayanAss: PublicKey;
			referrerAss: PublicKey;
			mayan: PublicKey;
		} = {
			ixs: [],
			mayanAss: null as any,
			referrerAss: null as any,
			mayan: new PublicKey(this.contractsConfig.feeCollectorSolana),
		};

		let referrer: string | Uint8Array = referrerAddress;
		if (referrer.length === 44) {
			referrer = tryNativeToUint8Array(referrer as string, destChain);
		}

		if (mayanBps !== 0) {
			const mayanFeeAss = getAssociatedTokenAddressSync(
				toTokenMint,
				new PublicKey(this.contractsConfig.feeCollectorSolana),
				true,
				isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);
			result.ixs.push(
				createAssociatedTokenAccountIdempotentInstruction(
					this.walletConfig.solana.publicKey,
					mayanFeeAss,
					new PublicKey(this.contractsConfig.feeCollectorSolana),
					toTokenMint,
					isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
				),
			);
			result.mayanAss = mayanFeeAss;
		}

		if (referrerBps !== 0) {
			const referrerFeeAss = getAssociatedTokenAddressSync(
				toTokenMint,
				new PublicKey(referrer),
				true,
				isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);
			result.ixs.push(
				createAssociatedTokenAccountIdempotentInstruction(
					this.walletConfig.solana.publicKey,
					referrerFeeAss,
					new PublicKey(referrer),
					toTokenMint,
					isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
				),
			);
			result.referrerAss = referrerFeeAss;
		}

		return result;
	}

	async getRegisterOrderFromSwap(swap: Swap): Promise<TransactionInstruction> {
		const fromToken = swap.fromToken;

		const instruction = await this.solanaIxService.getRegisterOrderIx(
			this.walletConfig.solana.publicKey,
			new PublicKey(swap.stateAddr),
			swap,
			fromToken.decimals,
		);
		return instruction;
	}

	getDriverEvmTokenForBidAndSwap(swap: Swap): Token {
		const fromNativeUSDT = this.tokenList.getNativeUsdt(swap.sourceChain);
		const fromNativeUSDC = this.tokenList.getNativeUsdc(swap.sourceChain);
		const fromEth = this.tokenList.getEth(swap.sourceChain);
		const fromSolWeth = swap.sourceChain === CHAIN_ID_SOLANA ? this.tokenList.getWethSol() : null;

		if (swap.fromToken.contract === fromNativeUSDC?.contract || swap.fromToken.contract === fromNativeUSDT?.contract) {
			const destUsdc = this.tokenList.getNativeUsdc(swap.destChain);
			const destUsdt = this.tokenList.getNativeUsdt(swap.destChain);
			if (!destUsdc && !destUsdt) {
				throw new Error(`Stable token not found on ${swap.destChain} for driver! not bidding or swapping`);
			}

			return (destUsdc || destUsdt)!;
		} else if (swap.fromToken.contract === fromEth?.contract || swap.fromToken.contract === fromSolWeth?.contract) {
			return this.tokenList.getEth(swap.destChain)!;
		} else {
			throw new Error(
				`Unsupported input token ${swap.fromToken.contract} on
				${swap.sourceChain} for driver! not bidding or swapping`,
			);
		}
	}

	getDriverSolanaTokenForBidAndSwap(swap: Swap): Token {
		const fromNativeUSDT = this.tokenList.getNativeUsdt(swap.sourceChain);
		const fromNativeUSDC = this.tokenList.getNativeUsdc(swap.sourceChain);
		const fromEth = this.tokenList.getEth(swap.sourceChain);


		if (
			this.tokenList.getNativeUsdc(swap.sourceChain)?.contract === swap.fromToken.contract &&
			swap.destChain === CHAIN_ID_SOLANA &&
			swap.toToken.contract === "mzerokyEX9TNDoK4o2YZQBDmMzjokAeN6M2g2S3pLJo") {
			return swap.toToken
		}

		if (swap.fromToken.contract === fromNativeUSDC?.contract || swap.fromToken.contract === fromNativeUSDT?.contract) {
			return this.tokenList.getNativeUsdc(CHAIN_ID_SOLANA)!;
		} else if (swap.fromToken.contract === fromEth?.contract) {
			return this.tokenList.getWethSol();
		} else {
			throw new Error(`Unsupported input token ${swap.fromToken.contract} for driver! not bidding or swapping`);
		}
	}

	async bid(swap: Swap, lastBid: bigint = 0n): Promise<void> {
		if (this.pendingAuctionCount > driverConfig.maxPendingOrders) {
			sendAlert('FILLED_PENDING', `Filled pending auction ${this.pendingAuctionCount}`);
			throw new Error(`Not bidding ${swap.sourceTxHash} because we have too many pending orders`);
		}

		const srcChain = swap.sourceChain;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;
		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: swap.gasless,
			auctionMode: swap.auctionMode,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			fromAmount: swap.fromAmount.toNumber(),
			gasDrop: swap.gasDrop.toNumber(),
			destAddress: swap.destAddress,
		}, swap.orderId);
		logger.info(`[EXPENSES] ${swap.sourceTxHash}: ${expenses.fulfillAndUnlock}:${expenses.fulfillCost}:${expenses.unlockSource}`);
		const effectiveAmountIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmountIn < 0) {
			logger.error(`effectiveAmountIn is less than 0 ${effectiveAmountIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}

		let driverToken: Token;
		if (dstChain === CHAIN_ID_SOLANA) {
			driverToken = this.getDriverSolanaTokenForBidAndSwap(swap);
		} else {
			driverToken = this.getDriverEvmTokenForBidAndSwap(swap);
		}

		let isDriverTokenUSDC = driverToken.contract === this.tokenList.getNativeUsdc(dstChain)?.contract || driverToken.contract === "mzerokyEX9TNDoK4o2YZQBDmMzjokAeN6M2g2S3pLJo";
		let isDstChainValidForRebalance = REBALANCE_ENABLED_CHAIN_IDS.includes(dstChain);

		if (process.env.BATTLE_TEST === 'true' && (!isDriverTokenUSDC || !isDstChainValidForRebalance)) {
			throw new Error('Shall not bid on tx because driver token is not USDC or dst chain is not valid for rebalance in development mode');
		}

		if (this.globalConfig.minUsdcOrderAmount && effectiveAmountIn < this.globalConfig.minUsdcOrderAmount && isDriverTokenUSDC) {
			logger.info(`Shall not bid on tx: ${swap.sourceTxHash} because effectiveAmountIn ${effectiveAmountIn} is less than minUsdcOrderAmount ${this.globalConfig.minUsdcOrderAmount}`);
			throw new Error(`Shall not bid on tx: ${swap.sourceTxHash} because effectiveAmountIn ${effectiveAmountIn} is less than minUsdcOrderAmount ${this.globalConfig.minUsdcOrderAmount}`);
		}

		let context = {
			isDriverTokenUSDC,
			isDstChainValidForRebalance,
		};
		let normalizedBidAmount = await this.auctionFulfillerCfg.normalizedBidAmount(
			driverToken,
			effectiveAmountIn,
			swap,
			expenses,
			context,
			lastBid,
		);

		if (normalizedBidAmount < normalizedMinAmountOut) {
			logger.error(
				`Shall not bid on tx: ${swap.sourceTxHash} because ${normalizedBidAmount} is less than min amount out ${normalizedMinAmountOut}. ${expenses.unlockSource}:${expenses.fulfillCost}:${expenses.fulfillAndUnlock}`,
			);
			throw new Error('`Shall not bid on tx because bid amount is less than min amount out`');
		}

		// // TODO: remove debug
		// logger.info(`debugggggg not bid`);
		// return;

		const bidIx = await this.solanaIxService.getBidIx(
			this.walletConfig.solana.publicKey,
			new PublicKey(swap.auctionStateAddr),
			normalizedBidAmount,
			swap,
			fromToken.decimals,
		);

		let instructions = [bidIx];
		let signers = [this.walletConfig.solana];

		// Store auction state before bidding for comparison
		const stateBefore = await this.auctionFulfillerCfg.auctionListener?.getAuctionState(swap.auctionStateAddr);
		const previousAmount = stateBefore?.amountPromised || 0n;

		// // Create and sign transaction to calculate hash upfront
		// const { trx } = await this.solanaSender.createOptimizedVersionedTransaction(
		// 	instructions,
		// 	signers,
		// 	[],
		// 	true,
		// 	undefined,
		// 	70_000,
		// );

		// const rawTrx = trx.serialize();
		// // Calculate hash from signed transaction (before sending)
		// const calculatedHash = trx.signatures[0] ? binary_to_base58(trx.signatures[0]) : '';
		let txHash = await this.solanaSender.createAndSendJitoBundle(
			[{
				instructions: instructions,
				signers: signers,
				lookupTables: [],
			}],
			1,
			process.env.BID_JITO_TIP ? Number(process.env.BID_JITO_TIP) : 0.000018447,
		);

		// logger.info(`Prepared bid transaction hash: ${calculatedHash} for ${swap.sourceTxHash} - Previous amount: ${previousAmount}, Bidding: ${normalizedBidAmount}`);

		// Race between transaction confirmation and auction events
		await this.sendTransactionAndWaitForEvents(swap, normalizedBidAmount, txHash, previousAmount);
	}

	/**
	 * Send transaction and race between transaction confirmation and auction events
	 */
	private async sendTransactionAndWaitForEvents(
		swap: Swap,
		expectedBidAmount: bigint,
		txHash: string,
		// rawTrx: Buffer | Uint8Array,
		previousAmount: bigint
	): Promise<void> {
		// Start background transaction sending and monitoring
		// const txConfirmationPromise = this.sendAndMonitorTransaction(rawTrx, txHash, swap.sourceTxHash);

		// Start auction listener monitoring
		const auctionEventPromise = this.waitForBidEvent(swap, expectedBidAmount, txHash, previousAmount);

		// Race between the two - whoever completes first wins
		try {
			const result = await Promise.race([
				// txConfirmationPromise.then(() => ({ source: 'transaction-confirmation', hash: txHash })),
				this.solanaConnection.getSignatureStatus(txHash).then(() => {
					return ({ source: 'transaction-confirmation', hash: txHash })
				}),
				auctionEventPromise.then(() => ({ source: 'auction-listener', hash: txHash }))
			]);

			logger.info(`[BidRace] ✅ Bid completed via ${result.source} for ${swap.sourceTxHash} with hash: ${txHash}`);
		} catch (error: any) {
			logger.error(`[BidRace] ❌ Bid failed for ${swap.sourceTxHash}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Send transaction and monitor its confirmation status
	 */
	private async sendAndMonitorTransaction(
		rawTrx: Buffer | Uint8Array,
		expectedHash: string,
		sourceTxHash: string
	): Promise<void> {
		const timeout = 59_000; // 59 seconds timeout
		const pollInterval = 900; // Check every 900ms
		const startTime = Date.now();

		// Send transaction multiple times to ensure it gets through
		const sendPromises: Promise<void>[] = [];
		for (let i = 0; i < this.rpcConfig.solana.sendCount; i++) {
			sendPromises.push(
				this.solanaConnection.sendRawTransaction(rawTrx, { skipPreflight: true })
					.then(() => { /* fire and forget */ })
					.catch(() => { /* ignore send errors */ })
			);
			// Stagger sends slightly
			if (i < this.rpcConfig.solana.sendCount - 1) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		// Monitor transaction status
		while (Date.now() - startTime < timeout) {
			try {
				const sigStatuses = await this.solanaConnection.getSignatureStatuses([expectedHash]);
				const trxStatus = sigStatuses && sigStatuses.value[0];

				if (trxStatus) {
					if (trxStatus.err) {
						throw new Error(`[TxMonitor] Transaction ${expectedHash} failed: ${trxStatus.err}`);
					} else if (trxStatus.confirmationStatus === 'confirmed' || trxStatus.confirmationStatus === 'finalized') {
						logger.info(`[TxMonitor] ✅ Transaction confirmed for ${sourceTxHash}: ${expectedHash}`);
						return;
					}
				}

				await new Promise(resolve => setTimeout(resolve, pollInterval));
			} catch (error: any) {
				logger.warn(`[TxMonitor] Error checking transaction status for ${sourceTxHash}: ${error.message}`);
				await new Promise(resolve => setTimeout(resolve, pollInterval));
			}
		}

		throw new Error(`[TxMonitor] Transaction confirmation timeout for ${sourceTxHash}: ${expectedHash}`);
	}

	/**
	 * Wait for the auction listener to process our bid event
	 * @param swap The swap being bid on
	 * @param expectedBidAmount The amount we bid
	 * @param txHash The transaction hash of our bid
	 * @param previousAmount The previous highest bid amount
	 */
	private async waitForBidEvent(
		swap: Swap,
		expectedBidAmount: bigint,
		txHash: string,
		previousAmount: bigint
	): Promise<void> {
		const timeout = 10_000; // 10 seconds timeout
		const pollInterval = 100; // Check every 100ms
		const startTime = Date.now();
		const driverAddress = this.walletConfig.solana.publicKey.toString();
		const auctionListener = this.auctionFulfillerCfg.auctionListener;

		if (!auctionListener) {
			logger.warn(`[BidEvent] No auction listener available for ${swap.sourceTxHash}`);
			return;
		}

		logger.debug(`[BidEvent] Waiting for auction listener to process bid for ${swap.sourceTxHash}, expected amount: ${expectedBidAmount}`);

		while (Date.now() - startTime < timeout) {
			try {
				const auctionState = await auctionListener.getAuctionState(swap.auctionStateAddr, false);

				if (auctionState) {
					// Check if our bid was processed
					if (auctionState.amountPromised >= expectedBidAmount &&
						auctionState.winner === driverAddress &&
						auctionState.signature === txHash) {
						logger.info(`[BidEvent] ✅ Bid successfully processed for ${swap.sourceTxHash} - Amount: ${auctionState.amountPromised}, Winner: ${auctionState.winner.slice(0, 8)}...`);
						return;
					}

					// Check if someone else outbid us
					if (auctionState.amountPromised > expectedBidAmount &&
						auctionState.winner !== driverAddress) {
						logger.info(`[BidEvent] ⚠️ Outbid detected for ${swap.sourceTxHash} - Our bid: ${expectedBidAmount}, Current: ${auctionState.amountPromised}, Winner: ${auctionState.winner.slice(0, 8)}...`);
						return;
					}

					// Check if auction was closed
					if (auctionState.isClosed) {
						logger.info(`[BidEvent] 🔒 Auction closed for ${swap.sourceTxHash} - Final amount: ${auctionState.amountPromised}, Winner: ${auctionState.winner.slice(0, 8)}...`);
						return;
					}

					// Log progress if we're still waiting
					if (auctionState.amountPromised > previousAmount) {
						logger.debug(`[BidEvent] Progress detected for ${swap.sourceTxHash} - Amount updated to: ${auctionState.amountPromised}, Winner: ${auctionState.winner.slice(0, 8)}...`);
					}
				}

				await new Promise(resolve => setTimeout(resolve, pollInterval));
			} catch (error: any) {
				logger.warn(`[BidEvent] Error checking auction state for ${swap.sourceTxHash}: ${error.message}`);
				await new Promise(resolve => setTimeout(resolve, pollInterval));
			}
		}

		// Timeout reached - log final state
		try {
			const finalState = await auctionListener.getAuctionState(swap.auctionStateAddr, true);
			if (finalState) {
				logger.warn(`[BidEvent] ⏰ Timeout waiting for bid event ${swap.sourceTxHash} - Final state: Amount: ${finalState.amountPromised}, Winner: ${finalState.winner.slice(0, 8)}..., Closed: ${finalState.isClosed}`);
			} else {
				logger.warn(`[BidEvent] ⏰ Timeout waiting for bid event ${swap.sourceTxHash} - No auction state found`);
			}
		} catch (error: any) {
			logger.warn(`[BidEvent] ⏰ Timeout waiting for bid event ${swap.sourceTxHash} - Error getting final state: ${error.message}`);
		}
	}

	async registerOrder(swap: Swap) {
		let instructions = [];
		instructions.unshift(await this.getRegisterOrderFromSwap(swap));
		let signers = [this.walletConfig.solana];

		logger.info(`Sending register-order transaction for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			signers,
			[],
			this.rpcConfig.solana.sendCount,
			true,
			undefined,
			50_000,
		);
		logger.info(`Sent  register-order for ${swap.sourceTxHash} with ${hash}`);
	}

	async postBid(
		swap: Swap,
		createStateAss: boolean,
		postAuction: boolean,
		onlyTxData?: boolean,
		alreadyRegisteredWinner?: boolean,
		alreadyRegisteredOrder?: boolean,
	): Promise<{
		sequence?: bigint;
		instructions?: TransactionInstruction[];
		signers?: Array<Keypair>;
	} | null> {
		const stateAddr = this.getStateAddr(swap);

		const srcChain = swap.sourceChain;
		const dstChain = swap.destChain;
		const toToken = swap.toToken;

		let instructions: TransactionInstruction[] = [];
		let newMessageAccount: Keypair | null = null;
		const signers = [this.walletConfig.solana];

		if (!postAuction && swap.auctionMode === AUCTION_MODES.ENGLISH && !alreadyRegisteredWinner) {
			if (!alreadyRegisteredOrder) {
				instructions.push(await this.getRegisterOrderFromSwap(swap));
			}
			instructions.push(await this.getRegisterWinnerIx(swap));
		} else if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
			const auctionEmitter = PublicKey.findProgramAddressSync(
				[Buffer.from('emitter')],
				this.swiftAuctionProgram,
			)[0];

			const wormholeAccs = get_wormhole_core_accounts(auctionEmitter);

			let postAuctionIx: TransactionInstruction;
			if (this.globalConfig.postAuctionMode === 'SHIM') {
				postAuctionIx = await this.solanaIxService.getPostAuctionShimIx(
					this.walletConfig.solana.publicKey,
					new PublicKey(swap.auctionStateAddr),
					wormholeAccs.bridge_config,
					wormholeAccs.coreBridge,
					auctionEmitter,
					wormholeAccs.fee_collector,
					wormholeAccs.sequence_key,
					swap,
					swap.fromToken.decimals,
					tryNativeToUint8Array(this.walletsHelper.getDriverWallet(dstChain).address, dstChain),
				);
			} else {
				newMessageAccount = Keypair.generate();
				postAuctionIx = await this.solanaIxService.getPostAuctionIx(
					this.walletConfig.solana.publicKey,
					new PublicKey(swap.auctionStateAddr),
					wormholeAccs.bridge_config,
					wormholeAccs.coreBridge,
					auctionEmitter,
					wormholeAccs.fee_collector,
					wormholeAccs.sequence_key,
					newMessageAccount.publicKey,
					swap,
					swap.fromToken.decimals,
					tryNativeToUint8Array(this.walletsHelper.getDriverWallet(dstChain).address, dstChain),
				);
				signers.push(newMessageAccount!);
			}
			instructions.push(postAuctionIx);
		}

		let computeUnits: number = 50_000;
		if (createStateAss) {
			computeUnits = 65_000;
			const stateToAss = getAssociatedTokenAddressSync(
				new PublicKey(toToken.mint),
				stateAddr,
				true,
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);
			const createdAtaIx = createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);

			instructions.unshift(createdAtaIx);
		}

		if (postAuction) {
			computeUnits = 80_000;
		}

		if (!!onlyTxData) {
			return { instructions, signers };
		}

		logger.info(`Sending post bid transaction for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			signers,
			[],
			this.rpcConfig.solana.sendCount,
			true,
		);
		logger.info(`Sent post bid transaction for ${swap.sourceTxHash} with ${hash}`);

		if (postAuction) {
			let auctionState = await getAuctionState(this.solanaConnection, new PublicKey(swap.auctionStateAddr));

			while ((!auctionState || !auctionState.sequence)) {
				await delay(1500);
				auctionState = await getAuctionState(this.solanaConnection, new PublicKey(swap.auctionStateAddr));
			}

			return { sequence: auctionState.sequence - 1n };
		}
		return null;
	}

	private async getRegisterWinnerIx(swap: Swap): Promise<TransactionInstruction> {
		const stateAddr = this.getStateAddr(swap);
		const auctionAddr = new PublicKey(swap.auctionStateAddr);
		const registerWinnerIx = await this.solanaIxService.getRegisterWinnerIx(
			this.walletConfig.solana.publicKey,
			stateAddr,
			auctionAddr,
		);
		return registerWinnerIx;
	}

	async fulfill(
		swap: Swap,
		postAuctionSignedVaa?: Uint8Array,
		onlySolTrx?: boolean,
	): Promise<{
		instructions: TransactionInstruction[];
		lookupTables: AddressLookupTableAccount[];
		signers: Array<Keypair>;
	} | void> {
		const stateAddr = this.getStateAddr(swap);

		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: swap.gasless,
			auctionMode: swap.auctionMode,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			fromAmount: swap.fromAmount.toNumber(),
			gasDrop: swap.gasDrop.toNumber(),
			destAddress: swap.destAddress,
		}, swap.orderId);
		const effectiveAmntIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmntIn < 0) {
			logger.error(`effectiveAmountIn is less than 0
			${effectiveAmntIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}

		let driverToken: Token;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			driverToken = this.getDriverSolanaTokenForBidAndSwap(swap);
		} else {
			driverToken = this.getDriverEvmTokenForBidAndSwap(swap);
		}

		const fulfillAmount = await this.auctionFulfillerCfg.fulfillAmount(
			driverToken,
			effectiveAmntIn,
			swap,
			expenses,
		);

		const tBalanceCheckStart = Date.now();
		while (Date.now() - tBalanceCheckStart < this.globalConfig.waitForRebalanceTransferIfNeededSeconds * 1000) {
			if (await this.auctionFulfillerCfg.getTokenBalance(driverToken) >= fulfillAmount) {
				break;
			}
			await delay(100);
		}
		if (await this.auctionFulfillerCfg.getTokenBalance(driverToken) < fulfillAmount) {
			logger.error(`Not enough balance for fulfill ${swap.sourceTxHash}`);
			throw new Error(`Not enough balance for fulfill ${swap.sourceTxHash}`);
		}

		logger.info(`Fulfilling ${swap.sourceTxHash} with ${fulfillAmount} other: effective: ${effectiveAmntIn}, fromprice: ${expenses.fromTokenPrice}`);

		if (fulfillAmount > effectiveAmntIn) {
			sendLossAlert(swap.orderId, `${(fulfillAmount - effectiveAmntIn) * expenses.fromTokenPrice}`);
		}

		insertTransactionLog(
			DB_PATH,
			`${swap.sourceTxHash}__${swap.orderId}`,
			swap.sourceChain.toString(),
			swap.destChain.toString(),
			fulfillAmount * expenses.fromTokenPrice,
			effectiveAmntIn * expenses.fromTokenPrice,
			(fulfillAmount - effectiveAmntIn) * expenses.fromTokenPrice,
		);

		if (swap.destChain === CHAIN_ID_SOLANA) {
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));

			const stateToAss = getAssociatedTokenAddressSync(
				new PublicKey(toToken.mint),
				stateAddr,
				true,
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			); // already created via the instruction package in bid

			const trxData = await this.solanaFulfiller.getFulfillTransferTrxData(
				driverToken,
				stateAddr,
				stateToAss,
				fulfillAmount,
				realMinAmountOut,
				toToken,
				swap,
			);

			if (!!onlySolTrx) {
				return trxData;
			}

			logger.info(`Sending fulfill transaction for ${swap.sourceTxHash}`);
			const hash = await this.solanaSender.createAndSendOptimizedTransaction(
				trxData.instructions,
				trxData.signers,
				trxData.lookupTables,
				this.rpcConfig.solana.sendCount,
				true,
			);
			logger.info(`Sent fulfill transaction for ${swap.sourceTxHash} with ${hash}`);
		} else {
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));

			await this.evmFulFiller.fulfillAuctionOrSimple(
				swap,
				fulfillAmount,
				toToken,
				dstChain,
				driverToken,
				realMinAmountOut,
				expenses.dstGasPrice,
				postAuctionSignedVaa,
			);
		}
	}

	async settle(swap: Swap, onlyTxData?: boolean): Promise<{ instructions: TransactionInstruction[] } | void> {
		const stateAddr = this.getStateAddr(swap);
		const to = new PublicKey(swap.destAddress);

		const toToken = swap.toToken;
		const toMint = new PublicKey(toToken.mint);

		const mayanAndReferrerAssInfo = this.getMayanAndReferrerFeeAssesInstructions(
			swap.mayanBps,
			swap.referrerBps,
			swap.referrerAddress,
			swap.destChain,
			toMint,
			toToken.standard === 'spl2022',
		);

		let instructions: TransactionInstruction[] = [];
		for (let ix of mayanAndReferrerAssInfo.ixs) {
			instructions.push(ix);
		}

		const stateToAss = getAssociatedTokenAddressSync(
			toMint,
			stateAddr,
			true,
			toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
		);

		let toAss = null;
		if (swap.toToken.contract !== '0x0000000000000000000000000000000000000000') {
			toAss = getAssociatedTokenAddressSync(
				toMint,
				to,
				true,
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);
			// pure sol doesnt require creating an ata for the user
			instructions.push(
				createAssociatedTokenAccountIdempotentInstruction(
					this.walletConfig.solana.publicKey,
					toAss,
					to,
					toMint,
					toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
				),
			);
		}

		const settleIx = await this.solanaIxService.getSettleIx(
			this.walletConfig.solana.publicKey,
			stateAddr,
			stateToAss,
			to,
			toAss,
			mayanAndReferrerAssInfo.mayan,
			mayanAndReferrerAssInfo.mayanAss,
			toMint,
			new PublicKey(swap.referrerAddress),
			mayanAndReferrerAssInfo.referrerAss,
			toToken.standard === 'spl2022',
			!toToken.hasTransferFee,
		);
		instructions.push(settleIx);

		if (!!onlyTxData) {
			return { instructions };
		}

		logger.info(`Sending settle transaction for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			[this.walletConfig.solana],
			[],
			this.rpcConfig.solana.sendCount,
			true,
		);
		logger.info(`Sent settle transaction for ${swap.sourceTxHash} with ${hash}`);
	}

	async solanaFulfillAndSettlePackage(swap: Swap) {
		logger.info(`Getting simple-mode fulfill-settle package for ${swap.sourceTxHash}`);
		const [postBidData, fulfillData, settleData] = await Promise.all([
			this.postBid(swap, true, false, true),
			this.fulfill(swap, undefined, true),
			this.settle(swap, true),
		]);

		let finalInstructions: TransactionInstruction[] = [];
		finalInstructions.push(...postBidData!.instructions!);
		finalInstructions.push(...fulfillData!.instructions!);
		finalInstructions.push(...settleData!.instructions!);
		logger.info(`Sending fulfill-settle package for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			finalInstructions,
			[this.walletConfig.solana, ...postBidData?.signers!, ...fulfillData?.signers!],
			fulfillData!.lookupTables,
			this.rpcConfig.solana.sendCount,
			true,
		);
		logger.info(`Sent fulfill-settle package for ${swap.sourceTxHash} with ${hash}`);
	}

	async solanaFulfillAndSettleJitoBundle(swap: Swap) {
		logger.info(`Getting jito fulfill-settle package for ${swap.sourceTxHash}`);
		const [postBidData, fulfillData, settleData] = await Promise.all([
			this.postBid(swap, true, false, true),
			this.fulfill(swap, undefined, true),
			this.settle(swap, true),
		]);

		logger.info(`Sending jito fulfill-settle package for ${swap.sourceTxHash}`);
		await this.solanaSender.createAndSendJitoBundle(
			[
				{
					instructions: postBidData!.instructions!,
					signers: postBidData!.signers!,
					lookupTables: [],
				},
				{
					instructions: fulfillData!.instructions!,
					signers: fulfillData!.signers!,
					lookupTables: fulfillData!.lookupTables,
				},
				{
					instructions: [...settleData!.instructions!],
					signers: [],
					lookupTables: [],
				},
			],
			4,
		);
		logger.info(`Sent jito fulfill-settle package for ${swap.sourceTxHash}`);
	}
}
