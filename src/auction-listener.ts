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
	orderHash: string;
	orderId: string;
	amountBid: string;
	driver: string;
	signature: string;
	timestamp: number;
	firstBidTime: number;
	order: any;
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
	 * @param orderHash The order hash to lookup
	 * @returns BidState if found, null otherwise
	 */
	public async getAuctionState(orderHash: string): Promise<BidState | null> {
		let state = this.bidStatesMap.get(orderHash) || null;
		if (state) {
			logger.debug(`[ReBidListener] Retrieved auction state for order: ${state.orderId} in memory`);
		} else {
			logger.debug(`[ReBidListener] No auction state found for order hash: ${orderHash}. Getting from solana ...`);
			const auctionState = await getAuctionStateFromSolana(this.solanaConnection, new PublicKey(orderHash));
			if (auctionState) {
				state = {
					orderHash,
					orderId: `SWIFT_0x${orderHash}`,
					amountBid: auctionState?.amountPromised.toString() || '0',
					driver: this.driverSolanaAddress,
					signature: '',
					timestamp: Date.now(),
					firstBidTime: Date.now(),
					order: null,
				};
			}
			logger.debug(`[ReBidListener] Retrieved auction state for order: ${state?.orderId} from solana`);
		}
		return state;
	}

	/**
	 * Get all stored auction states
	 * @returns Array of all BidState objects
	 */
	public getAllAuctionStates(): BidState[] {
		const states = Array.from(this.bidStatesMap.values());
		logger.debug(`[ReBidListener] Retrieved ${states.length} auction states from memory`);
		return states;
	}

	/**
	 * Get the count of stored auction states
	 * @returns Number of stored states
	 */
	public getAuctionStateCount(): number {
		const count = this.bidStatesMap.size;
		logger.debug(`[ReBidListener] Current auction states count: ${count}`);
		return count;
	}

	private storeBidState(bidState: BidState): void {
		const existingState = this.bidStatesMap.get(bidState.orderHash);

		if (existingState) {
			// Parse bid amounts for comparison (assuming they are numeric strings)
			const existingAmount = BigInt(existingState.amountBid);
			const newAmount = BigInt(bidState.amountBid);

			// Only update if the new bid amount is larger than the existing one
			if (newAmount > existingAmount) {
				// Keep the original first bid time but update other fields
				const updatedBidState: BidState = {
					...bidState,
					firstBidTime: existingState.firstBidTime
				};
				this.bidStatesMap.set(bidState.orderHash, updatedBidState);
				logger.info(`[ReBidListener] Updated bid state for order: ${bidState.orderId}, new amount: ${bidState.amountBid} > previous: ${existingState.amountBid}, driver: ${bidState.driver}`);
			} else {
				logger.debug(`[ReBidListener] Skipping bid update for order: ${bidState.orderId}, new amount: ${bidState.amountBid} <= existing: ${existingState.amountBid}`);
			}
			return;
		}

		// Add new bid state - set both timestamp and firstBidTime to current time
		const newBidState: BidState = {
			...bidState,
			firstBidTime: bidState.timestamp
		};

		this.bidStatesMap.set(bidState.orderHash, newBidState);
		this.bidOrder.push(bidState.orderHash);

		// Remove oldest entries if we exceed the threshold
		let removedCount = 0;
		while (this.bidOrder.length > this.bidStateThreshold) {
			const oldestOrderHash = this.bidOrder.shift();
			if (oldestOrderHash) {
				const removedState = this.bidStatesMap.get(oldestOrderHash);
				this.bidStatesMap.delete(oldestOrderHash);
				removedCount++;
				if (removedState) {
					logger.debug(`[ReBidListener] Removed old bid state for order: ${removedState.orderId} (exceeded threshold)`);
				}
			}
		}

		logger.info(`[ReBidListener] Stored new bid state for order: ${bidState.orderId}, driver: ${bidState.driver}, amount: ${bidState.amountBid}, total states: ${this.bidStatesMap.size}${removedCount > 0 ? `, removed ${removedCount} old states` : ''}`);
	}

	private async processBidInstruction(
		signature: string,
		ix: any,
		decoded: any,
		message: any,
	): Promise<void> {
		const driverIdx = ix.accounts[1];
		const driver = binary_to_base58(message.accountKeys[driverIdx]);

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

		logger.info(`[ReBidListener] Processing bid instruction - Order: ${orderId}, Amount: ${amountBid64}, Driver: ${driver}, Signature: ${signature}`);

		// Create bid state object
		const bidState: BidState = {
			orderHash: orderHashHex,
			orderId,
			amountBid: amountBid64,
			driver,
			signature,
			timestamp: Date.now(),
			firstBidTime: Date.now(),
			order: decodeData.order,
		};

		this.storeBidState(bidState);
	}

	private async setupGeyserSubscription(): Promise<void> {
		if (!this.rpcConfig.solana.geyser.endpoint) {
			throw new Error('Geyser endpoint is not configured');
		}

		logger.info(`[ReBidListener] Initializing Geyser client connection to: ${this.rpcConfig.solana.geyser.endpoint}`);

		const client = new Client(
			this.rpcConfig.solana.geyser.endpoint,
			this.rpcConfig.solana.geyser.apiKey,
			undefined,
		);

		const version = await client.getVersion();
		logger.info(`[ReBidListener] Connected to Solana Geyser, version: ${JSON.stringify(version)}`);

		const stream = await client.subscribe();
		const auctionProgram = AuctionAddressSolana;
		const [auctionConfig] = PublicKey.findProgramAddressSync(
			[Buffer.from('CONFIG')],
			new PublicKey(auctionProgram),
		);

		logger.info(`[ReBidListener] Setting up subscription for auction program: ${auctionProgram}, config: ${auctionConfig.toString()}`);

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
					logger.info('[ReBidListener] Successfully subscribed to auction transactions');
					resolve();
				} else {
					logger.error(`[ReBidListener] Failed to subscribe to auction transactions: ${err}`);
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

				logger.debug(`[ReBidListener] Processing transaction: ${signature}`);

				for (const ix of message.instructions) {
					const programidx = ix.programIdIndex;
					const programId = binary_to_base58(message.accountKeys[programidx]);

					if (programId !== auctionProgram) {
						continue;
					}

					const decoded = coder.decode(ix.data);
					if (decoded?.name !== 'bid') {
						logger.debug(`[ReBidListener] Skipping non-bid instruction: ${decoded?.name || 'unknown'}`);
						continue;
					}

					logger.debug(`[ReBidListener] Found bid instruction in transaction: ${signature}`);
					await this.processBidInstruction(signature, ix, decoded, message);
				}
			} catch (error: any) {
				logger.error(`[ReBidListener] Error processing streamed transaction data: ${error.message || error}`);
				if (error.stack) {
					logger.debug(`[ReBidListener] Error stack trace: ${error.stack}`);
				}
			}
		});

		stream.on('error', (error: any) => {
			logger.error(`[ReBidListener] Geyser stream error: ${error.message || error}`);
		});

		stream.on('end', () => {
			logger.warn('[ReBidListener] Geyser stream ended unexpectedly');
		});
	}

	public async start(): Promise<void> {
		if (!this.globalConfig.rebidEnabled) {
			logger.info('[ReBidListener] Rebid functionality is disabled in configuration');
			return;
		}

		logger.info(`[ReBidListener] Starting ReBid Listener with bid state threshold: ${this.bidStateThreshold}, driver address: ${this.driverSolanaAddress}`);

		try {
			await this.setupGeyserSubscription();
			logger.info('[ReBidListener] ReBid Listener started successfully and is now monitoring for bid transactions');
		} catch (error: any) {
			logger.error(`[ReBidListener] Failed to start ReBid Listener: ${error.message || error}`);
			throw error;
		}
	}
}