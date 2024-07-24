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

export async function getPermitSignature(
	signer: ethers.Signer,
	amount: bigint,
	tokenAbsoluteChainId: number,
	tokenAddr: string,
	provider: ethers.JsonRpcProvider,
	spender: string,
	deadlineAddedSeconds: number,
): Promise<{ v: number; r: string; s: string; deadline: bigint; value: bigint }> {
	const signerAddress = await signer.getAddress();

	const contract = new ethers.Contract(
		tokenAddr,
		[
			{
				inputs: [
					{
						internalType: 'address',
						name: 'owner',
						type: 'address',
					},
				],
				name: 'nonces',
				outputs: [
					{
						internalType: 'uint256',
						name: '',
						type: 'uint256',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
		],
		provider,
	);

	let nonce: bigint | null = null;
	try {
		nonce = await contract.nonces(signer.getAddress());
	} catch (err) {
		throw {
			mayanError: {
				permitIssue: true,
			},
		};
	}
	const deadline = BigInt(Math.floor(new Date().getTime() / 1000) + deadlineAddedSeconds);
	const domain = await getPermitDomain(tokenAbsoluteChainId, tokenAddr, provider);

	const values = {
		owner: signerAddress,
		spender,
		value: amount,
		nonce: nonce,
		deadline: deadline,
	};
	const sig = await signer.signTypedData(domain, PermitType, values);
	const signature = ethers.Signature.from(sig);
	return {
		...values,
		...domain,
		s: signature.s,
		r: signature.r,
		v: signature.v,
	};
}

type PermitDomain = {
	name: string;
	version: string;
	chainId: number;
	verifyingContract: string;
};
async function getPermitDomain(
	tokenAbsoluteChainId: number,
	tokenAddr: string,
	provider: ethers.JsonRpcProvider,
): Promise<PermitDomain> {
	const contract = new ethers.Contract(
		tokenAddr,
		[
			{
				inputs: [],
				name: 'DOMAIN_SEPARATOR',
				outputs: [
					{
						internalType: 'bytes32',
						name: '',
						type: 'bytes32',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
			{
				inputs: [],
				name: 'name',
				outputs: [
					{
						internalType: 'string',
						name: '',
						type: 'string',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
		],
		provider,
	);
	let domainSeparator: string;
	try {
		domainSeparator = await contract.DOMAIN_SEPARATOR();
	} catch (err) {
		throw {
			mayanError: {
				permitIssue: true,
			},
		};
	}
	const name = await contract.name();
	const domain: PermitDomain = {
		name: name,
		version: '1',
		chainId: tokenAbsoluteChainId,
		verifyingContract: tokenAddr,
	};
	for (let i = 1; i < 11; i++) {
		domain.version = String(i);
		const hash = ethers.TypedDataEncoder.hashDomain(domain);
		if (hash.toLowerCase() === domainSeparator.toLowerCase()) {
			return domain;
		}
	}
	throw {
		mayanError: {
			permitIssue: true,
		},
	};
}

const PermitType = {
	Permit: [
		{
			name: 'owner',
			type: 'address',
		},
		{
			name: 'spender',
			type: 'address',
		},
		{
			name: 'value',
			type: 'uint256',
		},
		{
			name: 'nonce',
			type: 'uint256',
		},
		{
			name: 'deadline',
			type: 'uint256',
		},
	],
};
