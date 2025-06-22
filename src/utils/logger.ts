import { Logger, createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
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
    return createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: combine(
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