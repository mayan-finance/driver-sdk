export type MayanEndpoints = {
	explorerWsAddress: string;
	relayerWsAddress: string;
	explorerApiUrl: string;
	priceApiUrl: string;
	lutApiUrl: string;
	refreshTokenIntervalSeconds: number;
};

export const mayanEndpoints: MayanEndpoints = {
	explorerWsAddress: process.env.EXPLORER_WS_ADDRESS || 'https://testnet-explorer-api.mayan.finance',
	relayerWsAddress: process.env.RELAYER_WS_ADDRESS || 'https://swifdt-relayer-api.mayan.finance',
	explorerApiUrl: process.env.EXPLORER_API_URL || 'https://testnet-explorer-api.mayan.finance',
	priceApiUrl: process.env.PRICE_API_URL || 'https://testnet-price-api.mayan.finance',
	lutApiUrl: process.env.LUT_API_URL || 'https://lut-api.mayan.finance',
	refreshTokenIntervalSeconds: Number(process.env.REFRESH_TOKEN_INTERVAL_SECONDS) || 600,
};
