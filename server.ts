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
  try {
    await prisma.$connect();
    console.log('Database connected');

    const httpServer = createServer(app);
    initSocketServer(httpServer);

    const PORT = process.env.PORT || 5000;
    server = httpServer.listen(PORT, () => {
      console.log(`Quorum server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to the database or start server:', err);
    process.exit(1);
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
