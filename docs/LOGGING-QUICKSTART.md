# Logging Quick Start Guide

## Basic Usage

### In Services/Utilities
```javascript
const logger = require('./services/logger');

logger.info('User action completed', { userId: 123 });
logger.error('Operation failed', { error: err.message, stack: err.stack });
```

### In Route Handlers
```javascript
router.get('/example', async (req, res) => {
  req.logger.info('Processing request', { action: 'example' });

  try {
    const result = await doSomething();
    req.logger.info('Request completed successfully');
    res.json(result);
  } catch (err) {
    req.logger.error('Request failed', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Internal error' });
  }
});
```

## Log Levels

```javascript
logger.error('Critical error');  // Red - Errors only
logger.warn('Warning message');   // Yellow - Warnings and above
logger.info('Info message');      // Green - Info and above (production default)
logger.http('HTTP request');      // Magenta - HTTP requests
logger.debug('Debug details');    // Blue - Debug and above (development default)
```

## Request Tracking

Every request automatically gets:
- Unique request ID in `req.id`
- Request ID in response header `X-Request-Id`
- Contextual logger in `req.logger` that includes the request ID

## Viewing Logs

### Development (Console)
Logs appear in your terminal with colors

### Production (Files)
```bash
# View all logs
tail -f logs/combined.log

# View errors only
tail -f logs/error.log

# Search for specific request
grep "abc123def456" logs/combined.log

# View as JSON
cat logs/combined.log | jq '.'
```

## What Gets Logged Automatically

✅ All HTTP requests (method, URL, status, response time)
✅ Server startup information
✅ Database migrations
✅ Error stack traces
✅ Request IDs for correlation

## Best Practices

✅ **Do:**
- Use `req.logger` in routes for request context
- Include error stacks: `{ error: err.message, stack: err.stack }`
- Log important business events
- Use appropriate log levels

❌ **Don't:**
- Log passwords, API keys, or sensitive data
- Use `console.log` directly
- Log in tight loops

## Common Patterns

### Error Logging
```javascript
try {
  await riskyOperation();
} catch (err) {
  req.logger.error('Operation failed', {
    error: err.message,
    stack: err.stack,
    userId: req.session.userId
  });
  throw err;
}
```

### Info Logging
```javascript
req.logger.info('User registered', {
  userId: user.id,
  email: user.email,
  membershipType: 'family'
});
```

### Debug Logging
```javascript
logger.debug('Payment processing details', {
  amount: payment.amount,
  currency: payment.currency,
  stripeSessionId: session.id
});
```

## Configuration

### Automatic Configuration
Logs are automatically configured based on `NODE_ENV`:
- **development**: Debug level, colorized console
- **production**: Info level, JSON format, file rotation

### Environment Variables

```bash
# Disable logging completely
DISABLE_LOGGING=true npm run dev

# Set custom log level
LOG_LEVEL=warn npm run dev

# Available levels: error, warn, info, http, debug, silent
LOG_LEVEL=error npm start
```

### Disable Logging

To completely disable all logging:

**Option 1: Environment Variable**
```bash
DISABLE_LOGGING=true npm run dev
```

**Option 2: .env file**
```
DISABLE_LOGGING=true
```

**Option 3: Set log level to silent**
```bash
LOG_LEVEL=silent npm run dev
```

When disabled:
- No console output
- No log files created
- No file I/O overhead
- Perfect for tests or production debugging

No configuration needed! 🎉
