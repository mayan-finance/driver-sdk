import * as fs from 'fs';

const filePath = './loss.json';
export const maxLossPerSwapUSD = 20;
export const maxTotalLossUSDPerDay = 2000;

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
		throw new Error('Daily loss limit reached');
	}

	fs.writeFileSync(filePath, JSON.stringify(data));
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
