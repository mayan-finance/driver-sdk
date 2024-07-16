import { ed25519 } from '@noble/curves/ed25519';
import axios from 'axios';
import { MayanEndpoints } from '../config/endpoints';
import { GlobalConfig } from '../config/global';
import { WalletConfig } from '../config/wallet';

export class RegisterService {
	private readonly signMessage = 'MAYAN_FINANCE';
	private readonly signedSolanaHex: string;
	private readonly signedEvmHex: string;
	constructor(
		private readonly gConf: GlobalConfig,
		private readonly walletConfig: WalletConfig,
		private readonly endpoints: MayanEndpoints,
	) {
		this.signedSolanaHex = Buffer.from(
			ed25519.sign(Buffer.from(this.signMessage), this.walletConfig.solana.secretKey.slice(0, 32)),
		).toString('hex');
		this.signedEvmHex = this.walletConfig.evm.signMessageSync(this.signMessage);
	}

	async scheduleRegister() {
		setInterval(this.register.bind(this), this.gConf.registerAgainInterval * 1000);
	}

	async register() {
		// ed25519.verify(
		// 	this.signedSolanaHex,
		// 	Buffer.from(this.signMessage),
		// 	this.walletConfig.solana.publicKey.toBuffer(),
		// );
		await axios.post(`${this.endpoints.priceApiUrl}/v3/driver/register/`, {
			evmAddress: this.walletConfig.evm.address,
			evmSignature: this.signedEvmHex,
			solanaAddress: this.walletConfig.solana.publicKey.toString(),
			solanaSignature: this.signedSolanaHex,
		});
	}
}
