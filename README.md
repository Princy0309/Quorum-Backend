# Quorum Backend

This is the backend service for Quorum, providing authentication, session management, and related API features.

## Architecture

- **Node.js + Express**: Web framework.
- **TypeScript**: Static typing for safer code.
- **Prisma ORM + PostgreSQL**: Primary database for durable storage of user records and refresh token metadata.
- **Redis**: Ephemeral store for rate limiting, active session lists, and OTP state caching.
- **BullMQ**: Background queue processing for sending emails asynchronously.
- **Winston**: Structured logging system.

## Setup and Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   Create a `.env` file in the root directory based on the following variables:

   ```env
   # Application
   PORT=5000
   NODE_ENV=development

   # Database
   DATABASE_URL="postgresql://user:password@localhost:5432/quorum?schema=public"
   
   # Redis
   REDIS_URL="redis://localhost:6379"

   # Security
   JWT_SECRET="your-super-secret-key"
   ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
   TRUST_PROXY=1

   # Email Setup (SMTP)
   SMTP_HOST="smtp.example.com"
   SMTP_PORT=587
   SMTP_USER="your-email@example.com"
   SMTP_PASS="your-email-password"
   EMAIL_FROM="noreply@example.com"
   ```

3. **Database Migration**
   ```bash
   npm run db:migrate
   ```

4. **Start the Development Server**
   ```bash
   npm run dev
   ```

## Key API Endpoints

### Auth Routes
- `POST /api/auth/register` - Create a new user account.
- `POST /api/auth/login` - Authenticate and issue sessions.
- `POST /api/auth/refresh-token` - Rotate refresh token.
- `POST /api/auth/logout` - Logout of current session.
- `POST /api/auth/logout-all` - Logout of all active sessions.
- `GET /api/auth/me` - Fetch current user profile.

### OTP Routes
- `POST /api/otp/send-verification` - Dispatch verification OTP.
- `POST /api/otp/verify-email` - Validate email via OTP.
- `POST /api/otp/forgot-password` - Request a password reset OTP.
- `POST /api/otp/reset-password` - Reset password with OTP.

## Testing

Run tests with Jest:
```bash
npm run test
```

## Deployment

1. Ensure the PostgreSQL and Redis instances are running and accessible.
2. Build the project (if applicable) or start via `tsx`:
   ```bash
   npm start
   ```
3. Set `NODE_ENV=production` and ensure secrets are populated correctly.