import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import expressWinston from 'express-winston';

dotenv.config();

import setupSwagger from './config/swagger';
import authRoutes from './routes/authRoutes';
import otpRoutes from './routes/otpRoutes';
import errorHandler from './middlewares/errorHandler';
import verifyCSRF from './middlewares/csrfProtection';
import logger from './utils/logger';

const app = express();

const trustProxy = process.env.TRUST_PROXY || 1;
app.set('trust proxy', isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy));

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [
      'https://quorum-web-omega.vercel.app',
      'https://newquorum.me',
      'https://www.newquorum.me',
      'http://localhost:3000',
      'http://localhost:5173',
    ];

app.use(cors({
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (!origin) return callback(null, true);

    const isAllowedDomain = allowedOrigins.includes(origin);
    const isLocalDev = process.env.NODE_ENV !== 'production' && (
      origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
    );

    if (isAllowedDomain || isLocalDev) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  exposedHeaders: ['authorization'],
}));

app.use(express.json());
app.use(cookieParser());
app.use(verifyCSRF);

app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: "HTTP {{req.method}} {{req.url}}",
  expressFormat: true,
  colorize: false,
  ignoreRoute: function (req, res) { return req.path === '/health'; }
}));

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.get('/api/csrf-token', (req: Request, res: Response) => {
  res.json({ csrfToken: res.locals.csrfToken || req.cookies['XSRF-TOKEN'] });
});
setupSwagger(app);

app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok',
    hasDbUrl: !!process.env.DATABASE_URL,
    hasRedisUrl: !!process.env.REDIS_URL,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasSmtpUser: !!process.env.SMTP_USER,
    hasSmtpPass: !!process.env.SMTP_PASS,
  });
});

app.get('/', (req: Request, res: Response) => {
  res.status(200).send('API is running');
});

app.use(errorHandler);

export default app;
