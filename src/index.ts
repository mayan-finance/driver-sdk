import 'dotenv/config';
import { supportedChainIds } from './config/chains';
import { mayanEndpoints } from './config/endpoints';
import { rpcConfig } from './config/rpc';
import { TokenList } from './config/tokens';
import { getWalletConfig } from './config/wallet';
import { Relayer } from './relayer';
import { makeEvmProviders } from './utils/evm-providers';
import logger from './utils/logger';
import { SolanaMultiTxSender } from './utils/solana-trx';
import { MayanExplorerWatcher } from './watchers/mayan-explorer';

export async function main() {
	const walletConf = getWalletConfig();
	logger.info(`Solana Wallet is ${walletConf.solana.publicKey.toString()} and Ethereum Wallet is ${walletConf.evm.address}`);

	const evmProviders = makeEvmProviders(supportedChainIds, rpcConfig);
	const solanaTxSender = new SolanaMultiTxSender(rpcConfig);

	const tokenList = new TokenList(mayanEndpoints);
	await tokenList.init();
	const relayer = new Relayer();
	const watcher = new MayanExplorerWatcher(mayanEndpoints, relayer, tokenList);
	watcher.init();
}

main().catch((err) => {
	logger.error(`Failed to launch main process ${err}`);
	process.exit(1);
});
