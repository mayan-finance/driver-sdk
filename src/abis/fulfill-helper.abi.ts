export const abi = [
	{
		inputs: [
			{
				internalType: 'address',
				name: '_guardian',
				type: 'address',
			},
			{
				internalType: 'address[]',
				name: '_swapProtocols',
				type: 'address[]',
			},
			{
				internalType: 'address[]',
				name: '_mayanProtocols',
				type: 'address[]',
			},
		],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
	{
		inputs: [],
		name: 'UnsupportedProtocol',
		type: 'error',
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
				internalType: 'address',
				name: 'mayanProtocol',
				type: 'address',
			},
			{
				internalType: 'bytes',
				name: 'mayanData',
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
				internalType: 'struct FulfillHelper.PermitParams',
				name: 'permitParams',
				type: 'tuple',
			},
		],
		name: 'directFulfill',
		outputs: [],
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
				internalType: 'address',
				name: 'fulfillToken',
				type: 'address',
			},
			{
				internalType: 'address',
				name: 'swapProtocol',
				type: 'address',
			},
			{
				internalType: 'bytes',
				name: 'swapData',
				type: 'bytes',
			},
			{
				internalType: 'address',
				name: 'mayanProtocol',
				type: 'address',
			},
			{
				internalType: 'bytes',
				name: 'mayanData',
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
				internalType: 'struct FulfillHelper.PermitParams',
				name: 'permitParams',
				type: 'tuple',
			},
		],
		name: 'fulfillWithERC20',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'uint256',
				name: 'amountIn',
				type: 'uint256',
			},
			{
				internalType: 'address',
				name: 'fulfillToken',
				type: 'address',
			},
			{
				internalType: 'address',
				name: 'swapProtocol',
				type: 'address',
			},
			{
				internalType: 'bytes',
				name: 'swapData',
				type: 'bytes',
			},
			{
				internalType: 'address',
				name: 'mayanProtocol',
				type: 'address',
			},
			{
				internalType: 'bytes',
				name: 'mayanData',
				type: 'bytes',
			},
		],
		name: 'fulfillWithEth',
		outputs: [],
		stateMutability: 'payable',
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
		inputs: [
			{
				internalType: 'address',
				name: '',
				type: 'address',
			},
		],
		name: 'mayanProtocols',
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
				internalType: 'uint256',
				name: 'amount',
				type: 'uint256',
			},
			{
				internalType: 'address payable',
				name: 'to',
				type: 'address',
			},
		],
		name: 'rescueEth',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'token',
				type: 'address',
			},
			{
				internalType: 'uint256',
				name: 'amount',
				type: 'uint256',
			},
			{
				internalType: 'address',
				name: 'to',
				type: 'address',
			},
		],
		name: 'rescueToken',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'mayanProtocol',
				type: 'address',
			},
			{
				internalType: 'bool',
				name: 'enabled',
				type: 'bool',
			},
		],
		name: 'setMayanProtocol',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: 'swapProtocol',
				type: 'address',
			},
			{
				internalType: 'bool',
				name: 'enabled',
				type: 'bool',
			},
		],
		name: 'setSwapProtocol',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{
				internalType: 'address',
				name: '',
				type: 'address',
			},
		],
		name: 'swapProtocols',
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
		stateMutability: 'payable',
		type: 'receive',
	},
];
