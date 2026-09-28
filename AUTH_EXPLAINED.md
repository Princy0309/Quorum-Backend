# Quorum Authentication System - Architecture & Flow

This document explains the complete Authentication Backend that was built for Quorum. It breaks down the technologies used, the security measures implemented, and exactly how the Backend (Tushar) and the Frontend (Princy) interact.

---

## 🏗️ 1. Core Technologies
The authentication system is built to be fast, secure, and infinitely scalable:
*   **Node.js & Express:** The core backend framework handling API requests.
*   **Neon PostgreSQL:** A serverless SQL database storing user data securely.
*   **Prisma ORM:** The tool used to safely read and write data to PostgreSQL without writing raw SQL.
*   **Upstash Redis:** A blazing-fast, serverless caching database used to store temporary OTPs (One Time Passwords), track active login sessions, and manage rate limiting.
*   **AWS Elastic Beanstalk:** The production server hosting the live application.
*   **GitHub Actions:** The CI/CD pipeline that automatically takes new code from GitHub and deploys it straight to AWS.

---

## 🔄 2. The Token System (How Login Works)
We use a **Dual-Token System (JWT)** to keep users logged in securely without forcing them to re-enter their passwords constantly.

1.  **Access Token (Short-lived - 15 minutes):** 
    *   This is the "VIP Pass". It is attached to every API request the user makes (like creating a post).
    *   Because it expires so quickly, if a hacker steals it, it becomes useless almost immediately.
2.  **Refresh Token (Long-lived - 7 days):**
    *   This is the "VIP Pass Generator". 
    *   When the 15-minute Access Token expires, the frontend secretly sends the Refresh Token to the `/api/auth/refresh-token` endpoint to get a brand new Access Token. 

### How the Frontend (Princy) gets the Tokens:
Mobile apps (Flutter) and Web browsers handle security differently. Tushar built the backend to perfectly support both:
*   **For the Flutter Mobile App:** Princy sends the header `X-Client-Platform: mobile`. The backend responds by placing the Refresh Token directly in the JSON response so the Flutter app can save it in secure device storage.
*   **For the Web (Future):** The backend automatically places the Refresh Token inside an `httpOnly`, `Secure` browser cookie. This means JavaScript cannot read it, making it completely immune to Cross-Site Scripting (XSS) attacks.

---

## 🛡️ 3. Advanced Security Measures
Tushar implemented enterprise-grade security features to protect Quorum from hackers and bots.

### Rate Limiting (Redis Sliding Window)
To stop brute-force hacking (where a bot tries millions of passwords), we implemented a Sliding Window Rate Limiter powered by Redis:
*   **Rule:** A user can only guess a password wrong 10 times within a 15-minute window.
*   **Why Redis?** Because the app is on AWS, there might be multiple servers running. By storing the attempts in Redis, all servers share the same memory. A hacker cannot bypass the limit by hitting different servers.
*   **Smart Consumption:** The rate limiter only penalizes *failed* logins. Legitimate users who log in successfully are never blocked.
*   **Fail-Open Resilience:** If the Redis server ever goes down, the backend is smart enough to temporarily disable rate limiting rather than locking everyone out of the app.

### OTP (One Time Passwords)
For Email Verification and Password Resets:
*   OTPs are randomly generated and securely stored in **Redis** with a strict expiration timer (e.g., 5 minutes).
*   They are sent via Nodemailer to the user's email.
*   Once used, or once the timer runs out, the OTP automatically vanishes from Redis.

### Session Management & Remote Logout
When a user clicks "Logout", it's not enough to just delete the token on the frontend. 
*   Tushar's backend takes the user's Refresh Token, hashes it, and forcibly deletes it from the Redis database.
*   If a hacker tries to use a stolen Refresh Token after the real user has logged out, the backend checks Redis, sees the session is gone, and rejects it.

---

## 🚀 4. The CI/CD Pipeline (Deployment)
To make updates effortless, a complete CI/CD (Continuous Integration / Continuous Deployment) pipeline is set up.

1.  Tushar or Princy finishes a new feature and runs `git push origin dev`.
2.  GitHub Actions automatically wakes up, securely logs into AWS using the `quorum-deployer` IAM Credentials.
3.  It bundles the code, zips it, and deploys the new version directly to the live AWS Elastic Beanstalk servers without any downtime.
