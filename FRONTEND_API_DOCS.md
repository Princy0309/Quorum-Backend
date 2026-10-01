# Quorum Backend API Documentation for Frontend Developers

Base Production URL: `https://api.newquorum.me`  
Interactive Swagger Docs: `https://api.newquorum.me/api-docs`

---

## Overview & Authentication Flow

### Tokens & Headers
- **Access Token:** Short-lived JWT (15 mins) returned in API response data. Pass in HTTP Header for protected routes:
  `Authorization: Bearer <accessToken>`
- **Refresh Token:** Long-lived token returned in HTTPS-only cookie `refreshToken` (Web) or in JSON payload when `x-client-platform: mobile` header is sent.
- **Mobile Request Header:** Pass `x-client-platform: mobile` header on mobile apps to receive `refreshToken` in the JSON body instead of cookies.

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
  "message": "User registered successfully",
  "data": {
    "accessToken": "eyJhbG...",
    "user": {
      "id": "uuid",
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
- **Request Body:**
```json
{
  "email": "john@example.com",
  "password": "Password123!"
}
```
- **Response - 2FA Not Enabled (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbG...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "member",
      "isEmailVerified": true
    }
  }
}
```
- **Response - 2FA Enabled (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "2FA verification required",
  "data": {
    "requires2FA": true,
    "mfaToken": "eyJhbG..."
  }
}
```
*(When `requires2FA` is true, prompt the user for their 6-digit Authenticator code and call `POST /api/auth/2fa/verify-login` with `mfaToken` + `code`)*.

---

### 1.3 Google OAuth Authentication
- **Endpoint:** `POST /api/auth/google`
- **Auth Required:** No
- **Request Body:**
```json
{
  "idToken": "GOOGLE_ID_TOKEN_FROM_GIS_OR_REACT_OAUTH"
}
```
- **Response (200 OK):** Same structure as Login (returns tokens or `requires2FA: true`).

---

### 1.4 Generate 2FA Secret & QR Code
- **Endpoint:** `POST /api/auth/2fa/generate`
- **Auth Required:** Yes (`Bearer <accessToken>`)
- **Request Body:** None
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "2FA QR Code generated successfully",
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCodeUrl": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```
*(Render `qrCodeUrl` inside an `<img src={qrCodeUrl} />` tag for the user to scan with Google Authenticator or Authy)*.

---

### 1.5 Enable 2FA Account Protection
- **Endpoint:** `POST /api/auth/2fa/enable`
- **Auth Required:** Yes (`Bearer <accessToken>`)
- **Request Body:**
```json
{
  "code": "123456"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "2FA enabled successfully"
}
```

---

### 1.6 Verify 2FA During Login
- **Endpoint:** `POST /api/auth/2fa/verify-login`
- **Auth Required:** No
- **Request Body:**
```json
{
  "mfaToken": "eyJhbG...",
  "code": "123456"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "2FA authentication successful",
  "data": {
    "accessToken": "eyJhbG...",
    "user": { ... }
  }
}
```

---

### 1.7 Refresh Access Token
- **Endpoint:** `POST /api/auth/refresh-token`
- **Auth Required:** Cookie `refreshToken` (Web) or Request Body (Mobile)
- **Request Body (Mobile):**
```json
{
  "refreshToken": "YOUR_REFRESH_TOKEN"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbG..."
  }
}
```

---

### 1.8 Logout
- **Endpoint:** `POST /api/auth/logout`
- **Auth Required:** Cookie or Request Body
- **Response (200 OK):** Clears refresh cookies and invalidates session in Redis.

---

### 1.9 Get Current User Profile
- **Endpoint:** `GET /api/auth/me`
- **Auth Required:** Yes (`Bearer <accessToken>`)
- **Requires Verified Email:** Yes
- **Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile retrieved",
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "member",
    "isEmailVerified": true,
    "lastLogin": "2026-10-01T08:00:00.000Z"
  }
}
```

---

## 2. OTP & Email Verification Endpoints (`/api/otp`)

### 2.1 Send Email Verification OTP
- **Endpoint:** `POST /api/otp/send-verification`
- **Auth Required:** Yes (`Bearer <accessToken>`)
- **Response (200 OK):** Sends 6-digit OTP code to user's registered email address.

---

### 2.2 Verify Email OTP
- **Endpoint:** `POST /api/otp/verify-email`
- **Auth Required:** Yes (`Bearer <accessToken>`)
- **Request Body:**
```json
{
  "otp": "123456"
}
```
- **Response (200 OK):** Marks `isEmailVerified: true` for the user account.

---

### 2.3 Forgot Password
- **Endpoint:** `POST /api/otp/forgot-password`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "john@example.com"
}
```
- **Response (200 OK):** Sends password reset OTP to email.

---

### 2.4 Reset Password
- **Endpoint:** `POST /api/otp/reset-password`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456",
  "newPassword": "NewPassword123!"
}
```
- **Response (200 OK):** Updates user password.

---

## Standard Error Response Format

All error responses return standard HTTP status codes (400, 401, 403, 404, 500):

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Error description message"
}
```
