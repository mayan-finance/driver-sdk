import { createHmac } from 'node:crypto';

export function hmac256base64(message: string, secretKey: string): string {
	return createHmac('sha256', secretKey).update(message).digest('base64');
}
