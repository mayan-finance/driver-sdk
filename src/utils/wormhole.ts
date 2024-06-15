import { publicrpc } from '@certusone/wormhole-sdk-proto-web';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers';
import { CHAIN_ID_SOLANA } from '../config/chains';
import { NodeHttpTransportWithDefaultTimeout } from './grpc';
import logger from './logger';
import { delay } from './util';
const { GrpcWebImpl, PublicRPCServiceClientImpl } = publicrpc;

export const WORMHOLE_CORE_BRIDGE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');

function serializePayload(parsedVaa: any) {
	const x = Buffer.alloc(51 + parsedVaa.payload.length);
	x.writeUint32BE(parsedVaa.timestamp);
	x.writeUint32BE(parsedVaa.nonce, 4);
	x.writeUint16BE(parsedVaa.emitterChain, 8);
	const e = Buffer.from(parsedVaa.emitterAddress);
	e.copy(x, 10);
	x.writeBigInt64BE(BigInt(parsedVaa.sequence), 42);
	x.writeUInt8(parsedVaa.consistencyLevel, 50);
	const v = Buffer.from(parsedVaa.payload);
	v.copy(x, 51);
	return x;
}

export async function findVaaAddress(vaa: Buffer): Promise<PublicKey> {
	const parsedVaa = parseVaa(vaa);
	const serializedVaa = serializePayload(parsedVaa);
	const vaaHash = Buffer.from(ethers.keccak256(serializedVaa).replace('0x', ''), 'hex');
	const [vaaAddr] = PublicKey.findProgramAddressSync([Buffer.from('PostedVAA'), vaaHash], WORMHOLE_CORE_BRIDGE);

	return vaaAddr;
}

export function get_wormhole_core_accounts(emitterAddr: PublicKey): {
	coreBridge: PublicKey;
	bridge_config: PublicKey;
	fee_collector: PublicKey;
	sequence_key: PublicKey;
} {
	const coreBridge = WORMHOLE_CORE_BRIDGE;
	const [bridge_config] = PublicKey.findProgramAddressSync([Buffer.from('Bridge')], coreBridge);
	const [fee_collector] = PublicKey.findProgramAddressSync([Buffer.from('fee_collector')], coreBridge);
	const [sequence_key] = PublicKey.findProgramAddressSync(
		[Buffer.from('Sequence'), Buffer.from(emitterAddr.toBytes())],
		coreBridge,
	);
	return {
		coreBridge,
		bridge_config,
		fee_collector,
		sequence_key,
	};
}

export function getWormholeSequenceFromPostedMessage(messageData: Buffer): bigint {
	return messageData.readBigUInt64LE(49);
}

export function getEmitterAddressEth(contractAddress: ethers.BytesLike) {
	return ethers.zeroPadValue(contractAddress, 32).replace('0x', '');
}

export function getEmitterAddressSolana(programAddress: string) {
	return PublicKey.findProgramAddressSync([Buffer.from('emitter')], new PublicKey(programAddress))[0]
		.toBuffer()
		.toString('hex');
}

export async function getSignedVaa(guardianRpcs: string[], chainId: number, contractAddress: string, sequence: string) {
	let mayanBridgeEmitterAddress;
	if (ethers.isAddress(contractAddress)) {
		mayanBridgeEmitterAddress = getEmitterAddressEth(contractAddress);
	} else if (chainId === CHAIN_ID_SOLANA) {
		mayanBridgeEmitterAddress = getEmitterAddressSolana(contractAddress);
	} else {
		throw new Error('Cannot get emitter address for chainId=' + chainId);
	}

	// poll until the guardian(s) witness and sign the vaa
	while (true) {
		try {
			const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
				guardianRpcs,
				chainId,
				mayanBridgeEmitterAddress,
				sequence,
				{
					transport: NodeHttpTransportWithDefaultTimeout(3000),
				},
				3000,
				6 * guardianRpcs.length,
			);

			return signedVAA;
		} catch (err) {
			logger.info(`Unable to fetch signed VAA ${err}. Retrying... ${chainId}, ${contractAddress}, ${sequence}`);
			await delay(2000);
		}
	}
}

export async function getSignedVAAWithRetry(
	hosts: string[],
	emitterChainId: number,
	emitterAddress: string,
	sequence: string,
	extraGrpcOpts = {},
	retryTimeout = 1000,
	retryAttempts?: number,
) {
	let currentWormholeRpcHost = -1;
	const getNextRpcHost = () => ++currentWormholeRpcHost % hosts.length;
	let result;
	let attempts = 0;
	while (!result) {
		attempts++;
		await new Promise((resolve) => setTimeout(resolve, retryTimeout));
		try {
			result = await getSignedVAARaw(
				hosts[getNextRpcHost()],
				emitterChainId,
				emitterAddress,
				sequence,
				extraGrpcOpts,
			);
		} catch (e) {
			if (retryAttempts !== undefined && attempts > retryAttempts) {
				throw e;
			}
		}
	}
	return result;
}

async function getSignedVaaFromWormholeScan(
	chainid: number,
	emitter: string,
	sequence: string,
): Promise<{ vaaBytes: Uint8Array } | null> {
	try {
		const result = await axios.get(`https://api.wormholescan.io/v1/signed_vaa/${chainid}/${emitter}/${sequence}`);
		if (result?.data?.vaaBytes) {
			return {
				vaaBytes: new Uint8Array(Buffer.from(result.data.vaaBytes, 'base64')),
			};
		}
		return null;
	} catch (e) {
		return null;
	}
}

export function chunks<T>(array: T[], size: number): T[][] {
	return Array.apply<number, T[], T[][]>(0, new Array(Math.ceil(array.length / size))).map((_, index) =>
		array.slice(index * size, (index + 1) * size),
	);
}

export async function getSignedVAARaw(
	host: string,
	emitterChainId: number,
	emitterAddress: string,
	sequence: string,
	extraGrpcOpts = {},
) {
	const rpc = new GrpcWebImpl(host, extraGrpcOpts);
	const api = new PublicRPCServiceClientImpl(rpc);
	return await api.GetSignedVAA({
		messageId: {
			emitterChain: emitterChainId,
			emitterAddress,
			sequence,
		},
	});
}

function parseVaa(signedVaa: Buffer) {
	const sigStart = 6;
	const numSigners = signedVaa[5];
	const sigLength = 66;

	const guardianSignatures = [];
	for (let i = 0; i < numSigners; ++i) {
		const start = sigStart + i * sigLength;
		guardianSignatures.push({
			index: signedVaa[start],
			signature: signedVaa.subarray(start + 1, start + 66),
		});
	}

	const body = signedVaa.subarray(sigStart + sigLength * numSigners);

	return {
		version: signedVaa[0],
		guardianSetIndex: signedVaa.readUInt32BE(1),
		guardianSignatures,
		timestamp: body.readUInt32BE(0),
		nonce: body.readUInt32BE(4),
		emitterChain: body.readUInt16BE(8),
		emitterAddress: body.subarray(10, 42),
		sequence: body.readBigUInt64BE(42),
		consistencyLevel: body[50],
		payload: body.subarray(51),
		hash: ethers.keccak256(body),
	};
}
