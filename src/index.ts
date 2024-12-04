import { Connection, PublicKey } from '@solana/web3.js';
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
import { Relayer } from './relayer';
import { SimpleFulfillerConfig } from './simple';
import { makeEvmProviders, makeSecondEvmProviders } from './utils/evm-providers';
import { FeeService } from './utils/fees';
import { ChainFinality } from './utils/finality';
import logger from './utils/logger';
import { LookupTableOptimizer } from './utils/lut';
import { PriorityFeeHelper, SolanaMultiTxSender } from './utils/solana-trx';
import { VaaPoster } from './utils/vaa-poster';
import { MayanExplorerWatcher } from './watchers/mayan-explorer';

export async function main() {
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
		auctionAddr: AuctionAddressSolana,
		evmFulfillHelpers: fulfillHelpers,
		contracts: { ...initialDynamicConfig.swiftContracts, [CHAIN_ID_SOLANA]: SolanaProgram },
		feeCollectorSolana: FeeCollectorSolana,
	};
	setInterval(() => {
		refershAndPatchConfigs(globalConfig, contracts, rpcConfig);
	}, 60_000);

	const evmProviders = makeEvmProviders(supportedChainIds, rpcConfig);
	const secondaryEvmProviders = makeSecondEvmProviders(supportedChainIds, rpcConfig);
	const solanaConnection = new Connection(rpcConfig.solana.solanaMainRpc, {
		commitment: 'confirmed',
	});

	const solanaTxSender = new SolanaMultiTxSender(rpcConfig, walletConf);

	const priorityFeeHelper = new PriorityFeeHelper(rpcConfig);

	const walletHelper = new WalletsHelper(evmProviders, walletConf, rpcConfig, contracts);

	const tokenList = new TokenList(mayanEndpoints, evmProviders, solanaConnection);
	await tokenList.init();

	const solanaIxHelper = new NewSolanaIxHelper(
		new PublicKey(contracts.contracts[CHAIN_ID_SOLANA]),
		new PublicKey(contracts.auctionAddr),
		solanaConnection,
	);

	const swapRouters = new SwapRouters(contracts, rpcConfig, routersConfig, evmProviders);

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
	);

	const stateCloser = new StateCloser(
		walletConf,
		solanaConnection,
		solanaIxHelper,
		solanaTxSender,
		priorityFeeHelper,
	);
	const watcher = new MayanExplorerWatcher(
		globalConfig,
		mayanEndpoints,
		walletConf,
		contracts,
		tokenList,
		relayer,
		stateCloser,
	);
	watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err} ${err.stack}`);
	process.exit(1);
});
