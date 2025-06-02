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

const coder = new BorshInstructionCoder(SwiftAuction);

export class ReBidListener {
	constructor(
		private readonly driverSolanaAddress: string,
		private readonly globalConfig: GlobalConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly mayanExplorerWatcher: MayanExplorerWatcher,
		private readonly driverService: DriverService,
	) {}

	public async start() {
		if (!this.globalConfig.rebidEnabled) {
			logger.info('Rebid is not enabled');
			return;
		}

		try {
			if (!this.rpcConfig.solana.geyser.endpoint) {
				logger.error('Geyser endpoint is not configured');
				return;
			}

			const client = new Client(
				this.rpcConfig.solana.geyser.endpoint,
				this.rpcConfig.solana.geyser.apiKey,
				undefined,
			);

			const version = await client.getVersion(); // gets the version information
			logger.info('solana geyserversion', version);
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
							logger.info(`Rebid detected on order-id ${orderId} with amount ${amountBid64}`);

							const swap = await this.mayanExplorerWatcher.fetchFromExplorerByHash(
								orderHash.toString('hex'),
								2,
							);
							await this.driverService.bid(swap, BigInt(amountBid64));
							logger.info(`Rebid done on order-id: ${orderId} trx: ${swap.sourceTxHash}`);
						}
					}
				} catch (err: any) {
					logger.error(`Error processing streamed bid: ${err} ${err.stack}`);
				}
			});
		} catch (error) {
			logger.error(`Error starting ReBidListener: ${error}`);
		}
	}
}
