# Quorum API Documentation

**Base URL (Production/AWS)**: `http://quorum-backend-env.eba-2vd8rmzr.ap-south-1.elasticbeanstalk.com`
**Base URL (Local Development)**: `http://localhost:5000`
---

## 📱 Important Headers
For the **Flutter Mobile App**, you **must** include the following header on every request:
`X-Client-Platform: mobile`

This tells the backend to return the `refreshToken` in the JSON response body instead of as an `httpOnly` browser cookie, which Flutter cannot easily read.

---

## 🔐 Auth Endpoints (`/api/auth`)

### 1. Register a New User
- **Method:** `POST`
- **Endpoint:** `/api/auth/register`
- **Headers:** `X-Client-Platform: mobile` (For Flutter)
- **Body:**
```json
{
  "name": "User Name",
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "710063...",
    "user": {
      "id": "uuid-here",
      "name": "User Name",
      "email": "user@example.com",
      "role": "member"
    }
  }
}
```

### 2. Login
- **Method:** `POST`
- **Endpoint:** `/api/auth/login`
- **Headers:** `X-Client-Platform: mobile`
- **Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "710063...",
    "user": {
      "id": "uuid-here",
      "name": "User Name",
      "email": "user@example.com",
      "role": "member"
    }
  }
}
```

### 3. Get Current User Profile
- **Method:** `GET`
- **Endpoint:** `/api/auth/me`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "User profile retrieved",
  "data": {
    "id": "uuid-here",
    "name": "User Name",
    "email": "user@example.com",
    "role": "member",
    "lastLogin": "2026-09-27T..."
  }
}
```

### 4. Refresh Token
- **Method:** `POST`
- **Endpoint:** `/api/auth/refresh-token`
- **Headers:** `X-Client-Platform: mobile`
- **Body:** *(Only needed for Flutter/Mobile)*
```json
{
  "refreshToken": "710063..."
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "new-eyJhbGci...",
    "refreshToken": "new-710063..."
  }
}
```

### 5. Logout
- **Method:** `POST`
- **Endpoint:** `/api/auth/logout`
- **Body:** *(Only needed for Flutter/Mobile)*
```json
{
  "refreshToken": "710063..."
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## ✉️ OTP & Email Endpoints (`/api/otp`)

### 1. Send Email Verification OTP
- **Method:** `POST`
- **Endpoint:** `/api/otp/send-verification`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Verification email sent"
}
```

### 2. Verify Email OTP
- **Method:** `POST`
- **Endpoint:** `/api/otp/verify-email`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Body:**
```json
{
  "otp": "123456"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

### 3. Forgot Password (Request OTP)
- **Method:** `POST`
- **Endpoint:** `/api/otp/forgot-password`
- **Body:**
```json
{
  "email": "user@example.com"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

### 4. Reset Password
- **Method:** `POST`
- **Endpoint:** `/api/otp/reset-password`
- **Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "NewSecurePassword123!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset successful"
}
```
