import { ethers } from 'ethers6';
import { getSuggestedOverrides } from './evm-trx';

const erc20BalanceOfAbi = [
	{
		constant: true,
		inputs: [
			{
				name: '_owner',
				type: 'address',
			},
		],
		name: 'balanceOf',
		outputs: [
			{
				name: 'balance',
				type: 'uint256',
			},
		],
		payable: false,
		stateMutability: 'view',
		type: 'function',
	},
];

const erc20AllowanceAbi = [
	{
		constant: true,
		inputs: [
			{
				name: '_owner',
				type: 'address',
			},
			{
				name: '_spender',
				type: 'address',
			},
		],
		name: 'allowance',
		outputs: [
			{
				name: '',
				type: 'uint256',
			},
		],
		payable: false,
		stateMutability: 'view',
		type: 'function',
	},
];

const erc20ApproveAbi = [
	{
		constant: false,
		inputs: [
			{
				name: '_spender',
				type: 'address',
			},
			{
				name: '_value',
				type: 'uint256',
			},
		],
		name: 'approve',
		outputs: [
			{
				name: '',
				type: 'bool',
			},
		],
		payable: false,
		stateMutability: 'nonpayable',
		type: 'function',
	},
];

export async function getErc20Balance(
	evmProvider: ethers.JsonRpcProvider,
	tokenContract: string,
	owner: string,
): Promise<bigint> {
	const contract = new ethers.Contract(tokenContract, erc20BalanceOfAbi, evmProvider);
	const balance = await contract.balanceOf(owner);

	return balance;
}

export async function getErc20Allowance(
	wallet: ethers.Wallet,
	tokenContract: string,
	owner: string,
	spender: string,
): Promise<bigint> {
	const contract = new ethers.Contract(tokenContract, erc20AllowanceAbi, wallet);
	const balance = await contract.allowance(owner, spender);
	return balance;
}

export async function giveErc20Allowance(
	wallet: ethers.Wallet,
	tokenContract: string,
	spender: string,
	amount: bigint,
	chainId: number,
	networkFeeData: ethers.FeeData,
): Promise<void> {
	const contract = new ethers.Contract(tokenContract, erc20ApproveAbi, wallet);
	const overrides = await getSuggestedOverrides(chainId, networkFeeData);
	const tx: ethers.TransactionResponse = await contract.approve(spender, amount, overrides);
	const res = await tx.wait();
	if (!res || res.status !== 1) {
		throw new Error(`Failed to approve ${amount} tokens to ${spender}`);
	}
}

export async function getEthBalance(evmProvider: ethers.JsonRpcProvider, address: string): Promise<bigint> {
	const balance = await evmProvider.getBalance(address);
	return balance;
}
