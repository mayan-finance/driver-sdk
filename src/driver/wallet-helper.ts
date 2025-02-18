import { abi as FulfillHelperAbi } from '../abis/fulfill-helper.abi';
import { abi as SwiftDestAbi } from '../abis/swift-dest.abi';
import { abi as SwiftSourceAbi } from '../abis/swift-source.abi';

import { ethers } from 'ethers6';
import { CHAIN_ID_ETH } from '../config/chains';
import { ContractsConfig } from '../config/contracts';
import { RpcConfig } from '../config/rpc';
import { WalletConfig } from '../config/wallet';
import { EvmProviders } from '../utils/evm-providers';

export class WalletsHelper {
	private evmWallets: {
		[chainId: number]: ethers.Wallet;
	} = {};
	private flashBotWallet: ethers.Wallet;
	private readonly flashBotSwiftContractDst: ethers.Contract;
	private readonly flashBotSwiftContractSrc: ethers.Contract;
	private readonly flashBotFulfillHelperContract: ethers.Contract;
	private swiftContractsSrc: {
		[chainId: number]: ethers.Contract;
	} = {};
	private swiftContractsDst: {
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
		for (let chainId of Object.keys(this.contracts.evmContractsV2Src)) {
			let contractAddrSrc = this.contracts.evmContractsV2Src[+chainId];
			let wallet = new ethers.Wallet(this.walletConfig.evm.privateKey, this.evmProviders[chainId]);

			this.evmWallets[+chainId] = wallet;
			this.swiftContractsSrc[+chainId] = new ethers.Contract(contractAddrSrc, SwiftSourceAbi, wallet);
		}

		for (let chainId of Object.keys(this.contracts.evmContractsV2Dst)) {
			let contractAddrDSt = this.contracts.evmContractsV2Dst[+chainId];
			let wallet = new ethers.Wallet(this.walletConfig.evm.privateKey, this.evmProviders[chainId]);

			this.evmWallets[+chainId] = wallet;
			this.swiftContractsDst[+chainId] = new ethers.Contract(contractAddrDSt, SwiftDestAbi, wallet);
		}

		for (let chainId of Object.keys(this.contracts.evmFulfillHelpers)) {
			let wallet = new ethers.Wallet(this.walletConfig.evm.privateKey, this.evmProviders[chainId]);
			let contractAddr = this.contracts.evmFulfillHelpers[+chainId];
			this.fulfillHelperContracts[+chainId] = new ethers.Contract(contractAddr, FulfillHelperAbi, wallet);
		}

		const flashbotsProvider = new ethers.JsonRpcProvider(this.rpcConfig.evmEndpoints.ethereumFlashBot, 1, {
			staticNetwork: ethers.Network.from(1),
			batchMaxCount: 1,
		});
		const flashbotWallet = new ethers.Wallet(this.walletConfig.evm.privateKey, flashbotsProvider);
		this.flashBotWallet = flashbotWallet;
		this.flashBotSwiftContractSrc = new ethers.Contract(
			this.contracts.evmContractsV2Src[CHAIN_ID_ETH],
			SwiftSourceAbi,
			flashbotWallet,
		);
		this.flashBotSwiftContractDst = new ethers.Contract(
			this.contracts.evmContractsV2Dst[CHAIN_ID_ETH],
			SwiftDestAbi,
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

	getDestWriteContract(chainId: number, useFlashBots: boolean = true): ethers.Contract {
		if (chainId === CHAIN_ID_ETH && useFlashBots) {
			return this.flashBotSwiftContractDst;
		} else {
			return this.swiftContractsDst[chainId];
		}
	}

	getSourceWriteContract(chainId: number, useFlashBots: boolean = true): ethers.Contract {
		if (chainId === CHAIN_ID_ETH && useFlashBots) {
			return this.flashBotSwiftContractSrc;
		} else {
			return this.swiftContractsSrc[chainId];
		}
	}

	getFulfillHelperWriteContract(chainId: number): ethers.Contract {
		if (chainId === CHAIN_ID_ETH) {
			return this.flashBotFulfillHelperContract;
		} else {
			return this.fulfillHelperContracts[chainId];
		}
	}

	getSourceReadContract(chainId: number): ethers.Contract {
		return this.swiftContractsSrc[chainId];
	}

	getDestReadContract(chainId: number): ethers.Contract {
		return this.swiftContractsDst[chainId];
	}
}
