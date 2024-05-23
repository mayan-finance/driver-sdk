import { supportedChainIds } from "./config/chains";
import { Swap } from "./swap.dto";
import logger from "./utils/logger";

export class Relayer {
	private relayingSwaps: Swap[] = [];

	async relay(swap: Swap) {
		try {
			if (!supportedChainIds.includes(swap.sourceChain) || !supportedChainIds.includes(swap.destChain)) {
				logger.warn(`Swap chain id is not supported yet on sdk`);
				return;
			}

			// verifyOrderHash(
			// 	swap.orderHash,
			// 	swap.trader,
			// 	+swap.sourceChain as ChainId,
			// 	swap.fromTokenAddress,
			// 	fromToken.decimals,
			// 	+swap.destChain as ChainId,
			// 	swap.toTokenAddress,
			// 	toToken.decimals,
			// 	swap.minAmountOut.toFixed(Math.min(toToken.decimals, 8), Prisma.Decimal.ROUND_DOWN),
			// 	swap.gasDrop.toFixed(8, Prisma.Decimal.ROUND_DOWN),
			// 	swap.redeemRelayerFee.toFixed(Math.min(fromToken.decimals, 8), Prisma.Decimal.ROUND_DOWN),
			// 	swap.refundRelayerFee.toFixed(Math.min(fromToken.decimals, 8), Prisma.Decimal.ROUND_DOWN),
			// 	swap.deadline.getTime() / 1000,
			// 	swap.destAddress,
			// 	swap.referrerAddress,
			// 	swap.referrerBps,
			// 	swap.mayanBps,
			// 	swap.auctionMode,
			// 	swap.randomKey,
			// );

			// if (this.relayingSwaps.find(rs => rs.orderHash === swap.orderHash)) {
			// 	return;
			// } else {
			// 	this.relayingSwaps.push(swap);
			// }

			// if (!this.isInputTokenAcceptable(swap)) {
			// 	this.logger.warn(`input token is not acceptable for ${swap.sourceTxHash}. discarding...`);
			// 	return;
			// }

			// if (
			// 	ethers.utils.getAddress(swap.mayanAddress) !== this.swiftConfig.contracts[+swap.sourceChain][0]
			// ) {
			// 	this.logger.warn(`Mayan address is not valid for ${swap.sourceTxHash}. discarding...`);
			// 	return;
			// }

			// this.logger.log(`relaying: ${swap.sourceTxHash}`);

			// while (!this.isJobDone(swap) && swap.retries < 10) {
			// 	try {
			// 		this.logger.log(`in swift while-switch ${swap.sourceTxHash} with status: ${swap.status}`);
			// 		await this._relaySwitch(swap);
			// 	} catch (err) {
			// 		this.logger.error(`error in main swift while for tx: ${swap.sourceTxHash} ${err}`);

			// 		let backoff = 1000;
			// 		switch (swap.retries) {
			// 			case 0: backoff = 5_000; break;
			// 			case 1: backoff = 5_000; break;
			// 			case 2: backoff = 10_000; break;
			// 			case 3: backoff = 20_000; break;
			// 			case 4: backoff = 40_000; break;
			// 			case 5: backoff = 50_000; break;
			// 			default: backoff = 60_000; break;
			// 		}
			// 		if (backoff < 0) {
			// 			backoff = 0;
			// 		}

			// 		swap.retries++;
			// 		this.logger.log(`swap retries in catch  ${swap.retries} for ${swap.sourceTxHash}`);
			// 		await this.swapService.updateSwap({ where: { id: swap.id }, data: { retries: swap.retries } });
			// 		await delay(backoff);
			// 		this.logger.log(`end of backoff for ${swap.sourceTxHash}`);
			// 	} finally {
			// 		swap = await this.swapService.swap({ id: swap.id });
			// 		await delay(1000);
			// 		this.logger.log(`swap retries in finally ${swap.retries} for ${swap.sourceTxHash}`);
			// 	}
			// }

			this.relayingSwaps = this.relayingSwaps.filter((rs) => rs.orderHash !== swap.orderHash);
			logger.info(`Finished relaying ${swap.sourceTxHash}`);
		} catch (relayErr) {
			logger.error(`Relay Failed Critically to relay tx: ${swap.sourceTxHash} with err ${relayErr}`);
			this.relayingSwaps = this.relayingSwaps.filter((rs) => rs.orderHash !== swap.orderHash);
			return;
		}
	}
}
