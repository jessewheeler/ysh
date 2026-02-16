require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const seed = require('./db/seed');
const { injectLocals } = require('./middleware/locals');
const logger = require('./services/logger');
const { attachRequestId, attachLogger, morganMiddleware, logError } = require('./middleware/requestLogger');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (Render, nginx, etc.) so secure cookies and rate limiting work behind TLS termination
app.set('trust proxy', 1);

// Ensure directories exist
for (const dir of ['data', 'data/cards', 'data/uploads']) {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Run migration + seed on startup (moved to start() function)

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Rate limiters
const isTest = process.env.NODE_ENV === 'test';
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 10,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 20,
  message: 'Too many submissions. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stripe webhook needs raw body — must be before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

// Request logging and tracking
app.use(attachRequestId);
app.use(attachLogger);
app.use(morganMiddleware);

// Multer setup for file uploads (memoryStorage — files go to B2 or local disk in route handler)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
  },
});

// Sessions
let store;
if (process.env.DATABASE_URL) {
  const PgSimpleStore = require('connect-pg-simple')(session);
  const { Pool } = require('pg');
  const sessionPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  store = new PgSimpleStore({
    pool: sessionPool,
    createTableIfMissing: true,
  });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  store = new SQLiteStore({ dir: path.join(__dirname, 'data'), db: 'sessions.db' });
}

app.use(session({
  store,
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

// Parse multipart form data for admin routes before CSRF check
// (multer populates req.body for multipart forms; without this, CSRF token is inaccessible)
app.use('/admin', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      req.session.flash_error = `Upload error: ${err.message}`;
      return res.redirect(req.get('Referer') || '/admin/dashboard');
    }
    if (err) {
      req.session.flash_error = err.message;
      return res.redirect(req.get('Referer') || '/admin/dashboard');
    }
    next();
  });
});

// CSRF protection
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomUUID();
    }
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }

  // Skip CSRF for Stripe webhook (uses its own signature verification)
  if (req.path.startsWith('/stripe/')) return next();

  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    req.session.flash_error = 'Invalid form submission. Please try again.';
    const referer = req.get('Referer') || '/';
    return res.redirect(referer);
  }
  // Rotate token after successful POST
  req.session.csrfToken = crypto.randomUUID();
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

// Template engine
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Inject site settings, flash, isAdmin into all templates
app.use(injectLocals);

// Apply rate limiters to specific routes
app.use('/admin/login', loginLimiter);
app.use('/membership', formLimiter);
app.use('/contact', formLimiter);

// Routes
app.use('/', require('./routes/index'));
app.use('/stripe', require('./routes/stripe'));

// Admin routes (multer already applied above, before CSRF)
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { status: 404, message: 'Page not found' });
});

// Error logging middleware
app.use(logError);

// Error handler
app.use((err, req, res, _next) => {
  res.status(500).render('error', { status: 500, message: 'Something went wrong' });
});

async function start() {
  // Run migration + seed on startup
  try {
    await seed();
    app.listen(PORT, () => {
      logger.info(`Server running at http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Log level: ${logger.level}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = app;
