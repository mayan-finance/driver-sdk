export type SwiftV2Auction = {
	address: '9bh7SPjkNPgmq7HHWQxgCFJEnMPvAPdLcBEQL1FSG1YR';
	metadata: {
		name: 'swiftAuction';
		version: '0.1.0';
		spec: '0.1.0';
		description: 'Created with Anchor';
	};
	instructions: [
		{
			name: 'bid';
			discriminator: [199, 56, 85, 38, 146, 243, 37, 158];
			accounts: [
				{
					name: 'config';
				},
				{
					name: 'driver';
					writable: true;
					signer: true;
				},
				{
					name: 'auctionState';
					writable: true;
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'order';
					type: {
						defined: {
							name: 'orderInfo';
						};
					};
				},
				{
					name: 'amountBid';
					type: 'u64';
				},
			];
		},
		{
			name: 'closeAuction';
			discriminator: [225, 129, 91, 48, 215, 73, 203, 172];
			accounts: [
				{
					name: 'auction';
					writable: true;
				},
				{
					name: 'initializer';
					writable: true;
				},
			];
			args: [];
		},
		{
			name: 'postAuction';
			discriminator: [62, 30, 249, 94, 9, 182, 79, 198];
			accounts: [
				{
					name: 'auction';
					writable: true;
				},
				{
					name: 'driver';
					writable: true;
					signer: true;
				},
				{
					name: 'emitter';
				},
				{
					name: 'config';
					writable: true;
				},
				{
					name: 'emitterSequence';
					writable: true;
				},
				{
					name: 'feeCollector';
					writable: true;
				},
				{
					name: 'message';
					writable: true;
					signer: true;
				},
				{
					name: 'coreBridgeProgram';
				},
				{
					name: 'systemProgram';
				},
				{
					name: 'clock';
				},
				{
					name: 'rent';
				},
			];
			args: [
				{
					name: 'order';
					type: {
						defined: {
							name: 'orderInfo';
						};
					};
				},
				{
					name: 'foreignDriver';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'postAuctionShim';
			discriminator: [82, 7, 45, 178, 249, 242, 49, 192];
			accounts: [
				{
					name: 'auction';
					writable: true;
				},
				{
					name: 'driver';
					writable: true;
					signer: true;
				},
				{
					name: 'emitter';
				},
				{
					name: 'config';
					writable: true;
				},
				{
					name: 'emitterSequence';
					writable: true;
				},
				{
					name: 'feeCollector';
					writable: true;
				},
				{
					name: 'message';
					writable: true;
				},
				{
					name: 'coreBridgeProgram';
				},
				{
					name: 'systemProgram';
				},
				{
					name: 'clock';
				},
				{
					name: 'shimEventAuth';
				},
				{
					name: 'shimProgram';
				},
			];
			args: [
				{
					name: 'order';
					type: {
						defined: {
							name: 'orderInfo';
						};
					};
				},
				{
					name: 'foreignDriver';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'updateConfig';
			discriminator: [29, 158, 252, 191, 10, 83, 219, 99];
			accounts: [
				{
					name: 'updater';
					writable: true;
					signer: true;
				},
				{
					name: 'config';
					writable: true;
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'auctionTime';
					type: 'u64';
				},
			];
		},
	];
	accounts: [
		{
			name: 'auctionState';
			discriminator: [252, 227, 205, 147, 72, 64, 250, 126];
		},
		{
			name: 'config';
			discriminator: [155, 12, 170, 224, 30, 250, 204, 130];
		},
	];
	errors: [
		{
			code: 6000;
			name: 'amountBidLessThanMinimumAmountOut';
			msg: 'amount bid is less than the minimum amount out';
		},
		{
			code: 6001;
			name: 'amountBidNotGreaterThanLastBidAmount';
			msg: 'amount bid is not greater than the last bid amount';
		},
		{
			code: 6002;
			name: 'auctionClosed';
			msg: 'auction is closed';
		},
		{
			code: 6003;
			name: 'driverIsNotWinner';
			msg: 'driver is not winner';
		},
		{
			code: 6004;
			name: 'auctionIsNotClosed';
			msg: 'auction is not closed';
		},
		{
			code: 6005;
			name: 'invalidAuctionMode';
			msg: 'invalid auction mode';
		},
		{
			code: 6006;
			name: 'whCpiError';
			msg: 'wh cpi error';
		},
		{
			code: 6007;
			name: 'invalidOrderInfo';
			msg: 'Invalid order info';
		},
		{
			code: 6008;
			name: 'invalidDestChain';
			msg: 'Order with dest Solana could not be published';
		},
		{
			code: 6009;
			name: 'invalidPayloadLen';
			msg: 'Invalid payload len';
		},
		{
			code: 6010;
			name: 'invalidInitializer';
		},
		{
			code: 6011;
			name: 'closeEpochNotReached';
		},
		{
			code: 6012;
			name: 'driverNotWhitelisted';
			msg: 'Driver is not whitelisted';
		},
		{
			code: 6013;
			name: 'auctionAlreadyPosted';
			msg: 'Auction already posted';
		},
		{
			code: 6014;
			name: 'invalidRefAddress';
			msg: 'Invalid ref address';
		},
	];
	types: [
		{
			name: 'auctionState';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'bump';
						type: 'u8';
					},
					{
						name: 'hash';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'initializer';
						type: 'pubkey';
					},
					{
						name: 'closeEpoch';
						type: 'u64';
					},
					{
						name: 'winner';
						type: 'pubkey';
					},
					{
						name: 'amountPromised';
						type: 'u64';
					},
					{
						name: 'validFrom';
						type: 'u64';
					},
					{
						name: 'seqMsg';
						type: 'u64';
					},
				];
			};
		},
		{
			name: 'config';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'auctionTime';
						type: 'u64';
					},
				];
			};
		},
		{
			name: 'orderInfo';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'payloadType';
						type: 'u8';
					},
					{
						name: 'trader';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'chainSource';
						type: 'u16';
					},
					{
						name: 'tokenIn';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'addrDest';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'chainDest';
						type: 'u16';
					},
					{
						name: 'tokenOut';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'amountOutMin';
						type: 'u64';
					},
					{
						name: 'gasDrop';
						type: 'u64';
					},
					{
						name: 'feeCancel';
						type: 'u64';
					},
					{
						name: 'feeRefund';
						type: 'u64';
					},
					{
						name: 'deadline';
						type: 'u64';
					},
					{
						name: 'penaltyPeriod';
						type: 'u16';
					},
					{
						name: 'addrRef';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'feeRateRef';
						type: 'u8';
					},
					{
						name: 'feeRateMayan';
						type: 'u8';
					},
					{
						name: 'auctionMode';
						type: 'u8';
					},
					{
						name: 'baseBond';
						type: 'u64';
					},
					{
						name: 'perBpsBond';
						type: 'u64';
					},
					{
						name: 'keyRnd';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'customPayload';
						type: {
							array: ['u8', 32];
						};
					},
				];
			};
		},
	];
};

export const SwiftV2AuctionIdl: SwiftV2Auction = {
	address: '9bh7SPjkNPgmq7HHWQxgCFJEnMPvAPdLcBEQL1FSG1YR',
	metadata: {
		name: 'swiftAuction',
		version: '0.1.0',
		spec: '0.1.0',
		description: 'Created with Anchor',
	},
	instructions: [
		{
			name: 'bid',
			discriminator: [199, 56, 85, 38, 146, 243, 37, 158],
			accounts: [
				{
					name: 'config',
				},
				{
					name: 'driver',
					writable: true,
					signer: true,
				},
				{
					name: 'auctionState',
					writable: true,
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'order',
					type: {
						defined: {
							name: 'orderInfo',
						},
					},
				},
				{
					name: 'amountBid',
					type: 'u64',
				},
			],
		},
		{
			name: 'closeAuction',
			discriminator: [225, 129, 91, 48, 215, 73, 203, 172],
			accounts: [
				{
					name: 'auction',
					writable: true,
				},
				{
					name: 'initializer',
					writable: true,
				},
			],
			args: [],
		},
		{
			name: 'postAuction',
			discriminator: [62, 30, 249, 94, 9, 182, 79, 198],
			accounts: [
				{
					name: 'auction',
					writable: true,
				},
				{
					name: 'driver',
					writable: true,
					signer: true,
				},
				{
					name: 'emitter',
				},
				{
					name: 'config',
					writable: true,
				},
				{
					name: 'emitterSequence',
					writable: true,
				},
				{
					name: 'feeCollector',
					writable: true,
				},
				{
					name: 'message',
					writable: true,
					signer: true,
				},
				{
					name: 'coreBridgeProgram',
				},
				{
					name: 'systemProgram',
				},
				{
					name: 'clock',
				},
				{
					name: 'rent',
				},
			],
			args: [
				{
					name: 'order',
					type: {
						defined: {
							name: 'orderInfo',
						},
					},
				},
				{
					name: 'foreignDriver',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'postAuctionShim',
			discriminator: [82, 7, 45, 178, 249, 242, 49, 192],
			accounts: [
				{
					name: 'auction',
					writable: true,
				},
				{
					name: 'driver',
					writable: true,
					signer: true,
				},
				{
					name: 'emitter',
				},
				{
					name: 'config',
					writable: true,
				},
				{
					name: 'emitterSequence',
					writable: true,
				},
				{
					name: 'feeCollector',
					writable: true,
				},
				{
					name: 'message',
					writable: true,
				},
				{
					name: 'coreBridgeProgram',
				},
				{
					name: 'systemProgram',
				},
				{
					name: 'clock',
				},
				{
					name: 'shimEventAuth',
				},
				{
					name: 'shimProgram',
				},
			],
			args: [
				{
					name: 'order',
					type: {
						defined: {
							name: 'orderInfo',
						},
					},
				},
				{
					name: 'foreignDriver',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'updateConfig',
			discriminator: [29, 158, 252, 191, 10, 83, 219, 99],
			accounts: [
				{
					name: 'updater',
					writable: true,
					signer: true,
				},
				{
					name: 'config',
					writable: true,
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'auctionTime',
					type: 'u64',
				},
			],
		},
	],
	accounts: [
		{
			name: 'auctionState',
			discriminator: [252, 227, 205, 147, 72, 64, 250, 126],
		},
		{
			name: 'config',
			discriminator: [155, 12, 170, 224, 30, 250, 204, 130],
		},
	],
	errors: [
		{
			code: 6000,
			name: 'amountBidLessThanMinimumAmountOut',
			msg: 'amount bid is less than the minimum amount out',
		},
		{
			code: 6001,
			name: 'amountBidNotGreaterThanLastBidAmount',
			msg: 'amount bid is not greater than the last bid amount',
		},
		{
			code: 6002,
			name: 'auctionClosed',
			msg: 'auction is closed',
		},
		{
			code: 6003,
			name: 'driverIsNotWinner',
			msg: 'driver is not winner',
		},
		{
			code: 6004,
			name: 'auctionIsNotClosed',
			msg: 'auction is not closed',
		},
		{
			code: 6005,
			name: 'invalidAuctionMode',
			msg: 'invalid auction mode',
		},
		{
			code: 6006,
			name: 'whCpiError',
			msg: 'wh cpi error',
		},
		{
			code: 6007,
			name: 'invalidOrderInfo',
			msg: 'Invalid order info',
		},
		{
			code: 6008,
			name: 'invalidDestChain',
			msg: 'Order with dest Solana could not be published',
		},
		{
			code: 6009,
			name: 'invalidPayloadLen',
			msg: 'Invalid payload len',
		},
		{
			code: 6010,
			name: 'invalidInitializer',
		},
		{
			code: 6011,
			name: 'closeEpochNotReached',
		},
		{
			code: 6012,
			name: 'driverNotWhitelisted',
			msg: 'Driver is not whitelisted',
		},
		{
			code: 6013,
			name: 'auctionAlreadyPosted',
			msg: 'Auction already posted',
		},
		{
			code: 6014,
			name: 'invalidRefAddress',
			msg: 'Invalid ref address',
		},
	],
	types: [
		{
			name: 'auctionState',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'bump',
						type: 'u8',
					},
					{
						name: 'hash',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'initializer',
						type: 'pubkey',
					},
					{
						name: 'closeEpoch',
						type: 'u64',
					},
					{
						name: 'winner',
						type: 'pubkey',
					},
					{
						name: 'amountPromised',
						type: 'u64',
					},
					{
						name: 'validFrom',
						type: 'u64',
					},
					{
						name: 'seqMsg',
						type: 'u64',
					},
				],
			},
		},
		{
			name: 'config',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'auctionTime',
						type: 'u64',
					},
				],
			},
		},
		{
			name: 'orderInfo',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'payloadType',
						type: 'u8',
					},
					{
						name: 'trader',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'chainSource',
						type: 'u16',
					},
					{
						name: 'tokenIn',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'addrDest',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'chainDest',
						type: 'u16',
					},
					{
						name: 'tokenOut',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'amountOutMin',
						type: 'u64',
					},
					{
						name: 'gasDrop',
						type: 'u64',
					},
					{
						name: 'feeCancel',
						type: 'u64',
					},
					{
						name: 'feeRefund',
						type: 'u64',
					},
					{
						name: 'deadline',
						type: 'u64',
					},
					{
						name: 'penaltyPeriod',
						type: 'u16',
					},
					{
						name: 'addrRef',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'feeRateRef',
						type: 'u8',
					},
					{
						name: 'feeRateMayan',
						type: 'u8',
					},
					{
						name: 'auctionMode',
						type: 'u8',
					},
					{
						name: 'baseBond',
						type: 'u64',
					},
					{
						name: 'perBpsBond',
						type: 'u64',
					},
					{
						name: 'keyRnd',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'customPayload',
						type: {
							array: ['u8', 32],
						},
					},
				],
			},
		},
	],
};
