import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	SYSVAR_CLOCK_PUBKEY,
	SYSVAR_RENT_PUBKEY,
	SystemProgram,
	TransactionInstruction,
} from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from 'anchor30';
import { SwiftV2Auction, SwiftV2AuctionIdl } from '../abis/swift-auction-v2.idl';
import { SwiftV2, SwiftV2Idl } from '../abis/swift-v2.idl';
import { FeeCollectorSolana } from '../config/contracts';
import { tokenTo32ByteAddress } from '../config/tokens';
import { Swap } from '../swap.dto';
import { hexToUint8Array } from '../utils/buffer';

export class NewSolanaIxHelper {
	private readonly swiftProgram: Program<SwiftV2>;
	private readonly auctionProgram: Program<SwiftV2Auction>;
	private readonly auctionConfig: PublicKey;

	constructor(swiftProgramId: PublicKey, auctionProgramId: PublicKey, connection: Connection) {
		// Use a random keypair wallet because we won't be sending tx using anchor wrapper
		const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
			commitment: 'confirmed',
		});
		this.swiftProgram = new Program(SwiftV2Idl, provider);
		this.auctionProgram = new Program(SwiftV2AuctionIdl, provider);

		this.auctionConfig = PublicKey.findProgramAddressSync([Buffer.from('CONFIG')], auctionProgramId)[0];
	}

	private createOrderParams(swap: Swap) {
		return {
			payloadType: swap.payloadId,
			penaltyPeriod: swap.penaltyPeriod,
			baseBond: new BN(swap.baseBond.toString()),
			perBpsBond: new BN(swap.perBpsBond.toString()),
			customPayload: Array.from(swap.customPayload ? hexToUint8Array(swap.customPayload) : Buffer.alloc(32)),
			addrDest: Array.from(swap.destAddress32),
			addrRef: Array.from(swap.referrerAddress32),
			amountOutMin: new BN(swap.minAmountOut64.toString()),
			auctionMode: swap.auctionMode,
			chainDest: swap.destChain,
			chainSource: swap.sourceChain,
			deadline: new BN(Math.floor(swap.deadline.getTime() / 1000)),
			feeRefund: new BN(swap.refundRelayerFee64.toString()),
			feeCancel: new BN(swap.redeemRelayerFee64.toString()), // redeem relayer fee is considered as dst refund fee (cancel fee) for swifts
			feeRateMayan: swap.mayanBps,
			feeRateRef: swap.referrerBps,
			gasDrop: new BN(swap.gasDrop64.toString()),
			keyRnd: Array.from(hexToUint8Array(swap.randomKey)),
			tokenIn: Array.from(tokenTo32ByteAddress(swap.fromToken)),
			tokenOut: Array.from(tokenTo32ByteAddress(swap.toToken)),
			trader: Array.from(swap.trader32),
		};
	}

	async getUnlockBatchIx(
		driver: PublicKey,
		driverFromAss: PublicKey,
		state: PublicKey,
		stateFromAss: PublicKey,
		stateIdxInVaa: number,
		mintFrom: PublicKey,
		vaa: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.unlockBatch(stateIdxInVaa, true)
			.accounts({
				vaaUnlock: vaa,
				unlockReceiver: driver,
				unlockReceiverAcc: driverFromAss,
				mintFrom: mintFrom,
				state: state,
				stateFromAcc: stateFromAss,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				feeCollector: FeeCollectorSolana,
				mayanFeeAcc: FeeCollectorSolana,
				referrer: FeeCollectorSolana,
				referrerFeeAcc: FeeCollectorSolana, // TODO
			})
			.instruction();
	}

	async getUnlockSingleIx(
		driver: PublicKey,
		driverFromAss: PublicKey,
		state: PublicKey,
		stateFromAss: PublicKey,
		mintFrom: PublicKey,
		vaa: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.unlock(true)
			.accounts({
				unlockReceiver: driver,
				unlockReceiverAcc: driverFromAss,
				feeCollector: FeeCollectorSolana,
				mayanFeeAcc: FeeCollectorSolana,
				referrer: FeeCollectorSolana,
				referrerFeeAcc: FeeCollectorSolana, // TODO
				mintFrom: mintFrom,
				state: state,
				stateFromAcc: stateFromAss,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				vaaUnlock: vaa,
			})
			.instruction();
	}

	async getBatchPostIx(
		driver: PublicKey,
		whConfig: PublicKey,
		whCore: PublicKey,
		whEmitter: PublicKey,
		whSeq: PublicKey,
		whMessage: PublicKey,
		whFee: PublicKey,
		states: PublicKey[],
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.postUnlock(false)
			.accounts({
				clock: SYSVAR_CLOCK_PUBKEY,
				rent: SYSVAR_RENT_PUBKEY,
				systemProgram: SystemProgram.programId,
				config: whConfig,
				coreBridgeProgram: whCore,
				driver: driver,
				emitter: whEmitter,
				emitterSequence: whSeq,
				feeCollector: whFee,
				message: whMessage,
			})
			.remainingAccounts(
				states.map((state) => ({
					isSigner: false,
					isWritable: true,
					pubkey: state,
				})),
			)
			.instruction();
	}

	async getRegisterOrderIx(
		relayer: PublicKey,
		state: PublicKey,

		swap: Swap,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.registerOrder(this.createOrderParams(swap))
			.accounts({
				relayer: relayer,
				state: state,
				systemProgram: SystemProgram.programId,
			})
			.instruction();
	}

	async getFullfillIx(
		unlockerAddress32: Uint8Array,
		destAddress: string,
		driver: PublicKey,
		mintTo: PublicKey,
		state: PublicKey,
		stateToAss: PublicKey,
		isToken2022: boolean,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.fulfill(Array.from(unlockerAddress32))
			.accounts({
				systemProgram: SystemProgram.programId,
				dest: new PublicKey(destAddress),
				driver: driver,
				mintTo: mintTo,
				state: state,
				stateToAcc: stateToAss,
				tokenProgram: isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			})
			.instruction();
	}

	async getBidIx(
		driver: PublicKey,
		auctionState: PublicKey,
		normalizedBidAmount: bigint,

		swap: Swap,
	): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.bid(this.createOrderParams(swap), new BN(normalizedBidAmount.toString()))
			.accounts({
				config: this.auctionConfig,
				systemProgram: SystemProgram.programId,
				driver: driver,
				auctionState: auctionState,
			})
			.instruction();
	}

	async getPostAuctionIx(
		driver: PublicKey,
		auctionState: PublicKey,
		whConf: PublicKey,
		whCore: PublicKey,
		whEmitter: PublicKey,
		whFee: PublicKey,
		whSeq: PublicKey,
		whMessage: PublicKey,

		swap: Swap,
		driverDestChainAddress: Uint8Array,
	): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.postAuction(this.createOrderParams(swap), Array.from(driverDestChainAddress))
			.accounts({
				driver: driver,
				systemProgram: SystemProgram.programId,
				rent: SYSVAR_RENT_PUBKEY,
				clock: SYSVAR_CLOCK_PUBKEY,
				auction: auctionState,
				config: whConf,
				coreBridgeProgram: whCore,
				emitter: whEmitter,
				emitterSequence: whSeq,
				feeCollector: whFee,
				message: whMessage,
			})
			.instruction();
	}

	async getRegisterWinnerIx(
		driver: PublicKey,
		state: PublicKey,
		auctionAddr: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.setAuctionWinner(driver)
			.accounts({
				auction: auctionAddr,
				state: state,
			})
			.instruction();
	}

	async getSettleIx(
		driver: PublicKey,
		state: PublicKey,
		stateToAss: PublicKey,
		destAddr: PublicKey,
		destAssAddr: PublicKey | null,
		mayanFeeCollector: PublicKey,
		mayanFeeCollectorAss: PublicKey,
		mintTo: PublicKey,
		referrerAddr: PublicKey,
		referrerAddrAss: PublicKey,
		isToken2022: boolean,
		closeAta: boolean,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.settle(closeAta)
			.accounts({
				relayer: driver,
				destSigner: driver,
				state: state,
				stateToAcc: stateToAss,
				dest: destAddr,
				destAcc: destAssAddr,
				mintTo,
				systemProgram: SystemProgram.programId,
				tokenProgram: isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			})
			.instruction();
	}

	async getCloseAuctionIx(auctionState: PublicKey, initializer: PublicKey): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.closeAuction()
			.accounts({
				auction: auctionState,
				initializer: initializer,
			})
			.instruction();
	}

	async getCloseStateDestIx(stateAddr: PublicKey, relayer: PublicKey): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.close()
			.accounts({
				state: stateAddr,
				relayer: relayer,
				systemProgram: SystemProgram.programId,
			})
			.instruction();
	}

	isBadAggIns(
		instruction: TransactionInstruction,
		address: PublicKey,
		mints: Array<PublicKey>,
		mintsAss: Array<PublicKey>,
	): boolean {
		if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
			return true;
		}
		if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
			return false;
		}
		if (instruction.data.length > 0) {
			return false;
		}
		if (!instruction.keys[2].pubkey.equals(address)) {
			return false;
		}
		const currentMint = instruction.keys[3].pubkey;
		if (mints.find((m) => m.equals(currentMint))) {
			return true;
		}
		return false;
	}
}
