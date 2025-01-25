import { ZeroAddress } from 'ethers6';

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function isNativeToken(token: string): Boolean {
	return token === ZeroAddress || token === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
}
