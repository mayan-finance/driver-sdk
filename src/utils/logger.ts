import { Logger, createLogger, format, transports } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});

// File size management utilities
class LogFileManager {
    private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    private static readonly MAX_BACKUP_FILES = 5;

    static checkAndRotateFile(filename: string): void {
        try {
            if (!fs.existsSync(filename)) {
                return;
            }

            const stats = fs.statSync(filename);
            if (stats.size >= this.MAX_FILE_SIZE) {
                this.rotateFile(filename);
            }
        } catch (error) {
            console.error('Error checking file size:', error);
        }
    }

    private static rotateFile(filename: string): void {
        try {
            const dir = path.dirname(filename);
            const ext = path.extname(filename);
            const baseName = path.basename(filename, ext);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = path.join(dir, `${baseName}.${timestamp}${ext}`);

            // Rename current file to backup
            fs.renameSync(filename, backupName);

            // Create a new empty file to ensure continuous logging
            fs.writeFileSync(filename, '', { encoding: 'utf8' });

            // Keep only the most recent backup files
            this.cleanupOldBackups(dir, baseName, ext);
        } catch (error) {
            console.error('Error rotating log file:', error);
        }
    }

    private static cleanupOldBackups(dir: string, baseName: string, ext: string): void {
        try {
            const files = fs.readdirSync(dir)
                .filter(file => file.startsWith(baseName) && file.endsWith(ext))
                .map(file => ({
                    name: file,
                    path: path.join(dir, file),
                    mtime: fs.statSync(path.join(dir, file)).mtime
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            // Keep only the most recent backup files
            for (let i = this.MAX_BACKUP_FILES; i < files.length; i++) {
                fs.unlinkSync(files[i].path);
            }
        } catch (error) {
            console.error('Error cleaning up old backup files:', error);
        }
    }
}

// Custom format that checks file size before logging
const sizeCheckFormat = format((info) => {
    // Check and rotate log files before writing
    LogFileManager.checkAndRotateFile('logs/error.log');
    LogFileManager.checkAndRotateFile('logs/combined.log');
    return info;
});

class DuplicateLoggerWrapper {
    private logger: Logger;
    private recentMessages: Map<string, number> = new Map();
    private readonly duplicateWindowMs = 3000; // 1 second

    constructor(logger: Logger) {
        this.logger = logger;
    }

    private createMessageKey(level: string, message: string): string {
        return `${level}:${message}`;
    }

    private isDuplicate(level: string, message: string): boolean {
        const key = this.createMessageKey(level, message);
        const now = Date.now();
        const lastTime = this.recentMessages.get(key);

        if (lastTime && (now - lastTime) < this.duplicateWindowMs) {
            return true;
        }

        this.recentMessages.set(key, now);
        return false;
    }

    private cleanupOldMessages(): void {
        const now = Date.now();
        for (const [key, timestamp] of this.recentMessages.entries()) {
            if (now - timestamp >= this.duplicateWindowMs) {
                this.recentMessages.delete(key);
            }
        }
    }

    log(level: string, message: string, ...meta: any[]): void {
        if (this.isDuplicate(level, message)) {
            return; // Ignore duplicate message
        }

        this.cleanupOldMessages();
        this.logger.log(level, message, ...meta);
    }

    error(message: string, ...meta: any[]): void {
        this.log('error', message, ...meta);
    }

    warn(message: string, ...meta: any[]): void {
        this.log('warn', message, ...meta);
    }

    info(message: string, ...meta: any[]): void {
        this.log('info', message, ...meta);
    }

    debug(message: string, ...meta: any[]): void {
        this.log('debug', message, ...meta);
    }

    verbose(message: string, ...meta: any[]): void {
        this.log('verbose', message, ...meta);
    }

    silly(message: string, ...meta: any[]): void {
        this.log('silly', message, ...meta);
    }
}

export function getLogger(): Logger {
    // Ensure logs directory exists
    const logsDir = 'logs';
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    return createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: combine(
            sizeCheckFormat(),
            colorize(),
            timestamp({
                format: 'YYYY-MM-DD HH:mm:ss.SSS'
            }),
            logFormat
        ),
        transports: [
            new transports.Console(),
            new transports.File({ filename: 'logs/error.log', level: 'error' }),
            new transports.File({ filename: 'logs/combined.log' }),
        ],
    });
}

export function getDuplicateProtectedLogger(): DuplicateLoggerWrapper {
    return new DuplicateLoggerWrapper(getLogger());
}

const logger = getDuplicateProtectedLogger();

export default logger;