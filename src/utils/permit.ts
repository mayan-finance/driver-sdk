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
