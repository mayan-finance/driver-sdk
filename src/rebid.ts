import Client, { CommitmentLevel, SubscribeRequestFilterTransactions } from '@triton-one/yellowstone-grpc';
import { SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { binary_to_base58 } from './utils/base58';
import { BorshInstructionCoder } from '@coral-xyz/anchor';
import { IDL as SwiftAuction } from './abis/swift-auction.idl';
import { RpcConfig } from './config/rpc';
import logger from './utils/logger';
import { AuctionAddressSolana } from './config/contracts';
import { PublicKey } from '@solana/web3.js';
import { GlobalConfig } from './config/global';
import { reconstructOrderHash32 } from './utils/order-hash';
import { MayanExplorerWatcher } from './watchers/mayan-explorer';
import { DriverService } from './driver/driver';
import { driverConfig } from './driver.conf';

const coder = new BorshInstructionCoder(SwiftAuction);

export class ReBidListener {
	constructor(
		private readonly driverSolanaAddress: string,
		private readonly globalConfig: GlobalConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly mayanExplorerWatcher: MayanExplorerWatcher,
		private readonly driverService: DriverService,
	) { }

	public async start() {
		if (!this.globalConfig.rebidEnabled) {
			logger.info('[Rebid] Rebid is not enabled');
			return;
		}

		try {
			if (!this.rpcConfig.solana.geyser.endpoint) {
				logger.error('[Rebid] Geyser endpoint is not configured');
				return;
			}

			const client = new Client(
				this.rpcConfig.solana.geyser.endpoint,
				this.rpcConfig.solana.geyser.apiKey,
				undefined,
			);

			const version = await client.getVersion(); // gets the version information
			logger.info('[Rebid] solana geyserversion', version);
			const stream = await client.subscribe();
			const auctionProgram = AuctionAddressSolana;
			const [auctionConfig] = PublicKey.findProgramAddressSync(
				[Buffer.from('CONFIG')],
				new PublicKey(auctionProgram),
			);
			// Create a subscription request.
			const request: SubscribeRequest = SubscribeRequest.create({
				commitment: CommitmentLevel.CONFIRMED,
				transactions: {
					auction: SubscribeRequestFilterTransactions.create({
						vote: false,
						accountInclude: [
							auctionConfig.toString(), //config
							auctionProgram, //pr
						],
					}),
				},
			});

			// // Sending a subscription request.
			await new Promise<void>((resolve, reject) => {
				stream.write(request, (err: any) => {
					if (err === null || err === undefined) {
						resolve();
					} else {
						reject(err);
					}
				});
			}).catch((reason) => {
				console.error(reason);
				throw reason;
			});
			stream.on('data', async (data) => {
				let orderHash: any;
				try {
					if (data.transaction?.transaction) {
						const signature = binary_to_base58(data.transaction.transaction.signature);
						const message = data.transaction.transaction.transaction.message;
						for (let ix of message.instructions) {
							const programidx = ix.programIdIndex;
							const programId = binary_to_base58(message.accountKeys[programidx]);
							if (programId !== auctionProgram) {
								continue;
							}

							const decoded = coder.decode(ix.data);
							if (decoded?.name !== 'bid') {
								continue;
							}

							const driverIdx = ix.accounts[1];
							const driver = binary_to_base58(message.accountKeys[driverIdx]);

							if (driver === this.driverSolanaAddress) {
								continue;
							}

							const decodeData = decoded.data as any;
							const amountBid64 = decodeData.amountBid.toString();
							const order = decodeData.order;
							orderHash = reconstructOrderHash32(
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
							const orderId = `SWIFT_0x${orderHash.toString('hex')}`;

							const swap = await this.mayanExplorerWatcher.fetchFromExplorerByHash(
								orderHash.toString('hex'),
								2,
							);

							if (!swap) {
								logger.error(`[Rebid] No swap data found for order-id ${orderId}`);
								return;
							}

							if (!driverConfig.acceptedInputChains.has(swap.sourceChain) ||
								!driverConfig.acceptedOutputChains.has(swap.destChain)) {
								logger.info(`Rebid detected on order-id ${orderId} with amount ${amountBid64} but not accepted`);
								return;
							}

							logger.info(`[Rebid] detected on order-id ${orderId} with amount ${amountBid64}`);
							logger.info(`[Rebid] Swap data: sourceChain=${swap.sourceChain}, destChain=${swap.destChain}, sourceTxHash=${swap.sourceTxHash}`);

							if (!amountBid64 || isNaN(Number(amountBid64))) {
								logger.error(`[Rebid] Invalid amountBid64 value: ${amountBid64} for order-id ${orderId}`);
								return;
							}

							try {
								await this.driverService.bid(swap, BigInt(amountBid64));
								logger.info(`[Rebid] Bid done on order-id: ${orderId} trx: ${swap.sourceTxHash}`);
							} catch (bidError: any) {
								logger.error(`[Rebid] Error during bid for order-id ${orderId}: ${bidError.message || bidError}`);
								logger.error(`[Rebid] Bid error stack: ${bidError.stack}`);
							}
						}
					}
				} catch (err: any) {
					logger.error(`[Rebid] Error processing streamed bid: ${err} ${err.stack}`);
				}
			});
		} catch (error) {
			logger.error(`[Rebid] Error starting ReBidListener: ${error}`);
		}
	}
}
