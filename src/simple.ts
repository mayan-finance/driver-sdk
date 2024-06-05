import { Swap } from './swap.dto';
import { SwiftCosts } from './utils/fees';

export class SimpleFulfillerConfig {
	/**
	 * For swaps without auction (auction mode 1) there is not reason to fulfill more than minAmountOut
	 * But we recalculate gas costs and pay more than `minAmountOut` if networks congestion is reduced compared to swap initiate time
	 * @param swap user's order details
	 * @param effectiveAmountIn effective amount in which swap.fromAmount - totalCosts
	 * @param costDetails cost details to consider more factors
	 * @returns the amount to fulfill
	 **/
	async fulfillAmount(swap: Swap, effectiveAmountIn: number, costDetails: SwiftCosts): Promise<number> {
		return effectiveAmountIn;
	}
}
