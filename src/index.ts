import { Connection } from '@solana/web3.js';
import 'dotenv/config';
import { AuctionFulfillerConfig } from './auction';
import { CHAIN_ID_SOLANA, supportedChainIds } from './config/chains';
import {
	AuctionAddressSolana,
	ContractsConfig,
	FeeCollectorSolana,
	SolanaProgram,
	fulfillHelpers,
} from './config/contracts';
import { mayanEndpoints } from './config/endpoints';
import { GlobalConfig } from './config/global';
import { fetchDynamicSdkParams } from './config/init';
import { rpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { getWalletConfig } from './config/wallet';
import { DriverService } from './driver/driver';
import { EvmFulfiller } from './driver/evm';
import { RegisterService } from './driver/register';
import { SolanaFulfiller } from './driver/solana';
import { SolanaIxHelper } from './driver/solana-ix-helper';
import { Unlocker } from './driver/unlocker';
import { WalletsHelper } from './driver/wallet-helper';
import { Relayer } from './relayer';
import { SimpleFulfillerConfig } from './simple';
import { makeEvmProviders } from './utils/evm-providers';
import { FeeService } from './utils/fees';
import { ChainFinality } from './utils/finality';
import logger from './utils/logger';
import { LookupTableOptimizer } from './utils/lut';
import { PriorityFeeHelper, SolanaMultiTxSender } from './utils/solana-trx';
import { SwiftAuctionParser, SwiftStateParser } from './utils/state-parser';
import { MayanExplorerWatcher } from './watchers/mayan-explorer';

export async function main() {
	const walletConf = getWalletConfig();
	logger.info(
		`Solana Wallet is ${walletConf.solana.publicKey.toString()} and Ethereum Wallet is ${walletConf.evm.address}`,
	);

	const initialDynamicConfig = await fetchDynamicSdkParams();
	rpcConfig.wormholeGuardianRpcs = initialDynamicConfig.wormholeGuardianRpcs.split(',');

	const globalConfig: GlobalConfig = {
		auctionTimeSeconds: 0 || initialDynamicConfig.auctionTimeSeconds, // TODO: remove hardcode values
		batchUnlockThreshold: initialDynamicConfig.batchUnlockThreshold,
		registerInterval: initialDynamicConfig.registerInterval,
		scheduleUnlockInterval: initialDynamicConfig.scheduleUnlockInterval,
		singleBatchChainIds: initialDynamicConfig.singleBatchChainIds.split(',').map((x) => +x),
		pollExplorerInterval: 5,
		registerAgainInterval: initialDynamicConfig.registerInterval,
	};

	const contracts: ContractsConfig = {
		auctionAddr: AuctionAddressSolana,
		evmFulfillHelpers: fulfillHelpers,
		contracts: { ...initialDynamicConfig.swiftContracts, [CHAIN_ID_SOLANA]: SolanaProgram },
		feeCollectorSolana: FeeCollectorSolana,
	};

	const evmProviders = makeEvmProviders(supportedChainIds, rpcConfig);
	const solanaConnection = new Connection(rpcConfig.solana.solanaMainRpc, 'confirmed');

	const solanaTxSender = new SolanaMultiTxSender(rpcConfig);

	const priorityFeeHelper = new PriorityFeeHelper(rpcConfig);

	const walletHelper = new WalletsHelper(evmProviders, walletConf, rpcConfig, contracts);

	const tokenList = new TokenList(mayanEndpoints);
	await tokenList.init();

	const solanaIxHelper = new SolanaIxHelper();

	const registerSvc = new RegisterService(globalConfig, walletConf, mayanEndpoints);
	await registerSvc.register();
	registerSvc.scheduleRegister();

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

	const stateParser = new SwiftStateParser(solanaConnection);
	const auctionParser = new SwiftAuctionParser(solanaConnection);
	const feeSvc = new FeeService(evmProviders, mayanEndpoints, tokenList);
	const lutOptimizer = new LookupTableOptimizer(
		walletConf,
		mayanEndpoints,
		solanaConnection,
		priorityFeeHelper,
		solanaTxSender,
	);
	const solanaFulfiller = new SolanaFulfiller(
		solanaConnection,
		rpcConfig,
		walletConf,
		solanaIxHelper,
		priorityFeeHelper,
		lutOptimizer,
		walletHelper,
		tokenList,
	);
	const evmFulFiller = new EvmFulfiller(
		globalConfig,
		walletConf,
		rpcConfig,
		contracts,
		walletHelper,
		evmProviders,
		tokenList,
	);
	const driverSvc = new DriverService(
		new SimpleFulfillerConfig(),
		new AuctionFulfillerConfig(),
		solanaConnection,
		walletConf,
		rpcConfig,
		contracts,
		solanaIxHelper,
		priorityFeeHelper,
		feeSvc,
		solanaFulfiller,
		walletHelper,
		evmFulFiller,
		tokenList,
		solanaTxSender,
	);
	const chainFinalitySvc = new ChainFinality(solanaConnection, contracts, rpcConfig, evmProviders);
	const relayer = new Relayer(
		rpcConfig,
		mayanEndpoints,
		globalConfig,
		tokenList,
		contracts,
		stateParser,
		auctionParser,
		walletHelper,
		walletConf,
		solanaConnection,
		driverSvc,
		chainFinalitySvc,
	);

	const watcher = new MayanExplorerWatcher(globalConfig, mayanEndpoints, contracts, tokenList, relayer);
	watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err} ${err.stack}`);
	process.exit(1);
});
