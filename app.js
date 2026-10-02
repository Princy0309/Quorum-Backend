const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const setupSwagger = require('./config/swagger');
const authRoutes = require('./routes/authRoutes').default || require('./routes/authRoutes');
const otpRoutes = require('./routes/otpRoutes').default || require('./routes/otpRoutes');
const errorHandler = require('./middlewares/errorHandler').default || require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (
      !origin || 
      allowedOrigins.includes(origin) || 
      origin.endsWith('.vercel.app') || 
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:')
    ) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  exposedHeaders: ['x-refresh-token', 'X-Refresh-Token', 'x-access-token', 'authorization'],
}));

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
setupSwagger(app);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    hasDbUrl: !!process.env.DATABASE_URL,
    hasRedisUrl: !!process.env.REDIS_URL,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasSmtpUser: !!process.env.SMTP_USER,
    hasSmtpPass: !!process.env.SMTP_PASS,
  });
});

app.get('/', (req, res) => {
  res.status(200).send('API is running');
});

app.use(errorHandler);

module.exports = app;
