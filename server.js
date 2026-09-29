const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const prisma = require('./config/prisma');

const authRoutes = require('./routes/authRoutes');
const otpRoutes = require('./routes/otpRoutes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();


const allowedOrigins = [
  'http://localhost:3000',
  'https://newquorum.me',
  'https://www.newquorum.me',
  'https://quorum-web-otsg.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());


app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);


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

prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;')
  .then(() => console.log('Database synced: isEmailVerified column ready'))
  .catch(err => console.error('DB migration error:', err));


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Quorum server running on port ${PORT}`);
});
