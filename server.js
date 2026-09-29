require('dotenv').config();
const prisma = require('./config/prisma');
const app = require('./app');

prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;')
  .then(() => console.log('Database synced: isEmailVerified column ready'))
  .catch(err => console.error('DB migration error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Quorum server running on port ${PORT}`);
});
