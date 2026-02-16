const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
  silent: 5, // Special level to disable all logging
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Determine log level from environment
const level = () => {
  // Allow disabling logs completely
  if (process.env.DISABLE_LOGGING === 'true') {
    return 'silent';
  }

  // Allow custom log level via env var
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development' || env === 'dev';
  return isDevelopment ? 'debug' : 'info';
};

// Define format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, requestId, ...meta } = info;
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      const reqId = requestId ? `[${requestId}]` : '';
      return `${timestamp} ${level} ${reqId}: ${message} ${metaStr}`;
    }
  )
);

// Define transports (conditionally based on whether logging is enabled)
const createTransports = () => {
  const currentLevel = level();

  // If logging is disabled, return minimal transports
  if (currentLevel === 'silent') {
    return [];
  }

  return [
    // Console output
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ];
};

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports: createTransports(),
  exitOnError: false,
  silent: level() === 'silent', // Completely silence the logger if disabled
});

// Create a stream for morgan HTTP request logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

module.exports = logger;
