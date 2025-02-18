export const abi = [
	{
		inputs: [
			{
				internalType: 'address',
				name: '_wormhole',
				type: 'address',
			},
			{
				internalType: 'address',
				name: '_feeManager',
				type: 'address',
			},
		],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
	{
		inputs: [],
		name: 'DuplicateOrder',
		type: 'error',
	},
	{
		inputs: [],
		name: 'EmitterAddressExists',
		type: 'error',
	},
	{
		inputs: [],
		name: 'FeesTooHigh',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidAction',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidBatchIndex',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidBpsFee',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidDestChain',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidEmitterAddress',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidEmitterChain',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidEvmAddr',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidGasDrop',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidOrderStatus',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidPayload',
		type: 'error',
	},
	{
		inputs: [],
		name: 'InvalidSrcChain',
		type: 'error',
	},
	{
		inputs: [
			{
				internalType: 'bytes32',
				name: 'orderHash',
				type: 'bytes32',
			},
		],
		name: 'OrderNotExists',
		type: 'error',
	},
	{
		inputs: [],
		name: 'Paused',
		type: 'error',
	},
	{
		inputs: [],
		name: 'SmallAmountIn',
		type: 'error',
	},
	{
		inputs: [],
		name: 'Unauthorized',
		type: 'error',
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: false,
				internalType: 'bytes32',
				name: 'key',
				type: 'bytes32',
			},
			{
				indexed: false,
				internalType: 'uint64',
				name: 'sequence',
				type: 'uint64',
			},
		],
		name: 'OrderCanceled',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: false,
				internalType: 'bytes32',
				name: 'key',
				type: 'bytes32',
			},
		],
		name: 'OrderCreated',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: false,
				internalType: 'bytes32',
				name: 'key',
				type: 'bytes32',
			},
			{
				indexed: false,
				internalType: 'uint64',
				name: 'sequence',
				type: 'uint64',
			},
			{
				indexed: false,
				internalType: 'uint256',
				name: 'netAmount',
				type: 'uint256',
			},
		],
		name: 'OrderFulfilled',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: false,
				internalType: 'bytes32',
				name: 'key',
				type: 'bytes32',
			},
			{
				indexed: false,
				internalType: 'uint256',
				name: 'netAmount',
				type: 'uint256',
			},
		],
		name: 'OrderRefunded',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{
				indexed: false,
				internalType: 'bytes32',
				name: 'key',
				type: 'bytes32',
			},
		],
		name: 'OrderUnlocked',
		type: 'event',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'newGuardian',
				type: 'address',
			},
		],
		name: 'changeGuardian',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'claimGuardian',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				components: [
					{
						internalType: 'uint8',
						name: 'payloadType',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'trader',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'destAddr',
						type: 'bytes32',
					},
					{
						internalType: 'uint16',
						name: 'destChainId',
						type: 'uint16',
					},
					{
						internalType: 'bytes32',
						name: 'referrerAddr',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'tokenOut',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'minAmountOut',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'gasDrop',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'cancelFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'refundFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'deadline',
						type: 'uint64',
					},
					{
						internalType: 'uint16',
						name: 'penaltyPeriod',
						type: 'uint16',
					},
					{
						internalType: 'uint8',
						name: 'referrerBps',
						type: 'uint8',
					},
					{
						internalType: 'uint8',
						name: 'auctionMode',
						type: 'uint8',
					},
					{
						internalType: 'uint64',
						name: 'baseBond',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'perBpsBond',
						type: 'uint64',
					},
					{
						internalType: 'bytes32',
						name: 'random',
						type: 'bytes32',
					},
				],
				internalType: 'struct OrderParams',
				name: 'params',
				type: 'tuple',
			},
			{
				internalType: 'bytes',
				name: 'customPayload',
				type: 'bytes',
			},
		],
		name: 'createOrderWithEth',
		outputs: [
			{
				internalType: 'bytes32',
				name: 'orderHash',
				type: 'bytes32',
			},
		],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'tokenIn',
				type: 'address',
			},
			{
				internalType: 'uint256',
				name: 'amountIn',
				type: 'uint256',
			},
			{
				components: [
					{
						internalType: 'uint8',
						name: 'payloadType',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'trader',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'destAddr',
						type: 'bytes32',
					},
					{
						internalType: 'uint16',
						name: 'destChainId',
						type: 'uint16',
					},
					{
						internalType: 'bytes32',
						name: 'referrerAddr',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'tokenOut',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'minAmountOut',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'gasDrop',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'cancelFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'refundFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'deadline',
						type: 'uint64',
					},
					{
						internalType: 'uint16',
						name: 'penaltyPeriod',
						type: 'uint16',
					},
					{
						internalType: 'uint8',
						name: 'referrerBps',
						type: 'uint8',
					},
					{
						internalType: 'uint8',
						name: 'auctionMode',
						type: 'uint8',
					},
					{
						internalType: 'uint64',
						name: 'baseBond',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'perBpsBond',
						type: 'uint64',
					},
					{
						internalType: 'bytes32',
						name: 'random',
						type: 'bytes32',
					},
				],
				internalType: 'struct OrderParams',
				name: 'params',
				type: 'tuple',
			},
			{
				internalType: 'bytes',
				name: 'customPayload',
				type: 'bytes',
			},
			{
				internalType: 'uint256',
				name: 'submissionFee',
				type: 'uint256',
			},
			{
				internalType: 'bytes',
				name: 'signedOrderHash',
				type: 'bytes',
			},
			{
				components: [
					{
						internalType: 'uint256',
						name: 'value',
						type: 'uint256',
					},
					{
						internalType: 'uint256',
						name: 'deadline',
						type: 'uint256',
					},
					{
						internalType: 'uint8',
						name: 'v',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'r',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 's',
						type: 'bytes32',
					},
				],
				internalType: 'struct PermitParams',
				name: 'permitParams',
				type: 'tuple',
			},
		],
		name: 'createOrderWithSig',
		outputs: [
			{
				internalType: 'bytes32',
				name: 'orderHash',
				type: 'bytes32',
			},
		],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'tokenIn',
				type: 'address',
			},
			{
				internalType: 'uint256',
				name: 'amountIn',
				type: 'uint256',
			},
			{
				components: [
					{
						internalType: 'uint8',
						name: 'payloadType',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'trader',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'destAddr',
						type: 'bytes32',
					},
					{
						internalType: 'uint16',
						name: 'destChainId',
						type: 'uint16',
					},
					{
						internalType: 'bytes32',
						name: 'referrerAddr',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'tokenOut',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'minAmountOut',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'gasDrop',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'cancelFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'refundFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'deadline',
						type: 'uint64',
					},
					{
						internalType: 'uint16',
						name: 'penaltyPeriod',
						type: 'uint16',
					},
					{
						internalType: 'uint8',
						name: 'referrerBps',
						type: 'uint8',
					},
					{
						internalType: 'uint8',
						name: 'auctionMode',
						type: 'uint8',
					},
					{
						internalType: 'uint64',
						name: 'baseBond',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'perBpsBond',
						type: 'uint64',
					},
					{
						internalType: 'bytes32',
						name: 'random',
						type: 'bytes32',
					},
				],
				internalType: 'struct OrderParams',
				name: 'params',
				type: 'tuple',
			},
			{
				internalType: 'bytes',
				name: 'customPayload',
				type: 'bytes',
			},
		],
		name: 'createOrderWithToken',
		outputs: [
			{
				internalType: 'bytes32',
				name: 'orderHash',
				type: 'bytes32',
			},
		],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'uint16',
				name: '',
				type: 'uint16',
			},
		],
		name: 'emitters',
		outputs: [
			{
				internalType: 'bytes32',
				name: '',
				type: 'bytes32',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'feeManager',
		outputs: [
			{
				internalType: 'contract IFeeManager',
				name: '',
				type: 'address',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes32[]',
				name: 'orderHashes',
				type: 'bytes32[]',
			},
		],
		name: 'getOrders',
		outputs: [
			{
				components: [
					{
						internalType: 'enum Status',
						name: 'status',
						type: 'uint8',
					},
					{
						internalType: 'uint64',
						name: 'amountIn',
						type: 'uint64',
					},
					{
						internalType: 'uint16',
						name: 'destChainId',
						type: 'uint16',
					},
				],
				internalType: 'struct Order[]',
				name: '',
				type: 'tuple[]',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'guardian',
		outputs: [
			{
				internalType: 'address',
				name: '',
				type: 'address',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'nextGuardian',
		outputs: [
			{
				internalType: 'address',
				name: '',
				type: 'address',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes32',
				name: '',
				type: 'bytes32',
			},
		],
		name: 'orders',
		outputs: [
			{
				internalType: 'enum Status',
				name: 'status',
				type: 'uint8',
			},
			{
				internalType: 'uint64',
				name: 'amountIn',
				type: 'uint64',
			},
			{
				internalType: 'uint16',
				name: 'destChainId',
				type: 'uint16',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encoded',
				type: 'bytes',
			},
		],
		name: 'parseFulfillPayload',
		outputs: [
			{
				components: [
					{
						internalType: 'uint8',
						name: 'action',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'orderHash',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'driver',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'promisedAmount',
						type: 'uint64',
					},
				],
				internalType: 'struct FulfillMsg',
				name: 'fulfillMsg',
				type: 'tuple',
			},
		],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encoded',
				type: 'bytes',
			},
		],
		name: 'parseRefundPayload',
		outputs: [
			{
				components: [
					{
						internalType: 'uint8',
						name: 'action',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'orderHash',
						type: 'bytes32',
					},
					{
						internalType: 'uint16',
						name: 'srcChainId',
						type: 'uint16',
					},
					{
						internalType: 'bytes32',
						name: 'tokenIn',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'trader',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'canceler',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'cancelFee',
						type: 'uint64',
					},
					{
						internalType: 'uint64',
						name: 'refundFee',
						type: 'uint64',
					},
				],
				internalType: 'struct RefundMsg',
				name: 'refundMsg',
				type: 'tuple',
			},
		],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encoded',
				type: 'bytes',
			},
		],
		name: 'parseUnlockPayload',
		outputs: [
			{
				components: [
					{
						internalType: 'uint8',
						name: 'action',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'orderHash',
						type: 'bytes32',
					},
					{
						internalType: 'uint16',
						name: 'srcChainId',
						type: 'uint16',
					},
					{
						internalType: 'bytes32',
						name: 'tokenIn',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'referrerAddr',
						type: 'bytes32',
					},
					{
						internalType: 'uint8',
						name: 'referrerBps',
						type: 'uint8',
					},
					{
						internalType: 'uint8',
						name: 'protocolBps',
						type: 'uint8',
					},
					{
						internalType: 'bytes32',
						name: 'unlockReceiver',
						type: 'bytes32',
					},
					{
						internalType: 'bytes32',
						name: 'driver',
						type: 'bytes32',
					},
					{
						internalType: 'uint64',
						name: 'fulfillTime',
						type: 'uint64',
					},
				],
				internalType: 'struct UnlockMsg',
				name: 'unlockMsg',
				type: 'tuple',
			},
		],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [],
		name: 'paused',
		outputs: [
			{
				internalType: 'bool',
				name: '',
				type: 'bool',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encodedVm',
				type: 'bytes',
			},
		],
		name: 'refundOrder',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'uint16',
				name: 'chainId',
				type: 'uint16',
			},
			{
				internalType: 'bytes32',
				name: 'addr',
				type: 'bytes32',
			},
		],
		name: 'setEmitterAddr',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: '_feeManager',
				type: 'address',
			},
		],
		name: 'setFeeManager',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bool',
				name: '_pause',
				type: 'bool',
			},
		],
		name: 'setPause',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encodedVm',
				type: 'bytes',
			},
			{
				internalType: 'uint16[]',
				name: 'indexes',
				type: 'uint16[]',
			},
		],
		name: 'unlockBatch',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encodedVm',
				type: 'bytes',
			},
			{
				internalType: 'bytes',
				name: 'encodedPayload',
				type: 'bytes',
			},
			{
				internalType: 'uint16[]',
				name: 'indexes',
				type: 'uint16[]',
			},
		],
		name: 'unlockCompressedBatch',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'bytes',
				name: 'encodedVm',
				type: 'bytes',
			},
		],
		name: 'unlockSingle',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'wormhole',
		outputs: [
			{
				internalType: 'contract IWormhole',
				name: '',
				type: 'address',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		stateMutability: 'payable',
		type: 'receive',
	},
];
