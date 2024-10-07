export interface SwiftFeeParams {
	shrinkedStateCost: number;
	sourceStateCost: number;
	solanaSimpleCost: number;
	postAuctionCost: number;
	ataCreationCost: number;
	postCancelCost: number;
	batchPostBaseCost: number;
	batchPostAdddedCost: number;
	postUnlockVaaSingle: number;
	postUnlockVaaBase: number;
	postUnlockVaaPerItem: number;
	solTxCost: number;
	additionalSolfulfillCost: number;

	auctionVaaVerificationAddedGas: number;
	baseFulfillGasWithBatchEth: number;
	baseFulfillGasWithOutBatchEth: number;
	erc20GasOverHead: number;
	swapFulfillAddedGas: number;
	baseCancelGas: number;
	baseBatchPostGas: number;
	ethSubmitGas: number;
	erc20SubmitGas: number;
}

export type GlobalConfig = {
	ignoreReferrers: Set<string>;
	blackListedReferrerAddresses: Set<string>;
	auctionTimeSeconds: number;
	batchUnlockThreshold: number; // Optimal Number of swaps to select for unlocking
	singleBatchChainIds: number[]; // Expensive chain-ids that use direct vaa post instead of batch (e.g ethereum)
	scheduleUnlockInterval: number; // Seconds to schedule unlock again. Reducing it will not help that much to unlock faster unless there are tons of new incoming swaps
	registerInterval: number; // Seconds to register evm and solana address again
	pollExplorerInterval: number; // Interval to poll mayan explorer for new swaps
	registerAgainInterval: number; // Interval to register driver wallets again
	closeLutsInterval: number;
	disableUnlocker: boolean;
	feeParams: SwiftFeeParams;
};
