import { Connection } from '@solana/web3.js';
import 'dotenv/config';
import { CHAIN_ID_SOLANA, supportedChainIds } from './config/chains';
import {
	ContractsConfig,
	auctionAddressSolana,
	feeCollectorSolana,
	fulfillHelpers,
	solanaProgram,
} from './config/contracts';
import { mayanEndpoints } from './config/endpoints';
import { GlobalConf } from './config/global';
import { fetchDynamicSdkParams } from './config/init';
import { rpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { getWalletConfig } from './config/wallet';
import { RegisterService } from './driver/register';
import { SolanaIxHelper } from './driver/solana-ix-helper';
import { Unlocker } from './driver/unlocker';
import { WalletsHelper } from './driver/wallet-helper';
import { makeEvmProviders } from './utils/evm-providers';
import logger from './utils/logger';
import { PriorityFeeHelper, SolanaMultiTxSender } from './utils/solana-trx';

export async function main() {
	const walletConf = getWalletConfig();
	logger.info(
		`Solana Wallet is ${walletConf.solana.publicKey.toString()} and Ethereum Wallet is ${walletConf.evm.address}`,
	);

	const initialDynamicConfig = await fetchDynamicSdkParams();
	rpcConfig.wormholeGuardianRpcs = initialDynamicConfig.wormholeGuardianRpcs.split(',');

	const globalConfig: GlobalConf = {
		auctionTimeSeconds: initialDynamicConfig.auctionTimeSeconds,
		batchUnlockThreshold: initialDynamicConfig.batchUnlockThreshold,
		registerInterval: initialDynamicConfig.registerInterval,
		scheduleUnlockInterval: 5 || initialDynamicConfig.scheduleUnlockInterval,
		singleBatchChainIds: initialDynamicConfig.singleBatchChainIds.split(',').map((x) => +x),
	};

	const contracts: ContractsConfig = {
		auctionAddr: auctionAddressSolana,
		evmFulfillHelpers: fulfillHelpers,
		contracts: { ...initialDynamicConfig.swiftContracts, [CHAIN_ID_SOLANA]: solanaProgram },
		feeCollectorSolana: feeCollectorSolana,
	};

	const evmProviders = makeEvmProviders(supportedChainIds, rpcConfig);
	const solanaConnection = new Connection(rpcConfig.solana.solanaMainRpc, 'confirmed');

	const solanaTxSender = new SolanaMultiTxSender(rpcConfig);

	const priorityFeeHelper = new PriorityFeeHelper(rpcConfig);

	const walletHelper = new WalletsHelper(evmProviders, walletConf, rpcConfig, contracts);

	const tokenList = new TokenList(mayanEndpoints);
	await tokenList.init();

	const solanaIxHelper = new SolanaIxHelper();

	const registerSvc = new RegisterService(walletConf, mayanEndpoints);
	await registerSvc.register();

	const unlocker = new Unlocker(
		globalConfig,
		mayanEndpoints,
		contracts,
		rpcConfig,
		walletConf,
		solanaConnection,
		evmProviders,
		solanaIxHelper,
		priorityFeeHelper,
		solanaTxSender,
		walletHelper,
	);
	unlocker.scheduleUnlockJobs();
	// const relayer = new Relayer();
	// const watcher = new MayanExplorerWatcher(mayanEndpoints, relayer, tokenList);
	// watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err} ${err.stack}`);
	process.exit(1);
});
