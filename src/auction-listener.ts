import Client, { CommitmentLevel, SubscribeRequestFilterTransactions } from '@triton-one/yellowstone-grpc';
import { SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { binary_to_base58 } from './utils/base58';
import { BorshInstructionCoder } from '@coral-xyz/anchor';
import { IDL as SwiftAuction } from './abis/swift-auction.idl';
import { RpcConfig } from './config/rpc';
import logger from './utils/logger';
import { AuctionAddressSolana } from './config/contracts';
import { Connection, PublicKey } from '@solana/web3.js';
import { GlobalConfig } from './config/global';
import { reconstructOrderHash32 } from './utils/order-hash';
import { getAuctionState as getAuctionStateFromSolana } from './utils/state-parser';

const coder = new BorshInstructionCoder(SwiftAuction);

export interface BidState {
	auctionStateAddr: string;
	orderHash: string;
	orderId: string;
	amountPromised: bigint;
	winner: string;
	signature: string;
	timestamp: number;
	firstBidTime: number;
	order: any;
	validFrom: number;
	sequence: bigint;
	isClosed: boolean;
}

export class AuctionListener {
	private bidStatesMap: Map<string, BidState> = new Map();
	private bidOrder: string[] = [];

	constructor(
		private readonly driverSolanaAddress: string,
		private readonly solanaConnection: Connection,
		private readonly globalConfig: GlobalConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly bidStateThreshold: number = 100,
	) { }

	/**
	 * Get auction state from memory if it exists
	 * @param auctionStateAddr The auction state address to lookup
	 * @returns BidState if found, null otherwise
	 */
	public async getAuctionState(auctionStateAddr: string): Promise<BidState | null> {
		let state = this.bidStatesMap.get(auctionStateAddr) || null;

		if (state && Date.now() - state.firstBidTime > this.globalConfig.auctionTimeSeconds * 1000) {
			state = null;
		}

		if (state) {
			logger.debug(`[AuctionListener] Retrieved auction state for order: ${state.orderId} in memory`);
		} else {
			logger.debug(`[AuctionListener] No auction state found for auctionStateAddr: ${auctionStateAddr}. Getting from solana ...`);
			const auctionState = await getAuctionStateFromSolana(this.solanaConnection, new PublicKey(auctionStateAddr));
			if (auctionState) {
				state = {
					auctionStateAddr,
					orderHash: '',
					orderId: '',
					amountPromised: BigInt(auctionState?.amountPromised.toString() || '0'),
					winner: auctionState?.winner || '',
					signature: '',
					timestamp: Date.now(),
					firstBidTime: Date.now(),
					order: null,
					validFrom: auctionState?.validFrom || 0,
					sequence: auctionState?.sequence || BigInt(0),
					isClosed: false,
				};
			}
			if (state) {
				this.storeBidState(state);
			}
			logger.debug(`[AuctionListener] Retrieved auction state for order: ${state?.orderId} from solana`);
		}
		return state;
	}

	/**
	 * Get all stored auction states
	 * @returns Array of all BidState objects
	 */
	public getAllAuctionStates(): BidState[] {
		const states = Array.from(this.bidStatesMap.values());
		logger.debug(`[AuctionListener] Retrieved ${states.length} auction states from memory`);
		return states;
	}

	/**
	 * Get the count of stored auction states
	 * @returns Number of stored states
	 */
	public getAuctionStateCount(): number {
		const count = this.bidStatesMap.size;
		logger.debug(`[AuctionListener] Current auction states count: ${count}`);
		return count;
	}

	private storeBidState(bidState: BidState): void {
		const existingState = this.bidStatesMap.get(bidState.auctionStateAddr);

		if (existingState) {
			const existingAmount = BigInt(existingState.amountPromised);
			const newAmount = BigInt(bidState.amountPromised);

			if (newAmount > existingAmount) {
				const updatedBidState: BidState = {
					...bidState,
					firstBidTime: existingState.firstBidTime
				};
				this.bidStatesMap.set(bidState.auctionStateAddr, updatedBidState);
				logger.info(`[AuctionListener] Updated bid state for order: ${bidState.orderId}, new amount: ${bidState.amountPromised} > previous: ${existingState.amountPromised}, driver: ${bidState.winner}`);
			} else {
				logger.debug(`[AuctionListener] Skipping bid update for order: ${bidState.orderId}, new amount: ${bidState.amountPromised} <= existing: ${existingState.amountPromised}`);
			}
			return;
		}

		const newBidState: BidState = {
			...bidState,
			firstBidTime: bidState.timestamp
		};

		this.bidStatesMap.set(bidState.auctionStateAddr, newBidState);
		this.bidOrder.push(bidState.auctionStateAddr);

		let removedCount = 0;
		while (this.bidOrder.length > this.bidStateThreshold) {
			const oldestAuctionStateAddr = this.bidOrder.shift();
			if (oldestAuctionStateAddr) {
				const removedState = this.bidStatesMap.get(oldestAuctionStateAddr);
				this.bidStatesMap.delete(oldestAuctionStateAddr);
				removedCount++;
				if (removedState) {
					logger.debug(`[AuctionListener] Removed old bid state for order: ${removedState.orderId} (exceeded threshold)`);
				}
			}
		}

		logger.info(`[AuctionListener] Stored new bid state for order: ${bidState.orderId}, driver: ${bidState.winner}, amount: ${bidState.amountPromised}, total states: ${this.bidStatesMap.size}${removedCount > 0 ? `, removed ${removedCount} old states` : ''}`);
	}

	private async processBidInstruction(
		signature: string,
		ix: any,
		decoded: any,
		message: any,
		deleted: boolean,
	): Promise<void> {
		const driverIdx = ix.accounts[1];
		const driver = binary_to_base58(message.accountKeys[driverIdx]);

		const auctionStateIdx = ix.accounts[2];
		const auctionStateAddr = binary_to_base58(message.accountKeys[auctionStateIdx]);

		if (deleted) {
			let state = this.bidStatesMap.get(auctionStateAddr);
			if (state && state.winner !== this.driverSolanaAddress) {
				state.isClosed = true;
				this.storeBidState(state);
				logger.info(`[AuctionListener] Auction state for order: ${state.orderId} was deleted`);
			}

			return;
		}

		const decodeData = decoded.data as any;

		const amountBid64 = decodeData.amountBid.toString();
		const order = decodeData.order;

		// Reconstruct order hash
		const orderHash = reconstructOrderHash32(
			Buffer.from(new Uint8Array(order.trader)),
			order.chainSource,
			Buffer.from(new Uint8Array(order.tokenIn)),
			order.chainDest,
			Buffer.from(new Uint8Array(order.tokenOut)),
			BigInt(order.amountOutMin.toString()),
			BigInt(order.gasDrop.toString()),
			BigInt(order.feeCancel.toString()),
			BigInt(order.feeRefund.toString()),
			Number(order.deadline.toString()),
			Buffer.from(new Uint8Array(order.addrDest)),
			Buffer.from(new Uint8Array(order.addrRef)),
			order.feeRateRef,
			order.feeRateMayan,
			order.auctionMode,
			Buffer.from(new Uint8Array(order.keyRnd)),
		);

		const orderHashHex = orderHash.toString('hex');
		const orderId = `SWIFT_0x${orderHashHex}`;

		logger.info(`[AuctionListener] Processing bid instruction - Order: ${orderId}, Amount: ${amountBid64}, Driver: ${driver}, Signature: ${signature}, AuctionStateAddr: ${auctionStateAddr}`);

		const bidState: BidState = {
			auctionStateAddr,
			orderHash: orderHashHex,
			orderId,
			amountPromised: BigInt(amountBid64),
			winner: driver,
			signature,
			timestamp: Date.now(),
			firstBidTime: Date.now(),
			order: decodeData.order,
			validFrom: decodeData.validFrom,
			sequence: decodeData.seqMsg ? BigInt(decodeData.seqMsg.toString()) : BigInt(0),
			isClosed: false,
		};

		this.storeBidState(bidState);
	}

	private async setupGeyserSubscription(): Promise<void> {
		if (!this.rpcConfig.solana.geyser.endpoint) {
			throw new Error('Geyser endpoint is not configured');
		}

		logger.info(`[AuctionListener] Initializing Geyser client connection to: ${this.rpcConfig.solana.geyser.endpoint}`);

		const client = new Client(
			this.rpcConfig.solana.geyser.endpoint,
			this.rpcConfig.solana.geyser.apiKey,
			undefined,
		);

		const version = await client.getVersion();
		logger.info(`[AuctionListener] Connected to Solana Geyser, version: ${JSON.stringify(version)}`);

		const stream = await client.subscribe();
		const auctionProgram = AuctionAddressSolana;
		const [auctionConfig] = PublicKey.findProgramAddressSync(
			[Buffer.from('CONFIG')],
			new PublicKey(auctionProgram),
		);

		logger.info(`[AuctionListener] Setting up subscription for auction program: ${auctionProgram}, config: ${auctionConfig.toString()}`);

		// Create subscription request
		const request: SubscribeRequest = SubscribeRequest.create({
			commitment: CommitmentLevel.PROCESSED,
			transactions: {
				auction: SubscribeRequestFilterTransactions.create({
					vote: false,
					accountInclude: [
						auctionConfig.toString(),
						auctionProgram,
					],
				}),
			},
		});

		// Send subscription request
		await new Promise<void>((resolve, reject) => {
			stream.write(request, (err: any) => {
				if (err === null || err === undefined) {
					logger.info('[AuctionListener] Successfully subscribed to auction transactions');
					resolve();
				} else {
					logger.error(`[AuctionListener] Failed to subscribe to auction transactions: ${err}`);
					reject(err);
				}
			});
		});

		// Handle incoming data
		stream.on('data', async (data) => {
			try {
				if (!data.transaction?.transaction) {
					return;
				}

				const signature = binary_to_base58(data.transaction.transaction.signature);
				const message = data.transaction.transaction.transaction.message;

				let deleted = false;
				if (data.transaction.transaction.meta?.err) {
					if (data.transaction.transaction.meta?.logMessages.join('\n').includes('auction is closed.')) {
						logger.info(`[AuctionListener] Auction is closed. Skipping transaction: ${signature}`);
						deleted = true;
					} else {
						logger.info(`[AuctionListener] Skipping failed transaction: ${signature}`);
						return;
					}
				}

				logger.debug(`[AuctionListener] Processing transaction: ${signature}`);

				for (const ix of message.instructions) {
					const programidx = ix.programIdIndex;
					const programId = binary_to_base58(message.accountKeys[programidx]);

					if (programId !== auctionProgram) {
						continue;
					}

					const decoded = coder.decode(ix.data);
					if (decoded?.name !== 'bid') {
						logger.debug(`[AuctionListener] Skipping non-bid instruction: ${decoded?.name || 'unknown'}`);
						continue;
					}

					logger.debug(`[AuctionListener] Found bid instruction in transaction: ${signature}`);
					await this.processBidInstruction(signature, ix, decoded, message, deleted);
				}
			} catch (error: any) {
				logger.error(`[AuctionListener] Error processing streamed transaction data: ${error.message || error}`);
				if (error.stack) {
					logger.debug(`[AuctionListener] Error stack trace: ${error.stack}`);
				}
			}
		});

		stream.on('error', (error: any) => {
			logger.error(`[AuctionListener] Geyser stream error: ${error.message || error}`);
		});

		stream.on('end', () => {
			logger.warn('[AuctionListener] Geyser stream ended unexpectedly');
		});
	}

	public async start(): Promise<void> {
		if (!this.globalConfig.rebidEnabled) {
			logger.info('[AuctionListener] Rebid functionality is disabled in configuration');
			return;
		}

		logger.info(`[AuctionListener] Starting ReBid Listener with bid state threshold: ${this.bidStateThreshold}, driver address: ${this.driverSolanaAddress}`);

		try {
			await this.setupGeyserSubscription();
			logger.info('[AuctionListener] ReBid Listener started successfully and is now monitoring for bid transactions');
		} catch (error: any) {
			logger.error(`[AuctionListener] Failed to start ReBid Listener: ${error.message || error}`);
			throw error;
		}
	}
}