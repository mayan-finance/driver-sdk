import {
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
	getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import {
	Connection,
	Keypair,
	MessageV0,
	PublicKey,
	TransactionInstruction,
	VersionedTransaction,
} from '@solana/web3.js';
import Decimal from 'decimal.js';
import { ethers } from 'ethers';
import { CHAIN_ID_SOLANA, WORMHOLE_DECIMALS } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { Token, TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { Swap } from '../swap.dto';
import { hexToUint8Array, tryNativeToUint8Array } from '../utils/buffer';
import logger from '../utils/logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from '../utils/solana-trx';
import { AUCTION_MODES } from '../utils/state-parser';
import { delay } from '../utils/util';
import { getWormholeSequenceFromPostedMessage, get_wormhole_core_accounts } from '../utils/wormhole';
import { EvmFulfiller } from './evm';
import { SolanaFulfiller } from './solana';
import { SolanaIxHelper } from './solana-ix-helper';
import { WalletsHelper } from './wallet-helper';
import { FeeService } from '../utils/fees';

export class DriverService {
	private readonly swiftProgram: PublicKey;
	private readonly swiftAuctionProgram: PublicKey;
	constructor(
		private readonly solanaConnection: Connection,
		private readonly walletConfig: WalletConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly contractsConfig: ContractsConfig,
		private readonly solanaIxService: SolanaIxHelper,
		private readonly priorityFeeHelper: PriorityFeeHelper,
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

	getAuctionStateAddr(stateAddr: PublicKey): PublicKey {
		return PublicKey.findProgramAddressSync(
			[Buffer.from('AUCTION'), stateAddr.toBytes()],
			this.swiftAuctionProgram,
		)[0];
	}

	getStateAddr(swap: Swap): PublicKey {
		if (swap.stateAddr) {
			return new PublicKey(swap.stateAddr);
		} else {
			return PublicKey.findProgramAddressSync(
				[Buffer.from('STATE'), hexToUint8Array(swap.orderHash)],
				this.swiftProgram,
			)[0];
		}
	}

	getMayanAndReferrerFeeAssesInstructions(
		mayanBps: number,
		referrerBps: number,
		referrerAddress: string,
		destChain: number,
		toTokenMint: PublicKey,
		stateAddr: PublicKey,
	): { ixs: TransactionInstruction[]; mayanAss: PublicKey; referrerAss: PublicKey } {
		let result: {
			ixs: TransactionInstruction[];
			mayanAss: PublicKey;
			referrerAss: PublicKey;
		} = {
			ixs: [],
			mayanAss: stateAddr,
			referrerAss: stateAddr,
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
			);
			result.ixs.push(
				createAssociatedTokenAccountIdempotentInstruction(
					this.walletConfig.solana.publicKey,
					mayanFeeAss,
					new PublicKey(this.contractsConfig.feeCollectorSolana),
					toTokenMint,
				),
			);
			result.mayanAss = mayanFeeAss;
		}

		if (referrerBps !== 0) {
			const referrerFeeAss = getAssociatedTokenAddressSync(toTokenMint, new PublicKey(referrer), true);
			result.ixs.push(
				createAssociatedTokenAccountIdempotentInstruction(
					this.walletConfig.solana.publicKey,
					referrerFeeAss,
					new PublicKey(referrer),
					toTokenMint,
				),
			);
			result.referrerAss = referrerFeeAss;
		}

		return result;
	}

	async getMayanAndReferrerFeeAsses(
		mayanBps: number,
		referrerBps: number,
		referrerAddress: string,
		destChain: number,
		toTokenMint: PublicKey,
		stateAddr: PublicKey,
	): Promise<[PublicKey, PublicKey]> {
		let referrer: string | Uint8Array = referrerAddress;
		if (referrer.length === 44) {
			referrer = tryNativeToUint8Array(referrer as string, destChain);
		}

		let mayanFeeAss: PublicKey;
		if (mayanBps !== 0) {
			mayanFeeAss = (
				await getOrCreateAssociatedTokenAccount(
					this.solanaConnection,
					this.walletConfig.solana,
					toTokenMint,
					new PublicKey(this.contractsConfig.feeCollectorSolana),
					true,
				)
			).address;
		} else {
			mayanFeeAss = stateAddr;
		}

		let referrerAss: PublicKey;
		if (referrerBps !== 0) {
			referrerAss = (
				await getOrCreateAssociatedTokenAccount(
					this.solanaConnection,
					this.walletConfig.solana,
					toTokenMint,
					new PublicKey(referrer),
					true,
				)
			).address;
		} else {
			referrerAss = stateAddr;
		}

		return [mayanFeeAss, referrerAss];
	}

	getRegisterOrderFromSwap(swap: Swap): TransactionInstruction {
		const stateAddr = this.getStateAddr(swap);
		const fromToken = swap.fromToken;

		const instruction = this.solanaIxService.getRegisterOrderIx(
			this.swiftProgram,
			stateAddr,
			this.walletConfig.solana.publicKey,
			swap.sourceChain,
			swap.destChain,
			swap.trader,
			swap.destAddress,
			swap.fromTokenAddress,
			fromToken.decimals,
			swap.fromAmount.toFixed(swap.fromToken.decimals, Decimal.ROUND_DOWN),
			swap.toTokenAddress,
			swap.toToken.decimals,
			swap.minAmountOut.toFixed(Math.min(WORMHOLE_DECIMALS, swap.toToken.decimals), Decimal.ROUND_DOWN),
			swap.randomKey,
			swap.referrerAddress,
			swap.gasDrop.toFixed(WORMHOLE_DECIMALS, Decimal.ROUND_DOWN),
			swap.auctionMode,
			swap.mayanBps,
			swap.referrerBps,
			swap.orderHash,
			ethers.parseUnits(
				swap.refundRelayerFee.toFixed(Math.min(8, fromToken.decimals), Decimal.ROUND_DOWN),
				Math.min(WORMHOLE_DECIMALS, fromToken.decimals),
			),
			ethers.parseUnits(
				swap.redeemRelayerFee.toFixed(Math.min(8, fromToken.decimals), Decimal.ROUND_DOWN), // redeem relayer fee is considered as dst refund fee for swifts
				Math.min(WORMHOLE_DECIMALS, fromToken.decimals),
			),
			BigInt(Math.floor(swap.deadline.getTime() / 1000)),
		);
		return instruction;
	}

	async registerOrder(swap: Swap): Promise<void> {
		const instruction = this.getRegisterOrderFromSwap(swap);
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(
			instruction.keys.map((accMeta) => accMeta.pubkey.toString()),
		);

		let instructions = [priorityFeeIx, instruction];

		await this.doTransaction(
			this.walletConfig.solana.publicKey,
			instructions,
			[this.walletConfig.solana],
			`register_order_${swap.sourceTxHash}`,
		);
	}

	getDriverEvmTokenForBidAndSwap(srcChain: number, destChain: number, fromToken: Token): Token {
		const fromNativeUSDC = this.tokenList.getNativeUsdc(srcChain);
		const fromEth = this.tokenList.getEth(srcChain);

		if (fromToken.contract === fromNativeUSDC?.contract) {
			return this.tokenList.getNativeUsdc(destChain)!;
		} else if (fromToken.contract === fromEth?.contract) {
			return this.tokenList.getEth(destChain)!;
		} else {
			throw new Error(
				`Unsupported input token ${fromToken.contract} on
				${srcChain} for driver! not bidding or swapping`,
			);
		}
	}

	getDriverSolanaTokenForBidAndSwap(srcChain: number, fromToken: Token): Token {
		const fromNativeUSDC = this.tokenList.getNativeUsdc(srcChain);
		const fromEth = this.tokenList.getEth(srcChain);

		if (fromToken.contract === fromNativeUSDC?.contract) {
			return this.tokenList.getNativeUsdc(CHAIN_ID_SOLANA)!;
		} else if (fromToken.contract === fromEth?.contract) {
			return this.tokenList.getWethSol();
		} else {
			throw new Error(`Unsupported input token ${fromToken.contract} for driver! not bidding or swapping`);
		}
	}

	async bid(
		swap: Swap,
		createStateAss: boolean,
		registerOrder: boolean,
		postAuction: boolean,
	): Promise<bigint | undefined> {
		const stateAddr = this.getStateAddr(swap);

		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;
		const normalizedMinAmountOut = BigInt(swap.minAmountOut64);

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: !!swap.gaslessSignature,
			auctionMode: AUCTION_MODES.ENGLISH,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn =
			swap.fromAmount.toNumber() - expenses.fulfillCost - expenses.unlockSource - expenses.submissionCost;

		if (effectiveAmountIn < 0) {
			logger.error(`effectiveAmountIn is less than 0 ${effectiveAmountIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}

		const effectiveAmountInDriverToken = effectiveAmountIn;

		let normalizedBidAmount: bigint;
		if (dstChain === CHAIN_ID_SOLANA) {
			const driverToken = this.getDriverSolanaTokenForBidAndSwap(srcChain, fromToken);
			normalizedBidAmount = await this.solanaFulfiller.getNormalizedBid(
				driverToken,
				effectiveAmountInDriverToken * 0.95,
				normalizedMinAmountOut,
				toToken,
			);
		} else {
			const driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
			normalizedBidAmount = await this.evmFulFiller.getNormalizedBid(
				dstChain,
				driverToken,
				effectiveAmountInDriverToken * 0.95,
				normalizedMinAmountOut,
				toToken,
			);
		}

		if (normalizedBidAmount < normalizedMinAmountOut) {
			logger.error(
				`Shall not bid on tx: ${swap.sourceTxHash} because 
				${normalizedBidAmount} is less than min amount out ${normalizedMinAmountOut}`,
			);
			throw new Error('`Shall not bid on tx because bid amount is less than min amount out`');
		}

		const bidIx = this.solanaIxService.getBidIx(
			this.swiftAuctionProgram,
			normalizedBidAmount,
			stateAddr,
			this.walletConfig.solana.publicKey,
			this.walletConfig.solana.publicKey,
		);

		let instructions = [bidIx];
		let newMessageAccount: Keypair | null = null;
		if (!postAuction) {
			instructions.push(this.getRegisterWinnerIx(swap));
		} else {
			const auctionEmitter = PublicKey.findProgramAddressSync(
				[Buffer.from('emitter')],
				this.swiftAuctionProgram,
			)[0];

			const wormholeAccs = await get_wormhole_core_accounts(auctionEmitter);
			newMessageAccount = Keypair.generate();

			const postAuctionIx = this.solanaIxService.getPostAuctionIx(
				this.swiftAuctionProgram,
				stateAddr,
				this.walletConfig.solana.publicKey,
				this.walletConfig.solana.publicKey,
				auctionEmitter,
				wormholeAccs.sequence_key,
				newMessageAccount.publicKey,
				wormholeAccs.bridge_config,
				wormholeAccs.fee_collector,
				tryNativeToUint8Array(this.walletsHelper.getDriverWallet(srcChain).address, dstChain),
				wormholeAccs.coreBridge,
			);
			instructions.push(postAuctionIx);
		}

		if (createStateAss) {
			const stateToAss = getAssociatedTokenAddressSync(new PublicKey(toToken.mint), stateAddr, true);
			const createdAtaIx = createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
			);

			instructions.unshift(createdAtaIx);
		}

		if (registerOrder) {
			instructions.unshift(this.getRegisterOrderFromSwap(swap));
		}

		let keyAccs = [];
		for (let ix of instructions) {
			for (const key of ix.keys) {
				keyAccs.push(key.pubkey.toString());
			}
		}
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(keyAccs);
		instructions.unshift(priorityFeeIx);

		let signers = [this.walletConfig.solana];
		if (postAuction) {
			signers.push(newMessageAccount!);
		}
		await this.doTransaction(this.walletConfig.solana.publicKey, instructions, signers, `bid_${swap.sourceTxHash}`);

		if (postAuction) {
			let whMessageInfo = await this.solanaConnection.getAccountInfo(newMessageAccount!.publicKey);

			while (!whMessageInfo || !whMessageInfo.data) {
				await delay(1500);
				whMessageInfo = await this.solanaConnection.getAccountInfo(newMessageAccount!.publicKey);
			}

			return getWormholeSequenceFromPostedMessage(whMessageInfo.data);
		}
	}

	private getRegisterWinnerIx(swap: Swap): TransactionInstruction {
		const stateAddr = this.getStateAddr(swap);
		const auctionAddr = this.getAuctionStateAddr(stateAddr);
		const registerWinnerIx = this.solanaIxService.getRegisterWinnerIx(this.swiftProgram, stateAddr, auctionAddr);
		return registerWinnerIx;
	}

	async registerAsWinner(swap: Swap): Promise<void> {
		const registerWinnerIx = this.getRegisterWinnerIx(swap);
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(
			registerWinnerIx.keys.map((accMeta) => accMeta.pubkey.toString()),
		);
		let instructions = [priorityFeeIx, registerWinnerIx];

		await this.doTransaction(
			this.walletConfig.solana.publicKey,
			instructions,
			[this.walletConfig.solana],
			`register_winner_${swap.sourceTxHash}`,
		);
	}

	async simpleFulFillEvm(swap: Swap) {
		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: !!swap.gaslessSignature,
			auctionMode: AUCTION_MODES.DONT_CARE,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn =
			swap.fromAmount.toNumber() - expenses.fulfillCost - expenses.unlockSource - expenses.submissionCost;

		if (effectiveAmountIn < swap.minAmountOut.toNumber()) {
			await delay(2000);
			throw new Error(`Can not fulfill ${swap.sourceTxHash} on evm. min amount out issue`);
		}

		await this.evmFulFiller.simpleFulfill(swap, effectiveAmountIn, toToken);
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
			isGasless: !!swap.gaslessSignature,
			auctionMode: AUCTION_MODES.DONT_CARE,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn =
			swap.fromAmount.toNumber() - expenses.fulfillCost - expenses.unlockSource - expenses.submissionCost;

		if (effectiveAmountIn < swap.minAmountOut.toNumber()) {
			await delay(2000);
			throw new Error(`Can not fulfill ${swap.sourceTxHash} on solana. min amount out issue`);
		}

		const stateToAss = getAssociatedTokenAddressSync(new PublicKey(toToken.mint), stateAddr, true);

		let result: TransactionInstruction[] = [];
		result.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
			),
		);
		const fulfillIxs = await this.solanaFulfiller.getSimpleFulfillIxPackage(
			this.swiftProgram,
			stateAddr,
			stateToAss,
			toToken,
			effectiveAmountIn,
			swap,
		);
		result.push(...fulfillIxs);

		return result;
	}

	async fulfill(swap: Swap, postAuctionSignedVaa?: Uint8Array): Promise<void> {
		const stateAddr = this.getStateAddr(swap);

		const fromTokenAddr = swap.fromTokenAddress;
		const srcChain = swap.sourceChain;
		const toTokenAddr = swap.toTokenAddress;
		const dstChain = swap.destChain;

		const fromToken = swap.fromToken;
		const toToken = swap.toToken;

		const expenses = await this.feeService.calculateSwiftExpensesAndUSDInFromToken({
			isGasless: !!swap.gaslessSignature,
			auctionMode: AUCTION_MODES.ENGLISH,
			exactCalculation: false,
			fromChainId: srcChain,
			fromToken: fromToken,
			toChainId: dstChain,
			toToken: toToken,
			gasDrop: swap.gasDrop.toNumber(),
		});
		const effectiveAmountIn =
			swap.fromAmount.toNumber() - expenses.fulfillCost - expenses.unlockSource - expenses.submissionCost;

		if (effectiveAmountIn < 0) {
			logger.error(`effectiveAmountIn is less than 0
			${effectiveAmountIn} for swap ${swap.sourceTxHash}`);
			throw new Error('Shall not bid because effectiveAmountIn is less than 0');
		}
		if (swap.destChain === CHAIN_ID_SOLANA) {
			let driverToken = this.getDriverSolanaTokenForBidAndSwap(srcChain, fromToken);
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));

			const stateToAss = getAssociatedTokenAddressSync(new PublicKey(toToken.mint), stateAddr, true); // already created via the instruction package in bid

			const trx = await this.solanaFulfiller.getFulfillTransferTrx(
				driverToken,
				this.swiftProgram,
				stateAddr,
				stateToAss,
				effectiveAmountIn,
				realMinAmountOut,
				fromToken,
				toToken,
				swap,
			);

			await this.doTransaction(undefined, undefined, undefined, `fulfill_${swap.sourceTxHash}`, trx.serialize());
		} else {
			let driverToken = this.getDriverEvmTokenForBidAndSwap(srcChain, dstChain, fromToken);
			const normalizeMinAmountOut = BigInt(swap.minAmountOut64);
			const realMinAmountOut =
				normalizeMinAmountOut * BigInt(Math.ceil(10 ** Math.max(0, toToken.decimals - WORMHOLE_DECIMALS)));

			await this.evmFulFiller.fulfillAuction(
				swap,
				effectiveAmountIn,
				toToken,
				dstChain,
				driverToken,
				postAuctionSignedVaa!,
				realMinAmountOut,
			);
		}
	}

	async auctionLessFulfillAndSettleSolana(swap: Swap): Promise<string> {
		const registerOrderIx = this.getRegisterOrderFromSwap(swap);
		const fulfillIxs = await this.getSimpleFulfillIxsPackage(swap);
		const settleIxs = await this.getSettleIxsPackage(swap);

		let allAccountKeys = [];
		for (let ixPackage of [[registerOrderIx], fulfillIxs, settleIxs]) {
			for (let ix of ixPackage) {
				for (const key of ix.keys) {
					allAccountKeys.push(key.pubkey.toString());
				}
			}
		}
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(
			allAccountKeys.map((accMeta) => accMeta),
		);

		let instructions = [priorityFeeIx, registerOrderIx, ...fulfillIxs, ...settleIxs];

		return await this.doTransaction(
			this.walletConfig.solana.publicKey,
			instructions,
			[this.walletConfig.solana],
			`auction_less_fulfill_and_settle_${swap.sourceTxHash}`,
		);
	}

	async getSettleIxsPackage(swap: Swap): Promise<TransactionInstruction[]> {
		const stateAddr = this.getStateAddr(swap);
		const to = new PublicKey(swap.destAddress);

		const toToken = swap.toToken;
		const toMint = new PublicKey(toToken.mint);

		let instructions: TransactionInstruction[] = [];

		const stateToAss = getAssociatedTokenAddressSync(toMint, stateAddr, true);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				stateToAss,
				stateAddr,
				new PublicKey(toToken.mint),
			),
		);

		const mayanAndReferrerAssInfo = this.getMayanAndReferrerFeeAssesInstructions(
			swap.mayanBps,
			swap.referrerBps,
			swap.referrerAddress,
			swap.destChain,
			toMint,
			stateAddr,
		);
		for (let ix of mayanAndReferrerAssInfo.ixs) {
			instructions.push(ix);
		}

		const toAss = getAssociatedTokenAddressSync(toMint, to, true);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				toAss,
				to,
				new PublicKey(toMint),
			),
		);

		const settleIx = this.solanaIxService.getSettleIx(
			this.swiftProgram,
			stateAddr,
			stateToAss,
			to,
			toAss,
			mayanAndReferrerAssInfo.mayanAss,
			mayanAndReferrerAssInfo.referrerAss,
			this.walletConfig.solana.publicKey,
		);

		return [...instructions, settleIx];
	}

	async settle(swap: Swap): Promise<void> {
		const stateAddr = this.getStateAddr(swap);
		const to = new PublicKey(swap.destAddress);

		const toToken = swap.toToken;
		const toMint = new PublicKey(toToken.mint);

		const stateToAss = await getOrCreateAssociatedTokenAccount(
			this.solanaConnection,
			this.walletConfig.solana,
			new PublicKey(toToken.mint),
			stateAddr,
			true,
		);

		const [mayanFeeAss, referrerFeeAss] = await this.getMayanAndReferrerFeeAsses(
			swap.mayanBps,
			swap.referrerBps,
			swap.referrerAddress,
			swap.destChain,
			toMint,
			stateAddr,
		);

		let instructions: TransactionInstruction[] = [];

		const toAss = getAssociatedTokenAddressSync(toMint, to, true);
		instructions.push(
			createAssociatedTokenAccountIdempotentInstruction(
				this.walletConfig.solana.publicKey,
				toAss,
				to,
				new PublicKey(toMint),
			),
		);

		const settleIx = this.solanaIxService.getSettleIx(
			this.swiftProgram,
			stateAddr,
			stateToAss.address,
			to,
			toAss,
			mayanFeeAss,
			referrerFeeAss,
			this.walletConfig.solana.publicKey,
		);
		instructions.push(settleIx);

		const keyAccs = instructions.map((ix) => ix.keys).flat();
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(
			keyAccs.map((accMeta) => accMeta.pubkey.toString()),
		);
		instructions.unshift(priorityFeeIx);

		await this.doTransaction(
			this.walletConfig.solana.publicKey,
			instructions,
			[this.walletConfig.solana],
			`settle_${swap.sourceTxHash}`,
		);
	}

	async post(swap: Swap): Promise<void> {
		const stateAddr = this.getStateAddr(swap);

		const swiftEmitter = PublicKey.findProgramAddressSync([Buffer.from('emitter')], this.swiftProgram)[0];

		const wormholeAccs = await get_wormhole_core_accounts(swiftEmitter);

		const newMessageAccount = Keypair.generate();

		const postIx = this.solanaIxService.getPostIx(
			this.swiftProgram,
			stateAddr,
			swiftEmitter,
			wormholeAccs.sequence_key,
			newMessageAccount.publicKey,
			wormholeAccs.bridge_config,
			wormholeAccs.fee_collector,
			this.walletConfig.solana.publicKey,
			wormholeAccs.coreBridge,
		);
		const priorityFeeIx = await this.priorityFeeHelper.getPriorityFeeInstruction(
			postIx.keys.map((accMeta) => accMeta.pubkey.toString()),
		);
		let instructions = [priorityFeeIx, postIx];
		await this.doTransaction(
			this.walletConfig.solana.publicKey,
			instructions,
			[this.walletConfig.solana, newMessageAccount],
			`post_${swap.sourceTxHash}`,
		);
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
