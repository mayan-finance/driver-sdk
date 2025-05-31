import { execSync } from 'node:child_process';

export function createDatabase(dbFile: string) {
	const createTableQuery = `
        CREATE TABLE IF NOT EXISTS transactions (
                txHash TEXT PRIMARY KEY,
                srcChain TEXT,
                dstChain TEXT,
                finalAmount DECIMAL(20, 8),
                effectiveAmount DECIMAL(20, 8),
                diffAmount DECIMAL(20, 8),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `;
	execSync(`sqlite3 ${dbFile} "${createTableQuery}"`);

	const indexQuery = `
        CREATE INDEX if not exists transactions_datetime ON transactions (timestamp);
    `;
	execSync(`sqlite3 ${dbFile} "${indexQuery}"`);

	const rebalanceTableQuery = `
        CREATE TABLE IF NOT EXISTS rebalances (
                orderId TEXT PRIMARY KEY,
                amount DECIMAL(20, 8),
				isCreated BOOLEAN DEFAULT FALSE,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `;
	execSync(`sqlite3 ${dbFile} "${rebalanceTableQuery}"`);

}

export function insertTransactionLog(
	dbFile: string,
	txHash: string,
	srcChain: string,
	dstChain: string,
	finalAmount: number,
	effectiveAmount: number,
	diffAmount: number,
) {
	const insertQuery = `
        INSERT OR REPLACE INTO transactions (txHash, srcChain, dstChain, finalAmount, effectiveAmount, diffAmount)
        VALUES ('${txHash}', '${srcChain}', '${dstChain}', ${finalAmount}, ${effectiveAmount}, ${diffAmount});
    `;
	execSync(`sqlite3 ${dbFile} "${insertQuery}"`);
}

export function getTotalDiffAmount(dbFile: string, interval: '-1 day' | '-1 hours' | '-10 minutes'): number {
	const query = `select sum(diffAmount) from transactions where timestamp >= datetime('now', '${interval}');`;
	const res = execSync(`sqlite3 ${dbFile} "${query}"`, { encoding: 'utf8' });
	return Number(res.trim());
}

export function createRebalance(dbFile: string, orderId: string, amount: number) {
	const query = `insert into rebalances (orderId, amount) values ('${orderId}', ${amount});`;
	execSync(`sqlite3 ${dbFile} "${query}"`);
}

export function setRebalanceIsCreated(dbFile: string, orderId: string, isCreated: boolean) {
	const query = `update rebalances set isCreated = ${isCreated} where orderId = '${orderId}';`;
	execSync(`sqlite3 ${dbFile} "${query}"`);
}

export function getRebalanceIsCreated(dbFile: string, orderId: string): boolean {
	const query = `select isCreated from rebalances where orderId = '${orderId}';`;
	const res = execSync(`sqlite3 ${dbFile} "${query}"`, { encoding: 'utf8' });
	return res.trim() === '1';
}

export function getRebalanceAmount(dbFile: string, orderId: string): number {
	const query = `select amount from rebalances where orderId = '${orderId}';`;
	const res = execSync(`sqlite3 ${dbFile} "${query}"`, { encoding: 'utf8' });
	return Number(res.trim());
}

export function getRebalanceNeededAmount(dbFile: string, orderId: string): number {
	const query = `select neededAmount from rebalances where orderId = '${orderId}';`;
	const res = execSync(`sqlite3 ${dbFile} "${query}"`, { encoding: 'utf8' });
	return Number(res.trim());
}

export const DB_PATH = 'transactions.db';
