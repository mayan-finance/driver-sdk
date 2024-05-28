import { abi as FulfillHelperAbi } from '../abis/fulfill-helper';
import { abi as SwiftAbi } from '../abis/swift';

import { ethers } from 'ethers';
import { CHAIN_ID_ETH, CHAIN_ID_SOLANA } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import { EvmProviders } from '../utils/evm-providers';

export class WalletsHelper {
	private evmWallets: {
		[chainId: number]: ethers.Wallet;
	} = {};

	private readonly flashBotSwiftContract: ethers.Contract;
	private readonly flashBotFulfillHelperContract: ethers.Contract;
	private swiftContracts: {
		[chainId: number]: ethers.Contract;
	} = {};
	private fulfillHelperContracts: {
		[chainId: number]: ethers.Contract;
	} = {};

	constructor(
		private readonly evmProviders: EvmProviders,
		private readonly walletConfig: WalletConfig,
		private readonly rpcConfig: RpcConfig,
		private readonly contracts: ContractsConfig,
	) {
		for (let chainId of Object.keys(this.contracts.contracts)) {
			if (+chainId === CHAIN_ID_SOLANA) {
				continue;
			}
			let contractAddr = this.contracts.contracts[+chainId];
			let wallet = new ethers.Wallet(this.walletConfig.evm.privateKey, this.evmProviders[chainId]);

			this.evmWallets[+chainId] = wallet;
			this.swiftContracts[+chainId] = new ethers.Contract(contractAddr, SwiftAbi, wallet);
		}

		for (let chainId of Object.keys(this.contracts.evmFulfillHelpers)) {
			let wallet = new ethers.Wallet(this.walletConfig.evm.privateKey, this.evmProviders[chainId]);
			let contractAddr = this.contracts.evmFulfillHelpers[+chainId];
			this.fulfillHelperContracts[+chainId] = new ethers.Contract(contractAddr, FulfillHelperAbi, wallet);
		}

		const flashbotsProvider = new ethers.JsonRpcProvider(this.rpcConfig.evmEndpoints.ethereumFlashBot, 1, {
			staticNetwork: ethers.Network.from(1),
		});
		const flashbotWallet = new ethers.Wallet(this.walletConfig.evm.privateKey, flashbotsProvider);
		this.flashBotSwiftContract = new ethers.Contract(
			this.contracts.contracts[CHAIN_ID_ETH],
			SwiftAbi,
			flashbotWallet,
		);
		this.flashBotFulfillHelperContract = new ethers.Contract(
			this.contracts.evmFulfillHelpers[CHAIN_ID_ETH],
			FulfillHelperAbi,
			flashbotWallet,
		);
	}

	getDriverWallet(chainId: number): ethers.Wallet {
		return this.evmWallets[chainId];
	}

	getWriteContract(chainId: number): ethers.Contract {
		if (chainId === CHAIN_ID_ETH) {
			return this.flashBotSwiftContract;
		} else {
			return this.swiftContracts[chainId];
		}
	}

	getFulfillHelperEthersContract(chainId: number): ethers.Contract {
		if (chainId === CHAIN_ID_ETH) {
			return this.flashBotFulfillHelperContract;
		} else {
			return this.fulfillHelperContracts[chainId];
		}
	}

	getReadContract(chainId: number): ethers.Contract {
		return this.swiftContracts[chainId];
	}
}
