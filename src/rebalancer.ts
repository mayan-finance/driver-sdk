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

const SOLANA_CCTP_CHAIN_ID = 0;

export const REBALANCE_ENABLED_CHAIN_IDS = [CHAIN_ID_ETH, CHAIN_ID_AVAX, CHAIN_ID_OPTIMISM, CHAIN_ID_BASE, CHAIN_ID_UNICHAIN, CHAIN_ID_POLYGON, CHAIN_ID_ARBITRUM];

export class Rebalancer {

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

    async fetchSolanaUsdcBalance(): Promise<number> {
        let balances = await this.fetchBalances();
        const usdc = this.tokenList.getNativeUsdc(CHAIN_ID_SOLANA)
        if (!usdc) {
            throw new Error(`USDC not found for chain ${CHAIN_ID_SOLANA}`);
        }

        let balance = balances.find(b => b.chain_id === SOLANA_CCTP_CHAIN_ID && b.token_address.toLowerCase() === usdc.contract.toLowerCase());
        if (!balance) {
            throw new Error(`Balance not found for chain ${SOLANA_CCTP_CHAIN_ID} and token ${usdc.contract}`);
        }

        return parseInt(balance.balance, 16) / (10 ** usdc.decimals);
    }

    async checkFeasibility(chainId: number, amount: number): Promise<FeasibilityResponse> {
        try {
            const cctpChainId = this.getCCTPChainId(chainId);
            const request: FeasibilityRequest = {
                chain_id: cctpChainId,
                amount: amount.toFixed(6),
            };

            logger.info(`Checking feasibility for ${amount} USDC to chain ${chainId} (CCTP: ${cctpChainId})`);

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
        }
        return 0;
    }

}