export type SwiftV2 = {
	address: '92peaC8g5ANAxpK2aCfLTC12JgPncRKCGULQNB2DMvRH';
	metadata: {
		name: 'swift';
		version: '0.1.0';
		spec: '0.1.0';
		description: 'Created with Anchor';
	};
	instructions: [
		{
			name: 'cancel';
			discriminator: [232, 219, 223, 41, 219, 236, 220, 190];
			accounts: [
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'relayer';
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
					name: 'foreignFeeCollector';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'close';
			discriminator: [98, 165, 201, 177, 108, 65, 206, 96];
			accounts: [
				{
					name: 'state';
					docs: ['but as we want to close it and change its type we should use AccountInfo type'];
					writable: true;
				},
				{
					name: 'relayer';
					writable: true;
				},
				{
					name: 'systemProgram';
				},
			];
			args: [];
		},
		{
			name: 'closeCompactUnlock';
			discriminator: [150, 245, 132, 228, 182, 180, 180, 140];
			accounts: [
				{
					name: 'compactUnlock';
					writable: true;
				},
				{
					name: 'initializer';
					signer: true;
				},
			];
			args: [];
		},
		{
			name: 'fulfill';
			discriminator: [143, 2, 52, 206, 174, 164, 247, 72];
			accounts: [
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'driver';
					writable: true;
					signer: true;
				},
				{
					name: 'stateToAcc';
				},
				{
					name: 'mintTo';
				},
				{
					name: 'dest';
					docs: ['CHECK this should be equal to addr_dest'];
					writable: true;
				},
				{
					name: 'systemProgram';
				},
				{
					name: 'tokenProgram';
				},
			];
			args: [
				{
					name: 'unlockReceiver';
					type: {
						array: ['u8', 32];
					};
				},
			];
		},
		{
			name: 'initCompactUnlock';
			discriminator: [45, 148, 157, 145, 94, 113, 164, 139];
			accounts: [
				{
					name: 'vaa';
					docs: ["at this step we don't check the VAA, we just use it as the seeds"];
				},
				{
					name: 'compactUnlock';
					writable: true;
				},
				{
					name: 'relayer';
					writable: true;
					signer: true;
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'itemsCount';
					type: 'u16';
				},
			];
		},
		{
			name: 'initOrder';
			discriminator: [32, 76, 41, 12, 39, 162, 132, 219];
			accounts: [
				{
					name: 'trader';
					docs: [
						'must be transferred to the state account in the same transaction as the order',
						'initialization. This ensures the state seeds remain valid and prevents any risk',
						'of losing them.',
						'',
						'With this requirement, we can be certain that the funders have already signed',
						'this instruction, mitigating potential risks.',
					];
				},
				{
					name: 'relayer';
					writable: true;
					signer: true;
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateFromAcc';
				},
				{
					name: 'relayerFeeAcc';
					writable: true;
				},
				{
					name: 'customPayloadStore';
					docs: ['We will hash all data of it and store it in ledger as custom payload.'];
					optional: true;
				},
				{
					name: 'mintFrom';
				},
				{
					name: 'feeManagerProgram';
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'params';
					type: {
						defined: {
							name: 'initOrderParams';
						};
					};
				},
			];
		},
		{
			name: 'postUnlock';
			discriminator: [105, 29, 80, 28, 81, 250, 231, 185];
			accounts: [
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
					name: 'compactMode';
					type: 'bool';
				},
			];
		},
		{
			name: 'refund';
			discriminator: [2, 96, 183, 251, 63, 208, 46, 46];
			accounts: [
				{
					name: 'vaaCancel';
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateFromAcc';
					writable: true;
				},
				{
					name: 'trader';
					writable: true;
				},
				{
					name: 'traderAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'mintFrom';
				},
				{
					name: 'relayerRefund';
					writable: true;
					signer: true;
				},
				{
					name: 'relayerRefundAcc';
					writable: true;
				},
				{
					name: 'relayerCancel';
				},
				{
					name: 'relayerCancelAcc';
					writable: true;
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
				},
			];
			args: [];
		},
		{
			name: 'registerOrder';
			discriminator: [92, 37, 29, 46, 77, 250, 219, 6];
			accounts: [
				{
					name: 'relayer';
					writable: true;
					signer: true;
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'args';
					type: {
						defined: {
							name: 'orderInfo';
						};
					};
				},
			];
		},
		{
			name: 'setAuctionWinner';
			discriminator: [63, 231, 14, 33, 159, 196, 43, 39];
			accounts: [
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'auction';
				},
			];
			args: [
				{
					name: 'expectedWinner';
					type: 'pubkey';
				},
			];
		},
		{
			name: 'settle';
			discriminator: [175, 42, 185, 87, 144, 131, 102, 212];
			accounts: [
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateToAcc';
					writable: true;
				},
				{
					name: 'relayer';
					writable: true;
					signer: true;
				},
				{
					name: 'mintTo';
				},
				{
					name: 'dest';
					writable: true;
				},
				{
					name: 'destSigner';
					signer: true;
				},
				{
					name: 'destAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
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
			name: 'unlock';
			discriminator: [101, 155, 40, 21, 158, 189, 56, 203];
			accounts: [
				{
					name: 'vaaUnlock';
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateFromAcc';
					writable: true;
				},
				{
					name: 'mintFrom';
				},
				{
					name: 'unlockReceiver';
					docs: ['transfer to the driver ATA account.'];
					writable: true;
				},
				{
					name: 'unlockReceiverAcc';
					writable: true;
				},
				{
					name: 'referrer';
				},
				{
					name: 'feeCollector';
				},
				{
					name: 'referrerFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'mayanFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
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
			name: 'unlockBatch';
			discriminator: [167, 114, 53, 218, 111, 158, 170, 38];
			accounts: [
				{
					name: 'vaaUnlock';
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateFromAcc';
					writable: true;
				},
				{
					name: 'mintFrom';
				},
				{
					name: 'unlockReceiver';
					docs: ['transfer to the unlock receiver ATA account.'];
					writable: true;
				},
				{
					name: 'unlockReceiverAcc';
					writable: true;
				},
				{
					name: 'referrer';
				},
				{
					name: 'feeCollector';
				},
				{
					name: 'referrerFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'mayanFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'index';
					type: 'u16';
				},
				{
					name: 'tryCloseAta';
					type: 'bool';
				},
			];
		},
		{
			name: 'unlockBatchCompact';
			discriminator: [130, 18, 228, 224, 180, 84, 29, 177];
			accounts: [
				{
					name: 'compactUnlock';
					writable: true;
				},
				{
					name: 'state';
					writable: true;
				},
				{
					name: 'stateFromAcc';
					writable: true;
				},
				{
					name: 'mintFrom';
				},
				{
					name: 'unlockReceiver';
					docs: ['transfer to the driver ATA account.'];
					writable: true;
				},
				{
					name: 'unlockReceiverAcc';
					writable: true;
				},
				{
					name: 'referrer';
				},
				{
					name: 'feeCollector';
				},
				{
					name: 'referrerFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'mayanFeeAcc';
					writable: true;
					optional: true;
				},
				{
					name: 'tokenProgram';
				},
				{
					name: 'systemProgram';
				},
			];
			args: [
				{
					name: 'index';
					type: 'u16';
				},
				{
					name: 'tryCloseAta';
					type: 'bool';
				},
			];
		},
		{
			name: 'verifyCompactUnlock';
			discriminator: [25, 168, 186, 127, 55, 168, 207, 62];
			accounts: [
				{
					name: 'vaaUnlock';
				},
				{
					name: 'compactUnlock';
					writable: true;
				},
				{
					name: 'initializer';
					signer: true;
				},
			];
			args: [];
		},
		{
			name: 'writeCompactUnlock';
			discriminator: [183, 56, 194, 178, 205, 214, 144, 196];
			accounts: [
				{
					name: 'compactUnlock';
					writable: true;
				},
				{
					name: 'initializer';
					signer: true;
				},
			];
			args: [
				{
					name: 'start';
					type: 'u16';
				},
				{
					name: 'end';
					type: 'u16';
				},
				{
					name: 'slice';
					type: 'bytes';
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
			name: 'compactUnlockState';
			discriminator: [254, 246, 114, 147, 47, 219, 201, 148];
		},
		{
			name: 'swiftDestSolanaState';
			discriminator: [124, 172, 240, 168, 249, 92, 241, 163];
		},
		{
			name: 'swiftSourceSolanaState';
			discriminator: [107, 149, 204, 128, 198, 155, 3, 162];
		},
	];
	events: [
		{
			name: 'orderInitialized';
			discriminator: [180, 118, 44, 249, 166, 25, 40, 81];
		},
	];
	errors: [
		{
			code: 6000;
			name: 'orderDestChainIsNotSolana';
			msg: 'Order dest chain is not solana';
		},
		{
			code: 6001;
			name: 'chainIdNotMayanSupported';
			msg: 'Chain id is not Evm supported chain';
		},
		{
			code: 6002;
			name: 'invalidStateStatus';
			msg: 'Invalid state status';
		},
		{
			code: 6003;
			name: 'orderIsNotCreated';
			msg: 'Order is not created';
		},
		{
			code: 6004;
			name: 'invalidOrderAuctionType';
			msg: 'Order state is not fulfilled';
		},
		{
			code: 6005;
			name: 'deadlineIsPassed';
			msg: 'Order deadline is passed';
		},
		{
			code: 6006;
			name: 'auctionIsNotClosed';
			msg: 'Auction is not closed';
		},
		{
			code: 6007;
			name: 'auctionHashMismatch';
			msg: 'Auction hash mismatch';
		},
		{
			code: 6008;
			name: 'auctionIsNotFinished';
			msg: 'Auction is not valid yet';
		},
		{
			code: 6009;
			name: 'invalidExpectedWinner';
			msg: 'Invalid expected winner';
		},
		{
			code: 6010;
			name: 'orderCannotBeFulfilled';
			msg: 'Order cannot be fulfilled';
		},
		{
			code: 6011;
			name: 'driverIsNotWinner';
			msg: 'Invalid auction winner';
		},
		{
			code: 6012;
			name: 'invalidMint';
			msg: 'Invalid mint';
		},
		{
			code: 6013;
			name: 'invalidDestinationAddress';
			msg: 'Destination account address is wrong';
		},
		{
			code: 6014;
			name: 'outputIsLessThanPromised';
			msg: 'amount output < amount promised';
		},
		{
			code: 6015;
			name: 'minAmountOutNotSatisfied';
			msg: 'amount output < amount out min + fees';
		},
		{
			code: 6016;
			name: 'winnerIsPrivilegedYet';
			msg: 'winner is privileged yet';
		},
		{
			code: 6017;
			name: 'missingRequiredOptionalAccount';
			msg: 'missing required optional account';
		},
		{
			code: 6018;
			name: 'invalidStateAccount';
			msg: 'Invalid state account';
		},
		{
			code: 6019;
			name: 'orderFulfillInfoMissed';
			msg: 'Order fulfill info is missing';
		},
		{
			code: 6020;
			name: 'invalidRelayer';
			msg: 'Invalid Relayer for close state';
		},
		{
			code: 6021;
			name: 'overflow';
			msg: 'overflow';
		},
		{
			code: 6022;
			name: 'deadlineIsNotPassed';
			msg: 'Deadline is not passed yet';
		},
		{
			code: 6023;
			name: 'invalidPayloadLength';
			msg: 'Payload is invalid';
		},
		{
			code: 6024;
			name: 'amountInTooSmall';
			msg: 'Amount in too small';
		},
		{
			code: 6025;
			name: 'invalidZeroAmount';
			msg: 'Invalid zero amount';
		},
		{
			code: 6026;
			name: 'insufficientFundsToPayLockFee';
			msg: 'Insufficient funds to pay lock fee';
		},
		{
			code: 6027;
			name: 'protocolFeeRateTooHigh';
			msg: 'Protocol fee rate too high';
		},
		{
			code: 6028;
			name: 'protocolFeeRateMismatch';
			msg: 'Param protocol fee rate is wrong';
		},
		{
			code: 6029;
			name: 'referrerFeeRateTooHigh';
			msg: 'Referrer fee rate too high';
		},
		{
			code: 6030;
			name: 'gasDropNotAllowed';
			msg: 'Could not receive gas drop when token out is native';
		},
		{
			code: 6031;
			name: 'destSolanaNotAllowed';
			msg: 'Destination chain could not be Solana';
		},
		{
			code: 6032;
			name: 'invalidParam';
			msg: 'Invalid order parameter';
		},
		{
			code: 6033;
			name: 'feesOverflow';
			msg: 'fee cancel + fee refund -> overflow';
		},
		{
			code: 6034;
			name: 'feesTooHigh';
			msg: 'fee cancel + fee refund >= amount_in';
		},
		{
			code: 6035;
			name: 'feeRateRefIsNotZero';
			msg: 'fee rate ref is not zero';
		},
		{
			code: 6036;
			name: 'relayerIsTraderFeeSubmit';
			msg: 'relayer is trader but fee_submit > 0';
		},
		{
			code: 6037;
			name: 'mintAndTokenProgramMismatch';
			msg: 'Mint is not match with token program';
		},
		{
			code: 6038;
			name: 'invalidUnlockBatchVaa';
			msg: 'Invalid unlock batch message';
		},
		{
			code: 6039;
			name: 'invalidUnlockVaa';
			msg: 'Invalid unlock message';
		},
		{
			code: 6040;
			name: 'invalidUnlockBatchCompactVaa';
			msg: 'Invalid unlock batch compact message';
		},
		{
			code: 6041;
			name: 'unlockReceiverIsNotCorrect';
			msg: 'Unlock receiver account is not equal to message unlock receiver';
		},
		{
			code: 6042;
			name: 'mintIsNotTokenIn';
			msg: 'Mint is not equal to message token in';
		},
		{
			code: 6043;
			name: 'invalidRemainingAccountsCount';
		},
		{
			code: 6044;
			name: 'invalidTokenAccountMint';
		},
		{
			code: 6045;
			name: 'invalidTokenAccountOwner';
		},
		{
			code: 6046;
			name: 'invalidEmitterChain';
		},
		{
			code: 6047;
			name: 'invalidEmitterAddress';
		},
		{
			code: 6048;
			name: 'destShouldSignCustomPayload';
		},
		{
			code: 6049;
			name: 'invalidReferrerAddress';
		},
		{
			code: 6050;
			name: 'invalidCancelVaa';
			msg: 'Invalid cancel message';
		},
		{
			code: 6051;
			name: 'wrongCancelRelayerAddress';
		},
		{
			code: 6052;
			name: 'insufficientFundsToRefundFee';
		},
		{
			code: 6053;
			name: 'invalidTrader';
		},
		{
			code: 6054;
			name: 'invalidAccountStatus';
		},
		{
			code: 6055;
			name: 'invalidSlice';
		},
		{
			code: 6056;
			name: 'invalidCompactUnlockItemsCount';
		},
		{
			code: 6057;
			name: 'invalidCompactUnlockHash';
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
						name: 'amountOutMin';
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
			name: 'compactUnlockState';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'seeds';
						type: {
							defined: {
								name: 'compactUnlockStateSeeds';
							};
						};
					},
					{
						name: 'info';
						type: {
							defined: {
								name: 'compactUnlockStateInfo';
							};
						};
					},
					{
						name: 'items';
						type: 'bytes';
					},
				];
			};
		},
		{
			name: 'compactUnlockStateInfo';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'status';
						type: {
							defined: {
								name: 'compactUnlockStatus';
							};
						};
					},
					{
						name: 'emitterChain';
						type: 'u16';
					},
					{
						name: 'messageHash';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'itemsCount';
						type: 'u16';
					},
				];
			};
		},
		{
			name: 'compactUnlockStateSeeds';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'bump';
						type: 'u8';
					},
					{
						name: 'vaa';
						type: 'pubkey';
					},
					{
						name: 'initializer';
						type: 'pubkey';
					},
				];
			};
		},
		{
			name: 'compactUnlockStatus';
			repr: {
				kind: 'rust';
			};
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'none';
					},
					{
						name: 'created';
					},
					{
						name: 'verified';
					},
				];
			};
		},
		{
			name: 'fulfillInfo';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'winner';
						type: 'pubkey';
					},
					{
						name: 'amountPromised';
						type: 'u64';
					},
					{
						name: 'amountFulfill';
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
						name: 'unlockReceiver';
						type: {
							array: ['u8', 32];
						};
					},
				];
			};
		},
		{
			name: 'initOrderParams';
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
						name: 'baseBond';
						type: 'u64';
					},
					{
						name: 'perBpsBond';
						type: 'u64';
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
		{
			name: 'orderInitialized';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'orderHash';
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'amountIn';
						type: 'u64';
					},
				];
			};
		},
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
							defined: {
								name: 'swiftDestSolanaStatus';
							};
						};
					},
					{
						name: 'isSettled';
						type: 'bool';
					},
					{
						name: 'isPosted';
						type: 'bool';
					},
					{
						name: 'order';
						type: {
							defined: {
								name: 'orderInfo';
							};
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
						type: 'pubkey';
					},
					{
						name: 'fulfill';
						type: {
							defined: {
								name: 'fulfillInfo';
							};
						};
					},
				];
			};
		},
		{
			name: 'swiftDestSolanaStatus';
			repr: {
				kind: 'rust';
			};
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'none';
					},
					{
						name: 'created';
					},
					{
						name: 'fulfilled';
					},
					{
						name: 'cancelled';
					},
					{
						name: 'closed';
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
							defined: {
								name: 'swiftSourceSolanaStatus';
							};
						};
					},
				];
			};
		},
		{
			name: 'swiftSourceSolanaStatus';
			repr: {
				kind: 'rust';
			};
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'none';
					},
					{
						name: 'locked';
					},
					{
						name: 'unlocked';
					},
					{
						name: 'refunded';
					},
				];
			};
		},
	];
};
export const SwiftV2Idl: SwiftV2 = {
	address: '92peaC8g5ANAxpK2aCfLTC12JgPncRKCGULQNB2DMvRH',
	metadata: {
		name: 'swift',
		version: '0.1.0',
		spec: '0.1.0',
		description: 'Created with Anchor',
	},
	instructions: [
		{
			name: 'cancel',
			discriminator: [232, 219, 223, 41, 219, 236, 220, 190],
			accounts: [
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'relayer',
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
					name: 'foreignFeeCollector',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'close',
			discriminator: [98, 165, 201, 177, 108, 65, 206, 96],
			accounts: [
				{
					name: 'state',
					docs: ['but as we want to close it and change its type we should use AccountInfo type'],
					writable: true,
				},
				{
					name: 'relayer',
					writable: true,
				},
				{
					name: 'systemProgram',
				},
			],
			args: [],
		},
		{
			name: 'closeCompactUnlock',
			discriminator: [150, 245, 132, 228, 182, 180, 180, 140],
			accounts: [
				{
					name: 'compactUnlock',
					writable: true,
				},
				{
					name: 'initializer',
					signer: true,
				},
			],
			args: [],
		},
		{
			name: 'fulfill',
			discriminator: [143, 2, 52, 206, 174, 164, 247, 72],
			accounts: [
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'driver',
					writable: true,
					signer: true,
				},
				{
					name: 'stateToAcc',
				},
				{
					name: 'mintTo',
				},
				{
					name: 'dest',
					docs: ['CHECK this should be equal to addr_dest'],
					writable: true,
				},
				{
					name: 'systemProgram',
				},
				{
					name: 'tokenProgram',
				},
			],
			args: [
				{
					name: 'unlockReceiver',
					type: {
						array: ['u8', 32],
					},
				},
			],
		},
		{
			name: 'initCompactUnlock',
			discriminator: [45, 148, 157, 145, 94, 113, 164, 139],
			accounts: [
				{
					name: 'vaa',
					docs: ["at this step we don't check the VAA, we just use it as the seeds"],
				},
				{
					name: 'compactUnlock',
					writable: true,
				},
				{
					name: 'relayer',
					writable: true,
					signer: true,
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'itemsCount',
					type: 'u16',
				},
			],
		},
		{
			name: 'initOrder',
			discriminator: [32, 76, 41, 12, 39, 162, 132, 219],
			accounts: [
				{
					name: 'trader',
					docs: [
						'must be transferred to the state account in the same transaction as the order',
						'initialization. This ensures the state seeds remain valid and prevents any risk',
						'of losing them.',
						'',
						'With this requirement, we can be certain that the funders have already signed',
						'this instruction, mitigating potential risks.',
					],
				},
				{
					name: 'relayer',
					writable: true,
					signer: true,
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateFromAcc',
				},
				{
					name: 'relayerFeeAcc',
					writable: true,
				},
				{
					name: 'customPayloadStore',
					docs: ['We will hash all data of it and store it in ledger as custom payload.'],
					optional: true,
				},
				{
					name: 'mintFrom',
				},
				{
					name: 'feeManagerProgram',
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'params',
					type: {
						defined: {
							name: 'initOrderParams',
						},
					},
				},
			],
		},
		{
			name: 'postUnlock',
			discriminator: [105, 29, 80, 28, 81, 250, 231, 185],
			accounts: [
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
					name: 'compactMode',
					type: 'bool',
				},
			],
		},
		{
			name: 'refund',
			discriminator: [2, 96, 183, 251, 63, 208, 46, 46],
			accounts: [
				{
					name: 'vaaCancel',
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateFromAcc',
					writable: true,
				},
				{
					name: 'trader',
					writable: true,
				},
				{
					name: 'traderAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'mintFrom',
				},
				{
					name: 'relayerRefund',
					writable: true,
					signer: true,
				},
				{
					name: 'relayerRefundAcc',
					writable: true,
				},
				{
					name: 'relayerCancel',
				},
				{
					name: 'relayerCancelAcc',
					writable: true,
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
				},
			],
			args: [],
		},
		{
			name: 'registerOrder',
			discriminator: [92, 37, 29, 46, 77, 250, 219, 6],
			accounts: [
				{
					name: 'relayer',
					writable: true,
					signer: true,
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'args',
					type: {
						defined: {
							name: 'orderInfo',
						},
					},
				},
			],
		},
		{
			name: 'setAuctionWinner',
			discriminator: [63, 231, 14, 33, 159, 196, 43, 39],
			accounts: [
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'auction',
				},
			],
			args: [
				{
					name: 'expectedWinner',
					type: 'pubkey',
				},
			],
		},
		{
			name: 'settle',
			discriminator: [175, 42, 185, 87, 144, 131, 102, 212],
			accounts: [
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateToAcc',
					writable: true,
				},
				{
					name: 'relayer',
					writable: true,
					signer: true,
				},
				{
					name: 'mintTo',
				},
				{
					name: 'dest',
					writable: true,
				},
				{
					name: 'destSigner',
					signer: true,
				},
				{
					name: 'destAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
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
			name: 'unlock',
			discriminator: [101, 155, 40, 21, 158, 189, 56, 203],
			accounts: [
				{
					name: 'vaaUnlock',
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateFromAcc',
					writable: true,
				},
				{
					name: 'mintFrom',
				},
				{
					name: 'unlockReceiver',
					docs: ['transfer to the driver ATA account.'],
					writable: true,
				},
				{
					name: 'unlockReceiverAcc',
					writable: true,
				},
				{
					name: 'referrer',
				},
				{
					name: 'feeCollector',
				},
				{
					name: 'referrerFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'mayanFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
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
			name: 'unlockBatch',
			discriminator: [167, 114, 53, 218, 111, 158, 170, 38],
			accounts: [
				{
					name: 'vaaUnlock',
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateFromAcc',
					writable: true,
				},
				{
					name: 'mintFrom',
				},
				{
					name: 'unlockReceiver',
					docs: ['transfer to the unlock receiver ATA account.'],
					writable: true,
				},
				{
					name: 'unlockReceiverAcc',
					writable: true,
				},
				{
					name: 'referrer',
				},
				{
					name: 'feeCollector',
				},
				{
					name: 'referrerFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'mayanFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'index',
					type: 'u16',
				},
				{
					name: 'tryCloseAta',
					type: 'bool',
				},
			],
		},
		{
			name: 'unlockBatchCompact',
			discriminator: [130, 18, 228, 224, 180, 84, 29, 177],
			accounts: [
				{
					name: 'compactUnlock',
					writable: true,
				},
				{
					name: 'state',
					writable: true,
				},
				{
					name: 'stateFromAcc',
					writable: true,
				},
				{
					name: 'mintFrom',
				},
				{
					name: 'unlockReceiver',
					docs: ['transfer to the driver ATA account.'],
					writable: true,
				},
				{
					name: 'unlockReceiverAcc',
					writable: true,
				},
				{
					name: 'referrer',
				},
				{
					name: 'feeCollector',
				},
				{
					name: 'referrerFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'mayanFeeAcc',
					writable: true,
					optional: true,
				},
				{
					name: 'tokenProgram',
				},
				{
					name: 'systemProgram',
				},
			],
			args: [
				{
					name: 'index',
					type: 'u16',
				},
				{
					name: 'tryCloseAta',
					type: 'bool',
				},
			],
		},
		{
			name: 'verifyCompactUnlock',
			discriminator: [25, 168, 186, 127, 55, 168, 207, 62],
			accounts: [
				{
					name: 'vaaUnlock',
				},
				{
					name: 'compactUnlock',
					writable: true,
				},
				{
					name: 'initializer',
					signer: true,
				},
			],
			args: [],
		},
		{
			name: 'writeCompactUnlock',
			discriminator: [183, 56, 194, 178, 205, 214, 144, 196],
			accounts: [
				{
					name: 'compactUnlock',
					writable: true,
				},
				{
					name: 'initializer',
					signer: true,
				},
			],
			args: [
				{
					name: 'start',
					type: 'u16',
				},
				{
					name: 'end',
					type: 'u16',
				},
				{
					name: 'slice',
					type: 'bytes',
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
			name: 'compactUnlockState',
			discriminator: [254, 246, 114, 147, 47, 219, 201, 148],
		},
		{
			name: 'swiftDestSolanaState',
			discriminator: [124, 172, 240, 168, 249, 92, 241, 163],
		},
		{
			name: 'swiftSourceSolanaState',
			discriminator: [107, 149, 204, 128, 198, 155, 3, 162],
		},
	],
	events: [
		{
			name: 'orderInitialized',
			discriminator: [180, 118, 44, 249, 166, 25, 40, 81],
		},
	],
	errors: [
		{
			code: 6000,
			name: 'orderDestChainIsNotSolana',
			msg: 'Order dest chain is not solana',
		},
		{
			code: 6001,
			name: 'chainIdNotMayanSupported',
			msg: 'Chain id is not Evm supported chain',
		},
		{
			code: 6002,
			name: 'invalidStateStatus',
			msg: 'Invalid state status',
		},
		{
			code: 6003,
			name: 'orderIsNotCreated',
			msg: 'Order is not created',
		},
		{
			code: 6004,
			name: 'invalidOrderAuctionType',
			msg: 'Order state is not fulfilled',
		},
		{
			code: 6005,
			name: 'deadlineIsPassed',
			msg: 'Order deadline is passed',
		},
		{
			code: 6006,
			name: 'auctionIsNotClosed',
			msg: 'Auction is not closed',
		},
		{
			code: 6007,
			name: 'auctionHashMismatch',
			msg: 'Auction hash mismatch',
		},
		{
			code: 6008,
			name: 'auctionIsNotFinished',
			msg: 'Auction is not valid yet',
		},
		{
			code: 6009,
			name: 'invalidExpectedWinner',
			msg: 'Invalid expected winner',
		},
		{
			code: 6010,
			name: 'orderCannotBeFulfilled',
			msg: 'Order cannot be fulfilled',
		},
		{
			code: 6011,
			name: 'driverIsNotWinner',
			msg: 'Invalid auction winner',
		},
		{
			code: 6012,
			name: 'invalidMint',
			msg: 'Invalid mint',
		},
		{
			code: 6013,
			name: 'invalidDestinationAddress',
			msg: 'Destination account address is wrong',
		},
		{
			code: 6014,
			name: 'outputIsLessThanPromised',
			msg: 'amount output < amount promised',
		},
		{
			code: 6015,
			name: 'minAmountOutNotSatisfied',
			msg: 'amount output < amount out min + fees',
		},
		{
			code: 6016,
			name: 'winnerIsPrivilegedYet',
			msg: 'winner is privileged yet',
		},
		{
			code: 6017,
			name: 'missingRequiredOptionalAccount',
			msg: 'missing required optional account',
		},
		{
			code: 6018,
			name: 'invalidStateAccount',
			msg: 'Invalid state account',
		},
		{
			code: 6019,
			name: 'orderFulfillInfoMissed',
			msg: 'Order fulfill info is missing',
		},
		{
			code: 6020,
			name: 'invalidRelayer',
			msg: 'Invalid Relayer for close state',
		},
		{
			code: 6021,
			name: 'overflow',
			msg: 'overflow',
		},
		{
			code: 6022,
			name: 'deadlineIsNotPassed',
			msg: 'Deadline is not passed yet',
		},
		{
			code: 6023,
			name: 'invalidPayloadLength',
			msg: 'Payload is invalid',
		},
		{
			code: 6024,
			name: 'amountInTooSmall',
			msg: 'Amount in too small',
		},
		{
			code: 6025,
			name: 'invalidZeroAmount',
			msg: 'Invalid zero amount',
		},
		{
			code: 6026,
			name: 'insufficientFundsToPayLockFee',
			msg: 'Insufficient funds to pay lock fee',
		},
		{
			code: 6027,
			name: 'protocolFeeRateTooHigh',
			msg: 'Protocol fee rate too high',
		},
		{
			code: 6028,
			name: 'protocolFeeRateMismatch',
			msg: 'Param protocol fee rate is wrong',
		},
		{
			code: 6029,
			name: 'referrerFeeRateTooHigh',
			msg: 'Referrer fee rate too high',
		},
		{
			code: 6030,
			name: 'gasDropNotAllowed',
			msg: 'Could not receive gas drop when token out is native',
		},
		{
			code: 6031,
			name: 'destSolanaNotAllowed',
			msg: 'Destination chain could not be Solana',
		},
		{
			code: 6032,
			name: 'invalidParam',
			msg: 'Invalid order parameter',
		},
		{
			code: 6033,
			name: 'feesOverflow',
			msg: 'fee cancel + fee refund -> overflow',
		},
		{
			code: 6034,
			name: 'feesTooHigh',
			msg: 'fee cancel + fee refund >= amount_in',
		},
		{
			code: 6035,
			name: 'feeRateRefIsNotZero',
			msg: 'fee rate ref is not zero',
		},
		{
			code: 6036,
			name: 'relayerIsTraderFeeSubmit',
			msg: 'relayer is trader but fee_submit > 0',
		},
		{
			code: 6037,
			name: 'mintAndTokenProgramMismatch',
			msg: 'Mint is not match with token program',
		},
		{
			code: 6038,
			name: 'invalidUnlockBatchVaa',
			msg: 'Invalid unlock batch message',
		},
		{
			code: 6039,
			name: 'invalidUnlockVaa',
			msg: 'Invalid unlock message',
		},
		{
			code: 6040,
			name: 'invalidUnlockBatchCompactVaa',
			msg: 'Invalid unlock batch compact message',
		},
		{
			code: 6041,
			name: 'unlockReceiverIsNotCorrect',
			msg: 'Unlock receiver account is not equal to message unlock receiver',
		},
		{
			code: 6042,
			name: 'mintIsNotTokenIn',
			msg: 'Mint is not equal to message token in',
		},
		{
			code: 6043,
			name: 'invalidRemainingAccountsCount',
		},
		{
			code: 6044,
			name: 'invalidTokenAccountMint',
		},
		{
			code: 6045,
			name: 'invalidTokenAccountOwner',
		},
		{
			code: 6046,
			name: 'invalidEmitterChain',
		},
		{
			code: 6047,
			name: 'invalidEmitterAddress',
		},
		{
			code: 6048,
			name: 'destShouldSignCustomPayload',
		},
		{
			code: 6049,
			name: 'invalidReferrerAddress',
		},
		{
			code: 6050,
			name: 'invalidCancelVaa',
			msg: 'Invalid cancel message',
		},
		{
			code: 6051,
			name: 'wrongCancelRelayerAddress',
		},
		{
			code: 6052,
			name: 'insufficientFundsToRefundFee',
		},
		{
			code: 6053,
			name: 'invalidTrader',
		},
		{
			code: 6054,
			name: 'invalidAccountStatus',
		},
		{
			code: 6055,
			name: 'invalidSlice',
		},
		{
			code: 6056,
			name: 'invalidCompactUnlockItemsCount',
		},
		{
			code: 6057,
			name: 'invalidCompactUnlockHash',
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
						name: 'amountOutMin',
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
			name: 'compactUnlockState',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'seeds',
						type: {
							defined: {
								name: 'compactUnlockStateSeeds',
							},
						},
					},
					{
						name: 'info',
						type: {
							defined: {
								name: 'compactUnlockStateInfo',
							},
						},
					},
					{
						name: 'items',
						type: 'bytes',
					},
				],
			},
		},
		{
			name: 'compactUnlockStateInfo',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'status',
						type: {
							defined: {
								name: 'compactUnlockStatus',
							},
						},
					},
					{
						name: 'emitterChain',
						type: 'u16',
					},
					{
						name: 'messageHash',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'itemsCount',
						type: 'u16',
					},
				],
			},
		},
		{
			name: 'compactUnlockStateSeeds',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'bump',
						type: 'u8',
					},
					{
						name: 'vaa',
						type: 'pubkey',
					},
					{
						name: 'initializer',
						type: 'pubkey',
					},
				],
			},
		},
		{
			name: 'compactUnlockStatus',
			repr: {
				kind: 'rust',
			},
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'none',
					},
					{
						name: 'created',
					},
					{
						name: 'verified',
					},
				],
			},
		},
		{
			name: 'fulfillInfo',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'winner',
						type: 'pubkey',
					},
					{
						name: 'amountPromised',
						type: 'u64',
					},
					{
						name: 'amountFulfill',
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
						name: 'unlockReceiver',
						type: {
							array: ['u8', 32],
						},
					},
				],
			},
		},
		{
			name: 'initOrderParams',
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
						name: 'baseBond',
						type: 'u64',
					},
					{
						name: 'perBpsBond',
						type: 'u64',
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
		{
			name: 'orderInitialized',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'orderHash',
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'amountIn',
						type: 'u64',
					},
				],
			},
		},
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
							defined: {
								name: 'swiftDestSolanaStatus',
							},
						},
					},
					{
						name: 'isSettled',
						type: 'bool',
					},
					{
						name: 'isPosted',
						type: 'bool',
					},
					{
						name: 'order',
						type: {
							defined: {
								name: 'orderInfo',
							},
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
						type: 'pubkey',
					},
					{
						name: 'fulfill',
						type: {
							defined: {
								name: 'fulfillInfo',
							},
						},
					},
				],
			},
		},
		{
			name: 'swiftDestSolanaStatus',
			repr: {
				kind: 'rust',
			},
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'none',
					},
					{
						name: 'created',
					},
					{
						name: 'fulfilled',
					},
					{
						name: 'cancelled',
					},
					{
						name: 'closed',
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
							defined: {
								name: 'swiftSourceSolanaStatus',
							},
						},
					},
				],
			},
		},
		{
			name: 'swiftSourceSolanaStatus',
			repr: {
				kind: 'rust',
			},
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'none',
					},
					{
						name: 'locked',
					},
					{
						name: 'unlocked',
					},
					{
						name: 'refunded',
					},
				],
			},
		},
	],
};
