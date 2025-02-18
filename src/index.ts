import { SuiClient } from '@mysten/sui/client';
import { PublicKey } from '@solana/web3.js';
import 'dotenv/config';
import { AuctionFulfillerConfig } from './auction';
import { supportedChainIds } from './config/chains';
import {
	AuctionAddressV2Solana,
	ContractsConfig,
	FeeCollectorSolana,
	fulfillHelpers,
	SolanaProgramV2,
	SuiEmitterId,
	SuiFeeMgrStateId,
	SuiPackageId,
	SuiStateId,
} from './config/contracts';
import { mayanEndpoints } from './config/endpoints';
import { GlobalConfig } from './config/global';
import { fetchDynamicSdkParams, refershAndPatchConfigs } from './config/init';
import { routersConfig } from './config/routers';
import { rpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { getWalletConfig } from './config/wallet';
import { DriverService } from './driver/driver';
import { EvmFulfiller } from './driver/evm';
import { RegisterService } from './driver/register';
import { SwapRouters } from './driver/routers';
import { SolanaFulfiller } from './driver/solana';
import { NewSolanaIxHelper } from './driver/solana-ix';
import { StateCloser } from './driver/state-closer';
import { SuiFulfiller } from './driver/sui';
import { Unlocker } from './driver/unlocker';
import { WalletsHelper } from './driver/wallet-helper';
import { Relayer } from './relayer';
import { SimpleFulfillerConfig } from './simple';
import { makeEvmProviders, makeSecondEvmProviders, refreshEvmProvidersPeriodically } from './utils/evm-providers';
import { FeeService } from './utils/fees';
import { ChainFinality } from './utils/finality';
import logger from './utils/logger';
import { LookupTableOptimizer } from './utils/lut';
import { FailsafeSolanaConnectionHandler, PriorityFeeHelper, SolanaMultiTxSender } from './utils/solana-trx';
import { createDatabase, DB_PATH } from './utils/sqlite3';
import { VaaPoster } from './utils/vaa-poster';
import { MayanExplorerWatcher } from './watchers/mayan-explorer';

export async function main() {
	createDatabase(DB_PATH);
	const walletConf = getWalletConfig();
	logger.info(
		`	\nSolana Wallet is ${walletConf.solana.publicKey.toString()}	\nEthereum Wallet is ${walletConf.evm.address}	\nSui Wallet is ${walletConf.sui.getPublicKey().toSuiAddress()}`,
	);

	const initialDynamicConfig = await fetchDynamicSdkParams();
	rpcConfig.wormholeGuardianRpcs = initialDynamicConfig.wormholeGuardianRpcs.split(',');

	let whiteListedReferrerAddresses: Set<string> = new Set();
	if (process.env.WHITELISTED_REFERRERS) {
		whiteListedReferrerAddresses = new Set(process.env.WHITELISTED_REFERRERS.split(','));
	}

	const globalConfig: GlobalConfig = {
		ignoreReferrers: new Set(initialDynamicConfig.ignoreReferrers),
		auctionTimeSeconds: initialDynamicConfig.auctionTimeSeconds,
		batchUnlockThreshold: initialDynamicConfig.batchUnlockThreshold,
		registerInterval: initialDynamicConfig.registerInterval,
		scheduleUnlockInterval: initialDynamicConfig.scheduleUnlockInterval,
		singleBatchChainIds: initialDynamicConfig.singleBatchChainIds.split(',').map((x) => +x),
		pollExplorerInterval: 5,
		registerAgainInterval: initialDynamicConfig.registerInterval,
		disableUnlocker: process.env.DISABLE_UNLOCKER === 'true',
		closeLutsInterval: 1800,
		feeParams: initialDynamicConfig.feeParams,
		blackListedReferrerAddresses: (process.env.BLACKLISTED_REFERRERS || '').split(',').reduce((acc, x) => {
			acc.add(x);
			return acc;
		}, new Set<string>()),

		whiteListedReferrerAddresses: whiteListedReferrerAddresses,
	};

	const contracts: ContractsConfig = {
		auctionAddrV2: AuctionAddressV2Solana,
		evmFulfillHelpers: fulfillHelpers,
		evmContractsV2Src: { ...initialDynamicConfig.swiftEvmContractsV2Source },
		evmContractsV2Dst: { ...initialDynamicConfig.swiftEvmContractsV2Destination },
		feeCollectorSolana: FeeCollectorSolana,
		suiIds: {
			emitterId: SuiEmitterId,
			feeManagerStateId: SuiFeeMgrStateId,
			packageId: SuiPackageId,
			stateId: SuiStateId,
		},
	};
	setInterval(() => {
		refershAndPatchConfigs(globalConfig, contracts, rpcConfig);
	}, 60_000);

	const evmProviders = await makeEvmProviders(supportedChainIds, rpcConfig);
	refreshEvmProvidersPeriodically();
	const secondaryEvmProviders = await makeSecondEvmProviders(supportedChainIds, rpcConfig);
	const solanaConnection = new FailsafeSolanaConnectionHandler(rpcConfig.solana.solanaMainRpc).getConnectionProxy();

	const solanaTxSender = new SolanaMultiTxSender(rpcConfig, walletConf);

	const priorityFeeHelper = new PriorityFeeHelper(rpcConfig);

	const walletHelper = new WalletsHelper(evmProviders, walletConf, rpcConfig, contracts);

	const suiClient = new SuiClient({
		url: rpcConfig.suiFullNode,
	});

	const tokenList = new TokenList(mayanEndpoints, evmProviders, solanaConnection, suiClient);
	await tokenList.init();

	const solanaIxHelper = new NewSolanaIxHelper(
		new PublicKey(SolanaProgramV2),
		new PublicKey(contracts.auctionAddrV2),
		solanaConnection,
	);

	const swapRouters = new SwapRouters(contracts, rpcConfig, routersConfig, evmProviders, mayanEndpoints.priceApiUrl);

	const registerSvc = new RegisterService(globalConfig, walletConf, mayanEndpoints);
	await registerSvc.register();
	registerSvc.scheduleRegister();

	const vaaPoster = new VaaPoster(rpcConfig, walletConf, solanaConnection, solanaTxSender, priorityFeeHelper);
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
		vaaPoster,
	);
	unlocker.scheduleUnlockJobs();

	const feeSvc = new FeeService(evmProviders, mayanEndpoints, tokenList, globalConfig);
	const lutOptimizer = new LookupTableOptimizer(
		globalConfig,
		walletConf,
		mayanEndpoints,
		solanaConnection,
		priorityFeeHelper,
		solanaTxSender,
	);
	await lutOptimizer.initAndScheduleLutClose();
	const solanaFulfiller = new SolanaFulfiller(
		solanaConnection,
		rpcConfig,
		walletConf,
		solanaIxHelper,
		lutOptimizer,
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
		swapRouters,
	);
	await evmFulFiller.init();
	const suiFulfiller = new SuiFulfiller(suiClient, walletConf, contracts, tokenList);
	const driverSvc = new DriverService(
		new SimpleFulfillerConfig(),
		new AuctionFulfillerConfig(rpcConfig, solanaConnection, evmProviders, walletConf, swapRouters),
		solanaConnection,
		walletConf,
		rpcConfig,
		contracts,
		solanaIxHelper,
		feeSvc,
		solanaFulfiller,
		walletHelper,
		evmFulFiller,
		suiFulfiller,
		tokenList,
		solanaTxSender,
	);
	const chainFinalitySvc = new ChainFinality(solanaConnection, suiClient, evmProviders, secondaryEvmProviders);
	const relayer = new Relayer(
		rpcConfig,
		mayanEndpoints,
		globalConfig,
		tokenList,
		contracts,
		walletHelper,
		walletConf,
		solanaConnection,
		driverSvc,
		chainFinalitySvc,
	);

	const stateCloser = new StateCloser(walletConf, solanaConnection, solanaIxHelper, solanaTxSender);
	const watcher = new MayanExplorerWatcher(
		globalConfig,
		mayanEndpoints,
		walletConf,
		contracts,
		tokenList,
		relayer,
		driverSvc,
		stateCloser,
	);
	watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err} ${err.stack}`);
	process.exit(1);
});
