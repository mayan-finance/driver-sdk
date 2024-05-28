import { Swap } from './swap.dto';
import { SwiftCosts } from './utils/fees';

export class Auction {
	/**
	 * Specfiy if the driver will participate in the auction for this `swap` or not
	 * @param swap User's order details
	 * @param effectiveAmountIn Total available after considering gas costs which is equivalent to `swap.fromAmount - totalCosts`
	 * @param costDetails Gas cost details to consider more factors
	 **/
	async shouldParticipate(swap: Swap, effectiveAmountIn: number, costDetails: SwiftCosts): Promise<boolean> {
		return true;
	}

	/**
	 * Calculate the bid amount for the auction. The bid should be in the same token as the fromToken used in the swap on the destination chain.
	 * For example, if the swap is from `Ethereum (ETH)` to the `Arbitrum (any token)` network, the bid should be in ETH.
	 * The bid amount will then be converted to the destination chain token via a swap using the Jupiter or 1inch aggregator.
	 * We are bidding effectiveAmountIn by default because we assume no risks or additional benefits and only deduct the costs.
	 * @param swap user's order details
	 * @param effectiveAmountIn effective amount in which swap.fromAmount - totalCosts
	 * @param costDetails cost details to consider more factors
	 * @returns the amount to bid
	 **/
	async bidAmount(swap: Swap, effectiveAmountIn: number, costDetails: SwiftCosts): Promise<number> {
		return effectiveAmountIn;
	}
}
