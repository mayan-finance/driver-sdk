import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import Decimal from 'decimal.js';
import { ethers } from 'ethers6';
import { CHAIN_ID_BSC, CHAIN_ID_SOLANA, WORMHOLE_DECIMALS, supportedChainIds } from './config/chains';
import { ContractsConfig } from './config/contracts';
import { MayanEndpoints } from './config/endpoints';
import { GlobalConfig } from './config/global';
import { RpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { WalletConfig } from './config/wallet';
import { driverConfig } from './driver.conf';
import { DriverService } from './driver/driver';
import { WalletsHelper } from './driver/wallet-helper';
import { SWAP_STATUS, Swap } from './swap.dto';
import { ChainFinality } from './utils/finality';
import logger from './utils/logger';
import { verifyOrderHash } from './utils/order-hash';
import { getCurrentSolanaTimeMS } from './utils/solana-trx';
import {
	AUCTION_MODES,
	AuctionState,
	EVM_STATES,
	EvmStoredOrder,
	POST_FULFILL_STATUSES,
	SOLANA_DEST_STATUSES,
	SwiftDestState,
	SwiftSourceState,
	getSwiftStateDest,
	getSwiftStateSrc,
} from './utils/state-parser';
import { delay } from './utils/util';
import { getSignedVaa } from './utils/wormhole';
import { DB_PATH, getRebalanceAmount, getRebalanceIsCreated, RebalanceStatus, setRebalanceIsCreated } from './utils/sqlite3';
import { Rebalancer } from './rebalancer';
import { AuctionListener, BidState } from './auction-listener';

export class Relayer {
	public relayingSwaps: Swap[] = [];

	constructor(
		private readonly rpcConfig: RpcConfig,
		private readonly endpoints: MayanEndpoints,
		private readonly gConf: GlobalConfig,
		private readonly tokenList: TokenList,
		private readonly contractsConfig: ContractsConfig,
		private readonly walletHelper: WalletsHelper,
		private readonly walletConfig: WalletConfig,
		private readonly solanaConnection: Connection,
		private readonly driverService: DriverService,
		private readonly chainFinality: ChainFinality,
		private readonly rebalancer: Rebalancer,
		private readonly auctionListener: AuctionListener,
	) { }

	private async tryProgressFulfill(swap: Swap) {
		const isSolDst = swap.destChain === CHAIN_ID_SOLANA;
		const isSolSrc = swap.sourceChain === CHAIN_ID_SOLANA;
		let [destState, destEvmOrder, sourceState, sourceEvmOrder] = await Promise.all([
			isSolDst ? getSwiftStateDest(this.solanaConnection, new PublicKey(swap.stateAddr)) : null,
			!isSolDst ? this.walletHelper.getReadContract(swap.destChain).orders(swap.orderHash) : null,
			isSolSrc ? getSwiftStateSrc(this.solanaConnection, new PublicKey(swap.stateAddr)) : null,
			!isSolSrc ? this.walletHelper.getReadContract(swap.sourceChain).orders(swap.orderHash) : null,
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
					if (swap.auctionMode === AUCTION_MODES.ENGLISH || swap.auctionMode === AUCTION_MODES.DONT_CARE) {
						await this.bidAndFulfillSolana(swap, destState!, sourceState, sourceEvmOrder);
					} else {
						throw new Error('Unrecognized Auction mode');
					}
				} else {
					if (swap.auctionMode === AUCTION_MODES.ENGLISH || swap.auctionMode === AUCTION_MODES.DONT_CARE) {
						await this.bidAndFulfillEvm(swap, sourceState, sourceEvmOrder, destEvmOrder!);
					} else {
						throw new Error('Unrecognized Auction mode');
					}
				}
				break;
			case SWAP_STATUS.ORDER_FULFILLED:
				if (swap.destChain === CHAIN_ID_SOLANA) {
					if (destState && POST_FULFILL_STATUSES.includes(destState.status)) {
						logger.info(`Order is already settled on solana for ${swap.sourceTxHash}`);
						swap.status = SWAP_STATUS.ORDER_SETTLED;
					} else if (destState?.winner === this.walletConfig.solana.publicKey.toString()) {
						await this.settle(swap);
					} else {
						await delay(5000); // not fulfilled by me
						break;
					}
				} else {
					throw new Error('ORDER_FULFILLED on EVM is not valid and Must not happen');
				}
				break;
			default:
				throw new Error(`Unrecognized status for ${swap.sourceTxHash}`);
		}
	}

	async relay(swap: Swap) {
		try {
			if (!supportedChainIds.includes(swap.sourceChain) || !supportedChainIds.includes(swap.destChain)) {
				logger.warn(`Swap chain id is not supported yet on sdk for ${swap.sourceTxHash}`);
				return;
			}

			if (
				!driverConfig.acceptedInputChains.has(swap.sourceChain) ||
				!driverConfig.acceptedOutputChains.has(swap.destChain)
			) {
				logger.warn(`Swap chain id is disabled in driver conf for ${swap.sourceTxHash}`);
				return;
			}

			if (
				this.gConf.whiteListedReferrerAddresses.size > 0 &&
				!this.gConf.whiteListedReferrerAddresses.has(swap.referrerAddress)
			) {
				logger.warn(
					`Whitelist enabled and referrer address ${swap.referrerAddress} is not whitelisted for ${swap.sourceTxHash}. discarding...`,
				);
				return;
			}

			if (
				(this.gConf.ignoreReferrers.has(swap.referrerAddress) ||
					this.gConf.blackListedReferrerAddresses.has(swap.referrerAddress)) &&
				!this.gConf.whiteListedReferrerAddresses.has(swap.referrerAddress)
			) {
				logger.warn(`Referrer address is blacklisted/ignored for ${swap.sourceTxHash}. discarding...`);
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

			while (!this.finished(swap) && swap.retries < 15) {
				try {
					logger.info(`In while-switch ${swap.sourceTxHash} with status: ${swap.status} ${swap.retries}`);
					await this.tryProgressFulfill(swap);
				} catch (err: any) {
					logger.error(`error in main while for tx: ${swap.sourceTxHash} ${err}`);
					let backoff = 500;
					// switch (swap.retries) {
					// 	case 1:
					// 		backoff = 1_000;
					// 		break;
					// 	case 2:
					// 		backoff = 2_000;
					// 		break;
					// 	case 3:
					// 		backoff = 5_000;
					// 		break;
					// 	case 4:
					// 		backoff = 10_000;
					// 	case 5:
					// 		backoff = 20_000;
					// 		break;
					// 	case 6:
					// 		backoff = 30_000;
					// 		break;
					// 	default:
					// 		break;
					// }
					if (swap.retries > 6) {
						backoff = 1_500;
					}
					swap.retries++;
					const isLowAmountOutSolana = err?.solError?.InstructionError?.[1]?.Custom === 6014; // solana calldata for InvalidAmountOut()
					const isLowAmountOutEvm = err?.data === '0x2c5211c6'; // evm calldata for InvalidAmountOut()
					if (isLowAmountOutSolana || isLowAmountOutEvm) {
						logger.warn(`Invalid amount out for ${swap.sourceTxHash}. Increasing retries`);
						swap.invalidAmountRetires++;
					}

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

	async bidAndFulfillEvm(
		swap: Swap,
		srcState: SwiftSourceState | null,
		sourceEvmOrder: EvmStoredOrder | null,
		destEvmOrder: EvmStoredOrder,
	) {
		if (await this.checkAlreadyFulfilledOrCanceledOnEvm(swap, destEvmOrder)) {
			return;
		}

		let auctionSignedVaa: Uint8Array | undefined;
		if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
			let winner = null;
			let lastBidTimestamp = null;
			while (winner === null) {
				let [solanaTime, auctionState] = await Promise.all([
					getCurrentSolanaTimeMS(this.solanaConnection),
					this.auctionListener.getAuctionState(swap.auctionStateAddr),
				]);
				this.auctionListener.getAuctionState(swap.auctionStateAddr, true); // force solana to get the latest state without await
				if (auctionState && auctionState.winner !== this.walletConfig.solana.publicKey.toString()) {
					if (!this.isAuctionOpenToBid(auctionState, solanaTime) || Date.now() - auctionState.firstBidTime > this.gConf.auctionTimeSeconds * 1000 - 1000 || auctionState.isClosed) {
						return;
					} else {
						if (auctionState.timestamp == lastBidTimestamp) {
							await delay(100);
							continue;
						}
						try {
							logger.info(`In bid-and-fullfilll evm Bidding for ${swap.sourceTxHash}...`);
							await this.driverService.bid(swap, BigInt(auctionState?.amountPromised ?? 0));
							logger.info(`In bid-and-fullfilll evm done bid for ${swap.sourceTxHash}...`);
							lastBidTimestamp = auctionState.timestamp;
						} catch (err) {
							logger.warn(`Failed to bid on ${swap.sourceTxHash} because ${err}`);
						}
						await delay(100);
					}
				} else if (auctionState && auctionState.winner === this.walletConfig.solana.publicKey.toString()) {
					if (!this.isAuctionOpenToBid(auctionState, solanaTime)) {
						winner = auctionState.winner;
						break;
					}
					await delay(100);
				} else {
					try {
						logger.info(`In bid-and-fullfilll evm Bidding for ${swap.sourceTxHash}...`);
						await this.driverService.bid(swap, BigInt(auctionState?.amountPromised ?? 0));
						logger.info(`In bid-and-fullfilll evm done bid for ${swap.sourceTxHash}...`);
					} catch (err) {
						logger.warn(`Failed to bid on ${swap.sourceTxHash} because ${err}`);
					}
					await delay(500);
				}
			}
			logger.info(`I'm the winner. fulfill for ${swap.sourceTxHash}...`);

			let auctionState = await this.auctionListener.getAuctionState(swap.auctionStateAddr);
			swap.bidAmount64 = auctionState?.amountPromised;
			let sequence: bigint | undefined = auctionState?.sequence;
			try {
				if (!sequence || sequence < 1n) {
					sequence = (await this.driverService.postBid(swap, false, true))!.sequence!;

					if (getRebalanceIsCreated(DB_PATH, swap.orderId) === RebalanceStatus.IS_NOT_CREATED) {
						const amount = getRebalanceAmount(DB_PATH, swap.orderId);
						this.rebalancer.forceRebalance(swap.destChain, amount, swap.orderId);
						setRebalanceIsCreated(DB_PATH, swap.orderId, true);
					}
				} else {
					sequence = sequence - 1n;
				}
			} catch (err) {
				auctionState = await this.auctionListener.getAuctionState(swap.auctionStateAddr);
				if (!!auctionState && auctionState?.winner !== this.walletConfig.solana.publicKey.toString()) {
					logger.warn(`Stopped working on ${swap.sourceTxHash} because I'm not the final winner`);
					return;
				}
			}

			// // TODO: remove debug
			// logger.info(`debugggggg not fulfill`);
			// return;
			await this.waitForFinalizeOnSource(swap);

			logger.info(`Got sequence ${sequence} for ${swap.sourceTxHash}. Getting auction singed VAA...`);
			auctionSignedVaa = await getSignedVaa(
				this.rpcConfig.wormholeGuardianRpcs,
				CHAIN_ID_SOLANA,
				this.contractsConfig.auctionAddr,
				sequence!.toString(),
				500,
			);
			logger.info(`Got auction signed VAA for ${swap.sourceTxHash}. Fulfilling...`);
		} else {
			logger.info(`Simple mode evm fulfilling ${swap.sourceTxHash}...`);
		}

		// // TODO: remove debug
		// logger.info(`debugggggg not fulfill`);
		// return;

		await this.driverService.fulfill(swap, auctionSignedVaa);

		logger.info(`In bid-and-fullfilll-evm fulfilled ${swap.sourceTxHash}.`);
	}

	async bidAndFulfillSolana(
		swap: Swap,
		destState: SwiftDestState,
		srcState: SwiftSourceState | null,
		sourceEvmOrder: EvmStoredOrder | null,
	) {
		if (await this.checkAlreadyFulfilledOrCanceledSolana(swap, destState)) {
			return;
		}

		if (swap.auctionMode === AUCTION_MODES.ENGLISH) {
			let winner = null;
			let lastBidTimestamp = null;
			while (winner === null) {
				let [solanaTime, auctionState] = await Promise.all([
					getCurrentSolanaTimeMS(this.solanaConnection),
					this.auctionListener.getAuctionState(swap.auctionStateAddr),
				]);
				this.auctionListener.getAuctionState(swap.auctionStateAddr, true); // force solana to get the latest state without await
				if (auctionState && auctionState.winner !== this.walletConfig.solana.publicKey.toString()) {
					if (!this.isAuctionOpenToBid(auctionState, solanaTime) || Date.now() - auctionState.firstBidTime > this.gConf.auctionTimeSeconds * 1000 - 1000 || auctionState.isClosed) {
						return;
					} else {
						if (auctionState.timestamp == lastBidTimestamp) {
							await delay(100);
							continue;
						}
						try {
							logger.info(`In bid-and-fullfilll solana Bidding for ${swap.sourceTxHash}...`);
							await this.driverService.bid(swap, auctionState?.amountPromised ?? 0n);
							logger.info(`In bid-and-fullfilll solana done bid for ${swap.sourceTxHash}...`);
							lastBidTimestamp = auctionState.timestamp;
						} catch (err) {
							logger.warn(`Failed to bid on ${swap.sourceTxHash} because ${err}`);
						}
						await delay(100);
					}
				} else if (auctionState && auctionState.winner === this.walletConfig.solana.publicKey.toString()) {
					if (!this.isAuctionOpenToBid(auctionState, solanaTime)) {
						winner = auctionState.winner;
						break;
					}
					await delay(100);
				} else {
					try {
						logger.info(`In bid-and-fullfilll solana Bidding for ${swap.sourceTxHash}...`);
						await this.driverService.bid(swap, auctionState?.amountPromised ?? 0n);
						logger.info(`In bid-and-fullfilll solana done bid for ${swap.sourceTxHash}...`);
					} catch (err) {
						logger.warn(`Failed to bid on ${swap.sourceTxHash} because ${err}`);
					}
					await delay(500);
				}
			}
			logger.info(`I'm the winner. fulfill for ${swap.sourceTxHash}...`);

			let auctionState = await this.auctionListener.getAuctionState(swap.auctionStateAddr);
			swap.bidAmount64 = auctionState?.amountPromised;
		} else {
			let alreadyRegisteredOrder = !!destState;
			if (!alreadyRegisteredOrder) {
				logger.info(`Registering order for simple-fulfill`);
				await this.driverService.registerOrder(swap);
				logger.info(`Order registered for ${swap.sourceTxHash}`);
			}
		}

		// await this.submitGaslessOrderIfRequired(swap, srcState, sourceEvmOrder);

		let driverToken = this.driverService.getDriverSolanaTokenForBidAndSwap(swap.sourceChain, swap.fromToken);
		if (driverToken.contract === swap.toToken.contract) {
			await this.waitForFinalizeOnSource(swap);
			await this.driverService.solanaFulfillAndSettlePackage(swap);
			swap.status = SWAP_STATUS.ORDER_SETTLED;
		} else {
			await this.waitForFinalizeOnSource(swap);
			if (this.rpcConfig.solana.fulfillTxMode === 'JITO') {
				try {
					// send everything as bundle. If we fail to land under like 10 seconds, fall back to sending txs separately
					await this.driverService.solanaFulfillAndSettleJitoBundle(swap);
					swap.status = SWAP_STATUS.ORDER_SETTLED;
					return;
				} catch (e: any) {
					logger.warn(
						`Failed to send bundle for ${swap.sourceTxHash}. Falling back to sending each tx separately. errors: ${e} ${e.stack}`,
					);
				}
			}

			let alreadyRegisteredWinner =
				swap.auctionMode === AUCTION_MODES.DONT_CARE ||
				(!!destState?.winner && destState?.winner !== '11111111111111111111111111111111');
			const stateToAss = getAssociatedTokenAddressSync(
				new PublicKey(swap.toToken.mint),
				new PublicKey(swap.stateAddr),
				true,
				swap.toToken.standard === 'spl2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
			);
			let stateToAssData = await this.solanaConnection.getAccountInfo(stateToAss);
			let createStateToAss = !stateToAssData || stateToAssData.lamports === 0;
			let alreadyRegisteredOrder = !!destState;
			if (createStateToAss || !alreadyRegisteredWinner) {
				await this.driverService.postBid(
					swap,
					createStateToAss,
					false,
					false,
					alreadyRegisteredWinner,
					alreadyRegisteredOrder,
				);
			}

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
	}

	private async settle(swap: Swap) {
		logger.info(`Settling ${swap.sourceTxHash}`);

		logger.info(`Settle tx started for ${swap.sourceTxHash}`);
		await this.driverService.settle(swap);
		logger.info(`Settle tx done for ${swap.sourceTxHash}`);
		swap.status = SWAP_STATUS.ORDER_SETTLED;
	}

	async waitForFinalizeOnSource(swap: Swap) {
		logger.info(`trying to fulfill. waiting for finality for tx: ${swap.sourceTxHash}`);
		const startTime = Date.now();
		const fromToken = swap.fromToken;
		let swapValueUsd = swap.fromAmount.toNumber();
		if (fromToken.symbol === 'ETH' || fromToken.symbol === 'WETH') {
			swapValueUsd *= 4000; // TODO: get real eth price
		}

		if (swap.gasless && !swap.createTxHash) {
			await this.fetchCreateTxFromExplorer(swap);
		}
		let realSourceTxHash = !swap.gasless ? swap.sourceTxHash : swap.createTxHash;

		await this.chainFinality.waitForFinality(swap.sourceChain, realSourceTxHash, swapValueUsd);
		logger.info(
			`tx: ${swap.sourceTxHash} is finalized after
			${(Date.now() - startTime) / 1000} seconds. now fulfilling...`,
		);
	}

	private async fetchCreateTxFromExplorer(swap: Swap) {
		let maxRetries = 5;
		while (maxRetries-- > 0) {
			const { data: rawSwap } = await axios.get(
				this.endpoints.explorerApiUrl + `/v3/swap/trx/${swap.sourceTxHash}`,
			);
			if (rawSwap?.createTxHash) {
				swap.createTxHash = rawSwap.createTxHash;
				return;
			}
			await delay(4000);
		}
		throw new Error(`Failed to get createTxHash for gasless from mayan ${swap.sourceTxHash}`);
	}

	private async checkAlreadyFulfilledOrCanceledSolana(swap: Swap, state: SwiftDestState | null): Promise<boolean> {
		if (state) {
			if (state.status === SOLANA_DEST_STATUSES.FULFILLED) {
				// MIGHT NEED SETTLE So matters
				swap.status = SWAP_STATUS.ORDER_FULFILLED;
				swap.driverAddress = state.winner!;
				return true;
			} else if (POST_FULFILL_STATUSES.includes(state.status)) {
				logger.info(`Order already settled for ${swap.sourceTxHash}`);
				swap.status = SWAP_STATUS.ORDER_SETTLED;
				return true;
			} else if ([SOLANA_DEST_STATUSES.CANCELLED, SOLANA_DEST_STATUSES.CLOSED_CANCEL].includes(state.status)) {
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

	private isAuctionOpenToBid(auction: AuctionState | BidState, solanaTime: number): boolean {
		if (auction.validFrom <= solanaTime) {
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
		// We only accept ETH and USDC as input tokens (except for bsc) in our quote API so we are ignoring anything
		let acceptedTokens = [
			this.tokenList.getEth(swap.sourceChain),
			this.tokenList.getNativeUsdc(swap.sourceChain),
			this.tokenList.getWethSol(),
		];
		if (swap.sourceChain === CHAIN_ID_BSC) {
			acceptedTokens.push(this.tokenList.getNativeUsdt(swap.sourceChain));
		}

		return acceptedTokens.map((t) => t?.contract).includes(swap.fromToken.contract);
	}

	private isMayanInitiatedSwap(swap: Swap) {
		// Only fulfill swaps that were initiated via mayan
		if (swap.sourceChain === CHAIN_ID_SOLANA) {
			return swap.mayanAddress === this.contractsConfig.contracts[swap.sourceChain];
		} else {
			return ethers.getAddress(swap.mayanAddress) === this.contractsConfig.contracts[swap.sourceChain];
		}
	}
}
