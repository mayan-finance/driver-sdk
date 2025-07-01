import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers6';
import { base58_to_binary } from '../utils/base58';

export type WalletConfig = {
	solana: Keypair;
	evm: ethers.Wallet;
	sui: Ed25519Keypair;
};

export function getWalletConfig(): WalletConfig {
	if (!process.env.SOLANA_PRIVATE_KEY) {
		throw new Error('SOLANA_PRIVATE_KEY is not set in the environment variables');
	}
	if (!process.env.EVM_PRIVATE_KEY) {
		throw new Error('EVM_PRIVATE_KEY is not set in the environment variables');
	}
	if (!process.env.SUI_PRIVATE_KEY) {
		throw new Error('SUI_PRIVATE_KEY is not set in the environment variables');
	}
	return {
		solana: Keypair.fromSecretKey(base58_to_binary(process.env.SOLANA_PRIVATE_KEY)),
		evm: new ethers.Wallet(process.env.EVM_PRIVATE_KEY),
		sui: Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY),
	};
}
