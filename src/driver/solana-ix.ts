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
import { WORMHOLE_CORE_BRIDGE, WORMHOLE_SHIM_EVENT_AUTH, WORMHOLE_SHIM_PROGRAM, WORMHOLE_VERIFY_VAA_SHIM_PROGRAM } from '../utils/wormhole';
import { GuardianSignature } from '@certusone/wormhole-sdk';
import {sha256} from "js-sha256"

export function getAnchorInstructionData(name: string): Buffer {
	let preimage = `global:${name}`;
	// import some built in sha256
	return Buffer.from(sha256.digest(preimage)).subarray(0, 8);
}

import { hexToUint8Array, tryNativeToUint8Array } from '../utils/buffer';

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

	async getVerifyCompactUnlockIx(
		compactUnlock: PublicKey,
		initializer: PublicKey,
		vaaUnlock: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.verifyCompactUnlock()
			.accounts({ compactUnlock, initializer, vaaUnlock })
			.instruction();
	}

	async getWriteCompactUnlockIx(
		startIndex: number,
		endIndex: number,
		data: Buffer,
		compactUnlock: PublicKey,
		initializer: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.writeCompactUnlock(startIndex, endIndex, data)
			.accounts({
				compactUnlock,
				initializer: initializer,
			})
			.instruction();
	}

	async getInitCompactUnlockIx(
		batchSize: number,
		vaa: PublicKey,
		compactUnlock: PublicKey,
		relayer: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.initCompactUnlock(batchSize)
			.accounts({
				vaa,
				compactUnlock,
				relayer,
				systemProgram: SystemProgram.programId,
			})
			.instruction();
	}

	async getCloseUnlockCompactIx(unlockCompact: PublicKey, initializer: PublicKey): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.closeCompactUnlock()
			.accounts({ compactUnlock: unlockCompact, initializer })
			.instruction();
	}

	async getUnlockBatchCompactIx(
		index: number,
		vaa: PublicKey,
		driver: PublicKey,
		driverFromAss: PublicKey,
		state: PublicKey,
		stateFromAss: PublicKey,
		mintFrom: PublicKey,
		referrer: PublicKey,
		referrerFeeAcc: PublicKey,
		mayanFeeAcc: PublicKey,
	): Promise<TransactionInstruction> {
		return this.swiftProgram.methods
			.unlockBatchCompact(index, true)
			.accounts({
				compactUnlock: vaa,
				state,
				stateFromAcc: stateFromAss,
				mintFrom,
				unlockReceiver: driver,
				unlockReceiverAcc: driverFromAss,
				referrer,
				feeCollector: FeeCollectorSolana,
				referrerFeeAcc,
				mayanFeeAcc,
				tokenProgram: TOKEN_PROGRAM_ID,
				systemProgram: SystemProgram.programId,
			})
			.instruction();
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

	async getCloseSignaturesIx(
		guardianSigners: PublicKey,
		refundRecipient: PublicKey,
	): Promise<TransactionInstruction> {
		const data = Buffer.alloc(8);
		data.set(getAnchorInstructionData('close_signatures'), 0);
		return new TransactionInstruction({
			keys: [
				{
					pubkey: guardianSigners,
					isSigner: false,
					isWritable: true,
				},
				{
					pubkey: refundRecipient,
					isSigner: true,
					isWritable: true,
				},
				{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
			],
			programId: WORMHOLE_VERIFY_VAA_SHIM_PROGRAM,
			data: data,
		});
	}

	async getPostSignaturesIx(
		payer: PublicKey,
		guardian_signatures_signer: PublicKey,
		guardian_set_index: number,
		total_signatures: number,
		guardian_signatures_length: number,
		signatures: GuardianSignature[],
	): Promise<TransactionInstruction> {
		let data = Buffer.alloc(
			8 // anchor_discriminator
			+ 4 // guardian_set_index
			+ 1 // total_signatures
			+ 4 // guardian_signatures length
			+ signatures.length * (1 + 65) // guardian_signatures
		);

		const preData = getAnchorInstructionData('post_signatures');
		let offset = 0;
		data.set(preData, offset);
		offset += preData.length;

		data.writeUInt32LE(guardian_set_index, offset);
		offset += 4;

		data.writeUInt8(total_signatures, offset);
		offset += 1;

		data.writeUInt32LE(guardian_signatures_length, offset);
		offset += 4;

		for (const signature of signatures) {
			data.writeUInt8(signature.index, offset);
			offset += 1;

			data.set(signature.signature, offset);
			offset += signature.signature.length;
		}

		return new TransactionInstruction({
			keys: [
				{
					pubkey: payer,
					isSigner: true,
					isWritable: true,
				},
				{
					pubkey: guardian_signatures_signer,
					isSigner: true,
					isWritable: true,
				},
				{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
			],
			programId: WORMHOLE_VERIFY_VAA_SHIM_PROGRAM,
			data: data,
		});
	}

	async getUnlockSingleIx(
		vaaAddr: PublicKey,
		referrer: PublicKey,
		referrerFeeAcc: PublicKey,
		mayanFeeAcc: PublicKey,
		driver: PublicKey,
		driverFromAss: PublicKey,
		state: PublicKey,
		stateFromAss: PublicKey,
		mintFrom: PublicKey,
		guardianSignaturesInfo: PublicKey,
		wormholeGuardianSetBump: number,
		vaaBytes: Buffer,
	): Promise<TransactionInstruction> {
		// pub fn find_guardian_set_address(
		// 	index_be_bytes: [u8; 4],
		// 	wormhole_program_id: &Pubkey,
		// ) -> (Pubkey, u8) {
		// 	Pubkey::find_program_address(&[GUARDIAN_SET_SEED, &index_be_bytes], wormhole_program_id)
		// }
		const bumpBuffer = Buffer.alloc(4);
		bumpBuffer.writeUInt32BE(wormholeGuardianSetBump, 0);
		const [guardianSetInfo, bump] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('GuardianSet'),
				bumpBuffer,
			],
			WORMHOLE_CORE_BRIDGE,
		);
		return this.swiftProgram.methods
			.unlock(true, bump, vaaBytes)
			.accounts({
				unlockReceiver: driver,
				unlockReceiverAcc: driverFromAss,
				feeCollector: FeeCollectorSolana,
				mayanFeeAcc: mayanFeeAcc,
				referrer: referrer,
				referrerFeeAcc: referrerFeeAcc,
				mintFrom: mintFrom,
				state: state,
				stateFromAcc: stateFromAss,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				guardianSetInfo: guardianSetInfo,
				guardianSignaturesInfo: guardianSignaturesInfo,
				vaaUnlock: null,
			})
			.remainingAccounts([{
				isSigner: false,
				isWritable: true,
				pubkey: WORMHOLE_VERIFY_VAA_SHIM_PROGRAM,
			}])
			.instruction();
	}

	async getBatchPostShimIx(
		compact: boolean,
		driver: PublicKey,
		whConfig: PublicKey,
		whCore: PublicKey,
		whEmitter: PublicKey,
		whSeq: PublicKey,
		whFee: PublicKey,
		states: PublicKey[],
	): Promise<TransactionInstruction> {
		const [message] = PublicKey.findProgramAddressSync([whEmitter.toBuffer()], WORMHOLE_SHIM_PROGRAM);
		return this.swiftProgram.methods
			.postUnlockShim(compact)
			.accounts({
				clock: SYSVAR_CLOCK_PUBKEY,
				config: whConfig,
				coreBridgeProgram: whCore,
				emitter: whEmitter,
				emitterSequence: whSeq,
				feeCollector: whFee,
				message: message,
				shimProgram: WORMHOLE_SHIM_PROGRAM,
				shimEventAuth: WORMHOLE_SHIM_EVENT_AUTH,
				systemProgram: SystemProgram.programId,
				driver: driver,
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
			.postUnlock(true)
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

	async getPostAuctionShimIx(
		driver: PublicKey,
		auctionState: PublicKey,
		whConf: PublicKey,
		whCore: PublicKey,
		whEmitter: PublicKey,
		whFee: PublicKey,
		whSeq: PublicKey,

		swap: Swap,
		driverDestChainAddress: Uint8Array,
	): Promise<TransactionInstruction> {
		const [message] = PublicKey.findProgramAddressSync([whEmitter.toBuffer()], WORMHOLE_SHIM_PROGRAM);
		return this.auctionProgram.methods
			.postAuctionShim(this.createOrderParams(swap), Array.from(driverDestChainAddress))
			.accounts({
				driver: driver,
				systemProgram: SystemProgram.programId,
				clock: SYSVAR_CLOCK_PUBKEY,
				auction: auctionState,
				config: whConf,
				coreBridgeProgram: whCore,
				emitter: whEmitter,
				emitterSequence: whSeq,
				feeCollector: whFee,
				message: message,
				shimProgram: WORMHOLE_SHIM_PROGRAM,
				shimEventAuth: WORMHOLE_SHIM_EVENT_AUTH,
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
		mintTo: PublicKey,
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
