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

export class MayanExplorerWatcher {
	private initiateAddresses: string[] = [];
	private interval: NodeJS.Timeout | null = null;
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

	private createSwapFromJson(rawSwap: any) {
		const fromToken = this.tokenList.getTokenData(+rawSwap.sourceChain, rawSwap.fromTokenAddress);
		const toToken = this.tokenList.getTokenData(+rawSwap.destChain, rawSwap.toTokenAddress);
		const swap: Swap = {
			retries: 0,
			trader: rawSwap.trader,
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

					if (!this.initiateAddresses.includes(rawSwap.initiateContractAddress)) {
						logger.info(`Swap droppped because initiateAddress not supported ${rawSwap.sourceTxHash}`);
						return;
					}

					if (rawSwap.status !== 'ORDER_CREATED' && rawSwap.status !== 'ORDER_FULFILLED') {
						return;
					}

					const swap = this.createSwapFromJson(rawSwap);

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

		this.interval = setInterval(this.pollPendingSwaps.bind(this), this.gConf.pollExplorerInterval * 1000);
		this.auctionInterval = setInterval(this.pollOpenAuctions.bind(this), 60 * 1000);
		this.stateInterval = setInterval(this.pollOpenStates.bind(this), 60 * 1000);
	}

	async pollPendingSwaps(): Promise<void> {
		try {
			const result = await axios.get(this.endpoints.explorerApiUrl + '/v3/swaps', {
				params: {
					format: 'raw',
					status: 'ORDER_CREATED,ORDER_FULFILLED',
					service: 'SWIFT_SWAP',
					initiateContractAddresses: this.initiateAddresses.join(','),
					limit: 100,
				},
			});

			const swaps = result.data.data;

			for (let s of swaps) {
				if (!s.orderHash || !['SWIFT_SWAP'].includes(s.service)) {
					continue;
				}

				if (s.status !== 'ORDER_CREATED' && s.status !== 'ORDER_FULFILLED') {
					continue;
				}

				if (this.relayer.relayingSwaps.find((x) => x.orderHash === s.orderHash)) {
					logger.verbose(`Already progressing swap ${s.sourceTxHash}`);
					return;
				}

				const swap = this.createSwapFromJson(s);

				await this.relayer.relay(swap);
			}
		} catch (err) {
			logger.error(`error in polling explorer ${err}`);
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
