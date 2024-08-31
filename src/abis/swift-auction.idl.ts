export type SwiftAuction = {
	version: '0.1.0';
	name: 'swift_auction';
	instructions: [
		{
			name: 'updateConfig';
			accounts: [
				{
					name: 'updater';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'config';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'auctionTime';
					type: 'u64';
				},
			];
		},
		{
			name: 'bid';
			accounts: [
				{
					name: 'config';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driver';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'auctionState';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'order';
					type: {
						defined: 'OrderInfo';
					};
				},
				{
					name: 'amountBid';
					type: 'u64';
				},
			];
		},
		{
			name: 'postAuction';
			accounts: [
				{
					name: 'auction';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driver';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'emitter';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'config';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'emitterSequence';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'feeCollector';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'message';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'coreBridgeProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'clock';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'rent';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'order';
					type: {
						defined: 'OrderInfo';
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
			name: 'closeAuction';
			accounts: [
				{
					name: 'auction';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'initializer';
					isMut: true;
					isSigner: false;
				},
			];
			args: [];
		},
	];
	accounts: [
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
						type: 'publicKey';
					},
					{
						name: 'closeEpoch';
						type: 'u64';
					},
					{
						name: 'amountOutMin';
						type: 'u64';
					},
					{
						name: 'winner';
						type: 'publicKey';
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
	];
	types: [
		{
			name: 'OrderInfo';
			type: {
				kind: 'struct';
				fields: [
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
						name: 'keyRnd';
						type: {
							array: ['u8', 32];
						};
					},
				];
			};
		},
	];
	errors: [
		{
			code: 6000;
			name: 'AmountBidLessThanMinimumAmountOut';
			msg: 'amount bid is less than the minimum amount out';
		},
		{
			code: 6001;
			name: 'AmountBidNotGreaterThanLastBidAmount';
			msg: 'amount bid is not greater than the last bid amount';
		},
		{
			code: 6002;
			name: 'AuctionClosed';
			msg: 'auction is closed';
		},
		{
			code: 6003;
			name: 'DriverIsNotWinner';
			msg: 'driver is not winner';
		},
		{
			code: 6004;
			name: 'AuctionIsNotClosed';
			msg: 'auction is not closed';
		},
		{
			code: 6005;
			name: 'InvalidAuctionMode';
			msg: 'invalid auction mode';
		},
		{
			code: 6006;
			name: 'WhCpiError';
			msg: 'wh cpi error';
		},
		{
			code: 6007;
			name: 'InvalidOrderInfo';
			msg: 'Invalid order info';
		},
		{
			code: 6008;
			name: 'InvalidDestChain';
			msg: 'Order with dest Solana could not be published';
		},
		{
			code: 6009;
			name: 'InvalidPayloadLen';
			msg: 'Invalid payload len';
		},
		{
			code: 6010;
			name: 'InvalidInitializer';
		},
		{
			code: 6011;
			name: 'CloseEpochNotReached';
		},
		{
			code: 6012;
			name: 'DriverNotWhitelisted';
			msg: 'Driver is not whitelisted';
		},
		{
			code: 6013;
			name: 'AuctionAlreadyPosted';
			msg: 'Auction already posted';
		},
		{
			code: 6014;
			name: 'InvalidRefAddress';
			msg: 'Invalid ref address';
		},
	];
};

export const IDL: SwiftAuction = {
	version: '0.1.0',
	name: 'swift_auction',
	instructions: [
		{
			name: 'updateConfig',
			accounts: [
				{
					name: 'updater',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'config',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'auctionTime',
					type: 'u64',
				},
			],
		},
		{
			name: 'bid',
			accounts: [
				{
					name: 'config',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driver',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'auctionState',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'order',
					type: {
						defined: 'OrderInfo',
					},
				},
				{
					name: 'amountBid',
					type: 'u64',
				},
			],
		},
		{
			name: 'postAuction',
			accounts: [
				{
					name: 'auction',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driver',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'emitter',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'config',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'emitterSequence',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'feeCollector',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'message',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'coreBridgeProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'clock',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'rent',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'order',
					type: {
						defined: 'OrderInfo',
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
			name: 'closeAuction',
			accounts: [
				{
					name: 'auction',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'initializer',
					isMut: true,
					isSigner: false,
				},
			],
			args: [],
		},
	],
	accounts: [
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
						type: 'publicKey',
					},
					{
						name: 'closeEpoch',
						type: 'u64',
					},
					{
						name: 'amountOutMin',
						type: 'u64',
					},
					{
						name: 'winner',
						type: 'publicKey',
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
	],
	types: [
		{
			name: 'OrderInfo',
			type: {
				kind: 'struct',
				fields: [
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
						name: 'keyRnd',
						type: {
							array: ['u8', 32],
						},
					},
				],
			},
		},
	],
	errors: [
		{
			code: 6000,
			name: 'AmountBidLessThanMinimumAmountOut',
			msg: 'amount bid is less than the minimum amount out',
		},
		{
			code: 6001,
			name: 'AmountBidNotGreaterThanLastBidAmount',
			msg: 'amount bid is not greater than the last bid amount',
		},
		{
			code: 6002,
			name: 'AuctionClosed',
			msg: 'auction is closed',
		},
		{
			code: 6003,
			name: 'DriverIsNotWinner',
			msg: 'driver is not winner',
		},
		{
			code: 6004,
			name: 'AuctionIsNotClosed',
			msg: 'auction is not closed',
		},
		{
			code: 6005,
			name: 'InvalidAuctionMode',
			msg: 'invalid auction mode',
		},
		{
			code: 6006,
			name: 'WhCpiError',
			msg: 'wh cpi error',
		},
		{
			code: 6007,
			name: 'InvalidOrderInfo',
			msg: 'Invalid order info',
		},
		{
			code: 6008,
			name: 'InvalidDestChain',
			msg: 'Order with dest Solana could not be published',
		},
		{
			code: 6009,
			name: 'InvalidPayloadLen',
			msg: 'Invalid payload len',
		},
		{
			code: 6010,
			name: 'InvalidInitializer',
		},
		{
			code: 6011,
			name: 'CloseEpochNotReached',
		},
		{
			code: 6012,
			name: 'DriverNotWhitelisted',
			msg: 'Driver is not whitelisted',
		},
		{
			code: 6013,
			name: 'AuctionAlreadyPosted',
			msg: 'Auction already posted',
		},
		{
			code: 6014,
			name: 'InvalidRefAddress',
			msg: 'Invalid ref address',
		},
	],
};
