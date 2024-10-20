import { SuiClient } from '@mysten/sui/client';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Connection, ParsedAccountData, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { getDecimals, getSymbol } from '../utils/erc20';
import { EvmProviders } from '../utils/evm-providers';
import logger from '../utils/logger';
import {
	CHAIN_ID_ARBITRUM,
	CHAIN_ID_AVAX,
	CHAIN_ID_BASE,
	CHAIN_ID_BSC,
	CHAIN_ID_ETH,
	CHAIN_ID_OPTIMISM,
	CHAIN_ID_POLYGON,
	CHAIN_ID_SOLANA,
	CHAIN_ID_SUI,
	isEVMChainId,
	mapNameToWormholeChainId,
	WhChainIdToEvm,
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
	hasTransferFee?: boolean;
	verifiedAddress?: string; // for mapped 32byte wormhole address on sui
	standard: 'native' | 'erc20' | 'spl' | 'spl2022' | 'suicoin';
};

export class TokenList {
	private endpoints: MayanEndpoints;
	private tokensPerChain: { [key: number]: Token[] } = {};
	public nativeTokens: { [index: string]: Token } = {};

	private initialized = false;

	constructor(
		endpoints: MayanEndpoints,
		private readonly evmProviders: EvmProviders,
		private readonly connection: Connection,
		private readonly suiClient: SuiClient,
	) {
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
		try {
			let tokenCount = 0;
			const allTokens = await axios.get(this.endpoints.priceApiUrl + '/v3/tokens', {
				params: {
					standard: 'erc20,native,spl,spl2022,suicoin',
				},
			});
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
						(token) =>
							token.contract === '0x0000000000000000000000000000000000000000' ||
							token.contract === '0x2::sui::SUI',
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
		} catch (err) {
			logger.error(`Failed to update token list: ${err}`);
		}
	}

	getNativeUsdc(chainId: number): Token | undefined {
		return this.tokensPerChain[chainId]?.find((tk) => tk.contract === UsdcContracts[chainId]);
	}

	getNativeUsdt(chainId: number): Token | undefined {
		return this.tokensPerChain[chainId]?.find((tk) => tk.contract === UsdtContracts[chainId]);
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

	async getTokenData(tokenChain: number, tokenContract: string): Promise<Token> {
		const preDefinedToken = this.getPreDefinedTokenData(tokenChain, tokenContract);
		if (preDefinedToken) {
			return preDefinedToken;
		}

		if (tokenChain === CHAIN_ID_SOLANA) {
			return await this.fetchSolanaTokenData(tokenContract);
		} else if (tokenChain === CHAIN_ID_SUI) {
			return await this.fetchSuiTokenData(tokenContract);
		} else if (isEVMChainId(tokenChain)) {
			return await this.fetchErc20TokenData(tokenChain, tokenContract);
		} else {
			throw new Error(`Chain ${tokenChain} is not supported`);
		}
	}

	async fetchSuiTokenData(coinType: string): Promise<Token> {
		const coinMeta = await this.suiClient.getCoinMetadata({
			coinType: coinType,
		});
		if (!coinMeta || !coinMeta.id) {
			throw new Error(`Coin ${coinType} not found on Sui chain`);
		}

		return {
			chainId: 101,
			coingeckoId: '',
			contract: coinType,
			decimals: coinMeta.decimals,
			logoURI: coinMeta.iconUrl!,
			mint: '',
			name: coinMeta.name,
			standard: 'suicoin',
			realOriginChainId: CHAIN_ID_SUI,
			realOriginContractAddress: coinType,
			symbol: coinMeta.symbol,
			wChainId: CHAIN_ID_SUI,
			verifiedAddress: coinMeta.id,
		};
	}

	async fetchErc20TokenData(chainId: number, tokenContract: string): Promise<Token> {
		const [symbol, decimals] = await Promise.all([
			getSymbol(this.evmProviders[chainId], tokenContract),
			getDecimals(this.evmProviders[chainId], tokenContract),
		]);

		return {
			chainId: WhChainIdToEvm[chainId],
			wChainId: chainId,
			coingeckoId: tokenContract,
			contract: tokenContract,
			mint: tokenContract,
			decimals: Number(decimals),
			logoURI: '',
			name: symbol,
			realOriginChainId: WhChainIdToEvm[chainId],
			realOriginContractAddress: tokenContract,
			symbol: symbol,
			supportsPermit: false,
			standard: 'erc20',
		};
	}

	private async fetchSolanaTokenData(tokenContract: string): Promise<Token> {
		const mintAccountInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenContract));
		if (!mintAccountInfo.value) {
			throw new Error(`Token account not found on solana chain for ${tokenContract}`);
		}
		let isToken2022 = false;
		if (mintAccountInfo && mintAccountInfo.value) {
			const ownerProgramId = (mintAccountInfo.value as any).owner;
			isToken2022 = ownerProgramId.equals(TOKEN_2022_PROGRAM_ID);
		}
		const mintData = mintAccountInfo.value.data as ParsedAccountData;
		const decimals = Number(mintData.parsed.info.decimals);
		let transferFeeExtension = mintData.parsed.info.extensions?.find(
			(e: any) => e.extension === 'transferFeeConfig',
		);

		let hasTransferFee = false;
		if (transferFeeExtension) {
			if (Number(transferFeeExtension.withheldAmount)) {
				hasTransferFee = true;
			}

			if (Number(transferFeeExtension.state?.newerTransferFee?.transferFeeBasisPoints)) {
				hasTransferFee = true;
			}
		}

		return {
			chainId: CHAIN_ID_SOLANA,
			coingeckoId: '',
			contract: tokenContract,
			mint: tokenContract,
			decimals: decimals,
			logoURI: '',
			name: '',
			realOriginChainId: CHAIN_ID_SOLANA,
			realOriginContractAddress: tokenContract,
			symbol: '',
			supportsPermit: false,
			standard: isToken2022 ? 'spl2022' : 'spl',
			hasTransferFee: hasTransferFee,
		};
	}

	private getPreDefinedTokenData(tokenChain: number, tokenContract: string): Token | undefined {
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
				case CHAIN_ID_SUI:
					return t.contract === tokenContract || t.verifiedAddress === tokenContract; // both coinType and verifiedAddress searched for sui
				default:
					return t.contract.toLowerCase() === tokenContract.toLowerCase();
			}
		});

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
	[CHAIN_ID_SUI]: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
};

const UsdtContracts: { [key: number]: string } = {
	[CHAIN_ID_SOLANA]: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
	[CHAIN_ID_BSC]: '0x55d398326f99059ff775485246999027b3197955',
	[CHAIN_ID_ETH]: '0xdac17f958d2ee523a2206206994597c13d831ec7',
	[CHAIN_ID_POLYGON]: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
	[CHAIN_ID_AVAX]: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
	[CHAIN_ID_ARBITRUM]: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
	[CHAIN_ID_OPTIMISM]: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
};
