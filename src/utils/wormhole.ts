import { ChainId, getSignedVAAWithRetry, parseVaa } from '@certusone/wormhole-sdk';
import { publicrpc } from '@certusone/wormhole-sdk-proto-web';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers6';
import { CHAIN_ID_SOLANA, CHAIN_ID_UNICHAIN } from '../config/chains';
import { NodeHttpTransportWithDefaultTimeout } from './grpc';
import logger from './logger';
import { delay } from './util';
const { GrpcWebImpl, PublicRPCServiceClientImpl } = publicrpc;

export const WORMHOLE_CORE_BRIDGE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
export const WORMHOLE_SHIM_PROGRAM = new PublicKey('EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX');
export const WORMHOLE_SHIM_EVENT_AUTH = new PublicKey('HQS31aApX3DDkuXgSpV9XyDUNtFgQ31pUn5BNWHG2PSp');

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

export function findVaaAddress(vaa: Buffer): PublicKey {
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

export async function getSignedVAAWithRetryGeneric(
	hosts: string[],
	emitterChain: number,
	emitterAddress: string,
	sequence: string,
	extraGrpcOpts?: {},
	retryTimeout?: number,
	retryAttempts?: number,
): Promise<{
	vaaBytes: Uint8Array;
}> {
	if (emitterChain === CHAIN_ID_UNICHAIN) {
		return { vaaBytes: await getSignedVaaFromWormholeScan(emitterChain, emitterAddress, sequence) };
	}
	return await getSignedVAAWithRetry(
		hosts,
		emitterChain as ChainId,
		emitterAddress,
		sequence,
		extraGrpcOpts,
		retryTimeout,
		retryAttempts,
	);
}

export async function getSignedVaa(
	guardianRpcs: string[],
	chainId: number,
	contractAddress: string,
	sequence: string,
	retryTime?: number,
) {
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
			const { vaaBytes: signedVAA } = await getSignedVAAWithRetryGeneric(
				guardianRpcs,
				chainId as ChainId,
				mayanBridgeEmitterAddress,
				sequence,
				{
					transport: NodeHttpTransportWithDefaultTimeout(3000),
				},
				retryTime || 3000,
				6 * guardianRpcs.length,
			);

			return signedVAA;
		} catch (err) {
			logger.info(`Unable to fetch signed VAA ${err}. Retrying... ${chainId}, ${contractAddress}, ${sequence}`);
			await delay(2000);
		}
	}
}

export async function getSequenceFromWormholeScan(txHash: string): Promise<string> {
	let maxRetries = 20;
	let retries = 0;
	while (retries < maxRetries) {
		try {
			const { data } = await axios.get(`https://api.wormholescan.io/api/v1/operations?txHash=${txHash}`);

			// {"operations":[{"id":"30/000000000000000000000000875d6d37ec55c8cf220b9e5080717549d8aa8eca/11207","emitterChain":30,"emitterAddress":{"hex":"000000000000000000000000875d6d37ec55c8cf220b9e5080717549d8aa8eca","native":"0x875d6d37ec55c8cf220b9e5080717549d8aa8eca"},"sequence":"11207","content":{"standarizedProperties":{"appIds":null,"fromChain":0,"fromAddress":"","toChain":0,"toAddress":"","tokenChain":0,"tokenAddress":"","amount":"","feeAddress":"","feeChain":0,"fee":"","normalizedDecimals":null}},"sourceChain":{"chainId":30,"timestamp":"2025-04-27T16:07:07Z","transaction":{"txHash":"0x4433652a68b62c1a045812bb2e8404eef229abf9fd2ccff0401f9c78eb49e02a"},"from":"0x13e71631684a90df4c2310f1ec78c3eda037b2eb","status":"confirmed"}}]}%
			if (data && data.operations && data.operations.length > 0) {
				return data.operations[0].sequence;
			}
		} catch (err) {
			console.info(`Unable to fetch sequence from wormhole scan ${err}. Retrying... ${txHash}`);
		} finally {
			retries++;
			let waitTime = 1000 * retries;
			await delay(waitTime);
		}
	}

	throw new Error(`Sequence not found for ${txHash}`);
}

async function getSignedVaaFromWormholeScan(
	emitterChain: number,
	emitterAddress: string,
	sequence: string,
): Promise<Uint8Array> {
	const { data } = await axios.get(
		`https://api.wormholescan.io/v1/signed_vaa/${emitterChain}/${emitterAddress}/${sequence}`,
	);

	if (data && data.vaaBytes) {
		return new Uint8Array(Buffer.from(data.vaaBytes, 'base64'));
	}

	throw new Error(`Signed vaa not found for ${emitterChain}/${emitterAddress}/${sequence}`);
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
