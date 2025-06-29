import { PublicKey } from '@solana/web3.js';
import 'dotenv/config';
import { AuctionFulfillerConfig } from './auction';
import { CHAIN_ID_SOLANA, supportedChainIds } from './config/chains';
import {
	AuctionAddressSolana,
	ContractsConfig,
	FeeCollectorSolana,
	fulfillHelpers,
	SolanaProgram,
} from './config/contracts';
import { mayanEndpoints, treasuryEndpoints } from './config/endpoints';
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
import { Unlocker } from './driver/unlocker';
import { WalletsHelper } from './driver/wallet-helper';
import { Rebalancer } from './rebalancer';
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
import { AuctionListener } from './auction-listener';

export async function main() {
	createDatabase(DB_PATH);
	const walletConf = getWalletConfig();
	logger.info(
		`Solana Wallet is ${walletConf.solana.publicKey.toString()} and Ethereum Wallet is ${walletConf.evm.address}`,
	);

	const initialDynamicConfig = await fetchDynamicSdkParams();
	rpcConfig.wormholeGuardianRpcs = initialDynamicConfig.wormholeGuardianRpcs.split(',');

	let whiteListedReferrerAddresses: Set<string> = new Set();
	if (process.env.WHITELISTED_REFERRERS) {
		whiteListedReferrerAddresses = new Set(process.env.WHITELISTED_REFERRERS.split(','));
	}

	const globalConfig: GlobalConfig = {
		rebidEnabled: process.env.REBID_ENABLED === 'true',
		postAuctionMode: process.env.POST_AUCTION_MODE === 'SHIM' ? 'SHIM' : 'NORMAL',
		postUnlockMode: process.env.POST_UNLOCK_MODE === 'SHIM' ? 'SHIM' : 'NORMAL',
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
		isRebalancerEnabled: process.env.IS_REBALANCER_ENABLED === 'true',
		minUsdcOrderAmount: process.env.MIN_USDC_ORDER_AMOUNT ? parseInt(process.env.MIN_USDC_ORDER_AMOUNT) : undefined,
	};

	const contracts: ContractsConfig = {
		auctionAddr: AuctionAddressSolana,
		evmFulfillHelpers: fulfillHelpers,
		contracts: { ...initialDynamicConfig.swiftContracts, [CHAIN_ID_SOLANA]: SolanaProgram },
		feeCollectorSolana: FeeCollectorSolana,
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

	const tokenList = new TokenList(mayanEndpoints, evmProviders, solanaConnection);
	await tokenList.init();

	const rebalancer = new Rebalancer(treasuryEndpoints, tokenList);

	const solanaIxHelper = new NewSolanaIxHelper(
		new PublicKey(contracts.contracts[CHAIN_ID_SOLANA]),
		new PublicKey(contracts.auctionAddr),
		solanaConnection,
	);

	const swapRouters = new SwapRouters(contracts, rpcConfig, routersConfig, evmProviders, mayanEndpoints.priceApiUrl);

	const registerSvc = new RegisterService(globalConfig, walletConf, mayanEndpoints);
	await registerSvc.register();
	registerSvc.scheduleRegister();

	const auctionListener = new AuctionListener(
		walletConf.solana.publicKey.toString(),
		solanaConnection,
		globalConfig,
		rpcConfig,
	);
	auctionListener.start();

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
		swapRouters,
	);
	await evmFulFiller.init();
	const driverSvc = new DriverService(
		new SimpleFulfillerConfig(),
		new AuctionFulfillerConfig(globalConfig, rpcConfig, solanaConnection, evmProviders, walletConf, swapRouters, tokenList, rebalancer, auctionListener),
		globalConfig,
		solanaConnection,
		walletConf,
		rpcConfig,
		contracts,
		solanaIxHelper,
		feeSvc,
		solanaFulfiller,
		walletHelper,
		evmFulFiller,
		tokenList,
		solanaTxSender,
	);
	const chainFinalitySvc = new ChainFinality(
		solanaConnection,
		contracts,
		rpcConfig,
		evmProviders,
		secondaryEvmProviders,
	);
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
		rebalancer,
		auctionListener,
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
