export type FeeManager = {
	version: '0.1.0';
	name: 'fee_manager';
	instructions: [
		{
			name: 'getProtocolFeeRate';
			accounts: [
				{
					name: 'trader';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'referrer';
					type: 'publicKey';
				},
				{
					name: 'referrerFeeRate';
					type: 'u8';
				},
				{
					name: 'tokenIn';
					type: 'publicKey';
				},
				{
					name: 'amountIn';
					type: 'u64';
				},
			];
			returns: 'u8';
		},
	];
};

export const IDL: FeeManager = {
	version: '0.1.0',
	name: 'fee_manager',
	instructions: [
		{
			name: 'getProtocolFeeRate',
			accounts: [
				{
					name: 'trader',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'referrer',
					type: 'publicKey',
				},
				{
					name: 'referrerFeeRate',
					type: 'u8',
				},
				{
					name: 'tokenIn',
					type: 'publicKey',
				},
				{
					name: 'amountIn',
					type: 'u64',
				},
			],
			returns: 'u8',
		},
	],
};
