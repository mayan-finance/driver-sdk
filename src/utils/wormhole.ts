import { publicrpc } from '@certusone/wormhole-sdk-proto-web';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { ethers } from 'ethers';
import { CHAIN_ID_SOLANA } from '../config/chains';
import { NodeHttpTransportWithDefaultTimeout } from './grpc';
import logger from './logger';
import { delay } from './util';
const { GrpcWebImpl, PublicRPCServiceClientImpl } = publicrpc;

export function get_wormhole_core_accounts(emitterAddr: PublicKey): {
	coreBridge: PublicKey;
	bridge_config: PublicKey;
	fee_collector: PublicKey;
	sequence_key: PublicKey;
} {
	const coreBridge = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
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
