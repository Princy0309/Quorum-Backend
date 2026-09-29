require('dotenv').config();
const prisma = require('./config/prisma');
const app = require('./app');

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log('Database connected');

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Quorum server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to the database or start server:', err);
    process.exit(1);
  }
};

startServer();
