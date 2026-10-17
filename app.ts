import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import expressWinston from 'express-winston';
import helmet from 'helmet';
import apiRouter from './routes/index.js';

dotenv.config();

import setupSwagger from './config/swagger.js';
import errorHandler from './middlewares/errorHandler.js';
import verifyCSRF from './middlewares/csrfProtection.js';
import logger from './utils/logger.js';
import env, { isOriginAllowed } from './config/env.js';
import prisma from './config/prisma.js';
import { startAiHistoryCleanupTask } from './services/aiHistoryService.js';

startAiHistoryCleanupTask();

const app = express();

const trustProxy = process.env.TRUST_PROXY || 1;
app.set('trust proxy', isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy));

app.use(cors({
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  exposedHeaders: ['authorization'],
}));

app.use(helmet());
app.use(express.json({ limit: "10kb" }));
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

app.use('/api', apiRouter);
app.use('/', apiRouter);

setupSwagger(app);

app.get('/health', async (req: Request, res: Response) => {
  let dbStatus = 'connected';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'disconnected';
  }

  res.status(200).json({
    status: 'ok',
    database: dbStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req: Request, res: Response) => {
  res.status(200).send('API is running');
});

app.use(errorHandler);

export default app;
