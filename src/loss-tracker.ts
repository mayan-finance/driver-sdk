import axios from 'axios';
import * as fs from 'fs';
import { DB_PATH, getTotalDiffAmount } from './utils/sqlite3';

const filePath = './loss.json';
export const maxLossPerSwapUSD = 500;
export const maxTotalLossUSDPerDay = 1000;

const maxPerTenMins = 200;
const maxPerHour = 500;
const maxPerDay = 1000;

export const paidLosses = {
	TEN_MINS: 0,
	HOUR: 0,
	DAY: 0,
};

export function checkPaidLossWithinRange(txHash: string) {
	if (paidLosses.TEN_MINS > maxPerTenMins) {
		alertForLossReach('rangeLoss', 'Paid loss exceeded the limit withing 10 minute range');
		throw new Error(`Paid loss exceeded the limit 10 minute ${txHash}`);
	} else if (paidLosses.HOUR > maxPerHour) {
		alertForLossReach('rangeLoss', 'Paid loss exceeded the limit withing 1 hour range');
		throw new Error(`Paid loss exceeded the limit 1 hour ${txHash}`);
	} else if (paidLosses.DAY > maxPerDay) {
		alertForLossReach('rangeLoss', 'Paid loss exceeded the limit withing 24 hour range');
		throw new Error(`Paid loss exceeded the limit 24 hour ${txHash}`);
	}
}

function refreshPaidLosses() {
	const dayLoss = getTotalDiffAmount(DB_PATH, '-1 day');
	paidLosses.DAY = dayLoss;

	const hourLoss = getTotalDiffAmount(DB_PATH, '-1 hours');
	paidLosses.HOUR = hourLoss;

	const tenMinsLoss = getTotalDiffAmount(DB_PATH, '-10 minutes');
	paidLosses.TEN_MINS = tenMinsLoss;

	console.log('Paid losses:', paidLosses);
}

setInterval(refreshPaidLosses, 1000 * 5);

export function readTodayLoss() {
	let data = {
		date: getStartOfToday(),
		loss: 0,
	};
	if (fs.existsSync(filePath)) {
		data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		data.date = new Date(data.date);
	}

	if (new Date().getTime() - data.date.getTime() > 24 * 60 * 60 * 1000) {
		data.date = getStartOfToday();
		data.loss = 0;
	}

	return data;
}

export function appendLoss(loss: number) {
	const data = readTodayLoss();
	data.loss += loss;
	if (data.loss > maxTotalLossUSDPerDay) {
		alertForLossReach('modifyLossJson', 'Daily loss limit reached Modify json');
		throw new Error('Daily loss limit reached');
	}

	fs.writeFileSync(filePath, JSON.stringify(data));
}

export async function alertForLossReach(code: string, msg: string) {
	try {
		await axios.get(
			`${process.env.ALERT_FULL_URL}?pwd=${process.env.ALERT_PWD}&code=${code}&message=Bamshad ${msg}`,
		);
	} catch (err) {
		console.warn('Failed to send alert for loss reach', err);
	}
}

export function removeLoss(loss: number) {
	const data = readTodayLoss();
	data.loss -= loss;
	if (data.loss < -1) {
		throw new Error('should not reach negative loss!');
	}

	fs.writeFileSync(filePath, JSON.stringify(data));
}

function getStartOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}
