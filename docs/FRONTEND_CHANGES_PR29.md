# Frontend Integration Guide: PR #29 Updates

This document outlines all backend changes introduced in **Pull Request #29** that impact the frontend client applications (Web, Mobile, Desktop).

---

## Summary of Changes

1. **Lazy User Creation**: Unverified users are no longer pre-saved to the PostgreSQL database on registration; user state is kept in cache until OTP verification succeeds.
2. **OTP Verification Payload**: Email is now **mandatory** when submitting verification codes.
3. **Login OTP Decoupling**: Login attempts with unverified emails no longer automatically trigger an OTP email.
4. **Registration Dual Rate Limiting**: Dual rate limiting per IP and per Email address to prevent OTP flooding.
5. **Form Validation & String Limits**: Enforced field lengths on Community and Organization endpoints.

---

## 1. Critical & Breaking Changes

### A. OTP Verification Requires `email` in Request Body

* **Endpoints**:
  * `POST /api/auth/verify-email` (or `POST /api/otp/verify-email`)
  * `POST /api/v1/auth/verify-email` (or `POST /api/v1/otp/verify-email`)
* **Why**: The user does not exist in the database yet during initial registration. The backend verifies the OTP and fetches user creation data from the temporary registration cache using the email address.
* **Frontend Action**: Ensure your OTP submission payload always includes `email`.

#### Request Payload
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

#### Successful Response (`200 OK`)
```json
{
  "statusCode": 200,
  "message": "Email verified successfully",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "c1f7a4b2-8b4e-4f1b-8e2b-...",
      "name": "Alex Doe",
      "email": "user@example.com",
      "role": "USER",
      "isEmailVerified": true
    }
  }
}
```
> **Note**: For web clients, the backend also automatically sets `accessToken` and `refreshToken` in `httpOnly` secure cookies.

---

### B. Registration Response: `user.id` is Empty for New Accounts

* **Endpoint**: `POST /api/auth/register` (or `POST /api/v1/auth/register`)
* **Behavior**: Because the user record is committed only **after** OTP verification, `res.data.user.id` is an empty string (`""`) for newly registered accounts.

#### Response (`201 Created`)
```json
{
  "statusCode": 201,
  "message": "User registered successfully. Please verify your email with the OTP sent to your inbox.",
  "data": {
    "email": "user@example.com",
    "user": {
      "id": "",
      "name": "Alex Doe",
      "email": "user@example.com",
      "role": "USER",
      "isEmailVerified": false
    }
  }
}
```

* **Frontend Action**:
  * **DO NOT** rely on `response.data.user.id` for routing (e.g. avoid `/verify-otp?userId=...`).
  * Pass the **`email`** to the verification view instead (e.g. `/verify-otp?email=user@example.com` or through state/context).
  * The permanent database UUID `user.id` will be returned upon successful completion of `verify-email`.

---

### C. Unverified Login No Longer Auto-Sends OTP

* **Endpoint**: `POST /api/auth/login`
* **Behavior**: When an unverified user attempts to log in, the backend now returns HTTP `403 Forbidden` without automatically sending an OTP email:
  ```json
  {
    "statusCode": 403,
    "message": "Email not verified. Please verify your email before logging in."
  }
  ```
* **Frontend Action**:
  * Do not show messages claiming a code was automatically sent.
  * When receiving `403` with unverified email message, provide a **"Resend Verification Code"** or **"Verify Email"** button.
  * Clicking the button should call:
    ```http
    POST /api/otp/send-otp
    Content-Type: application/json

    {
      "email": "user@example.com",
      "type": "verification"
    }
    ```
  * Once the request succeeds, redirect the user to the OTP verification screen.

---

## 2. Form Validation & Field Constraints

Strict validation rules (Zod schemas and service-layer limits) are now enforced. The frontend should match these limits using `minLength`, `maxLength`, and client-side form checks to avoid `400 Bad Request` errors.

### Community Validation
* **Endpoints**: `POST /api/communities`, `PATCH /api/communities/:id`

| Field | Type | Rules | Error Message |
| :--- | :--- | :--- | :--- |
| `name` | string | Trimmed, **min 2**, **max 100** characters | `Community name must be between 2 and 100 characters` |
| `description` | string | Optional / nullable, **max 1000** characters | `Community description cannot exceed 1000 characters` |

### Organization Validation
* **Endpoints**: `POST /api/organizations`, `PATCH /api/organizations/:id`

| Field | Type | Rules | Error Message |
| :--- | :--- | :--- | :--- |
| `name` | string | Trimmed, **min 2**, **max 100** characters | `Organization name must be between 2 and 100 characters` |
| `description` | string | Optional / nullable, **max 1000** characters | `Organization description cannot exceed 1000 characters` |
| `email` | string | Optional / nullable, must be valid email format or empty string `""` | `Invalid email address` |
| `industry` | string | Optional / nullable, **max 100** characters | Max length constraint |
| `teamSize` | string | Optional / nullable, **max 50** characters | Max length constraint |

> **Update Rule**: On `PATCH /api/organizations/:id`, at least one field must be provided, otherwise the backend responds with `At least one field must be provided to update`.

---

## 3. Rate Limiting Updates

* **Registration Dual Limiter**:
  * **IP Limit**: 5 registration attempts per hour per IP.
  * **Email Limit**: 5 registration attempts per hour per email address.
  * **Block Window**: Exceeding the limit results in a 15-minute block.
* **Status Code**: `429 Too Many Requests`
  ```json
  {
    "success": false,
    "statusCode": 429,
    "message": "Too many registration attempts, try again later."
  }
  ```
* **Frontend Action**:
  * Disable the "Sign Up" / "Submit" button immediately after click while the API request is in-flight.
  * Display a friendly error notification or banner when a `429` status is received.

---

## 4. Route Aliases (Backwards Compatibility)

For developer convenience, the OTP routes are mounted under multiple paths and can be used interchangeably:

* `POST /api/auth/verify-email` ↔ `POST /api/otp/verify-email`
* `POST /api/v1/auth/verify-email` ↔ `POST /api/v1/otp/verify-email`
* `POST /api/auth/send-otp` ↔ `POST /api/otp/send-otp`
* `POST /api/v1/auth/send-otp` ↔ `POST /api/v1/otp/send-otp`
