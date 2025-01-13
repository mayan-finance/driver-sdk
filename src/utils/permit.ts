import { ethers } from 'ethers6';
import { abi as erc20Abi } from './erc20.abi';

export function deserializePermitFromHex(serializedPermit: string): {
	value: bigint;
	deadline: bigint;
	v: number;
	r: Buffer;
	s: Buffer;
} {
	const buffer = Buffer.from(serializedPermit.slice(2), 'hex');
	return {
		value: buffer.readBigUInt64BE(0),
		deadline: buffer.readBigUInt64BE(8),
		v: buffer.readUInt8(16),
		r: buffer.subarray(17, 49),
		s: buffer.subarray(49, 81),
	};
}

export async function generateErc20Permit(
	userWalletAddress: string,
	spender: string,
	tokenAddress: string,
	tokenRealChainId: number,
	amount64: bigint,
	signer: ethers.Signer,
	provider: ethers.JsonRpcProvider,
): Promise<Erc20Permit> {
	if (!userWalletAddress) {
		throw new Error('User address is not defined');
	}
	const signerAddress = await signer.getAddress();
	if (userWalletAddress.toLowerCase() !== signerAddress.toLowerCase()) {
		throw new Error('User address does not match signer address');
	}

	const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);

	let nonce;
	try {
		nonce = await contract.nonces(signer.getAddress());
	} catch (err) {
		throw {
			mayanError: {
				permitIssue: true,
			},
		};
	}
	const deadline = Math.floor(new Date().getTime() / 1000) + 60 * 50;
	const domain = await getPermitDomain(tokenAddress, tokenRealChainId, provider);

	const values = {
		owner: signerAddress,
		spender,
		value: amount64,
		nonce: nonce,
		deadline: deadline,
	};
	const sig = await signer.signTypedData(domain, PermitType, values);
	const signature = ethers.Signature.from(sig);
	const recovered = ethers.verifyTypedData(domain, PermitType, values, signature);
	return {
		...values,
		...domain,
		s: signature.s,
		r: signature.r,
		v: signature.v,
	};
}

async function getPermitDomain(
	tokenAddress: string,
	tokenRealChainId: number,
	provider: ethers.JsonRpcProvider,
): Promise<PermitDomain> {
	const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
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
		chainId: tokenRealChainId,
		verifyingContract: tokenAddress,
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

export type Erc20Permit = {
	owner: string;
	spender: string;
	value: bigint;
	nonce: number;
	deadline: number;
	chainId: number;
	name: string;
	verifyingContract: string;
	version: string;
	v: number;
	r: string;
	s: string;
};

type PermitDomain = {
	name: string;
	version: string;
	chainId: number;
	verifyingContract: string;
};

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
