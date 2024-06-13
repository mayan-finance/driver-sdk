import axios from 'axios';
import logger from '../utils/logger';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	mapNameToWormholeChainId,
} from './chains';
import { MayanEndpoints } from './endpoints';

export type Token = {
	name: string;
	symbol: string;
	mint: string;
	contract: string;
	chainId: number;
	wChainId?: number;
	decimals: number;
	logoURI: string;
	wrappedAddress?: string;
	coingeckoId: string;
	realOriginChainId: number;
	realOriginContractAddress: string;
	supportsPermit?: boolean;
};

export class TokenList {
	private endpoints: MayanEndpoints;
	private tokensPerChain: { [key: number]: Token[] } = {};
	public nativeTokens: { [index: string]: Token } = {};

	private initialized = false;

	constructor(endpoints: MayanEndpoints) {
		this.endpoints = endpoints;
	}

	async init() {
		if (this.initialized) {
			return;
		}
		await this.updateList();
		setInterval(() => {
			this.updateList();
		}, this.endpoints.refreshTokenIntervalSeconds * 1000);
		this.initialized = true;
	}

	async updateList() {
		let tokenCount = 0;
		const allTokens = await axios.get(this.endpoints.priceApiUrl + '/v3/tokens');
		for (const chainName of Object.keys(allTokens.data)) {
			const chainId = mapNameToWormholeChainId(chainName);
			if (!!chainId) {
				this.tokensPerChain[chainId] = allTokens.data[chainName];
				tokenCount += this.tokensPerChain[chainId].length;
			}
		}
		this.nativeTokens = Object.entries(this.tokensPerChain).reduce(
			(acc, [chainId, tokens]) => {
				const token = tokens.find(
					(token) => token.contract === '0x0000000000000000000000000000000000000000',
				) as Token;
				if (!token) {
					logger.info(`Native token not found for chain ${chainId} and ignored`);
				} else {
					acc[chainId] = token;
				}
				return acc;
			},
			{} as { [index: string]: Token },
		);

		logger.info(`Token list refreshed with ${tokenCount} tokens`);
	}

	getNativeUsdc(chainId: number): Token | undefined {
		return this.tokensPerChain[chainId]?.find((tk) => tk.contract === UsdcContracts[chainId]);
	}

	getEth(chainId: number): Token | null {
		if ([CHAIN_ID_ETH, CHAIN_ID_ARBITRUM, CHAIN_ID_OPTIMISM, CHAIN_ID_BASE].includes(chainId as any)) {
			return this.nativeTokens[chainId];
		}
		return null;
	}

	getWethSol(): Token {
		return this.tokensPerChain[CHAIN_ID_SOLANA].find(
			(t) => t.contract === '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
		)!;
	}

	getTokenData(tokenChain: number, tokenContract: string): Token {
		if (!this.tokensPerChain[tokenChain]) {
			throw new Error(`Chain ${tokenChain} is not found in token list`);
		}

		const token = this.tokensPerChain[tokenChain].find((t) => {
			switch (tokenChain) {
				case CHAIN_ID_SOLANA:
					if (tokenContract === '11111111111111111111111111111111') {
						tokenContract = '0x0000000000000000000000000000000000000000';
					}
					return t.contract === tokenContract;
				default:
					return t.contract.toLowerCase() === tokenContract.toLowerCase();
			}
		});

		if (!token) {
			throw new Error(`Token ${tokenContract} is not found in token list`);
		}

		return token;
	}
}

const UsdcContracts: { [key: number]: string } = {
	[CHAIN_ID_SOLANA]: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	[CHAIN_ID_ETH]: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
	[CHAIN_ID_POLYGON]: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
	[CHAIN_ID_AVAX]: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
	[CHAIN_ID_ARBITRUM]: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
	[CHAIN_ID_OPTIMISM]: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
	[CHAIN_ID_BASE]: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};
