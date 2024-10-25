import {
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
	AddressLookupTableAccount,
	Connection,
	Keypair,
	MessageV0,
	PublicKey,
	TransactionInstruction,
	VersionedTransaction,
} from '@solana/web3.js';
import { AuctionFulfillerConfig } from '../auction';
import { CHAIN_ID_SOLANA, CHAIN_ID_SUI, isEVMChainId, WORMHOLE_DECIMALS } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { SimpleFulfillerConfig } from '../simple';
import { Swap } from '../swap.dto';
import { tryNativeToUint8Array } from '../utils/buffer';
import { FeeService } from '../utils/fees';
import logger from '../utils/logger';
import { SolanaMultiTxSender } from '../utils/solana-trx';
import { AUCTION_MODES } from '../utils/state-parser';
import { delay } from '../utils/util';
import { get_wormhole_core_accounts, getWormholeSequenceFromPostedMessage } from '../utils/wormhole';
import { EvmFulfiller } from './evm';
import { SolanaFulfiller } from './solana';
import { NewSolanaIxHelper } from './solana-ix';
import { SuiFulfiller } from './sui';
import { WalletsHelper } from './wallet-helper';

export class DriverService {
	private readonly swiftProgram: PublicKey;
	private readonly swiftAuctionProgram: PublicKey;
	constructor(
		private readonly simpleFulfillerCfg: SimpleFulfillerConfig,
		private readonly auctionFulfillerCfg: AuctionFulfillerConfig,
		private readonly solanaConnection: Connection,
		private readonly walletConfig: WalletConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly contractsConfig: ContractsConfig,
		private readonly solanaIxService: NewSolanaIxHelper,
		private readonly feeService: FeeService,
		private readonly solanaFulfiller: SolanaFulfiller,
		private readonly walletsHelper: WalletsHelper,
		private readonly evmFulFiller: EvmFulfiller,
		private readonly suiFulfiller: SuiFulfiller,
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

	getDriverSuiTokenForBidAndSwap(srcChain: number, fromToken: Token): Token {
		const fromNativeUSDT = this.tokenList.getNativeUsdt(srcChain);
		const fromNativeUSDC = this.tokenList.getNativeUsdc(srcChain);

		if (fromToken.contract === fromNativeUSDC?.contract || fromToken.contract === fromNativeUSDT?.contract) {
			return this.tokenList.getNativeUsdc(CHAIN_ID_SUI)!;
		} else {
			throw new Error(`Unsupported input token ${fromToken.contract} for sui driver! not bidding or swapping`);
		}
	}

	async bid(swap: Swap, registerOrder: boolean): Promise<void> {
		const srcChain = swap.sourceChain;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;
		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: swap.gasless,
			auctionMode: AUCTION_MODES.ENGLISH,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
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
		} else if (dstChain === CHAIN_ID_SUI) {
			driverToken = this.getDriverSuiTokenForBidAndSwap(srcChain, fromToken);
		} else if (isEVMChainId(dstChain)) {
			driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
		} else {
			throw new Error(`Unsupported dest chain ${dstChain} for driver! not bidding or swapping`);
		}
		let normalizedBidAmount = await this.auctionFulfillerCfg.normalizedBidAmount(
			driverToken,
			effectiveAmountIn,
			swap,
			expenses,
		);

		if (normalizedBidAmount < normalizedMinAmountOut) {
			logger.error(
				`Shall not bid on tx: ${swap.sourceTxHash} because 
				${normalizedBidAmount} is less than min amount out ${normalizedMinAmountOut}`,
			);
			throw new Error('`Shall not bid on tx because bid amount is less than min amount out`');
		}

		const bidIx = await this.solanaIxService.getBidIx(
			this.walletConfig.solana.publicKey,
			new PublicKey(swap.auctionStateAddr),
			normalizedBidAmount,
			swap,
			fromToken.decimals,
		);

		let instructions = [bidIx];
		if (registerOrder) {
			instructions.unshift(await this.getRegisterOrderFromSwap(swap));
		}
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

	async postBid(
		swap: Swap,
		createStateAss: boolean,
		postAuction: boolean,
		onlyTxData?: boolean,
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
		if (!postAuction) {
			instructions.push(await this.getRegisterWinnerIx(swap));
		} else {
			const auctionEmitter = PublicKey.findProgramAddressSync(
				[Buffer.from('emitter')],
				this.swiftAuctionProgram,
			)[0];

			const wormholeAccs = get_wormhole_core_accounts(auctionEmitter);
			newMessageAccount = Keypair.generate();

			let driverWallet32: Uint8Array;
			if (isEVMChainId(dstChain)) {
				driverWallet32 = tryNativeToUint8Array(this.walletsHelper.getDriverWallet(dstChain).address, dstChain);
			} else if (dstChain === CHAIN_ID_SUI) {
				driverWallet32 = Buffer.from(this.walletConfig.sui.getPublicKey().toSuiAddress().slice(2), 'hex');
			} else {
				throw new Error(`Unsupported dest chain ${dstChain} for driver! not bidding or swapping`);
			}
			const postAuctionIx = await this.solanaIxService.getPostAuctionIx(
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
				driverWallet32,
			);
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

		const signers = [this.walletConfig.solana];
		if (postAuction) {
			computeUnits = 80_000;
			signers.push(newMessageAccount!);
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
			undefined,
			computeUnits,
		);
		logger.info(`Sent post bid transaction for ${swap.sourceTxHash} with ${hash}`);

		if (postAuction) {
			let whMessageInfo = await this.solanaConnection.getAccountInfo(newMessageAccount!.publicKey);

			while (!whMessageInfo || !whMessageInfo.data) {
				await delay(1500);
				whMessageInfo = await this.solanaConnection.getAccountInfo(newMessageAccount!.publicKey);
			}

			return { sequence: getWormholeSequenceFromPostedMessage(whMessageInfo.data) };
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

	async simpleFulFillEvm(swap: Swap) {
		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: swap.gasless,
			auctionMode: AUCTION_MODES.DONT_CARE,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmountIn < swap.minAmountOut.toNumber()) {
			await delay(2000);
			throw new Error(`Can not fulfill ${swap.sourceTxHash} on evm. min amount out issue`);
		}

		const fulfillAmount = await this.simpleFulfillerCfg.fulfillAmount(swap, effectiveAmountIn, expenses);

		await this.evmFulFiller.simpleFulfill(swap, fulfillAmount, toToken);
	}

	async getSimpleFulfillIxsPackage(swap: Swap): Promise<TransactionInstruction[]> {
		const stateAddr = this.getStateAddr(swap);

		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: swap.gasless,
			auctionMode: AUCTION_MODES.DONT_CARE,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn = swap.fromAmount.toNumber() - expenses.fulfillAndUnlock;

		if (effectiveAmountIn < swap.minAmountOut.toNumber()) {
			await delay(2000);
			throw new Error(`Can not fulfill ${swap.sourceTxHash} on solana. min amount out issue`);
		}

		const fulfillAmount = await this.simpleFulfillerCfg.fulfillAmount(swap, effectiveAmountIn, expenses);

		const stateToAss = getAssociatedTokenAddressSync(
			new PublicKey(toToken.mint),
			stateAddr,
			true,
			toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
		);

		let result: TransactionInstruction[] = [];
		result.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			),
		);
		const fulfillIxs = await this.solanaFulfiller.getSimpleFulfillIxPackage(
			this.swiftProgram,
			stateAddr,
			stateToAss,
			toToken,
			fulfillAmount,
			swap,
		);
		result.push(...fulfillIxs);

		return result;
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
			auctionMode: AUCTION_MODES.ENGLISH,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
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
		} else if (swap.destChain === CHAIN_ID_SUI) {
			driverToken = this.getDriverSuiTokenForBidAndSwap(srcChain, fromToken);
		} else if (isEVMChainId(swap.destChain)) {
			driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
		} else {
			throw new Error(`Unsupported dest chain ${dstChain} for driver! not bidding or swapping`);
		}

		const fulfillAmount = await this.auctionFulfillerCfg.fulfillAmount(
			driverToken,
			effectiveAmntIn,
			swap,
			expenses,
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
		} else if (swap.destChain === CHAIN_ID_SUI) {
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));
			await this.suiFulfiller.fulfillAuction(
				swap,
				fulfillAmount,
				toToken,
				driverToken,
				postAuctionSignedVaa!,
				realMinAmountOut,
			);
		} else if (isEVMChainId(swap.destChain)) {
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));

			await this.evmFulFiller.fulfillAuction(
				swap,
				fulfillAmount,
				toToken,
				dstChain,
				driverToken,
				postAuctionSignedVaa!,
				realMinAmountOut,
			);
		} else {
			throw new Error(`Unsupported dest chain ${dstChain} for driver! not bidding or swapping`);
		}
	}

	async auctionLessFulfillAndSettleSolana(swap: Swap): Promise<string> {
		const registerOrderIx = await this.getRegisterOrderFromSwap(swap);
		const fulfillIxs = await this.getSimpleFulfillIxsPackage(swap);
		const settleIxs = await this.getSettleIxsPackage(swap);

		let instructions = [registerOrderIx, ...fulfillIxs, ...settleIxs];

		logger.info(`Sending noacution settle transaction for ${swap.sourceTxHash}`);
		const hash = await this.solanaSender.createAndSendOptimizedTransaction(
			instructions,
			[this.walletConfig.solana],
			[],
			this.rpcConfig.solana.sendCount,
			true,
		);
		logger.info(`Sent noauction settle transaction for ${swap.sourceTxHash} with ${hash}`);
		return hash;
	}

	async getSettleIxsPackage(swap: Swap): Promise<TransactionInstruction[]> {
		const stateAddr = this.getStateAddr(swap);
		const to = new PublicKey(swap.destAddress);

		const toToken = swap.toToken;
		const toMint = new PublicKey(toToken.mint);

		let instructions: TransactionInstruction[] = [];

		const stateToAss = getAssociatedTokenAddressSync(
			toMint,
			stateAddr,
			true,
			toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
		);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			),
		);

		const mayanAndReferrerAssInfo = this.getMayanAndReferrerFeeAssesInstructions(
			swap.mayanBps,
			swap.referrerBps,
			swap.referrerAddress,
			swap.destChain,
			toMint,
			toToken.standard === 'spl2022',
		);
		for (let ix of mayanAndReferrerAssInfo.ixs) {
			instructions.push(ix);
		}

		const toAss = getAssociatedTokenAddressSync(
			toMint,
			to,
			true,
			toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
		);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				toAss,
				to,
				new PublicKey(toMint),
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			),
		);

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

		return [...instructions, settleIx];
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
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				toMint,
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			),
		);

		const toAss = getAssociatedTokenAddressSync(
			toMint,
			to,
			true,
			toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
		);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				toAss,
				to,
				toMint,
				toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			),
		);

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

	async auctionFulfillAndSettlePackage(swap: Swap) {
		logger.info(`Getting swapless fulfill-settle package for ${swap.sourceTxHash}`);
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
			undefined,
			220_000,
		);
		logger.info(`Sent fulfill-settle package for ${swap.sourceTxHash} with ${hash}`);
	}

	async auctionFulfillAndSettleJitoBundle(swap: Swap) {
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

	async submitGaslessOrder(swap: Swap) {
		await this.evmFulFiller.submitGaslessOrder(swap);
	}

	async doTransaction(
		payerKey?: PublicKey,
		instructions?: TransactionInstruction[],
		signers?: Keypair[],
		context?: string,
		rawTrx?: Buffer | Uint8Array,
		retry: number = 0,
	): Promise<string> {
		let trxHash;
		try {
			let serializedTrx: Buffer | Uint8Array;
			if (!!rawTrx) {
				serializedTrx = rawTrx;
			} else {
				const { blockhash } = await this.solanaConnection.getLatestBlockhash();
				const msg = MessageV0.compile({
					payerKey: payerKey!,
					instructions: instructions!,
					recentBlockhash: blockhash,
				});

				const trx = new VersionedTransaction(msg);
				trx.sign(signers!);
				serializedTrx = trx.serialize();
			}

			logger.info(`Sending transaction for ${context} with hash: ${trxHash}`);

			const newTxHash = await this.solanaSender.sendAndConfirmTransaction(
				serializedTrx,
				this.rpcConfig.solana.sendCount,
				'confirmed',
			);

			logger.info(`Sent transaction for ${context} with hash: ${newTxHash}`);
			return newTxHash;
		} catch (err: any) {
			if (retry < 2 && err.message == 'CONFIRM_TIMED_OUT') {
				logger.warn(
					`Sending swift transaction for ${context} with
					hash: ${trxHash} failed cause confirm timed out, retrying`,
				);
				return await this.doTransaction(payerKey, instructions, signers, context, rawTrx, retry + 1);
			} else if (retry < 3 && err.name == 'TransactionExpiredBlockheightExceededError' && !rawTrx) {
				logger.warn(
					`Sending swift transaction for ${context} with
					hash: ${trxHash} failed cause blockheight exceed, retrying ${err.name}`,
				);
				return await this.doTransaction(payerKey, instructions, signers, context, rawTrx, retry + 1);
			} else {
				logger.error(`Sending swift transaction failed ${err}`);
				throw err;
			}
		}
	}
}
