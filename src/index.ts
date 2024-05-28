import 'dotenv/config';
import { supportedChainIds } from './config/chains';
import { mayanEndpoints } from './config/endpoints';
import { rpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { getWalletConfig } from './config/wallet';
import { RegisterService } from './driver/register';
import { makeEvmProviders } from './utils/evm-providers';
import logger from './utils/logger';
import { SolanaMultiTxSender } from './utils/solana-trx';

export async function main() {
	const walletConf = getWalletConfig();
	logger.info(
		`Solana Wallet is ${walletConf.solana.publicKey.toString()} and Ethereum Wallet is ${walletConf.evm.address}`,
	);

	const evmProviders = makeEvmProviders(supportedChainIds, rpcConfig);
	const solanaTxSender = new SolanaMultiTxSender(rpcConfig);

	const tokenList = new TokenList(mayanEndpoints);
	await tokenList.init();

	const registerSvc = new RegisterService(walletConf, mayanEndpoints);
	await registerSvc.register();

	// const relayer = new Relayer();
	// const watcher = new MayanExplorerWatcher(mayanEndpoints, relayer, tokenList);
	// watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err} ${err.stack}`);
	process.exit(1);
});
