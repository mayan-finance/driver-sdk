import axios from 'axios';

export async function sendAlert(code: string, msg: string) {
	try {
		await axios.get(`${process.env.ALERT_FULL_URL}?pwd=${process.env.ALERT_PWD}&code=${code}&message=${msg}`);
	} catch (err) {
		console.warn('Failed to send alert', err);
	}
}

export async function sendLossAlert(code: string, msg: string) {
	try {
		await axios.get(`${process.env.ALERT_LOSS_FULL_URL}?pwd=${process.env.ALERT_PWD}&code=${code}&message=${msg}`);
	} catch (err) {
		console.warn('Failed to send loss alert', err);
	}
}
