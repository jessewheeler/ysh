const morgan = require('morgan');
const logger = require('../services/logger');
const { randomBytes } = require('crypto');

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return randomBytes(8).toString('hex');
}

/**
 * Middleware to attach request ID to each request
 */
function attachRequestId(req, res, next) {
  req.id = generateRequestId();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Create a child logger with request context
 */
function attachLogger(req, res, next) {
  req.logger = logger.child({ requestId: req.id });
  next();
}

/**
 * Morgan middleware configured to use Winston
 */
const morganMiddleware = morgan(
  ':remote-addr :method :url :status :res[content-length] - :response-time ms',
  {
    stream: logger.stream,
    skip: (req) => {
      // Skip logging for static assets in production
      if (process.env.NODE_ENV === 'production') {
        return req.url.startsWith('/css') ||
               req.url.startsWith('/js') ||
               req.url.startsWith('/img') ||
               req.url.startsWith('/assets');
      }
      return false;
    },
  }
);

/**
 * Log errors with full context
 */
function logError(err, req, res, next) {
  const log = req.logger || logger;
  log.error('Request error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next(err);
}

module.exports = {
  attachRequestId,
  attachLogger,
  morganMiddleware,
  logError,
};
