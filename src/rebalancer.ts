import axios from 'axios';
import { CHAIN_ID_BASE, CHAIN_ID_ARBITRUM, CHAIN_ID_POLYGON, CHAIN_ID_SOLANA, CHAIN_ID_UNICHAIN, CHAIN_ID_OPTIMISM, CHAIN_ID_AVAX, CHAIN_ID_ETH } from './config/chains';
import { TreasuryEndpoints } from './config/endpoints';
import { TokenList } from './config/tokens';
import logger from './utils/logger';

interface BalanceInfo {
    chain_id: number;
    balance: string;
    token_address: string;
}

interface RebalanceRequest {
    chain_id: number;
    amount: string;
    unique_id: string;
}

interface FeasibilityRequest {
    chain_id: number;
    amount: string;
    unique_id: string;
}

interface QueueStatus {
    total_ongoing: number;
    per_chain_ongoing: number;
    max_total: number;
    max_per_chain: number;
    can_accept: boolean;
}

interface BalanceStatus {
    current_solana_balance: string;
    requested_amount: string;
    total_committed_amount: string;
    effective_available_balance: string;
    balance_after_transfer: string;
    normal_threshold: string;
    sufficient_balance: boolean;
}

interface FeasibilityResponse {
    feasible: boolean;
    reason: string | null;
    queue_status: QueueStatus;
    balance_status: BalanceStatus;
}

interface ChainConfig {
    chain_id: number;
    chain_name: string;
    minimum_threshold: string;
    normal_threshold: string;
    maximum_threshold: string;
}

const SUI_CHAIN_ID = 1999;
const SUI_USDC_TOKEN_ADDRESS = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const MIN_PULL_AMOUNT = process.env.MIN_PULL_AMOUNT ? parseInt(process.env.MIN_PULL_AMOUNT) : 500;

export const REBALANCE_ENABLED_CHAIN_IDS = [CHAIN_ID_ETH, CHAIN_ID_AVAX, CHAIN_ID_OPTIMISM, CHAIN_ID_BASE, CHAIN_ID_UNICHAIN, CHAIN_ID_POLYGON, CHAIN_ID_ARBITRUM, CHAIN_ID_SOLANA];

export class Rebalancer {
    private chainConfigCache: Map<number, { config: ChainConfig; timestamp: number }> = new Map();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(
        private readonly endpoints: TreasuryEndpoints,
        private readonly tokenList: TokenList,
    ) { }

    private async fetchBalances(): Promise<BalanceInfo[]> {
        try {
            const response = await axios.get(`${this.endpoints.rebalancerApiUrl}/api/balances`, {
                timeout: 10000,
            });

            if (!Array.isArray(response.data)) {
                throw new Error('Invalid balance response format');
            }

            return response.data as BalanceInfo[];
        } catch (error) {
            logger.error(`Failed to fetch balances: ${error}`);
            throw error;
        }
    }

    async fetchSuiUsdcBalance(): Promise<number> {
        let balances = await this.fetchBalances();

        let balance = balances.find(b => b.chain_id === SUI_CHAIN_ID && b.token_address.toLowerCase() === SUI_USDC_TOKEN_ADDRESS.toLowerCase());
        if (!balance) {
            throw new Error(`Balance not found for chain ${SUI_CHAIN_ID} and token ${SUI_USDC_TOKEN_ADDRESS}`);
        }

        return parseInt(balance.balance, 16) / (10 ** 6);
    }

    async checkFeasibility(chainId: number, amount: number, orderId: string): Promise<FeasibilityResponse> {
        try {
            const cctpChainId = this.getCCTPChainId(chainId);
            const request: FeasibilityRequest = {
                chain_id: cctpChainId,
                amount: amount.toFixed(6),
                unique_id: orderId,
            };

            logger.info(`Checking feasibility for ${amount} USDC to chain ${chainId} (CCTP: ${cctpChainId}) for order ${orderId}`);

            const response = await axios.post(`${this.endpoints.rebalancerApiUrl}/api/feasibility`, request, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            });

            if (response.status !== 200) {
                throw new Error(`Feasibility API returned status ${response.status}`);
            }

            const feasibilityResponse = response.data as FeasibilityResponse;

            logger.info(`Feasibility check result: feasible=${feasibilityResponse.feasible}, reason=${feasibilityResponse.reason}`);

            return feasibilityResponse;
        } catch (error) {
            logger.error(`Failed to check feasibility for chain ${chainId} amount ${amount}: ${error}`);
            throw error;
        }
    }

    private async executeRebalance(request: RebalanceRequest): Promise<void> {
        try {
            logger.info(`Executing rebalance: ${request.amount} USDC to chain ${request.chain_id} with order id ${request.unique_id}`);

            // Call the rebalance API
            const response = await axios.post(`${this.endpoints.rebalancerApiUrl}/api/rebalance`, request, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 5000,
            });

            if (response.status === 200) {
                logger.info(`Rebalance request submitted successfully: ${request.unique_id}`);
            } else {
                throw new Error(`Rebalance API returned status ${response.status} with message ${response.data} for order id ${request.unique_id}`);
            }
        } catch (error) {
            logger.error(`Failed to execute rebalance ${request.unique_id}: ${error}`);
            throw error;
        }
    }

    async forceRebalance(chainId: number, amount: number, orderId: string): Promise<void> {
        const cctpChainId = this.getCCTPChainId(chainId);
        const request: RebalanceRequest = {
            chain_id: cctpChainId,
            amount: amount.toFixed(6),
            unique_id: orderId,
        };

        await this.executeRebalance(request);
    }

    private getCCTPChainId(chainId: number): number {
        switch (chainId) {
            case CHAIN_ID_ETH:
                return 0;
            case CHAIN_ID_AVAX:
                return 1;
            case CHAIN_ID_BASE:
                return 6;
            case CHAIN_ID_UNICHAIN:
                return 10;
            case CHAIN_ID_POLYGON:
                return 7;
            case CHAIN_ID_ARBITRUM:
                return 3;
            case CHAIN_ID_OPTIMISM:
                return 2;
            case CHAIN_ID_SOLANA:
                return 5;
        }
        return 0;
    }

    async getChainConfig(chainId: number): Promise<ChainConfig> {
        const cctpChainId = this.getCCTPChainId(chainId);
        const cacheKey = cctpChainId;
        const cachedConfig = this.chainConfigCache.get(cacheKey);

        if (cachedConfig && Date.now() - cachedConfig.timestamp < this.CACHE_TTL_MS) {
            logger.info(`Using cached chain config for chain ${cctpChainId}`);
            return cachedConfig.config;
        }

        try {
            logger.info(`Fetching chain config for chain ${cctpChainId}`);
            const response = await axios.get(`${this.endpoints.rebalancerApiUrl}/api/threshold-config`, {
                params: { chain_id: cctpChainId },
                timeout: 10000,
            });

            if (response.status !== 200) {
                throw new Error(`Chain config API returned status ${response.status}`);
            }

            const config = response.data as ChainConfig;
            this.chainConfigCache.set(cacheKey, { config, timestamp: Date.now() });

            logger.info(`Cached chain config for chain ${cctpChainId}: ${config.chain_name}`);
            return config;
        } catch (error) {
            logger.error(`Failed to fetch chain config for chain ${cctpChainId}: ${error}`);
            throw error;
        }
    }
}