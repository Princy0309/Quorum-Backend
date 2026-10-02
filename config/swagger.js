const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Quorum Backend API Documentation',
    version: '1.0.0',
    description: 'Interactive API documentation for Quorum Authentication, OTP verification, session management, and 2FA flows.',
  },
  servers: [
    {
      url: 'https://api.newquorum.me',
      description: 'AWS EC2 (Live Production)',
    },
    {
      url: 'http://localhost:5000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your Bearer Access Token in the format: Bearer <token>',
      },
      RefreshTokenHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-refresh-token',
        description: 'Pass your signed JWT Refresh Token in the x-refresh-token request header.',
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new user',
        description: 'Creates a new user account and sends verification OTP to email. Tokens are issued after OTP verification via /api/otp/verify-email.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'John Doe' },
                  email: { type: 'string', example: 'user@example.com' },
                  password: { type: 'string', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User registered successfully. OTP sent to email.',
          },
          400: { description: 'Validation error' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login user',
        description: 'Authenticates credentials, updates last login, and returns access token & x-refresh-token header.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  password: { type: 'string', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            headers: {
              'x-refresh-token': {
                schema: { type: 'string' },
                description: 'Signed JWT Refresh Token',
              },
            },
          },
          401: { description: 'Invalid credentials' },
          403: { description: 'Email not verified' },
          429: { description: 'Too many failed login attempts' },
        },
      },
    },
    '/api/auth/refresh-token': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate refresh token',
        description: 'Rotates an active refresh token sent in x-refresh-token header or body and returns a new access token & refreshed x-refresh-token header.',
        parameters: [
          {
            name: 'x-refresh-token',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Active JWT Refresh Token',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Token refreshed successfully',
            headers: {
              'x-refresh-token': {
                schema: { type: 'string' },
                description: 'New Signed JWT Refresh Token',
              },
            },
          },
          401: { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Logout user',
        description: 'Revokes the active refresh token provided in x-refresh-token header or body.',
        parameters: [
          {
            name: 'x-refresh-token',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Active JWT Refresh Token to revoke',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Logged out successfully' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current user profile',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'User profile retrieved successfully' },
          401: { description: 'Unauthorized' },
          403: { description: 'Email not verified' },
        },
      },
    },
    '/api/otp/send-verification': {
      post: {
        tags: ['OTP & Verification'],
        summary: 'Send email verification OTP',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Verification OTP sent to email' },
          400: { description: 'Email address required' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/otp/verify-email': {
      post: {
        tags: ['OTP & Verification'],
        summary: 'Verify email with 6-digit OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['otp'],
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  otp: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Email verified successfully',
            headers: {
              'x-refresh-token': {
                schema: { type: 'string' },
                description: 'Signed JWT Refresh Token',
              },
            },
          },
          400: { description: 'Incorrect or expired OTP' },
        },
      },
    },
    '/api/otp/forgot-password': {
      post: {
        tags: ['OTP & Verification'],
        summary: 'Request password reset OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset OTP sent to email' },
        },
      },
    },
    '/api/otp/reset-password': {
      post: {
        tags: ['OTP & Verification'],
        summary: 'Reset password with OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp', 'newPassword'],
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  otp: { type: 'string', example: '123456' },
                  newPassword: { type: 'string', example: 'NewSecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset successfully' },
          400: { description: 'Incorrect OTP or validation error' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/auth/2fa/generate': {
      post: {
        tags: ['Two-Factor Auth (2FA)'],
        summary: 'Generate 2FA secret and QR Code',
        description: 'Generates a TOTP secret key and QR code data URL for Google Authenticator / Authy.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: '2FA QR Code generated successfully' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/2fa/enable': {
      post: {
        tags: ['Two-Factor Auth (2FA)'],
        summary: 'Enable 2FA for account',
        description: 'Verifies the 6-digit TOTP code and enables 2FA for the user account.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '2FA enabled successfully' },
          400: { description: 'Invalid 2FA code or setup not initiated' },
        },
      },
    },
    '/api/auth/2fa/verify-login': {
      post: {
        tags: ['Two-Factor Auth (2FA)'],
        summary: 'Verify 2FA code during login',
        description: 'Verifies 6-digit TOTP code using the temporary mfaToken returned from /api/auth/login.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mfaToken', 'code'],
                properties: {
                  mfaToken: { type: 'string', example: 'eyJhbGciOiJIUzI1Ni...' },
                  code: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '2FA authentication successful',
            headers: {
              'x-refresh-token': {
                schema: { type: 'string' },
                description: 'Signed JWT Refresh Token',
              },
            },
          },
          400: { description: 'Missing required parameters or 2FA not configured' },
          401: { description: 'MFA session expired or invalid 2FA code' },
        },
      },
    },
  },
};

const setupSwagger = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};

module.exports = setupSwagger;
