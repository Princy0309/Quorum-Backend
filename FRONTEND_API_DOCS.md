# Quorum Backend API Documentation for Frontend Developers

Base Production URL: `https://api.newquorum.me`  
Interactive Swagger Docs: `https://api.newquorum.me/api-docs`

---

## Overview & Authentication Flow

### Tokens & Headers
- **Access Token:** Short-lived JWT (15 mins) signed with algorithm `HS256`, `issuer: quorum-api`, and `audience: quorum-app`. Pass in HTTP Header for protected routes:
  `Authorization: Bearer <accessToken>`
- **Refresh Token:** Long-lived signed JWT (7 days) returned in the response header `x-refresh-token` (and in HTTPS-only cookie `refreshToken` for web browsers). Pass in HTTP Header for token rotation / logout:
  `x-refresh-token: <refreshToken>`
- **Registration Safeguard:** No tokens are issued upon registration. Users must verify their email with the 6-digit OTP code sent to their inbox before receiving tokens.

---

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 User Registration
- **Endpoint:** `POST /api/auth/register`
- **Auth Required:** No
- **Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "Password123!"
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully. Please verify your email with the OTP sent to your inbox.",
  "data": {
    "user": {
      "id": "uuid-v4",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "member",
      "isEmailVerified": false
    }
  }
}
```

---

### 1.2 User Login (Password)
- **Endpoint:** `POST /api/auth/login`
- **Auth Required:** No
- **Headers Returned:** `x-refresh-token: <signed_jwt_refresh_token>`
- **Request Body:**
```json
{
  "email": "john@example.com",
  "password": "Password123!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "id": "uuid-v4",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "member",
      "isEmailVerified": true
    }
  }
}
```

---

### 1.3 Rotate Refresh Token
- **Endpoint:** `POST /api/auth/refresh-token`
- **Auth Header:** `x-refresh-token: <refreshToken>` (or in JSON body `{ "refreshToken": "..." }`)
- **Headers Returned:** `x-refresh-token: <new_signed_jwt_refresh_token>`
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Tokens refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1Ni..."
  }
}
```

---

### 1.4 User Logout
- **Endpoint:** `POST /api/auth/logout`
- **Auth Header:** `x-refresh-token: <refreshToken>`
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged out successfully"
}
```

---

### 1.5 Get Profile
- **Endpoint:** `GET /api/auth/me`
- **Auth Required:** `Authorization: Bearer <accessToken>`
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile fetched successfully",
  "data": {
    "user": {
      "id": "uuid-v4",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "member",
      "isEmailVerified": true,
      "is2FAEnabled": false,
      "createdAt": "2026-10-02T12:00:00.000Z",
      "lastLogin": "2026-10-02T19:00:00.000Z"
    }
  }
}
```

---

## 2. OTP & Email Verification Endpoints (`/api/otp`)

### 2.1 Verify Email OTP
- **Endpoint:** `POST /api/otp/verify-email`
- **Headers Returned:** `x-refresh-token: <signed_jwt_refresh_token>`
- **Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Email verified successfully",
  "data": {
    "accessToken": "eyJhbG...",
    "user": {
      "id": "uuid-v4",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "member",
      "isEmailVerified": true
    }
  }
}
```
