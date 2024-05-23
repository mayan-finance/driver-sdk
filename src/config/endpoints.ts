
export type MayanEndpoints = {
    explorerWsAddress: string;
    explorerApiUrl: string;
    priceApiUrl: string;
    refreshTokenIntervalSeconds: number;
};

export const mayanEndpoints: MayanEndpoints = {
    explorerWsAddress: process.env.EXPLORER_WS_ADDRESS || 'https://explorer-api.mayan.finance',
    explorerApiUrl: process.env.EXPLORER_API_URL || 'https://explorer-api.mayan.finance',
    priceApiUrl: process.env.PRICE_API_URL || 'https://price-api.mayan.finance',
    refreshTokenIntervalSeconds: Number(process.env.REFRESH_TOKEN_INTERVAL_SECONDS) || 120,
};