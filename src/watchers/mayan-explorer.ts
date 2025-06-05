import axios from 'axios';
import Decimal from 'decimal.js';
import * as io from 'socket.io-client';
import { ContractsConfig, MayanForwarderAddress } from '../config/contracts';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { TokenList } from '../config/tokens';
import { WalletConfig } from '../config/wallet';
import { StateCloser } from '../driver/state-closer';
import { Relayer } from '../relayer';
import { Swap } from '../swap.dto';
import logger from '../utils/logger';
import { DriverService } from '../driver/driver';

export class MayanExplorerWatcher {
	private initiateAddresses: string[] = [];
	private interval: NodeJS.Timeout | null = null;
	private wonAuctionInterval: NodeJS.Timeout | null = null;
	private auctionLock = false;
	private stateLock = false;
	private auctionInterval: NodeJS.Timeout | null = null;
	private stateInterval: NodeJS.Timeout | null = null;

	constructor(
		private readonly gConf: GlobalConfig,
		private readonly endpoints: MayanEndpoints,
		private readonly walletConf: WalletConfig,
		contracts: ContractsConfig,
		private readonly tokenList: TokenList,
		private readonly relayer: Relayer,
		private readonly driver: DriverService,
		private readonly stateCloser: StateCloser,
	) {
		this.initiateAddresses = [];
		this.initiateAddresses.push(MayanForwarderAddress);
		this.initiateAddresses.push(MayanForwarderAddress.toLowerCase());
		for (let chainId of Object.keys(contracts.contracts)) {
			this.initiateAddresses.push(contracts.contracts[+chainId]);
			this.initiateAddresses.push(contracts.contracts[+chainId].toLowerCase());
		}
	}

	async fetchFromExplorerByHash(orderHash: string, retries: number = 2): Promise<Swap> {
		try {
			const { data } = await axios.get(`${this.endpoints.explorerApiUrl}/v3/swap/order-id/SWIFT_0x${orderHash}?format=raw`);
			return this.createSwapFromJson(data);
		} catch (err) {
			if (retries > 0) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				return this.fetchFromExplorerByHash(orderHash, retries - 1);
			}
			throw err;
		}
	}

	private async createSwapFromJson(rawSwap: any) {
		const fromToken = await this.tokenList.getTokenData(+rawSwap.sourceChain, rawSwap.fromTokenAddress);
		const toToken = await this.tokenList.getTokenData(+rawSwap.destChain, rawSwap.toTokenAddress);
		const swap: Swap = {
			invalidAmountRetires: 0,
			retries: 0,
			trader: rawSwap.trader,
			orderId: rawSwap.orderId,
			sourceTxHash: rawSwap.sourceTxHash,
			gasless: !!rawSwap.gasless,
			gaslessTx: rawSwap.gaslessTx,
			orderHash: rawSwap.orderHash,
			auctionAddress: rawSwap.auctionAddress,
			auctionMode: Number(rawSwap.auctionMode),
			auctionStateAddr: rawSwap.auctionStateAddr,
			createTxHash: rawSwap.createTxHash,
			deadline: new Date(rawSwap.deadline),
			destAddress: rawSwap.destAddress,
			destChain: Number(rawSwap.destChain),
			driverAddress: rawSwap.driverAddress,
			fromToken: fromToken,
			fromAmount: new Decimal(rawSwap.fromAmount),
			fromAmount64: BigInt(rawSwap.fromAmount64),
			fromTokenAddress: rawSwap.fromTokenAddress,
			fromTokenSymbol: rawSwap.fromTokenSymbol,
			gasDrop: new Decimal(rawSwap.gasDrop),
			gasDrop64: BigInt(rawSwap.gasDrop64),
			gaslessPermit: rawSwap.gaslessPermit,
			gaslessSignature: rawSwap.gaslessSignature,
			initiatedAt: new Date(rawSwap.initiatedAt),
			mayanAddress: rawSwap.mayanAddress,
			mayanBps: Number(rawSwap.mayanBps),
			minAmountOut: new Decimal(rawSwap.minAmountOut),
			minAmountOut64: BigInt(rawSwap.minAmountOut64),
			posAddress: rawSwap.posAddress,
			randomKey: rawSwap.randomKey,
			redeemRelayerFee: new Decimal(rawSwap.redeemRelayerFee),
			referrerAddress: rawSwap.referrerAddress,
			referrerBps: Number(rawSwap.referrerBps),
			refundRelayerFee: new Decimal(rawSwap.refundRelayerFee),
			service: rawSwap.service,
			sourceChain: Number(rawSwap.sourceChain),
			stateAddr: rawSwap.stateAddr,
			status: rawSwap.status,
			swapRelayerFee: new Decimal(rawSwap.swapRelayerFee || 0),
			toAmount: rawSwap.toAmount ? new Decimal(rawSwap.toAmount) : undefined,
			toToken: toToken,
			toTokenAddress: rawSwap.toTokenAddress,
			toTokenSymbol: rawSwap.toTokenSymbol,
			unlockRecipient: rawSwap.unlockRecipient,
		};

		return swap;
	}

	init() {
		const socket = io.io(this.endpoints.explorerWsAddress, {
			transports: ['websocket'],
		});

		socket.on('connect', () => {
			logger.info('Connected to Mayan Explorer Socket');

			// Listen for Swap creations
			socket.on('SWAP_CREATED', async (data) => {
				try {
					const rawSwap = JSON.parse(data);
					if (!rawSwap.orderHash || !['SWIFT_NFT', 'SWIFT_SWAP'].includes(rawSwap.service)) {
						return;
					}

					if (rawSwap.status !== 'ORDER_CREATED' && rawSwap.status !== 'ORDER_FULFILLED') {
						return;
					}

					const swap = await this.createSwapFromJson(rawSwap);

					logger.info(
						`Received explorer swap with ` +
							'\x1b[32m' +
							`https://explorer.mayan.finance/swap/${swap.sourceTxHash}`,
					);

					await this.relayer.relay(swap);
				} catch (err) {
					logger.warn(`Error handling explorer swap with ${err}`);
				}
			});
		});

		socket.on('disconnect', () => {
			logger.info('Disconnected from Explorer Socket');
		});

		this.wonAuctionInterval = setInterval(this.pollPendingWonSwapsCount.bind(this), 60 * 1000);
		this.interval = setInterval(this.pollPendingSwaps.bind(this), this.gConf.pollExplorerInterval * 1000);
		this.auctionInterval = setInterval(this.pollOpenAuctions.bind(this), 60 * 1000);
		this.stateInterval = setInterval(this.pollOpenStates.bind(this), 60 * 1000);
	}

	async pollPendingWonSwapsCount(): Promise<void> {
		try {
			const result = await axios.get(this.endpoints.explorerApiUrl + '/v3/swaps', {
				params: {
					format: 'raw',
					status: 'ORDER_CREATED',
					service: 'SWIFT_SWAP',
					auctionInfo: 'true',
					limit: 100,
				},
			});
			let filteredResult = result.data.data.filter((s: any) => {
				return s.auctionInfo?.winner === this.walletConf.solana.publicKey.toString();
			});
			logger.info(`Current pending won swaps count is: ${filteredResult.length}`);
			this.driver.pendingAuctionCount = filteredResult.length;
		} catch (err) {
			logger.error(`error in polling pending won swaps ${err}`);
		}
	}

	async pollPendingSwaps(): Promise<void> {
		try {
			const maxPages = 8;
			for (let page = 0; page <= maxPages; page++) {
				const result = await axios.get(this.endpoints.explorerApiUrl + '/v3/swaps', {
					params: {
						format: 'raw',
						status: 'ORDER_CREATED,ORDER_FULFILLED',
						service: 'SWIFT_SWAP',
						// initiateContractAddresses: this.initiateAddresses.join(','),
						limit: 100,
						offset: page * 100,
					},
				});

				const swaps = result.data.data;
				if (swaps.length == 0) {
					break;
				}

				for (let s of swaps) {
					if (!s.orderHash || !['SWIFT_SWAP'].includes(s.service)) {
						continue;
					}

					if (s.status !== 'ORDER_CREATED' && s.status !== 'ORDER_FULFILLED') {
						continue;
					}

					if (this.relayer.relayingSwaps.find((x) => x.orderId === s.orderId)) {
						logger.verbose(`Already progressing swap ${s.sourceTxHash} ${s.orderId}`);
						continue;
					}

					this.backgroundRelay(s);
				}
			}
		} catch (err) {
			logger.error(`error in polling explorer ${err}`);
		}
	}

	private async backgroundRelay(s: any) {
		try {
			const swap = await this.createSwapFromJson(s);
			this.relayer.relay(swap);
		} catch (err) {
			logger.error(`Background relay failed ${err} ${s}`);
		}
	}

	async pollOpenAuctions(): Promise<void> {
		try {
			if (this.auctionLock) {
				return;
			}
			this.auctionLock = true;

			const result = await axios.get(this.endpoints.explorerApiUrl + '/v3/swift-state/auctions', {
				params: { driver: this.walletConf.solana.publicKey.toString() },
			});

			await this.stateCloser.closeAuctionStates(result.data.map((item: any) => item.auctionState));
		} catch (err) {
			logger.error(`error in polling auciotns ${err}`);
		} finally {
			this.auctionLock = false;
		}
	}

	async pollOpenStates(): Promise<void> {
		try {
			if (this.stateLock) {
				return;
			}
			this.stateLock = true;

			const result = await axios.get(this.endpoints.explorerApiUrl + '/v3/swift-state/swaps', {
				params: { driver: this.walletConf.solana.publicKey.toString() },
			});

			await this.stateCloser.closeDestSolanaStates(result.data.map((item: any) => item.swapState));
		} catch (err) {
			logger.error(`error in polling states ${err}`);
		} finally {
			this.stateLock = false;
		}
	}
}
