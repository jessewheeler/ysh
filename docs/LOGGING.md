# Logging Framework

YSH uses [Winston](https://github.com/winstonjs/winston) for structured logging with request tracking and multiple output formats.

## Features

- ✅ Multiple log levels (error, warn, info, http, debug)
- ✅ Request ID tracking for request correlation
- ✅ Colorized console output in development
- ✅ JSON logs for production
- ✅ File rotation (5MB max per file, 5 files kept)
- ✅ HTTP request logging via Morgan
- ✅ Contextual logging with request metadata

## Log Levels

The framework uses the following log levels (in order of priority):

- `error` (0): Error messages with stack traces
- `warn` (1): Warning messages
- `info` (2): General informational messages
- `http` (3): HTTP request/response logs
- `debug` (4): Detailed debugging information

**Default levels:**
- Development: `debug` (shows everything)
- Production: `info` (errors, warnings, and info messages)

## Log Files

Logs are written to the `logs/` directory:

- `logs/combined.log` - All log messages
- `logs/error.log` - Error messages only

Files are automatically rotated when they reach 5MB, keeping the last 5 files.

## Usage

### Basic Logging

```javascript
const logger = require('./services/logger');

// Different log levels
logger.error('Something went wrong', { userId: 123, action: 'payment' });
logger.warn('Deprecated API usage', { endpoint: '/old-api' });
logger.info('User registered', { email: 'user@example.com' });
logger.debug('Processing request', { requestData: req.body });
```

### Request-Scoped Logging

In route handlers, use `req.logger` to include the request ID automatically:

```javascript
router.get('/example', async (req, res) => {
  req.logger.info('Processing example request', {
    userId: req.session.userId
  });

  try {
    const result = await someOperation();
    req.logger.info('Operation completed', { result });
    res.json(result);
  } catch (err) {
    req.logger.error('Operation failed', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Internal error' });
  }
});
```

### Logging Errors

Always include error details:

```javascript
try {
  await riskyOperation();
} catch (err) {
  logger.error('Operation failed', {
    error: err.message,
    stack: err.stack,
    context: 'additional context'
  });
}
```

### HTTP Request Logging

HTTP requests are automatically logged with:
- IP address
- HTTP method
- URL
- Status code
- Response time

Example output:
```
::1 GET /membership 200 1234 - 45.123 ms
```

## Request Tracking

Every request receives a unique ID that's:
- Attached to `req.id`
- Returned in the `X-Request-Id` response header
- Included in all `req.logger` calls

This allows you to trace all logs for a specific request:

```bash
# Find all logs for a specific request
grep "abc123def456" logs/combined.log
```

## Configuration

### Environment Variables

Control logging behavior via environment:

- `NODE_ENV=development` - Debug level, colorized console
- `NODE_ENV=production` - Info level, JSON format
- `DISABLE_LOGGING=true` - Completely disable all logging
- `LOG_LEVEL=<level>` - Set custom log level (error, warn, info, http, debug, silent)

### Changing Log Level

**Via Environment Variable (Recommended):**
```bash
# Set specific level
LOG_LEVEL=warn npm run dev

# Disable completely
DISABLE_LOGGING=true npm run dev
```

**Via Code (if needed):**
Modify `services/logger.js`:

```javascript
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development' || env === 'dev';
  return isDevelopment ? 'debug' : 'info';
};
```

### Disabling Logging

Sometimes you need to disable logging entirely (tests, debugging, etc.):

**Method 1: Environment Variable**
```bash
DISABLE_LOGGING=true npm run dev
```

**Method 2: .env File**
```
DISABLE_LOGGING=true
```

**Method 3: Silent Level**
```bash
LOG_LEVEL=silent npm start
```

When logging is disabled:
- ✅ No console output
- ✅ No log files created
- ✅ No file I/O overhead
- ✅ Logger calls are no-ops (zero performance impact)
- ✅ Application runs normally

Perfect for:
- Running tests without log noise
- Production debugging
- Performance testing
- Automated CI/CD pipelines

## Best Practices

### ✅ Do

- Use appropriate log levels
- Include contextual data as objects
- Log important business events (user registration, payments, etc.)
- Use `req.logger` in route handlers
- Include error stacks for errors
- Log before and after critical operations

```javascript
req.logger.info('Starting payment process', { amount, userId });
try {
  const result = await processPayment(amount, userId);
  req.logger.info('Payment completed', { transactionId: result.id });
} catch (err) {
  req.logger.error('Payment failed', {
    error: err.message,
    stack: err.stack,
    userId,
    amount
  });
}
```

### ❌ Don't

- Log sensitive data (passwords, API keys, credit card numbers)
- Use console.log/console.error directly
- Log excessively in tight loops
- Include large objects without filtering

```javascript
// BAD
console.log('User logged in:', user.password);

// GOOD
logger.info('User logged in', { userId: user.id, email: user.email });
```

## Viewing Logs

### Development

Logs appear in the console with colors:
- Errors: red
- Warnings: yellow
- Info: green
- HTTP: magenta
- Debug: blue

### Production

View log files:

```bash
# Tail all logs
tail -f logs/combined.log

# View errors only
tail -f logs/error.log

# Search for specific request
grep "request-id-here" logs/combined.log

# View JSON formatted
cat logs/combined.log | jq '.'
```

### Filtering by Level

```bash
# Only errors
grep '"level":"error"' logs/combined.log | jq '.'

# Only warnings and errors
grep -E '"level":"(error|warn)"' logs/combined.log | jq '.'
```

## Integration with Monitoring

The JSON format makes it easy to integrate with log aggregation services:

- **Datadog**: Forward `logs/combined.log`
- **Splunk**: Use HTTP Event Collector
- **ELK Stack**: Use Filebeat to ship logs
- **CloudWatch**: Use CloudWatch agent

Example log entry:
```json
{
  "timestamp": "2026-02-15 14:30:45",
  "level": "info",
  "message": "User registered",
  "requestId": "abc123def456",
  "userId": 123,
  "email": "user@example.com"
}
```

## Troubleshooting

### Logs not appearing

1. Check log level: `logger.level`
2. Verify `logs/` directory exists
3. Check file permissions

### Disk space issues

Log files are rotated automatically, but you can manually clean:

```bash
# Remove old logs
rm logs/*.log.1 logs/*.log.2 logs/*.log.3
```

### Performance concerns

If logging impacts performance:

1. Reduce log level in production (`info` instead of `debug`)
2. Skip static asset logging (already configured)
3. Consider async transports

## Example: Adding Logging to a New Feature

```javascript
const logger = require('../services/logger');

async function processOrder(orderId) {
  logger.info('Processing order', { orderId });

  try {
    const order = await fetchOrder(orderId);
    logger.debug('Order fetched', { order });

    const result = await chargePayment(order);
    logger.info('Payment charged', {
      orderId,
      amount: result.amount,
      transactionId: result.id
    });

    await sendConfirmation(order.email);
    logger.info('Confirmation sent', { orderId, email: order.email });

    return result;
  } catch (err) {
    logger.error('Order processing failed', {
      orderId,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}
```
