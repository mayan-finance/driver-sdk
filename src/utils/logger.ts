import { Logger, createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

export function getLogger(): Logger { 
    return createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: combine(
            colorize(),
            timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
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

const logger = getLogger();
export default logger;