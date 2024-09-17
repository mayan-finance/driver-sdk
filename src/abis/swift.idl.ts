export type Swift = {
	version: '0.1.0';
	name: 'swift';
	instructions: [
		{
			name: 'registerOrder';
			accounts: [
				{
					name: 'relayer';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'state';
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
					name: 'args';
					type: {
						defined: 'OrderInfo';
					};
				},
			];
		},
		{
			name: 'setAuctionWinner';
			accounts: [
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'auction';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'expectedWinner';
					type: 'publicKey';
				},
			];
		},
		{
			name: 'fulfill';
			accounts: [
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driver';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'stateToAcc';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'mintTo';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'dest';
					isMut: true;
					isSigner: false;
					docs: ['CHECK this should be equal to addr_dest'];
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'addrUnlocker';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'settle';
			accounts: [
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'stateToAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'relayer';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'mintTo';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'dest';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'referrer';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'feeCollector';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'referrerFeeAcc';
					isMut: true;
					isSigner: false;
					isOptional: true;
				},
				{
					name: 'mayanFeeAcc';
					isMut: true;
					isSigner: false;
					isOptional: true;
				},
				{
					name: 'destAcc';
					isMut: true;
					isSigner: false;
					isOptional: true;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'associatedTokenProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [
				{
					name: 'tryCloseAta';
					type: 'bool';
				},
			];
		},
		{
			name: 'postUnlock';
			accounts: [
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
			args: [];
		},
		{
			name: 'cancel';
			accounts: [
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'relayer';
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
					name: 'foreignFeeCollector';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'close';
			accounts: [
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'relayer';
					isMut: true;
					isSigner: false;
					docs: ['CHECK this should be equal to state.relayer\\'];
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [];
		},
		{
			name: 'initOrder';
			accounts: [
				{
					name: 'trader';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'relayer';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'stateFromAcc';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'relayerFeeAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'mintFrom';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'feeManagerProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
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
					name: 'params';
					type: {
						defined: 'InitOrderParams';
					};
				},
			];
		},
		{
			name: 'unlockBatch';
			accounts: [
				{
					name: 'vaaUnlock';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'stateFromAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'mintFrom';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driver';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'driverAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
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
					name: 'index';
					type: 'u16';
				},
			];
		},
		{
			name: 'unlock';
			accounts: [
				{
					name: 'vaaUnlock';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'stateFromAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'mintFrom';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driver';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'driverAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [];
		},
		{
			name: 'refund';
			accounts: [
				{
					name: 'vaaCancel';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'state';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'stateFromAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'trader';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'traderAcc';
					isMut: true;
					isSigner: false;
					isOptional: true;
				},
				{
					name: 'mintFrom';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'relayerRefund';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'relayerRefundAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'relayerCancel';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'relayerCancelAcc';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
			];
			args: [];
		},
	];
	accounts: [
		{
			name: 'swiftDestSolanaState';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'bump';
						type: 'u8';
					},
					{
						name: 'status';
						type: {
							defined: 'SwiftDestSolanaStatus';
						};
					},
					{
						name: 'order';
						type: {
							defined: 'OrderInfo';
						};
					},
					{
						name: 'hash';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'relayer';
						type: 'publicKey';
					},
					{
						name: 'fulfill';
						type: {
							defined: 'FulfillInfo';
						};
					},
				];
			};
		},
		{
			name: 'swiftSourceSolanaState';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'bump';
						type: 'u8';
					},
					{
						name: 'status';
						type: {
							defined: 'SwiftSourceSolanaStatus';
						};
					},
				];
			};
		},
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
	];
	types: [
		{
			name: 'InitOrderParams';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'amountInMin';
						type: 'u64';
					},
					{
						name: 'nativeInput';
						type: 'bool';
					},
					{
						name: 'feeSubmit';
						type: 'u64';
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
		{
			name: 'FulfillInfo';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'winner';
						type: 'publicKey';
					},
					{
						name: 'amountPromised';
						type: 'u64';
					},
					{
						name: 'amountOutput';
						type: 'u64';
					},
					{
						name: 'patchVersion';
						type: 'u8';
					},
					{
						name: 'timeFulfill';
						type: 'u64';
					},
					{
						name: 'addrUnlocker';
						type: {
							array: ['u8', 32];
						};
					},
				];
			};
		},
		{
			name: 'SwiftDestSolanaStatus';
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'NONE';
					},
					{
						name: 'CREATED';
					},
					{
						name: 'FULFILLED';
					},
					{
						name: 'SETTLED';
					},
					{
						name: 'POSTED';
					},
					{
						name: 'CANCELLED';
					},
					{
						name: 'CLOSED';
					},
				];
			};
		},
		{
			name: 'SwiftSourceSolanaStatus';
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'NONE';
					},
					{
						name: 'LOCKED';
					},
					{
						name: 'UNLOCKED';
					},
					{
						name: 'REFUNDED';
					},
				];
			};
		},
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
	events: [
		{
			name: 'OrderInitialized';
			fields: [
				{
					name: 'orderHash';
					type: {
						array: ['u8', 32];
					};
					index: false;
				},
				{
					name: 'amountIn';
					type: 'u64';
					index: false;
				},
			];
		},
	];
	errors: [
		{
			code: 6000;
			name: 'OrderDestChainIsNotSolana';
			msg: 'Order dest chain is not solana';
		},
		{
			code: 6001;
			name: 'ChainIdNotEvmSupported';
			msg: 'Chain id is not Evm supported chain';
		},
		{
			code: 6002;
			name: 'InvalidStateStatus';
			msg: 'Invalid state status';
		},
		{
			code: 6003;
			name: 'OrderIsNotCreated';
			msg: 'Order is not created';
		},
		{
			code: 6004;
			name: 'InvalidOrderAuctionType';
			msg: 'Order state is not fulfilled';
		},
		{
			code: 6005;
			name: 'DeadlineIsPassed';
			msg: 'Order deadline is passed';
		},
		{
			code: 6006;
			name: 'AuctionIsNotClosed';
			msg: 'Auction is not closed';
		},
		{
			code: 6007;
			name: 'AuctionHashMismatch';
			msg: 'Auction hash mismatch';
		},
		{
			code: 6008;
			name: 'AuctionIsNotFinished';
			msg: 'Auction is not valid yet';
		},
		{
			code: 6009;
			name: 'InvalidExpectedWinner';
			msg: 'Invalid expected winner';
		},
		{
			code: 6010;
			name: 'OrderCannotBeFulfilled';
			msg: 'Order cannot be fulfilled';
		},
		{
			code: 6011;
			name: 'DriverIsNotWinner';
			msg: 'Invalid auction winner';
		},
		{
			code: 6012;
			name: 'InvalidMint';
			msg: 'Invalid mint';
		},
		{
			code: 6013;
			name: 'InvalidDestinationAddress';
			msg: 'Destination account address is wrong';
		},
		{
			code: 6014;
			name: 'OutputIsLessThanPromised';
			msg: 'amount output < amount promised';
		},
		{
			code: 6015;
			name: 'MinAmountOutNotSatisfied';
			msg: 'amount output < amount out min + fees';
		},
		{
			code: 6016;
			name: 'WinnerIsPrivilegedYet';
			msg: 'winner is privileged yet';
		},
		{
			code: 6017;
			name: 'MissingRequiredOptionalAccount';
			msg: 'missing required optional account';
		},
		{
			code: 6018;
			name: 'InvalidStateAccount';
			msg: 'Invalid state account';
		},
		{
			code: 6019;
			name: 'OrderFulfillInfoMissed';
			msg: 'Order fulfill info is missing';
		},
		{
			code: 6020;
			name: 'InvalidRelayer';
			msg: 'Invalid Relayer for close state';
		},
		{
			code: 6021;
			name: 'Overflow';
			msg: 'Overflow';
		},
		{
			code: 6022;
			name: 'DeadlineIsNotPassed';
			msg: 'Deadline is not passed yet';
		},
		{
			code: 6023;
			name: 'InvalidPayloadLength';
			msg: 'Payload is invalid';
		},
		{
			code: 6024;
			name: 'AmountInTooSmall';
			msg: 'Amount in too small';
		},
		{
			code: 6025;
			name: 'InvalidZeroAmount';
			msg: 'Invalid zero amount';
		},
		{
			code: 6026;
			name: 'InsufficientFundsToPayLockFee';
			msg: 'Insufficient funds to pay lock fee';
		},
		{
			code: 6027;
			name: 'ProtocolFeeRateTooHigh';
			msg: 'Protocol fee rate too high';
		},
		{
			code: 6028;
			name: 'ProtocolFeeRateMismatch';
			msg: 'Param protocol fee rate is wrong';
		},
		{
			code: 6029;
			name: 'ReferrerFeeRateTooHigh';
			msg: 'Referrer fee rate too high';
		},
		{
			code: 6030;
			name: 'GasDropNotAllowed';
			msg: 'Could not receive gas drop when token out is native';
		},
		{
			code: 6031;
			name: 'DestSolanaNotAllowed';
			msg: 'Destination chain could not be Solana';
		},
		{
			code: 6032;
			name: 'InvalidParam';
			msg: 'Invalid order parameter';
		},
		{
			code: 6033;
			name: 'FeesOverflow';
			msg: 'fee cancel + fee refund -> overflow';
		},
		{
			code: 6034;
			name: 'FeesTooHigh';
			msg: 'fee cancel + fee refund >= amount_in';
		},
		{
			code: 6035;
			name: 'FeeRateRefIsNotZero';
			msg: 'fee rate ref is not zero';
		},
		{
			code: 6036;
			name: 'RelayerIsTraderFeeSubmit';
			msg: 'relayer is trader but fee_submit > 0';
		},
		{
			code: 6037;
			name: 'MintAndTokenProgramMismatch';
			msg: 'Mint is not match with token program';
		},
		{
			code: 6038;
			name: 'InvalidUnlockBatchVAA';
			msg: 'Invalid unlock batch vaa';
		},
		{
			code: 6039;
			name: 'InvalidUnlockVAA';
			msg: 'Invalid unlock vaa';
		},
		{
			code: 6040;
			name: 'DriverIsNotUnlocker';
			msg: 'Driver is not equal to vaa unlocker';
		},
		{
			code: 6041;
			name: 'MintIsNotTokenIn';
			msg: 'Mint is not equal to vaa token in';
		},
		{
			code: 6042;
			name: 'InvalidRemainingAccountsCount';
		},
		{
			code: 6043;
			name: 'InvalidTokenAccountMint';
		},
		{
			code: 6044;
			name: 'InvalidTokenAccountOwner';
		},
		{
			code: 6045;
			name: 'InvalidEmitterChain';
		},
		{
			code: 6046;
			name: 'InvalidEmitterAddress';
		},
		{
			code: 6047;
			name: 'InvalidCancelVAA';
			msg: 'Invalid cancel vaa';
		},
		{
			code: 6048;
			name: 'WrongCancelRelayerAddress';
		},
		{
			code: 6049;
			name: 'InsufficientFundsToRefundFee';
		},
		{
			code: 6050;
			name: 'InvalidTrader';
		},
		{
			code: 6051;
			name: 'InvalidOneOwner';
		},
		{
			code: 6052;
			name: 'InvalidTwoOwner';
		},
		{
			code: 6053;
			name: 'InvalidThreeOwner';
		},
	];
};

export const IDL: Swift = {
	version: '0.1.0',
	name: 'swift',
	instructions: [
		{
			name: 'registerOrder',
			accounts: [
				{
					name: 'relayer',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'state',
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
					name: 'args',
					type: {
						defined: 'OrderInfo',
					},
				},
			],
		},
		{
			name: 'setAuctionWinner',
			accounts: [
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'auction',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'expectedWinner',
					type: 'publicKey',
				},
			],
		},
		{
			name: 'fulfill',
			accounts: [
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driver',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'stateToAcc',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'mintTo',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'dest',
					isMut: true,
					isSigner: false,
					docs: ['CHECK this should be equal to addr_dest'],
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'addrUnlocker',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'settle',
			accounts: [
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'stateToAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'relayer',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'mintTo',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'dest',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'referrer',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'feeCollector',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'referrerFeeAcc',
					isMut: true,
					isSigner: false,
					isOptional: true,
				},
				{
					name: 'mayanFeeAcc',
					isMut: true,
					isSigner: false,
					isOptional: true,
				},
				{
					name: 'destAcc',
					isMut: true,
					isSigner: false,
					isOptional: true,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'associatedTokenProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'tryCloseAta',
					type: 'bool',
				},
			],
		},
		{
			name: 'postUnlock',
			accounts: [
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
			args: [],
		},
		{
			name: 'cancel',
			accounts: [
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'relayer',
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
					name: 'foreignFeeCollector',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'close',
			accounts: [
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'relayer',
					isMut: true,
					isSigner: false,
					docs: ['CHECK this should be equal to state.relayer\\'],
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
		{
			name: 'initOrder',
			accounts: [
				{
					name: 'trader',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'relayer',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'stateFromAcc',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'relayerFeeAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'mintFrom',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'feeManagerProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
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
					name: 'params',
					type: {
						defined: 'InitOrderParams',
					},
				},
			],
		},
		{
			name: 'unlockBatch',
			accounts: [
				{
					name: 'vaaUnlock',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'stateFromAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'mintFrom',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driver',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'driverAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
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
					name: 'index',
					type: 'u16',
				},
			],
		},
		{
			name: 'unlock',
			accounts: [
				{
					name: 'vaaUnlock',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'stateFromAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'mintFrom',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driver',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'driverAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
		{
			name: 'refund',
			accounts: [
				{
					name: 'vaaCancel',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'state',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'stateFromAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'trader',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'traderAcc',
					isMut: true,
					isSigner: false,
					isOptional: true,
				},
				{
					name: 'mintFrom',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'relayerRefund',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'relayerRefundAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'relayerCancel',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'relayerCancelAcc',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
	],
	accounts: [
		{
			name: 'swiftDestSolanaState',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'bump',
						type: 'u8',
					},
					{
						name: 'status',
						type: {
							defined: 'SwiftDestSolanaStatus',
						},
					},
					{
						name: 'order',
						type: {
							defined: 'OrderInfo',
						},
					},
					{
						name: 'hash',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'relayer',
						type: 'publicKey',
					},
					{
						name: 'fulfill',
						type: {
							defined: 'FulfillInfo',
						},
					},
				],
			},
		},
		{
			name: 'swiftSourceSolanaState',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'bump',
						type: 'u8',
					},
					{
						name: 'status',
						type: {
							defined: 'SwiftSourceSolanaStatus',
						},
					},
				],
			},
		},
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
	],
	types: [
		{
			name: 'InitOrderParams',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'amountInMin',
						type: 'u64',
					},
					{
						name: 'nativeInput',
						type: 'bool',
					},
					{
						name: 'feeSubmit',
						type: 'u64',
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
		{
			name: 'FulfillInfo',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'winner',
						type: 'publicKey',
					},
					{
						name: 'amountPromised',
						type: 'u64',
					},
					{
						name: 'amountOutput',
						type: 'u64',
					},
					{
						name: 'patchVersion',
						type: 'u8',
					},
					{
						name: 'timeFulfill',
						type: 'u64',
					},
					{
						name: 'addrUnlocker',
						type: {
							array: ['u8', 32],
						},
					},
				],
			},
		},
		{
			name: 'SwiftDestSolanaStatus',
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'NONE',
					},
					{
						name: 'CREATED',
					},
					{
						name: 'FULFILLED',
					},
					{
						name: 'SETTLED',
					},
					{
						name: 'POSTED',
					},
					{
						name: 'CANCELLED',
					},
					{
						name: 'CLOSED',
					},
				],
			},
		},
		{
			name: 'SwiftSourceSolanaStatus',
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'NONE',
					},
					{
						name: 'LOCKED',
					},
					{
						name: 'UNLOCKED',
					},
					{
						name: 'REFUNDED',
					},
				],
			},
		},
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
	events: [
		{
			name: 'OrderInitialized',
			fields: [
				{
					name: 'orderHash',
					type: {
						array: ['u8', 32],
					},
					index: false,
				},
				{
					name: 'amountIn',
					type: 'u64',
					index: false,
				},
			],
		},
	],
	errors: [
		{
			code: 6000,
			name: 'OrderDestChainIsNotSolana',
			msg: 'Order dest chain is not solana',
		},
		{
			code: 6001,
			name: 'ChainIdNotEvmSupported',
			msg: 'Chain id is not Evm supported chain',
		},
		{
			code: 6002,
			name: 'InvalidStateStatus',
			msg: 'Invalid state status',
		},
		{
			code: 6003,
			name: 'OrderIsNotCreated',
			msg: 'Order is not created',
		},
		{
			code: 6004,
			name: 'InvalidOrderAuctionType',
			msg: 'Order state is not fulfilled',
		},
		{
			code: 6005,
			name: 'DeadlineIsPassed',
			msg: 'Order deadline is passed',
		},
		{
			code: 6006,
			name: 'AuctionIsNotClosed',
			msg: 'Auction is not closed',
		},
		{
			code: 6007,
			name: 'AuctionHashMismatch',
			msg: 'Auction hash mismatch',
		},
		{
			code: 6008,
			name: 'AuctionIsNotFinished',
			msg: 'Auction is not valid yet',
		},
		{
			code: 6009,
			name: 'InvalidExpectedWinner',
			msg: 'Invalid expected winner',
		},
		{
			code: 6010,
			name: 'OrderCannotBeFulfilled',
			msg: 'Order cannot be fulfilled',
		},
		{
			code: 6011,
			name: 'DriverIsNotWinner',
			msg: 'Invalid auction winner',
		},
		{
			code: 6012,
			name: 'InvalidMint',
			msg: 'Invalid mint',
		},
		{
			code: 6013,
			name: 'InvalidDestinationAddress',
			msg: 'Destination account address is wrong',
		},
		{
			code: 6014,
			name: 'OutputIsLessThanPromised',
			msg: 'amount output < amount promised',
		},
		{
			code: 6015,
			name: 'MinAmountOutNotSatisfied',
			msg: 'amount output < amount out min + fees',
		},
		{
			code: 6016,
			name: 'WinnerIsPrivilegedYet',
			msg: 'winner is privileged yet',
		},
		{
			code: 6017,
			name: 'MissingRequiredOptionalAccount',
			msg: 'missing required optional account',
		},
		{
			code: 6018,
			name: 'InvalidStateAccount',
			msg: 'Invalid state account',
		},
		{
			code: 6019,
			name: 'OrderFulfillInfoMissed',
			msg: 'Order fulfill info is missing',
		},
		{
			code: 6020,
			name: 'InvalidRelayer',
			msg: 'Invalid Relayer for close state',
		},
		{
			code: 6021,
			name: 'Overflow',
			msg: 'Overflow',
		},
		{
			code: 6022,
			name: 'DeadlineIsNotPassed',
			msg: 'Deadline is not passed yet',
		},
		{
			code: 6023,
			name: 'InvalidPayloadLength',
			msg: 'Payload is invalid',
		},
		{
			code: 6024,
			name: 'AmountInTooSmall',
			msg: 'Amount in too small',
		},
		{
			code: 6025,
			name: 'InvalidZeroAmount',
			msg: 'Invalid zero amount',
		},
		{
			code: 6026,
			name: 'InsufficientFundsToPayLockFee',
			msg: 'Insufficient funds to pay lock fee',
		},
		{
			code: 6027,
			name: 'ProtocolFeeRateTooHigh',
			msg: 'Protocol fee rate too high',
		},
		{
			code: 6028,
			name: 'ProtocolFeeRateMismatch',
			msg: 'Param protocol fee rate is wrong',
		},
		{
			code: 6029,
			name: 'ReferrerFeeRateTooHigh',
			msg: 'Referrer fee rate too high',
		},
		{
			code: 6030,
			name: 'GasDropNotAllowed',
			msg: 'Could not receive gas drop when token out is native',
		},
		{
			code: 6031,
			name: 'DestSolanaNotAllowed',
			msg: 'Destination chain could not be Solana',
		},
		{
			code: 6032,
			name: 'InvalidParam',
			msg: 'Invalid order parameter',
		},
		{
			code: 6033,
			name: 'FeesOverflow',
			msg: 'fee cancel + fee refund -> overflow',
		},
		{
			code: 6034,
			name: 'FeesTooHigh',
			msg: 'fee cancel + fee refund >= amount_in',
		},
		{
			code: 6035,
			name: 'FeeRateRefIsNotZero',
			msg: 'fee rate ref is not zero',
		},
		{
			code: 6036,
			name: 'RelayerIsTraderFeeSubmit',
			msg: 'relayer is trader but fee_submit > 0',
		},
		{
			code: 6037,
			name: 'MintAndTokenProgramMismatch',
			msg: 'Mint is not match with token program',
		},
		{
			code: 6038,
			name: 'InvalidUnlockBatchVAA',
			msg: 'Invalid unlock batch vaa',
		},
		{
			code: 6039,
			name: 'InvalidUnlockVAA',
			msg: 'Invalid unlock vaa',
		},
		{
			code: 6040,
			name: 'DriverIsNotUnlocker',
			msg: 'Driver is not equal to vaa unlocker',
		},
		{
			code: 6041,
			name: 'MintIsNotTokenIn',
			msg: 'Mint is not equal to vaa token in',
		},
		{
			code: 6042,
			name: 'InvalidRemainingAccountsCount',
		},
		{
			code: 6043,
			name: 'InvalidTokenAccountMint',
		},
		{
			code: 6044,
			name: 'InvalidTokenAccountOwner',
		},
		{
			code: 6045,
			name: 'InvalidEmitterChain',
		},
		{
			code: 6046,
			name: 'InvalidEmitterAddress',
		},
		{
			code: 6047,
			name: 'InvalidCancelVAA',
			msg: 'Invalid cancel vaa',
		},
		{
			code: 6048,
			name: 'WrongCancelRelayerAddress',
		},
		{
			code: 6049,
			name: 'InsufficientFundsToRefundFee',
		},
		{
			code: 6050,
			name: 'InvalidTrader',
		},
		{
			code: 6051,
			name: 'InvalidOneOwner',
		},
		{
			code: 6052,
			name: 'InvalidTwoOwner',
		},
		{
			code: 6053,
			name: 'InvalidThreeOwner',
		},
	],
};
