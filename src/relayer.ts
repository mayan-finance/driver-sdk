import { Connection } from '@solana/web3.js';
import axios from 'axios';
import Decimal from 'decimal.js';
import { ethers } from 'ethers';
import { CHAIN_ID_SOLANA, WORMHOLE_DECIMALS, supportedChainIds } from './config/chains';
import { ContractsConfig } from './config/contracts';
import { MayanEndpoints } from './config/endpoints';
import { GlobalConfig } from './config/global';
import { RpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { WalletConfig } from './config/wallet';
import { DriverService } from './driver/driver';
import { WalletsHelper } from './driver/wallet-helper';
import { SWAP_STATUS, Swap } from './swap.dto';
import { ChainFinality } from './utils/finality';
import logger from './utils/logger';
import { verifyOrderHash } from './utils/order-hash';
import { getCurrentSolanaTimeMS } from './utils/solana-trx';
import {
	AUCTION_MODES,
	EVM_STATES,
	EvmStoredOrder,
	ParsedAuctionState,
	ParsedState,
	SOLANA_STATES,
	SwiftAuctionParser,
	SwiftStateParser,
} from './utils/state-parser';
import { delay } from './utils/util';
import { getSignedVaa } from './utils/wormhole';

export class Relayer {
	public relayingSwaps: Swap[] = [];

	constructor(
		private readonly rpcConfig: RpcConfig,
		private readonly endpoints: MayanEndpoints,
		private readonly gConf: GlobalConfig,
		private readonly tokenList: TokenList,
		private readonly contractsConfig: ContractsConfig,
		private readonly stateParser: SwiftStateParser,
		private readonly auctionParser: SwiftAuctionParser,
		private readonly walletHelper: WalletsHelper,
		private readonly walletConfig: WalletConfig,
		private readonly solanaConnection: Connection,
		private readonly driverService: DriverService,
		private readonly chainFinality: ChainFinality,
	) {}

	private async tryProgressFulfill(swap: Swap) {
		let solState: ParsedState = null;
		let destEvmOrder: EvmStoredOrder;
		let sourceEvmOrder: EvmStoredOrder;

		if (swap.destChain === CHAIN_ID_SOLANA || swap.auctionMode === AUCTION_MODES.ENGLISH) {
			solState = await this.stateParser.parseSwiftStateAccount(swap.stateAddr);
		}
		[sourceEvmOrder, destEvmOrder] = await Promise.all([
			this.walletHelper.getReadContract(swap.sourceChain).orders(swap.orderHash),
			swap.destChain !== CHAIN_ID_SOLANA
				? this.walletHelper.getReadContract(swap.destChain).orders(swap.orderHash)
				: null,
		]);

		switch (swap.status) {
			case SWAP_STATUS.ORDER_SUBMITTED:
			case SWAP_STATUS.ORDER_CREATED:
				if (new Date().getTime() - swap.deadline.getTime() > 60 * 1000) {
					swap.status = SWAP_STATUS.ORDER_EXPIRED;
					logger.info(`Order is expired for tx: ${swap.sourceTxHash}`);
					break;
				}

				if (swap.destChain === CHAIN_ID_SOLANA) {
					if (swap.auctionMode === AUCTION_MODES.DONT_CARE) {
						await this.submitGaslessOrderIfRequired(swap, sourceEvmOrder);
						await this.waitForFinalizeOnSource(swap);
						await this.simpleFulfillAndSettle(swap, solState);
					} else if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
						await this.bidAndFulfillSolana(swap, solState, sourceEvmOrder);
					} else {
						throw new Error('Unrecognized Auction mode');
					}
				} else {
					if (swap.auctionMode === AUCTION_MODES.DONT_CARE) {
						await this.submitGaslessOrderIfRequired(swap, sourceEvmOrder);
						await this.waitForFinalizeOnSource(swap);
						await this.simpleFulfillEvm(swap, destEvmOrder);
					} else if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
						await this.bidAndFulfillEvm(swap, solState, sourceEvmOrder, destEvmOrder);
					} else {
						throw new Error('Unrecognized Auction mode');
					}
				}
				break;
			case SWAP_STATUS.ORDER_FULFILLED:
				if (swap.destChain === CHAIN_ID_SOLANA) {
					if (solState && solState!.status === SOLANA_STATES.STATUS_SETTLED) {
						logger.info(`Order is already settled on solana for ${swap.sourceTxHash}`);
						swap.status = SWAP_STATUS.ORDER_SETTLED;
						swap.driverAddress = solState!.winner;
					} else if (solState!.winner === this.walletConfig.solana.publicKey.toString()) {
						await this.settle(swap);
					} else {
						await delay(60_000); // someone else is responsible for settling it
					}
				} else {
					throw new Error('Fulfilling on EVM is not valid. check for possible code issues');
				}
				break;
			default:
				throw new Error(`Unrecognized status for ${swap.sourceTxHash}`);
		}
	}

	async relay(swap: Swap) {
		try {
			if (swap.trader.toLowerCase() !== '0x28A328C327307ab1b180327234fDD2a290EFC6DE'.toLowerCase()) {
				logger.warn(`Trader is ignored`);
				return;
			}
			if (swap.sourceChain === CHAIN_ID_SOLANA) {
				logger.warn(`Solana as source is not supported yet on sdk`);
				return;
			}
			if (!supportedChainIds.includes(swap.sourceChain) || !supportedChainIds.includes(swap.destChain)) {
				logger.warn(`Swap chain id is not supported yet on sdk`);
				return;
			}

			verifyOrderHash(
				swap.orderHash,
				swap.trader,
				swap.sourceChain,
				swap.fromTokenAddress,
				swap.fromToken.decimals,
				swap.destChain,
				swap.toTokenAddress,
				swap.toToken.decimals,
				swap.minAmountOut.toFixed(Math.min(swap.toToken.decimals, WORMHOLE_DECIMALS), Decimal.ROUND_DOWN),
				swap.gasDrop.toFixed(8, Decimal.ROUND_DOWN),
				swap.redeemRelayerFee.toFixed(Math.min(swap.fromToken.decimals, WORMHOLE_DECIMALS), Decimal.ROUND_DOWN),
				swap.refundRelayerFee.toFixed(Math.min(swap.fromToken.decimals, 8), Decimal.ROUND_DOWN),
				swap.deadline.getTime() / 1000, // better to throw error if deadline is not in seconds
				swap.destAddress,
				swap.referrerAddress,
				swap.referrerBps,
				swap.mayanBps,
				swap.auctionMode,
				swap.randomKey,
			);

			if (this.relayingSwaps.find((rs) => rs.orderHash === swap.orderHash)) {
				return;
			} else {
				this.relayingSwaps.push(swap);
			}

			if (!this.isInputTokenAcceptable(swap)) {
				logger.warn(`input token is not acceptable for ${swap.sourceTxHash}. discarding...`);
				return;
			}

			if (!this.isMayanInitiatedSwap(swap)) {
				logger.info(`Swap ${swap.sourceTxHash} was not submitted through mayan. discarding...`);
				return;
			}

			logger.info(`Started relaying ${swap.sourceTxHash}`);

			while (!this.finished(swap) && swap.retries < 5) {
				try {
					logger.info(`In while-switch ${swap.sourceTxHash} with status: ${swap.status}`);
					await this.tryProgressFulfill(swap);
				} catch (err) {
					logger.error(`error in main while for tx: ${swap.sourceTxHash} ${err}`);
					let backoff = 1000;
					switch (swap.retries) {
						case 1:
							backoff = 5_000;
							break;
						case 2:
							backoff = 10_000;
							break;
						case 3:
						case 4:
							backoff = 20_000;
							break;
					}
					swap.retries++;
					await delay(backoff);
				} finally {
					await delay(500);
				}
			}

			this.relayingSwaps = this.relayingSwaps.filter((rs) => rs.orderHash !== swap.orderHash);
			logger.info(`Finished relaying ${swap.sourceTxHash}`);
		} catch (relayErr) {
			logger.error(`Relay Failed Critically to for ${swap.sourceTxHash} with err ${relayErr}`);
			this.relayingSwaps = this.relayingSwaps.filter((rs) => rs.orderHash !== swap.orderHash);
			return;
		}
	}

	async submitGaslessOrderIfRequired(swap: Swap, sourceEvmOrder: EvmStoredOrder) {
		if (!swap.gaslessPermit || !swap.gaslessSignature) {
			return; // not gasless
		}

		if (sourceEvmOrder && sourceEvmOrder.destChainId == +swap.destChain) {
			logger.warn(`Order already submitted for ${swap.sourceTxHash}`);
			swap.status = 'ORDER_CREATED';
			if (!swap.createTxHash) {
				throw new Error('Gasless swap is already registered but createTxHash is missing');
			}
			return;
		}

		await this.driverService.submitGaslessOrder(swap);

		logger.info(`Order submitted for ${swap.sourceTxHash}`);
	}

	async bidAndFulfillEvm(
		swap: Swap,
		state: ParsedState,
		sourceEvmOrder: EvmStoredOrder,
		destEvmOrder: EvmStoredOrder,
	) {
		if (await this.checkAlreadyFulfilledOrCanceledOnEvm(swap, destEvmOrder)) {
			return;
		}

		const solanaTime = await getCurrentSolanaTimeMS(this.solanaConnection);
		let auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
		if (!!auctionState && auctionState.winner !== this.walletConfig.solana.publicKey.toBase58()) {
			const openToBid = this.isAuctionOpenToBid(auctionState, solanaTime);
			if (!openToBid) {
				logger.warn(
					`Stopped bidding on ${swap.sourceTxHash} because I'm not the winner and auction is not open`,
				);
				await delay(5000);
				return;
			}
		}

		if (
			!auctionState ||
			auctionState.validUntil * 1000 < solanaTime ||
			state?.winner !== this.walletConfig.solana.publicKey.toBase58()
		) {
			logger.info(`In bid-and-fullfilll evm Bidding for ${swap.sourceTxHash}...`);
			let shouldRegisterOrder = !state;
			await this.driverService.bid(swap, shouldRegisterOrder);
			logger.info(`In bid-and-fullfilll evm done bid for ${swap.sourceTxHash}...`);
		}

		await delay(this.gConf.auctionTimeSeconds * 1000);

		auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
		let maxRetries = 10;
		while (maxRetries > 0 && (!auctionState || auctionState.sequence < 1n)) {
			auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
			await delay(1000);
			maxRetries--;
		}

		if (auctionState?.winner !== this.walletConfig.solana.publicKey.toString()) {
			logger.warn(`Stopped working on ${swap.sourceTxHash} because I'm not the final winner`);
			return;
		}

		const sequence = await this.driverService.postBid(swap, false, true);

		await this.submitGaslessOrderIfRequired(swap, sourceEvmOrder);
		await this.waitForFinalizeOnSource(swap);

		logger.info(`Got sequence ${sequence} for ${swap.sourceTxHash}. Getting auction singed VAA...`);
		const signedVaa = await getSignedVaa(
			this.rpcConfig.wormholeGuardianRpcs,
			CHAIN_ID_SOLANA,
			this.contractsConfig.auctionAddr,
			sequence!.toString(),
		);
		logger.info(`Got auction signed VAA for ${swap.sourceTxHash}. Fulfilling...`);

		await this.driverService.fulfill(swap, signedVaa);

		logger.info(`In bid-and-fullfilll-evm fulfilled ${swap.sourceTxHash}.`);
	}

	async simpleFulfillEvm(swap: Swap, destEvmOrder: EvmStoredOrder) {
		if (await this.checkAlreadyFulfilledOrCanceledOnEvm(swap, destEvmOrder)) {
			return;
		}

		logger.info(`In simpleFulfillEvm for ${swap.sourceTxHash}`);
		await this.driverService.simpleFulFillEvm(swap);
		logger.info(`Finished simpleFulfillEvm for ${swap.sourceTxHash}`);
	}

	async bidAndFulfillSolana(swap: Swap, state: ParsedState, sourceEvmOrder: EvmStoredOrder) {
		if (await this.checkAlreadyFulfilledOrCanceledSolana(swap, state)) {
			return;
		}

		const solanaTime = await getCurrentSolanaTimeMS(this.solanaConnection);
		let auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
		if (!!auctionState && auctionState.winner !== this.walletConfig.solana.publicKey.toString()) {
			const openToBid = this.isAuctionOpenToBid(auctionState, solanaTime);
			if (!openToBid) {
				logger.info(
					`Stopped bidding on ${swap.sourceTxHash} because I'm not the winner and auction is not open`,
				);
				await delay(5000);
				return;
			}
		}

		if (
			!auctionState ||
			auctionState.validUntil * 1000 < solanaTime ||
			state?.winner !== this.walletConfig.solana.publicKey.toBase58()
		) {
			logger.info(`In bid-and-fullfilll Bidding for ${swap.sourceTxHash}...`);
			let shouldRegisterOrder = !state;
			await this.driverService.bid(swap, shouldRegisterOrder);
			logger.info(`In bid-and-fullfilll done bid for ${swap.sourceTxHash}...`);
		}

		await delay(this.gConf.auctionTimeSeconds * 1000);

		auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
		let maxRetries = 10;
		while (maxRetries > 0 && auctionState?.winner !== this.walletConfig.solana.publicKey.toString()) {
			auctionState = await this.auctionParser.parseState(swap.auctionStateAddr);
			await delay(1000);
			maxRetries--;
		}

		if (auctionState?.winner !== this.walletConfig.solana.publicKey.toString()) {
			logger.warn(`Stopped working on ${swap.sourceTxHash} because I'm not the final winner`);
			return;
		}

		await this.driverService.postBid(swap, true, false);

		await this.submitGaslessOrderIfRequired(swap, sourceEvmOrder);
		await this.waitForFinalizeOnSource(swap);

		await this.waitForFinalizeOnSource(swap);

		logger.info(`In bid-and-fullfilll Sending fulfill for ${swap.sourceTxHash}...`);
		let fulfillRetries = 0;
		while (true) {
			try {
				await this.driverService.fulfill(swap);
				break;
			} catch (err) {
				if (fulfillRetries > 3) {
					throw err;
				} else {
					logger.warn(
						`Fulfilling ${swap.sourceTxHash} failed On try ${fulfillRetries} because ${err}. Retrying...`,
					);
					fulfillRetries++;
				}
			}
		}
		logger.info(`In bid-and-fulfilll Sent fulfill for ${swap.sourceTxHash}`);
		swap.status = SWAP_STATUS.ORDER_FULFILLED;
	}

	async simpleFulfillAndSettle(swap: Swap, state: ParsedState) {
		if (await this.checkAlreadyFulfilledOrCanceledSolana(swap, state)) {
			return;
		}
		await this.driverService.auctionLessFulfillAndSettleSolana(swap);

		swap.status = SWAP_STATUS.ORDER_SETTLED;
	}

	private async settle(swap: Swap) {
		logger.info(`Settling ${swap.sourceTxHash}`);
		let state = await this.stateParser.parseSwiftStateAccount(swap.stateAddr);
		if (!state) {
			throw new Error(`Failed to get state while settling`);
		}
		if (state.status === SOLANA_STATES.STATUS_SETTLED || state.status === SOLANA_STATES.STATUS_UNLOCKED) {
			logger.info(`discarding settle tx cause order already settled for ${swap.sourceTxHash}`);
			swap.status = SWAP_STATUS.ORDER_SETTLED;
		} else if (state.status === SOLANA_STATES.STATUS_FULFILLED) {
			logger.info(`Settle tx started for ${swap.sourceTxHash}`);
			await this.driverService.settle(swap);
			logger.info(`Settle tx done for ${swap.sourceTxHash}`);
			swap.status = SWAP_STATUS.ORDER_SETTLED;
		}
	}

	async waitForFinalizeOnSource(swap: Swap) {
		logger.info(`trying to fulfill. waiting for finality for tx: ${swap.sourceTxHash}`);
		const startTime = Date.now();
		const fromToken = swap.fromToken;
		const prices = await axios.get(this.endpoints.priceApiUrl + '/v3/price/list', {
			params: {
				ids: [fromToken.coingeckoId].join(','),
			},
		});
		const swapValueUsd = swap.fromAmount.toNumber() * prices.data[fromToken.coingeckoId];

		let realSourceTxHash = !swap.gaslessSignature ? swap.sourceTxHash : swap.createTxHash;

		await this.chainFinality.waitForFinality(swap.sourceChain, realSourceTxHash, swapValueUsd);
		logger.info(
			`tx: ${swap.sourceTxHash} is finalized after
			${(Date.now() - startTime) / 1000} seconds. now fulfilling...`,
		);
	}

	private async checkAlreadyFulfilledOrCanceledSolana(swap: Swap, state: ParsedState): Promise<boolean> {
		if (state) {
			if ([SOLANA_STATES.STATUS_FULFILLED, SOLANA_STATES.STATUS_SETTLED].includes(state.status)) {
				logger.info(`Order already fulfilled for ${swap.sourceTxHash}`);
				swap.status = SWAP_STATUS.ORDER_FULFILLED;
				swap.driverAddress = state.winner;
				return true;
			} else if ([SOLANA_STATES.STATUS_CANCELLED].includes(state.status)) {
				logger.info(`Order already canceled for ${swap.sourceTxHash}`);
				swap.status = SWAP_STATUS.ORDER_CANCELED;
				return true;
			}

			return false;
		}
		return false;
	}

	private async checkAlreadyFulfilledOrCanceledOnEvm(swap: Swap, destEvmOrder: EvmStoredOrder): Promise<boolean> {
		if (destEvmOrder && destEvmOrder.status == EVM_STATES.FULFILLED) {
			logger.info(`Order was already fulfilled on evm for ${swap.sourceTxHash}`);
			swap.status = SWAP_STATUS.ORDER_SETTLED;
			return true;
		} else if (destEvmOrder && destEvmOrder.status == EVM_STATES.CANCELED) {
			logger.info(`Order was already canceled on evm for ${swap.sourceTxHash}`);
			swap.status = SWAP_STATUS.ORDER_CANCELED;
			return true;
		}

		return false;
	}

	private isAuctionOpenToBid(auction: ParsedAuctionState, solanaTime: number): boolean {
		if (auction.validFrom <= solanaTime && auction.validUntil >= solanaTime) {
			return false;
		}
		return true;
	}

	private finished(swap: Swap) {
		return (
			swap.status === SWAP_STATUS.ORDER_CANCELED ||
			swap.status === SWAP_STATUS.ORDER_SETTLED ||
			swap.status === SWAP_STATUS.ORDER_REFUNDED ||
			swap.status === SWAP_STATUS.ORDER_UNLOCKED ||
			swap.status === SWAP_STATUS.UNLOCK_SEQUENCE_RECEIVED ||
			swap.status === SWAP_STATUS.ORDER_EXPIRED
		);
	}

	private isInputTokenAcceptable(swap: Swap) {
		// We only accept ETH and USDC as input tokens in our quote API so we are ignoring anything
		const [eth, usdc] = [this.tokenList.getEth(swap.sourceChain), this.tokenList.getNativeUsdc(swap.sourceChain)];

		return [eth?.contract, usdc?.contract].includes(swap.fromToken.contract);
	}

	private isMayanInitiatedSwap(swap: Swap) {
		// Only fulfill swaps that were initiated via mayan
		return ethers.getAddress(swap.mayanAddress) === this.contractsConfig.contracts[swap.sourceChain];
	}
}
