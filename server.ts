import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import prisma from './config/prisma.js';
import app from './app.js';
import { emailWorker, queueRedisConnection } from './queues/emailQueue.js';
import redis from './config/redis.js';
import { initSocketServer } from './sockets/index.js';

let server: any;

const startServer = async (): Promise<void> => {
  const PORT = Number(process.env.PORT || 5000);
  
  const httpServer = createServer(app);
  initSocketServer(httpServer);

  server = httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Quorum server running on port ${PORT}`);
  });

  const maxRetries = 10;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await prisma.$connect();
      console.log('Database connected successfully');
      break;
    } catch (err) {
      console.warn(`Database connection attempt ${i}/${maxRetries} failed. Retrying in 2s...`);
      if (i === maxRetries) {
        console.error('Could not connect to database after maximum retries:', err);
      } else {
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }
};

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');

      try {
        await emailWorker.close();
        console.log('Email worker closed.');

        queueRedisConnection.disconnect();
        console.log('Queue Redis disconnected.');

        redis.disconnect();
        console.log('Main Redis disconnected.');

        await prisma.$disconnect();
        console.log('Prisma disconnected.');

        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
