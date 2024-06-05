export type GlobalConfig = {
	auctionTimeSeconds: number;
	batchUnlockThreshold: number; // Optimal Number of swaps to select for unlocking
	singleBatchChainIds: number[]; // Expensive chain-ids that use direct vaa post instead of batch (e.g ethereum)
	scheduleUnlockInterval: number; // Seconds to schedule unlock again. Reducing it will not help that much to unlock faster unless there are tons of new incoming swaps
	registerInterval: number; // Seconds to register evm and solana address again
	pollExplorerInterval: number; // Interval to poll mayan explorer for new swaps
	registerAgainInterval: number; // Interval to register driver wallets again
};
