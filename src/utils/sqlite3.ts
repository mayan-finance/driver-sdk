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

export const DB_PATH = 'transactions.db';
