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

	getDriverEvmTokenForBidAndSwap(srcChain: number, destChain: number, fromToken: Token): Token {
		const fromNativeUSDT = this.tokenList.getNativeUsdt(srcChain);
		const fromNativeUSDC = this.tokenList.getNativeUsdc(srcChain);
		const fromEth = this.tokenList.getEth(srcChain);
		const fromSolWeth = srcChain === CHAIN_ID_SOLANA ? this.tokenList.getWethSol() : null;

		if (fromToken.contract === fromNativeUSDC?.contract || fromToken.contract === fromNativeUSDT?.contract) {
			const destUsdc = this.tokenList.getNativeUsdc(destChain);
			const destUsdt = this.tokenList.getNativeUsdt(destChain);
			if (!destUsdc && !destUsdt) {
				throw new Error(`Stable token not found on ${destChain} for driver! not bidding or swapping`);
			}

			return (destUsdc || destUsdt)!;
		} else if (fromToken.contract === fromEth?.contract || fromToken.contract === fromSolWeth?.contract) {
			return this.tokenList.getEth(destChain)!;
		} else {
			throw new Error(
				`Unsupported input token ${fromToken.contract} on
				${srcChain} for driver! not bidding or swapping`,
			);
		}
	}

	getDriverSolanaTokenForBidAndSwap(srcChain: number, fromToken: Token): Token {
		const fromNativeUSDT = this.tokenList.getNativeUsdt(srcChain);
		const fromNativeUSDC = this.tokenList.getNativeUsdc(srcChain);
		const fromEth = this.tokenList.getEth(srcChain);

		if (fromToken.contract === fromNativeUSDC?.contract || fromToken.contract === fromNativeUSDT?.contract) {
			return this.tokenList.getNativeUsdc(CHAIN_ID_SOLANA)!;
		} else if (fromToken.contract === fromEth?.contract) {
			return this.tokenList.getWethSol();
		} else {
			throw new Error(`Unsupported input token ${fromToken.contract} for driver! not bidding or swapping`);
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
		});
		const effectiveAmountIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmountIn < 0) {
			logger.error(`effectiveAmountIn is less than 0 ${effectiveAmountIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}

		let driverToken: Token;
		if (dstChain === CHAIN_ID_SOLANA) {
			driverToken = this.getDriverSolanaTokenForBidAndSwap(srcChain, fromToken);
		} else {
			driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
		}

		let isDriverTokenUSDC = driverToken.contract === this.tokenList.getNativeUsdc(dstChain)?.contract;
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

		logger.info(`Sending bid transaction for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			signers,
			[],
			this.rpcConfig.solana.sendCount,
			true,
			undefined,
			70_000,
		);
		logger.info(`Sent bid transaction for ${swap.sourceTxHash} with ${hash}`);
	}

	async bidM0Swap(swap: Swap): Promise<void> {
		let ratio = 0.99;
		let amountOut = swap.fromAmount.toNumber() * ratio * 10 ** 6;
		swap.bidAmountIn = swap.fromAmount.toNumber() * ratio;

		if (amountOut < swap.minAmountOut64) {
			logger.info(`Shall not bid on tx: ${swap.sourceTxHash} because amountOut ${amountOut} is less than minAmountOut ${swap.minAmountOut64} for m0 swap`);
			throw new Error(`Shall not bid on tx: ${swap.sourceTxHash} because amountOut ${amountOut} is less than minAmountOut ${swap.minAmountOut64} for m0 swap`);
		}

		logger.info(`///////// bidM0Swap ${swap.sourceTxHash} amountOut ${amountOut} for m0 swap, swap: ${swap.destAddress} ${swap.destChain} ${swap.toToken.contract}`);

		let balance = await this.auctionFulfillerCfg.getTokenBalance(swap.toToken);
		if (balance < amountOut) {
			logger.info(`Shall not bid on tx: ${swap.sourceTxHash} because balance ${balance} is less than amountOut ${amountOut} for m0 swap`);
			throw new Error(`Shall not bid on tx: ${swap.sourceTxHash} because balance ${balance} is less than amountOut ${amountOut} for m0 swap`);
		}

		logger.info(`///////// before bidIx ${swap.sourceTxHash}`);

		const bidIx = await this.solanaIxService.getBidIx(
			this.walletConfig.solana.publicKey,
			new PublicKey(swap.auctionStateAddr),
			BigInt(amountOut),
			swap,
			6,
		);

		let instructions = [bidIx];
		let signers = [this.walletConfig.solana];

		logger.info(`Sending bid transaction for ${swap.sourceTxHash} for m0 swap`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			signers,
			[],
			this.rpcConfig.solana.sendCount,
			true,
			undefined,
			70_000,
		);
		logger.info(`Sent bid transaction for ${swap.sourceTxHash} with ${hash} for m0 swap`);
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
		});
		const effectiveAmntIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmntIn < 0) {
			logger.error(`effectiveAmountIn is less than 0
			${effectiveAmntIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}

		let driverToken: Token;
		if (swap.destChain === CHAIN_ID_SOLANA) {
			driverToken = this.getDriverSolanaTokenForBidAndSwap(srcChain, fromToken);
		} else {
			driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
		}

		const fulfillAmount = await this.auctionFulfillerCfg.fulfillAmount(
			driverToken,
			effectiveAmntIn,
			swap,
			expenses,
		);
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
