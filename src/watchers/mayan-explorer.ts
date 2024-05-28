import Decimal from 'decimal.js';
import * as io from 'socket.io-client';
import { MayanEndpoints } from '../config/endpoints';
import { TokenList } from '../config/tokens';
import { Relayer } from '../relayer';
import { Swap } from '../swap.dto';
import logger from '../utils/logger';

export class MayanExplorerWatcher {
	private readonly endpoints: MayanEndpoints;
	private readonly relayer: Relayer;

	constructor(
		endpoints: MayanEndpoints,
		relayer: Relayer,
		private readonly tokenList: TokenList,
	) {
		this.endpoints = endpoints;
		this.relayer = relayer;
	}

	private createSwapFromJson(rawSwap: any) {
		const fromToken = this.tokenList.getTokenData(+rawSwap.sourceChain, rawSwap.fromTokenAddress);
		const toToken = this.tokenList.getTokenData(+rawSwap.destChain, rawSwap.toTokenAddress);
		const swap: Swap = {
			retries: 0,
			trader: rawSwap.trader,
			sourceTxHash: rawSwap.sourceTxHash,
			orderHash: rawSwap.orderHash,
			auctionAddress: rawSwap.auctionAddress,
			auctionMode: Number(rawSwap.auctionModel),
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

					const swap = this.createSwapFromJson(rawSwap);

					logger.info(`Received explorer swap with ` + '\x1b[32m' + `https://explorer.mayan.finance/swap/${swap.sourceTxHash}`);

					await this.relayer.relay(swap);
				} catch (err) {
					logger.warn(`Error handling explorer swap with ${err}`);
				}
			});
		});

		socket.on('disconnect', () => {
			logger.info('Disconnected from Explorer Socket');
		});
	}

	async getOwnedInProgressSwaps(driverAddress: string): Promise<Swap[]> {
		// TODO fill and use this
		return [];
	}

	async getOwnedCompletedLockedSwaps(driverAddress: string): Promise<Swap[]> {
		// TODO fill and use this
		return [];
	}
}
