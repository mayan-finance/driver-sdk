export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const isTestNet = () => process.env.TESTNET === 'true';
