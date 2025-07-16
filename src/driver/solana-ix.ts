import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
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
import Decimal from 'decimal.js';
import { ethers } from 'ethers6';
import { IDL as AuctionIdl, SwiftAuction as AuctionT } from '../abis/swift-auction.idl';
import { IDL as SwiftIdl, Swift as SwiftT } from '../abis/swift.idl';
import { WORMHOLE_DECIMALS } from '../config/chains';
import { Swap } from '../swap.dto';
import { hexToUint8Array, tryNativeToUint8Array } from '../utils/buffer';
import { WORMHOLE_SHIM_EVENT_AUTH, WORMHOLE_SHIM_PROGRAM } from '../utils/wormhole';

export class NewSolanaIxHelper {
	private readonly swiftProgram: Program<SwiftT>;
	private readonly auctionProgram: Program<AuctionT>;
	private readonly auctionConfig: PublicKey;

	constructor(swiftProgramId: PublicKey, auctionProgramId: PublicKey, connection: Connection) {
		// Use a random keypair wallet because we won't be sending tx using anchor wrapper
		const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
			commitment: 'confirmed',
		});
		this.swiftProgram = new Program(SwiftIdl, swiftProgramId, provider);
		this.auctionProgram = new Program(AuctionIdl, auctionProgramId, provider);

		this.auctionConfig = PublicKey.findProgramAddressSync([Buffer.from('CONFIG')], auctionProgramId)[0];
	}

	private createOrderParams(swap: Swap, fromTokenDecimals: number) {
		return {
			addrDest: Array.from(tryNativeToUint8Array(swap.destAddress, swap.destChain)),
			addrRef: Array.from(tryNativeToUint8Array(swap.referrerAddress, swap.destChain)),
			amountOutMin: new BN(swap.minAmountOut64.toString()),
			auctionMode: swap.auctionMode,
			chainDest: swap.destChain,
			chainSource: swap.sourceChain,
			deadline: new BN(Math.floor(swap.deadline.getTime() / 1000)),
			feeRefund: new BN(
				ethers
					.parseUnits(
						swap.refundRelayerFee.toFixed(Math.min(8, fromTokenDecimals), Decimal.ROUND_DOWN),
						Math.min(WORMHOLE_DECIMALS, fromTokenDecimals),
					)
					.toString(),
			),
			feeCancel: new BN(
				ethers
					.parseUnits(
						swap.redeemRelayerFee.toFixed(Math.min(8, fromTokenDecimals), Decimal.ROUND_DOWN), // redeem relayer fee is considered as dst refund fee for swifts
						Math.min(WORMHOLE_DECIMALS, fromTokenDecimals),
					)
					.toString(),
			), // redeem relayer fee is considered as dst refund fee (cancel fee) for swifts
			feeRateMayan: swap.mayanBps,
			feeRateRef: swap.referrerBps,
			gasDrop: new BN(swap.gasDrop64.toString()),
			keyRnd: Array.from(hexToUint8Array(swap.randomKey)),
			tokenIn: Array.from(tryNativeToUint8Array(swap.fromTokenAddress, swap.sourceChain)),
			tokenOut: Array.from(tryNativeToUint8Array(swap.toTokenAddress, swap.destChain)),
			trader: Array.from(tryNativeToUint8Array(swap.trader, swap.sourceChain)),
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
			.unlockBatch(stateIdxInVaa)
			.accounts({
				vaaUnlock: vaa,
				driver: driver,
				driverAcc: driverFromAss,
				mintFrom: mintFrom,
				state: state,
				stateFromAcc: stateFromAss,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
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
			.unlock()
			.accounts({
				driver: driver,
				driverAcc: driverFromAss,
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
			.postUnlock()
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
		fromTokenDecimals: number,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.registerOrder(this.createOrderParams(swap, fromTokenDecimals))
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

	async getOverrideBidIx(
		driver: PublicKey,
		auctionState: PublicKey,
		swap: Swap,
		fromTokenDecimals: number,
	): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.overrideBid(this.createOrderParams(swap, fromTokenDecimals))
			.accounts({
				auctionState,
				driver,
			})
			.instruction();
	}

	async getBidIx(
		driver: PublicKey,
		auctionState: PublicKey,
		normalizedBidAmount: bigint,

		swap: Swap,
		fromTokenDecimals: number,
	): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.bid(this.createOrderParams(swap, fromTokenDecimals), new BN(normalizedBidAmount.toString()))
			.accounts({
				config: this.auctionConfig,
				systemProgram: SystemProgram.programId,
				driver: driver,
				auctionState: auctionState,
			})
			.instruction();
	}

	async getPostAuctionShimIx(
		driver: PublicKey,
		auctionState: PublicKey,
		whConf: PublicKey,
		whCore: PublicKey,
		whEmitter: PublicKey,
		whFee: PublicKey,
		whSeq: PublicKey,

		swap: Swap,
		fromTokenDecimals: number,
		driverDestChainAddress: Uint8Array,
	): Promise<TransactionInstruction> {
		const [message] = PublicKey.findProgramAddressSync([whEmitter.toBuffer()], WORMHOLE_SHIM_PROGRAM);

		return this.auctionProgram.methods
			.postAuctionShim(this.createOrderParams(swap, fromTokenDecimals), Array.from(driverDestChainAddress))
			.accounts({
				auction: auctionState,
				clock: SYSVAR_CLOCK_PUBKEY,
				config: whConf,
				coreBridgeProgram: whCore,
				emitter: whEmitter,
				emitterSequence: whSeq,
				feeCollector: whFee,
				message: message,
				driver: driver,
				shimEventAuth: WORMHOLE_SHIM_EVENT_AUTH,
				shimProgram: WORMHOLE_SHIM_PROGRAM,
				systemProgram: SystemProgram.programId,
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
		fromTokenDecimals: number,
		driverDestChainAddress: Uint8Array,
	): Promise<TransactionInstruction> {
		return this.auctionProgram.methods
			.postAuction(this.createOrderParams(swap, fromTokenDecimals), Array.from(driverDestChainAddress))
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
				state: state,
				stateToAcc: stateToAss,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				dest: destAddr,
				destAcc: destAssAddr,
				feeCollector: mayanFeeCollector,
				mayanFeeAcc: mayanFeeCollectorAss,
				mintTo,
				referrer: referrerAddr,
				referrerFeeAcc: referrerAddrAss,
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
