# Quorum Backend Code Walkthrough

This document is a technical deep-dive into the Quorum Backend codebase. It explains what each major file does, how the logic flows, and how the different pieces connect. This is perfect for onboarding new developers (like Princy) or reviewing how the system works.

---

## 1. The Entry Point: `server.js`
This is the heart of the application. 
*   **What it does:** It sets up the Express web server, connects to the database (Prisma), configures middleware (like CORS so the frontend can talk to it), and defines the main API routes (`/api/auth` and `/api/otp`).
*   **Key Detail:** It includes a simple `GET /` route that returns `OK`. This is crucial because AWS Elastic Beanstalk constantly pings this route to check if the server is healthy.

---

## 2. Authentication Logic: `controllers/authController.js`
This file contains the logic for creating users and logging them in.
*   **`register`:** 
    *   Takes the user's name, email, and password. 
    *   Hashes the password securely using `bcrypt` (so if the database is ever stolen, hackers can't see the passwords).
    *   Saves the user to the database using `prisma.user.create`.
    *   Generates an Access Token and a Refresh Token to log the user in immediately.
*   **`login`:**
    *   Finds the user by email. If they don't exist, it **consumes a rate-limit point** and returns a 401 error.
    *   Compares the provided password with the hashed password in the database.
    *   If successful, it returns new tokens and updates the `lastLogin` timestamp.
*   **`refreshToken`:**
    *   Takes an old Refresh Token, validates it against Redis (to ensure it hasn't been revoked/logged out), and issues a brand new Access Token so the user stays logged in.

---

## 3. OTP & Email Logic: `controllers/otpController.js`
This file handles Email Verification and Password Resets.
*   **How OTPs are Generated:** A secure 6-digit code is created. To prevent hackers from reading the database and stealing the code, we hash the code (turn it into gibberish) before saving it.
*   **Where OTPs are Saved:** We do NOT save OTPs in the PostgreSQL database. Instead, we save them in **Redis** with an expiration timer (`EX`, usually 5 minutes). Redis automatically deletes the OTP when the timer runs out.
*   **`forgotPassword` & `resetPassword`:**
    *   When a user forgets their password, we generate an OTP, save its hash to Redis under `otp:reset:<userId>`, and email the plain 6-digit code to the user.
    *   When they enter the code, we hash what they typed, compare it to the hash in Redis, and if it matches, we update their password in the Prisma database.

---

## 4. Security: `middlewares/rateLimiter.js`
This file stops hackers from brute-forcing passwords or spamming the server.
*   **`rate-limiter-flexible`:** We use this library alongside Redis to track how many requests an IP address makes.
*   **`loginLimiter`:** We allow 10 failed login attempts per 15 minutes. 
    *   *Smart Logic:* The middleware only checks `.get(req.ip)` to see if the user is currently blocked. It does NOT consume points on successful logins. The point is only consumed in `authController.js` if the user types the wrong password.
*   **Fail-Open Logic:** If the Redis database drops its connection, the `catch` block intercepts the error and calls `next()`. This allows legitimate users to keep logging in instead of bringing down the whole server.

---

## 5. Security Check: `middlewares/authMiddleware.js`
This is a security checkpoint. Any route that requires a user to be logged in (like getting their profile, or sending an OTP) must pass through this file first.
*   **What it does:** It looks for the `Authorization: Bearer <token>` header sent by the frontend.
*   It uses the `jsonwebtoken` library to verify the token is authentic and hasn't expired.
*   If valid, it attaches the user's ID to `req.user` and lets the request proceed to the controller.

---

## 6. Token Generation: `services/tokenService.js`
A helper file that cleans up the controllers.
*   **`issueTokens`:** Creates both the short-lived JWT Access Token and the long-lived JWT Refresh Token.
*   **Session Tracking:** When a Refresh Token is created, it is hashed and saved to a Redis "Set" (`user_sessions:<userId>`). This allows a user to be logged in on multiple devices (phone, web, tablet) simultaneously.
*   If a user changes their password, we can look up this Redis Set and instantly delete all their active Refresh Tokens, forcing all their devices to log out immediately.
