export type GlobalConf = {
	auctionTimeSeconds: number;
	batchUnlockThreshold: number; // Optimal Number of swaps to select for unlocking
	singleBatchChainIds: number[]; // Expensive chain-ids that used direct vaa post instead of batch (e.g ethereum)
	scheduleUnlockInterval: number; // Seconds to schedule unlock again
	registerInterval: number; // Seconds to register evm and solana address again
};
