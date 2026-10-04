import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Quorum Backend API Documentation',
    version: '1.0.0',
    description: 'Interactive API documentation for Quorum Authentication, OTP verification, and session management.',
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
      CSRFAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xsrf-token',
        description: 'Enter the CSRF token retrieved from /api/csrf-token for all POST, PUT, DELETE requests.',
      },
    },
  },
  paths: {
    '/api/csrf-token': {
      get: {
        tags: ['Authentication'],
        summary: 'Get CSRF Token',
        description: 'Retrieves a CSRF token to be included in the x-xsrf-token header of subsequent state-changing requests.',
        responses: {
          200: { description: 'Returns the CSRF token' },
        },
      },
    },
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
                  password: { type: 'string', minLength: 8, maxLength: 72, example: 'Password123!' },
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
        description: 'Authenticates credentials and sets an HttpOnly, Secure refreshToken cookie for web clients. Mobile clients can pass x-client-platform: mobile header to receive refreshToken in response JSON body.',
        parameters: [
          {
            name: 'x-client-platform',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Specify "mobile" for non-browser mobile app requests',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  password: { type: 'string', minLength: 8, maxLength: 72, example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful. Sets HttpOnly refreshToken cookie.',
          },
          401: { description: 'Invalid credentials' },
          403: { description: 'Email not verified or Account is temporarily locked' },
          429: { description: 'Too many failed login attempts from IP or Account' },
        },
      },
    },
    '/api/auth/refresh-token': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate refresh token',
        description: 'Rotates active refresh token from HttpOnly cookie (for web browsers) or JSON body (for mobile clients with x-client-platform: mobile) and returns a new access token.',
        parameters: [
          {
            name: 'x-client-platform',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Specify "mobile" for non-browser mobile app requests',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string', description: 'Refresh token (required for mobile clients)' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Token refreshed successfully. Sets updated HttpOnly refreshToken cookie.',
          },
          401: { description: 'Invalid or expired refresh token' },
          403: { description: 'Account is temporarily locked' },
          429: { description: 'Too many refresh token requests' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Logout user',
        description: 'Revokes the active refresh token provided in HttpOnly cookie or JSON body.',
        parameters: [
          {
            name: 'x-client-platform',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Specify "mobile" for non-browser mobile app requests',
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
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Logged out successfully. Both access token and refresh tokens are revoked.' },
        },
      },
    },
    '/api/auth/logout-all': {
      post: {
        tags: ['Authentication'],
        summary: 'Logout from all devices',
        description: 'Revokes all active sessions across all devices for the authenticated user.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Logged out from all devices successfully' },
          401: { description: 'Unauthorized' },
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
                  newPassword: { type: 'string', minLength: 8, maxLength: 72, example: 'NewSecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset successfully. All active sessions have been atomically revoked.' },
          400: { description: 'Incorrect OTP or validation error' },
          404: { description: 'User not found' },
        },
      },
    },
  },
};

export const setupSwagger = (app: Express): void => {
  const options = {
    swaggerOptions: {
      requestInterceptor: (req: any) => {
        // Runs in the browser context to automatically attach the CSRF token
        const match = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/);
        if (match) {
          req.headers['x-xsrf-token'] = decodeURIComponent(match[1]);
        }
        return req;
      }
    }
  };
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
};

export default setupSwagger;
