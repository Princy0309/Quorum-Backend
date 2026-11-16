import { Express, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';

export const swaggerDocument = {
  "openapi": "3.0.0",
  "info": {
    "title": "Quorum Backend API Documentation",
    "version": "1.0.0",
    "description": "Comprehensive interactive API documentation for Quorum Backend including Authentication, User Management, Real-Time Conversations, Communities, Posts, Comments, Organizations, Teams, Meetings (SFU/WebRTC), Media Storage, and Device Tokens."
  },
  "servers": [
    {
      "url": "/",
      "description": "API Server"
    }
  ],
  "components": {
    "securitySchemes": {
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Enter your Bearer Access Token in the format: Bearer <token>"
      },
      "CSRFAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "x-xsrf-token",
        "description": "Enter the CSRF token retrieved from /api/csrf-token for all state-changing requests."
      }
    }
  },
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "System & Health"
        ],
        "summary": "Check API and infrastructure health",
        "description": "Returns health status of the API server, database connectivity, redis connectivity, and core secrets.",
        "responses": {
          "200": {
            "description": "Health status summary",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "example": "ok"
                    },
                    "hasDbUrl": {
                      "type": "boolean",
                      "example": true
                    },
                    "hasRedisUrl": {
                      "type": "boolean",
                      "example": true
                    },
                    "hasJwtSecret": {
                      "type": "boolean",
                      "example": true
                    },
                    "hasSmtpUser": {
                      "type": "boolean",
                      "example": true
                    },
                    "hasSmtpPass": {
                      "type": "boolean",
                      "example": true
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/csrf-token": {
      "get": {
        "tags": [
          "Authentication"
        ],
        "summary": "Get CSRF Token",
        "description": "Retrieves a CSRF token to be included in the x-xsrf-token header of subsequent state-changing requests.",
        "responses": {
          "200": {
            "description": "Returns the CSRF token"
          }
        }
      }
    },
    "/api/users/profile": {
      "get": {
        "tags": [
          "Users"
        ],
        "summary": "Get current user profile",
        "description": "Fetches current authenticated user's complete profile. Compatible with Web and Mobile apps.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "User profile retrieved successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "patch": {
        "tags": [
          "Users"
        ],
        "summary": "Update current user profile (Partial / JSON)",
        "description": "Updates current authenticated user's profile fields. Accepts JSON or multipart/form-data. Compatible with Web and Mobile.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Jane Doe"
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://cdn.quorum.me/avatars/user.png"
                  },
                  "useCases": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "enum": [
                        "ORGANIZATION",
                        "FREELANCE",
                        "HIRE_COLLABORATE",
                        "COMMUNITY"
                      ]
                    }
                  },
                  "isOnboarded": {
                    "type": "boolean",
                    "example": true
                  }
                }
              }
            },
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Jane Doe"
                  },
                  "avatar": {
                    "type": "string",
                    "format": "binary",
                    "description": "Profile picture image file (JPEG, PNG, WEBP, etc.)"
                  },
                  "useCases": {
                    "type": "string",
                    "description": "JSON string or comma-separated use case enums"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Profile updated successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "put": {
        "tags": [
          "Users"
        ],
        "summary": "Set/Replace current user profile",
        "description": "Sets or replaces current authenticated user's profile. Accepts both application/json and multipart/form-data.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "$ref": "#/paths/~1api~1users~1profile/patch/requestBody"
        },
        "responses": {
          "200": {
            "description": "Profile updated successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/auth/register": {
      "post": {
        "tags": [
          "Authentication"
        ],
        "summary": "Register a new user",
        "description": "Creates a new user account and sends verification OTP to email. Tokens are issued after OTP verification via /api/otp/verify-email.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "email",
                  "password"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "John Doe"
                  },
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  },
                  "password": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 72,
                    "example": "Password123!"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "User registered successfully. OTP sent to email."
          },
          "400": {
            "description": "Validation error"
          },
          "409": {
            "description": "Email already registered"
          }
        }
      }
    },
    "/api/auth/login": {
      "post": {
        "tags": [
          "Authentication"
        ],
        "summary": "Login user",
        "description": "Authenticates credentials and sets an HttpOnly, Secure refreshToken cookie for web clients. Mobile clients can pass x-client-platform: mobile header to receive refreshToken in response JSON body.",
        "parameters": [
          {
            "name": "x-client-platform",
            "in": "header",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Specify \"mobile\" for non-browser mobile app requests"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "password"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  },
                  "password": {
                    "type": "string",
                    "example": "Password123!"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Login successful, returns accessToken and sets refreshToken cookie (or body for mobile)"
          },
          "401": {
            "description": "Invalid email or password"
          },
          "403": {
            "description": "Email not verified"
          },
          "429": {
            "description": "Too many failed login attempts"
          }
        }
      }
    },
    "/api/auth/refresh-token": {
      "post": {
        "tags": [
          "Authentication"
        ],
        "summary": "Rotate and refresh access token",
        "description": "Generates a new access token and rotated refresh token using the existing refresh token.",
        "parameters": [
          {
            "name": "x-client-platform",
            "in": "header",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Specify \"mobile\" if passing refreshToken in request body"
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "refreshToken": {
                    "type": "string",
                    "example": "raw-refresh-token"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Tokens rotated and refreshed successfully"
          },
          "401": {
            "description": "Invalid or expired refresh token"
          }
        }
      }
    },
    "/api/auth/logout": {
      "post": {
        "tags": [
          "Authentication"
        ],
        "summary": "Logout current session",
        "description": "Revokes the current refresh token and blacklists the current access token.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Logged out successfully"
          }
        }
      }
    },
    "/api/auth/logout-all": {
      "post": {
        "tags": [
          "Authentication"
        ],
        "summary": "Logout all active sessions",
        "description": "Revokes all active refresh tokens and sessions for the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Logged out of all sessions successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/auth/me": {
      "get": {
        "tags": [
          "Authentication"
        ],
        "summary": "Get current user profile",
        "description": "Fetches the authenticated user profile information.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "User profile fetched successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/otp/send-verification": {
      "post": {
        "tags": [
          "OTP & Password Reset"
        ],
        "summary": "Send email verification OTP",
        "description": "Sends a 6-digit verification OTP to the user email.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Verification OTP sent to email"
          },
          "400": {
            "description": "Validation error"
          },
          "429": {
            "description": "Too many OTP requests"
          }
        }
      }
    },
    "/api/otp/verify-email": {
      "post": {
        "tags": [
          "OTP & Password Reset"
        ],
        "summary": "Verify email with OTP",
        "description": "Verifies user email and issues initial auth tokens.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "otp"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  },
                  "otp": {
                    "type": "string",
                    "example": "123456"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Email verified successfully and tokens returned"
          },
          "400": {
            "description": "Invalid or expired OTP"
          }
        }
      }
    },
    "/api/otp/forgot-password": {
      "post": {
        "tags": [
          "OTP & Password Reset"
        ],
        "summary": "Request password reset OTP",
        "description": "Dispatches password reset OTP to user email if the account exists.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "If account exists, password reset OTP sent"
          },
          "429": {
            "description": "Rate limit exceeded"
          }
        }
      }
    },
    "/api/otp/reset-password": {
      "post": {
        "tags": [
          "OTP & Password Reset"
        ],
        "summary": "Reset password with OTP",
        "description": "Resets account password using received OTP and revokes previous active sessions.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "otp",
                  "newPassword"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "user@example.com"
                  },
                  "otp": {
                    "type": "string",
                    "example": "123456"
                  },
                  "newPassword": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 72,
                    "example": "NewSecret123!"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Password reset successfully"
          },
          "400": {
            "description": "Invalid or expired OTP"
          }
        }
      }
    },
    "/api/users/search": {
      "get": {
        "tags": [
          "Users"
        ],
        "summary": "Search users",
        "description": "Searches users by name or email with rate limiting.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Search keyword"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Maximum users to return"
          }
        ],
        "responses": {
          "200": {
            "description": "Matching users list"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/users/onboarding": {
      "patch": {
        "tags": [
          "Users"
        ],
        "summary": "Complete onboarding profile",
        "description": "Updates onboarding profile attributes including role, useCase, bio, and interests.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "role": {
                    "type": "string",
                    "example": "SOFTWARE_ENGINEER"
                  },
                  "useCase": {
                    "type": "string",
                    "enum": [
                      "ORGANIZATION",
                      "FREELANCE",
                      "HIRE_COLLABORATE",
                      "COMMUNITY",
                      "WORK",
                      "PERSONAL",
                      "EDUCATION"
                    ],
                    "example": "COMMUNITY"
                  },
                  "bio": {
                    "type": "string",
                    "example": "Full stack engineer building real-time collaboration apps."
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://res.cloudinary.com/demo/image/upload/avatar.png"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Onboarding completed successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "List user conversations",
        "description": "Fetches all direct and group conversations for the user with last messages and unread counts.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Optional search filter"
          }
        ],
        "responses": {
          "200": {
            "description": "List of conversations"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Create or get direct 1-on-1 conversation",
        "description": "Initiates or resolves a direct message conversation between the caller and target user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "target-user-uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Direct conversation created or resolved"
          },
          "400": {
            "description": "Cannot message yourself or invalid target"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/direct": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Create or get direct conversation (alias)",
        "description": "Alias route for initiating or getting 1-on-1 direct conversations.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "target-user-uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Direct conversation resolved"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/search": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Search conversations",
        "description": "Searches user conversations by participant name or recent message content.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Search query"
          }
        ],
        "responses": {
          "200": {
            "description": "Matching conversations list"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/group": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Create a group conversation",
        "description": "Creates a new group conversation with a designated name and participant list. Creator is automatically assigned group admin.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "participantIds"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Product Launch Group"
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://example.com/avatar.png"
                  },
                  "participantIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "example": [
                      "uuid-user-1",
                      "uuid-user-2"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Group conversation created successfully"
          },
          "400": {
            "description": "Invalid group payload"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/{id}": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Get conversation details",
        "description": "Returns conversation metadata, participant profiles, and participant roles.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID or target user ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Conversation details"
          },
          "403": {
            "description": "Not a participant in this conversation"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Update group conversation",
        "description": "Updates group conversation name or avatar. Only group admins can update group metadata.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Group conversation ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Engineering Core Team"
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://example.com/new-avatar.png"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Group conversation updated successfully"
          },
          "403": {
            "description": "Forbidden: only group admins can update group"
          }
        }
      }
    },
    "/api/conversations/{id}/messages": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Get conversation messages (Cursor Pagination)",
        "description": "Retrieves chronological messages for the conversation with keyset cursor pagination on sequence number.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Message ID of the last item in previous page"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Number of messages to retrieve (1-50)"
          }
        ],
        "responses": {
          "200": {
            "description": "Messages list with nextCursor and hasNextPage"
          },
          "403": {
            "description": "Not a participant in this conversation"
          }
        }
      }
    },
    "/api/conversations/{id}/messages/{messageId}": {
      "patch": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Edit chat message",
        "description": "Edits the text content of a message sent by the authenticated user in a 1-to-1 or group chat. Broadcasts message:updated event.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID or recipient user ID"
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Message ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Updated message content"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Message updated successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Can only edit your own messages"
          },
          "404": {
            "description": "Message or conversation not found"
          }
        }
      },
      "delete": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Delete chat message",
        "description": "Deletes a message from a 1-to-1 or group conversation. Can be performed by the message sender or group admin. Broadcasts message:deleted event.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID or recipient user ID"
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Message ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Message deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden - no permission to delete this message"
          },
          "404": {
            "description": "Message or conversation not found"
          }
        }
      }
    },
    "/api/conversations/{id}/messages/{messageId}/reactions": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Toggle reaction on message",
        "description": "Toggles an emoji reaction on a message. If the user already reacted with this emoji, it is removed; otherwise, it is added. Broadcasts message:reaction_updated event.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID or recipient user ID"
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Message ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "emoji"
                ],
                "properties": {
                  "emoji": {
                    "type": "string",
                    "example": "👍"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Reaction toggled successfully"
          },
          "400": {
            "description": "Bad Request - invalid emoji or message is deleted"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Conversation or message not found"
          }
        }
      },
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Get reaction details and users breakdown for message (WhatsApp style)",
        "description": "Retrieves reaction summaries grouped by emoji with counts, requesting user reaction state, and user details (id, name, avatar) of who gave what reaction. Supports optional ?emoji filter.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID or recipient user ID"
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Message ID"
          },
          {
            "name": "emoji",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Filter reactions by specific emoji (e.g. 👍 or ❤️)"
          }
        ],
        "responses": {
          "200": {
            "description": "Reaction details fetched successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Conversation or message not found"
          }
        }
      }
    },
    "/api/conversations/{id}/search": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Search messages within a conversation",
        "description": "Performs case-insensitive text search on messages within a specific conversation.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID"
          },
          {
            "name": "q",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Search term"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Cursor message ID"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Matching messages list"
          },
          "403": {
            "description": "Not a participant"
          }
        }
      }
    },
    "/api/conversations/{id}/participants": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Add participants to group",
        "description": "Adds new participants to an existing group conversation. Requires group admin privileges.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Group conversation ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userIds"
                ],
                "properties": {
                  "userIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "example": [
                      "uuid-participant-1"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Participants added successfully"
          },
          "403": {
            "description": "Forbidden: only group admins can add participants"
          }
        }
      }
    },
    "/api/conversations/{id}/leave": {
      "delete": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Leave group conversation",
        "description": "Removes the authenticated user from the group. If the leaving user was the sole admin, admin privileges are reassigned.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Group conversation ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Left group successfully"
          },
          "403": {
            "description": "Not a participant in this group"
          }
        }
      },
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Leave group conversation (POST alias for DELETE /leave)",
        "description": "Leaves the group conversation. Automatically reassigns owner if the leaving user was the sole owner.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully left conversation"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      }
    },
    "/api/conversations/{id}/admins": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Promote participant to group admin",
        "description": "Promotes an existing participant to group admin role.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Group conversation ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "uuid-to-promote"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Participant promoted to admin successfully"
          },
          "403": {
            "description": "Only group admins can promote other members"
          }
        }
      }
    },
    "/api/conversations/{id}/admins/{userId}": {
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Promote participant to group admin (by path)",
        "description": "Promotes an existing participant to admin status within the group conversation.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "User UUID to promote"
          }
        ],
        "responses": {
          "200": {
            "description": "Participant promoted to admin"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Only group owners or admins can promote"
          },
          "404": {
            "description": "Conversation or participant not found"
          }
        }
      },
      "delete": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Dismiss group admin",
        "description": "Demotes a group admin back to standard member role.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Group conversation ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "User ID of admin to dismiss"
          }
        ],
        "responses": {
          "200": {
            "description": "Admin dismissed successfully"
          },
          "403": {
            "description": "Only group admins can dismiss admins"
          }
        }
      }
    },
    "/api/communities": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "List user joined communities",
        "description": "Fetches all communities the authenticated user is currently a member of.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of joined communities"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Create a new community",
        "description": "Creates a community space with name, description, category, and privacy setting.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "description"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Open Source AI Builders"
                  },
                  "description": {
                    "type": "string",
                    "example": "Collaborative hub for open source AI engineers."
                  },
                  "category": {
                    "type": "string",
                    "example": "Technology"
                  },
                  "isPrivate": {
                    "type": "boolean",
                    "default": false
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://example.com/comm-avatar.png"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Community created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/search": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Search public communities",
        "description": "Searches public communities by name or description with member counts and cursor pagination.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Search query"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Matching communities list"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/join-requests/my": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get user pending join requests",
        "description": "Returns all pending community join requests submitted by the authenticated user with community details.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of pending community join requests"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/feed": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get consolidated communities feed",
        "description": "Fetches aggregated recent posts from all communities the authenticated user has joined.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Consolidated feed posts"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/{id}": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get community details",
        "description": "Retrieves metadata, creator, member count, and caller membership status for a community.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Community details"
          },
          "404": {
            "description": "Community not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Communities"
        ],
        "summary": "Update community details",
        "description": "Updates community metadata. Requires OWNER or ADMIN role.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Updated Community Name"
                  },
                  "description": {
                    "type": "string",
                    "example": "Updated Description"
                  },
                  "avatar": {
                    "type": "string",
                    "example": "https://example.com/avatar.png"
                  },
                  "isPrivate": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Community updated successfully"
          },
          "403": {
            "description": "Forbidden: Insufficient community permissions"
          }
        }
      },
      "delete": {
        "tags": [
          "Communities"
        ],
        "summary": "Delete community",
        "description": "Permanently deletes a community. Only the community OWNER can perform this action.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Community deleted successfully"
          },
          "403": {
            "description": "Only community owner can delete community"
          }
        }
      }
    },
    "/api/communities/{id}/members": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get community members",
        "description": "Lists all active members of the community with their roles and join dates.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Members list"
          },
          "403": {
            "description": "Community is private and caller is not a member"
          }
        }
      }
    },
    "/api/communities/{id}/members/{userId}/role": {
      "patch": {
        "tags": [
          "Communities"
        ],
        "summary": "Change community member role",
        "description": "Changes a member role to ADMIN or MEMBER. Only the OWNER can modify member roles.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "User ID of target member"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "ADMIN",
                      "MEMBER"
                    ],
                    "example": "ADMIN"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Member role updated successfully"
          },
          "403": {
            "description": "Only owner can change member roles"
          }
        }
      }
    },
    "/api/communities/{id}/members/{userId}": {
      "delete": {
        "tags": [
          "Communities"
        ],
        "summary": "Remove member from community",
        "description": "Removes or kicks a member from the community. Allowed for OWNER and ADMIN.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "User ID to remove"
          }
        ],
        "responses": {
          "200": {
            "description": "Member removed successfully"
          },
          "403": {
            "description": "Insufficient permissions"
          }
        }
      }
    },
    "/api/communities/{id}/leave": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Leave community",
        "description": "Leaves the specified community. The OWNER must transfer ownership before leaving.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Left community successfully"
          },
          "400": {
            "description": "Owner must transfer ownership before leaving"
          }
        }
      }
    },
    "/api/communities/{id}/transfer-ownership": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Transfer community ownership",
        "description": "Transfers community OWNER status to another existing member.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "newOwnerId"
                ],
                "properties": {
                  "newOwnerId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "uuid-target-new-owner"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Ownership transferred successfully"
          },
          "403": {
            "description": "Only current owner can transfer ownership"
          }
        }
      }
    },
    "/api/communities/{id}/invites": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Create invite link",
        "description": "Generates an invite token/link with optional expiration and max uses.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "expiresInHours": {
                    "type": "integer",
                    "default": 168
                  },
                  "maxUses": {
                    "type": "integer",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Invite link created successfully"
          },
          "403": {
            "description": "Only owner and admins can generate invites"
          }
        }
      }
    },
    "/api/communities/{id}/invites/{inviteId}": {
      "delete": {
        "tags": [
          "Communities"
        ],
        "summary": "Revoke invite link",
        "description": "Revokes an active community invite link.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "inviteId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Invite link revoked successfully"
          }
        }
      }
    },
    "/api/communities/invites/{token}": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Validate invite token preview",
        "description": "Public endpoint to check if an invite link is valid and fetch preview metadata.",
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite token"
          }
        ],
        "responses": {
          "200": {
            "description": "Invite token is valid, returns community preview"
          },
          "404": {
            "description": "Invalid, expired, or depleted invite token"
          }
        }
      }
    },
    "/api/communities/invites/{token}/join": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Join community via invite token",
        "description": "Adds the authenticated user to the community using a valid invite link.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite token"
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully joined community"
          },
          "400": {
            "description": "Already a member"
          },
          "404": {
            "description": "Invalid or expired invite token"
          }
        }
      }
    },
    "/api/communities/{id}/join-requests": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "List community join requests (Admin only)",
        "description": "Allows community OWNER or ADMIN to view join requests. Can be filtered by status (PENDING, ACCEPTED, REJECTED, CANCELLED).",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community ID"
          },
          {
            "name": "status",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "PENDING",
                "ACCEPTED",
                "REJECTED",
                "CANCELLED"
              ],
              "default": "PENDING"
            },
            "description": "Filter by join request status"
          }
        ],
        "responses": {
          "200": {
            "description": "List of join requests"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden - Only OWNER or ADMIN can view join requests"
          },
          "404": {
            "description": "Community not found"
          }
        }
      },
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Send community join request",
        "description": "Sends a join request to community admins. If the community is open/public and auto-join is configured or user is already a member/pending, appropriate status is returned.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "message": {
                    "type": "string",
                    "maxLength": 500,
                    "example": "Hi! I would love to join and collaborate on AI projects."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Join request submitted successfully"
          },
          "400": {
            "description": "Already a member or join request already pending"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Community not found"
          }
        }
      },
      "delete": {
        "tags": [
          "Communities"
        ],
        "summary": "Cancel pending join request",
        "description": "Cancels a pending join request that the authenticated user previously sent to this community.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Join request cancelled successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "No pending join request found"
          }
        }
      }
    },
    "/api/communities/{id}/join-requests/{requestId}/accept": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Accept community join request (Admin only)",
        "description": "Accepts a pending join request, adding the applicant as a MEMBER and notifying them in real time.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community ID"
          },
          {
            "name": "requestId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Join Request ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Join request accepted and member added"
          },
          "400": {
            "description": "Request is not pending"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden - Only OWNER or ADMIN can accept join requests"
          },
          "404": {
            "description": "Community or request not found"
          }
        }
      }
    },
    "/api/communities/{id}/join-requests/{requestId}/reject": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Reject community join request (Admin only)",
        "description": "Rejects a pending join request with an optional reason, and notifies the applicant.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community ID"
          },
          {
            "name": "requestId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Join Request ID"
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "reason": {
                    "type": "string",
                    "maxLength": 500,
                    "example": "Community requirements not met."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Join request rejected"
          },
          "400": {
            "description": "Request is not pending"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden - Only OWNER or ADMIN can reject join requests"
          },
          "404": {
            "description": "Community or request not found"
          }
        }
      }
    },
    "/api/communities/{id}/posts": {
      "get": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Get posts in community",
        "description": "Retrieves chronological posts with attachments, comments count, and cursor pagination.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Community posts list"
          },
          "403": {
            "description": "Access denied: Must be a community member"
          }
        }
      },
      "post": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Create post in community",
        "description": "Creates a new post with optional file attachment, image, or video.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Hello world from our community!"
                  },
                  "fileUrl": {
                    "type": "string",
                    "nullable": true,
                    "example": "https://bucket.s3.amazonaws.com/post.pdf"
                  },
                  "fileType": {
                    "type": "string",
                    "nullable": true,
                    "example": "pdf"
                  },
                  "fileName": {
                    "type": "string",
                    "nullable": true,
                    "example": "post.pdf"
                  },
                  "fileSize": {
                    "type": "integer",
                    "nullable": true,
                    "example": 1048576
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Post created successfully"
          },
          "403": {
            "description": "Must be a member of the community to post"
          }
        }
      }
    },
    "/api/posts/feed": {
      "get": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Get post feed",
        "description": "Aggregates posts across user communities for the main application feed.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Feed posts list"
          }
        }
      }
    },
    "/api/posts/{postId}": {
      "patch": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Update post",
        "description": "Updates content or attachments of an existing post. Caller must be post author or community admin.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Post ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Updated post content"
                  },
                  "fileUrl": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Post updated successfully"
          },
          "403": {
            "description": "Forbidden: Cannot edit another user post"
          }
        }
      },
      "delete": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Delete post",
        "description": "Deletes a post and cascades all attached comments.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Post ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Post deleted successfully"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/posts/{postId}/comments": {
      "get": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Get post comments",
        "description": "Retrieves all threaded comments for a community post.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Post ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Comments list"
          }
        }
      },
      "post": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Add comment to post",
        "description": "Adds a new comment or reply to a post.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Post ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Great update! Looking forward to this."
                  },
                  "parentId": {
                    "type": "string",
                    "nullable": true,
                    "example": "parent-comment-uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Comment created successfully"
          }
        }
      }
    },
    "/api/comments/{commentId}": {
      "patch": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Update comment",
        "description": "Edits comment content. Caller must be the comment author.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "commentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Comment ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Updated comment text"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Comment updated successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "Community Posts & Comments"
        ],
        "summary": "Delete comment",
        "description": "Deletes a comment.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "commentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Comment ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Comment deleted successfully"
          }
        }
      }
    },
    "/api/organizations": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "List user organizations",
        "description": "Fetches all organizations the caller belongs to with member roles and teams.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of organizations"
          }
        }
      },
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Create organization",
        "description": "Creates a new enterprise organization workspace. Caller becomes ORG_ADMIN.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Acme Corporation"
                  },
                  "description": {
                    "type": "string",
                    "example": "Engineering & Design Organization"
                  },
                  "logo": {
                    "type": "string",
                    "example": "https://example.com/logo.png"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Organization created successfully"
          }
        }
      }
    },
    "/api/organizations/{id}": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Get organization details",
        "description": "Retrieves organization details, members, and teams. Requires membership.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Organization details"
          },
          "403": {
            "description": "Must be an organization member"
          }
        }
      },
      "patch": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Update organization",
        "description": "Updates organization metadata. Requires ORG_ADMIN role.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Acme Global Inc"
                  },
                  "description": {
                    "type": "string",
                    "example": "Updated description"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Organization updated successfully"
          },
          "403": {
            "description": "Requires ORG_ADMIN role"
          }
        }
      }
    },
    "/api/organizations/{id}/members": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "List organization members",
        "description": "Lists all members with roles (ORG_ADMIN, TEAM_HEAD, MEMBER).",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Members list"
          }
        }
      }
    },
    "/api/organizations/{id}/members/{userId}": {
      "patch": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Update organization member role",
        "description": "Changes a member role in the organization. Requires ORG_ADMIN.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Member user ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "ORG_ADMIN",
                      "TEAM_HEAD",
                      "MEMBER"
                    ],
                    "example": "TEAM_HEAD"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Member role updated successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Remove organization member",
        "description": "Removes a user from the organization. Requires ORG_ADMIN.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Member user ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Member removed successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/leave": {
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Leave organization",
        "description": "Leaves the organization. Last ORG_ADMIN cannot leave without reassigning admin.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Left organization successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/invites": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "List organization invites",
        "description": "Lists pending and active invite tokens for the organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Invites list"
          }
        }
      },
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Create organization invite",
        "description": "Generates an invite token/link for an email address.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "role"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "colleague@example.com"
                  },
                  "role": {
                    "type": "string",
                    "enum": [
                      "ORG_ADMIN",
                      "TEAM_HEAD",
                      "MEMBER"
                    ],
                    "default": "MEMBER"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Invite created successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/invites/{inviteId}": {
      "delete": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Revoke organization invite",
        "description": "Revokes a pending organization invitation.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "inviteId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Invite revoked successfully"
          }
        }
      }
    },
    "/api/organizations/join/{token}": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Preview organization invite",
        "description": "Public endpoint to view organization name and invitation details before joining.",
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite token"
          }
        ],
        "responses": {
          "200": {
            "description": "Invite preview"
          },
          "404": {
            "description": "Invalid or expired invite"
          }
        }
      },
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Accept organization invite",
        "description": "Accepts the invitation and adds authenticated user to the organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invite token"
          }
        ],
        "responses": {
          "200": {
            "description": "Joined organization successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/teams": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "List organization teams",
        "description": "Fetches all teams inside the organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Teams list"
          }
        }
      },
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Create team in organization",
        "description": "Creates a team within the organization. Requires ORG_ADMIN or TEAM_HEAD.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Frontend Platform"
                  },
                  "description": {
                    "type": "string",
                    "example": "Responsible for Web and Mobile UI"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Team created successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Get team details",
        "description": "Retrieves team information, member roster, and head.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Team details"
          }
        }
      },
      "patch": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Update team",
        "description": "Updates team name or description. Requires ORG_ADMIN or TEAM_HEAD.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Platform Infrastructure"
                  },
                  "description": {
                    "type": "string",
                    "example": "Core backend and reliability team"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Team updated successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Delete team",
        "description": "Deletes a team within the organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Team deleted successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/members": {
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Add team member",
        "description": "Adds an organization member to a specific team.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "uuid-org-member"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Member added to team successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/members/{userId}": {
      "delete": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Remove team member",
        "description": "Removes a member from a team.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Member user ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Member removed from team successfully"
          }
        }
      }
    },
    "/api/meetings": {
      "post": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Create a meeting room",
        "description": "Creates a new meeting room with unique code and optional waiting room protection.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Sprint Planning Sync"
                  },
                  "waitingRoom": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Meeting room created with meeting code"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/meetings/{code}": {
      "get": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Get meeting room details",
        "description": "Retrieves meeting title, host information, status, and waiting room configuration by meeting code.",
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code (e.g. tkp-hue-bhw)"
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting details"
          },
          "404": {
            "description": "Meeting not found"
          }
        }
      }
    },
    "/api/meetings/{code}/end": {
      "post": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "End active meeting room",
        "description": "Terminates an active meeting for all participants. Caller must be the meeting host.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code"
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting ended successfully"
          },
          "403": {
            "description": "Only host can end meeting"
          }
        }
      }
    },
    "/api/meetings/{code}/polls": {
      "get": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Get live meeting polls",
        "description": "Retrieves all active and closed polls in the meeting room with real-time vote tallies and option voters.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code"
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting polls fetched successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Meeting not found"
          }
        }
      },
      "post": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Create live meeting poll",
        "description": "Creates and broadcasts a new live poll in an active video meeting room. Broadcasts meeting:poll-created event.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "question",
                  "options"
                ],
                "properties": {
                  "question": {
                    "type": "string",
                    "example": "Should we extend the sprint deadline?"
                  },
                  "options": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "example": [
                      "Yes, extend",
                      "No, keep deadline"
                    ]
                  },
                  "allowMultipleAnswers": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Meeting poll created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Meeting not found"
          }
        }
      }
    },
    "/api/meetings/{code}/polls/{pollId}/vote": {
      "post": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Vote on live meeting poll",
        "description": "Casts or toggles a vote on a meeting poll. Broadcasts meeting:poll-updated event with updated tallies to all participants in the meeting room.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code"
          },
          {
            "name": "pollId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting poll ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "optionIds"
                ],
                "properties": {
                  "optionIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "example": [
                      "opt-uuid-1"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Vote recorded successfully"
          },
          "400": {
            "description": "Poll is closed or invalid options"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Meeting or poll not found"
          }
        }
      }
    },
    "/api/meetings/{code}/polls/{pollId}/close": {
      "patch": {
        "tags": [
          "Meetings & Video Calls"
        ],
        "summary": "Close live meeting poll",
        "description": "Closes an active meeting poll to prevent further voting. Broadcasts meeting:poll-closed event. Only the meeting host or poll creator can close the poll.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting code"
          },
          {
            "name": "pollId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting poll ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting poll closed successfully"
          },
          "403": {
            "description": "Only meeting host or poll creator can close the poll"
          },
          "404": {
            "description": "Meeting or poll not found"
          }
        }
      }
    },
    "/api/uploads/sign": {
      "post": {
        "tags": [
          "Media & Uploads"
        ],
        "summary": "Generate signed upload signature (Cloudinary)",
        "description": "Generates a secure timestamped signature for uploading media files directly to Cloudinary.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "folder": {
                    "type": "string",
                    "example": "avatars"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Upload signature generated successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/uploads/s3": {
      "post": {
        "tags": [
          "Media & Uploads"
        ],
        "summary": "Direct multipart file upload to AWS S3",
        "description": "Uploads images, videos, audio, or documents directly to AWS S3 with mime validation and size limits (100MB max).",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "file"
                ],
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary",
                    "description": "Binary file payload"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "File uploaded successfully, returns permanent S3 URL and metadata"
          },
          "400": {
            "description": "Invalid file or file too large"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/devices": {
      "post": {
        "tags": [
          "Device Tokens"
        ],
        "summary": "Register FCM device token",
        "description": "Associates a Firebase Cloud Messaging device registration token with the authenticated user for push notifications.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "token"
                ],
                "properties": {
                  "token": {
                    "type": "string",
                    "example": "fcm-registration-token-123"
                  },
                  "platform": {
                    "type": "string",
                    "enum": [
                      "android",
                      "ios",
                      "web"
                    ],
                    "default": "android"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Device token registered successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "delete": {
        "tags": [
          "Device Tokens"
        ],
        "summary": "Unregister FCM device token",
        "description": "Removes a device token on logout or app uninstall so push notifications cease.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "token"
                ],
                "properties": {
                  "token": {
                    "type": "string",
                    "example": "fcm-registration-token-123"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Device token unregistered successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/users": {
      "get": {
        "tags": [
          "Users"
        ],
        "summary": "Search and list users (alias for /search)",
        "description": "Searches for registered platform users matching username, full name, or email with rate limiting.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Search query for name, username, or email"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Maximum users to return"
          }
        ],
        "responses": {
          "200": {
            "description": "Matching users list"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/{id}/users/search": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Search users eligible to invite to community",
        "description": "Finds platform users that are not already active members of this community.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community UUID"
          },
          {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Search query filter"
          }
        ],
        "responses": {
          "200": {
            "description": "List of invitable users"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Community not found"
          }
        }
      }
    },
    "/api/communities/{id}/feed": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get community feed posts (alias for /posts)",
        "description": "Returns feed posts for the specified community with cursor-based pagination.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Community UUID"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Cursor ID of the last post received"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Maximum posts to return"
          }
        ],
        "responses": {
          "200": {
            "description": "List of community posts"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Community not found"
          }
        }
      }
    },
    "/api/posts": {
      "get": {
        "tags": [
          "Community Posts"
        ],
        "summary": "Get global community feed (alias for /feed)",
        "description": "Returns consolidated post feed across public communities and member feeds.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Cursor for pagination"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Number of posts to return"
          }
        ],
        "responses": {
          "200": {
            "description": "Paginated community feed posts"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/dm": {
      "post": {
        "tags": [
          "Direct Messaging"
        ],
        "summary": "Initiate or retrieve 1:1 direct conversation (root alias)",
        "description": "Finds an existing direct conversation or establishes a new one between caller and recipient.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "recipientId"
                ],
                "properties": {
                  "recipientId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "d3b07384-d113-4607-bb89-53609804b407"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Existing conversation returned"
          },
          "201": {
            "description": "New conversation created"
          },
          "400": {
            "description": "Invalid recipient ID or cannot DM self"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/dm": {
      "post": {
        "tags": [
          "Direct Messaging"
        ],
        "summary": "Initiate or retrieve 1:1 direct conversation (conversations alias)",
        "description": "Alias for /api/conversations/direct.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "recipientId"
                ],
                "properties": {
                  "recipientId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "d3b07384-d113-4607-bb89-53609804b407"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Conversation retrieved"
          },
          "201": {
            "description": "Conversation established"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/{id}/members": {
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Add participants to group conversation (alias for /participants)",
        "description": "Adds one or more user IDs to the group conversation.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userIds"
                ],
                "properties": {
                  "userIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "example": [
                      "d3b07384-d113-4607-bb89-53609804b407"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Members added successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden - only group admins can add members"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      }
    },
    "/api/conversations/{id}/make-admin": {
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Promote participant to group admin (by body)",
        "description": "Alternative endpoint to promote a member to group admin by providing userId in request body.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "d3b07384-d113-4607-bb89-53609804b407"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Participant promoted to admin"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      }
    },
    "/api/conversations/{id}/participants/{userId}/make-admin": {
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Promote participant to group admin (RESTful path alias)",
        "description": "Promotes participant to group admin.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "User UUID"
          }
        ],
        "responses": {
          "200": {
            "description": "Participant promoted to admin"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/conversations/{id}/remove-admin": {
      "post": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Demote group admin to standard participant (by body)",
        "description": "Demotes an admin to normal participant status by providing userId in request body.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId"
                ],
                "properties": {
                  "userId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "d3b07384-d113-4607-bb89-53609804b407"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Admin demoted to participant"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/conversations/{id}/participants/{userId}": {
      "delete": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Remove participant from group conversation",
        "description": "Removes a participant from the group conversation. Only group admins or owners can remove participants.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "User UUID to remove"
          }
        ],
        "responses": {
          "200": {
            "description": "Participant removed successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Participant or conversation not found"
          }
        }
      }
    },
    "/api/conversations/{id}/members/{userId}": {
      "delete": {
        "tags": [
          "Group Conversations"
        ],
        "summary": "Remove member from group conversation (alias for /participants/{userId})",
        "description": "Removes a member from the group conversation.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Conversation UUID"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "User UUID to remove"
          }
        ],
        "responses": {
          "200": {
            "description": "Member removed successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/ai/upload": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Upload file or request presigned URL for AI analysis",
        "description": "Uploads a document/image directly or generates an S3 presigned upload URL specifically for sharing files with Quorum AI.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary",
                    "description": "Direct file to upload (image, PDF, spreadsheet, document, or code file up to 25MB)"
                  }
                }
              }
            },
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "fileName": {
                    "type": "string",
                    "example": "quarterly_budget.xlsx"
                  },
                  "fileSize": {
                    "type": "integer",
                    "example": 204800
                  },
                  "mimeType": {
                    "type": "string",
                    "example": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Presigned upload URL generated"
          },
          "201": {
            "description": "File uploaded directly to S3"
          },
          "401": {
            "description": "Unauthorized"
          },
          "429": {
            "description": "Too many requests"
          }
        }
      }
    },
    "/api/ai/chat": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Conversational AI question-answering assistant with file sharing",
        "description": "Provides intelligent answers, analyzes attached files (images, PDFs, documents, text files), and synthesizes workspace context.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "prompt": {
                    "type": "string",
                    "example": "Please summarize the key takeaways from the attached financial report."
                  },
                  "context": {
                    "type": "string",
                    "example": "Optional workspace context string"
                  },
                  "fileUrl": {
                    "type": "string",
                    "example": "https://bucket.s3.amazonaws.com/uploads/ai/report.pdf",
                    "description": "S3 or public URL of an attached document or image to analyze"
                  },
                  "fileName": {
                    "type": "string",
                    "example": "report.pdf"
                  },
                  "fileType": {
                    "type": "string",
                    "example": "application/pdf"
                  },
                  "attachments": {
                    "type": "array",
                    "description": "Array of multiple attached files for multimodal AI analysis",
                    "items": {
                      "type": "object",
                      "properties": {
                        "fileUrl": {
                          "type": "string"
                        },
                        "fileName": {
                          "type": "string"
                        },
                        "mimeType": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            },
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary",
                    "description": "Attached image, PDF, or text file to analyze"
                  },
                  "prompt": {
                    "type": "string",
                    "example": "Explain what this diagram shows"
                  },
                  "context": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "AI generated answer with token metadata"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "429": {
            "description": "Too Many Requests"
          },
          "503": {
            "description": "AI service unavailable"
          }
        }
      }
    },
    "/api/ai/search": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Workspace unified multi-entity AI search",
        "description": "Searches direct messages, community posts, file attachments, and meetings with grounded citations and TF-IDF ranking.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "query"
                ],
                "properties": {
                  "query": {
                    "type": "string",
                    "example": "Q4 design sprint deadlines"
                  },
                  "limit": {
                    "type": "integer",
                    "default": 15,
                    "minimum": 1,
                    "maximum": 50
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Synthesized answer with ranked source evidence citations"
          },
          "401": {
            "description": "Unauthorized"
          },
          "429": {
            "description": "Rate limit exceeded"
          }
        }
      }
    },
    "/api/ai/summarize": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Summarize conversation chat history",
        "description": "Generates structured summary with key decisions, action items, and participants for an authorized conversation.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "conversationId"
                ],
                "properties": {
                  "conversationId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "c4b9d031-18e4-4d45-933e-b490f2302821"
                  },
                  "limit": {
                    "type": "integer",
                    "default": 50,
                    "minimum": 1,
                    "maximum": 200
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Executive summary with action items"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Not a participant of this conversation"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      }
    },
    "/api/ai/assist": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Project & workspace contextual assistance",
        "description": "Answers inquiries scoped to an authorized organization, team, or community.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "prompt"
                ],
                "properties": {
                  "prompt": {
                    "type": "string",
                    "example": "Give me a high-level breakdown of our current team structure."
                  },
                  "organizationId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "teamId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "communityId": {
                    "type": "string",
                    "format": "uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Contextual project assistance answer"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "User does not belong to specified project or workspace"
          }
        }
      }
    },
    "/api/ai/quick-replies": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Context-aware quick replies & message tone rewrites",
        "description": "Generates smart response suggestions, proactive follow-ups, or professional rewrites with review-first disclaimers.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "mode": {
                    "type": "string",
                    "enum": [
                      "replies",
                      "follow_up",
                      "rewrite"
                    ],
                    "default": "replies"
                  },
                  "tone": {
                    "type": "string",
                    "enum": [
                      "professional",
                      "casual",
                      "friendly",
                      "concise",
                      "enthusiastic"
                    ],
                    "default": "professional"
                  },
                  "message": {
                    "type": "string",
                    "example": "Hey team, could everyone submit their sprint status reports by 3 PM?"
                  },
                  "conversationId": {
                    "type": "string",
                    "format": "uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Suggestions list with review disclaimer"
          },
          "400": {
            "description": "Either message or conversationId must be provided"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/ai/project-update": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Project status update (verified facts vs recommendations)",
        "description": "Generates structured status reports distinguishing verified historical facts from AI recommendations.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "timeframe": {
                    "type": "string",
                    "enum": [
                      "today",
                      "yesterday",
                      "last_7_days",
                      "last_30_days",
                      "last_90_days"
                    ],
                    "default": "last_7_days"
                  },
                  "organizationId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "teamId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "communityId": {
                    "type": "string",
                    "format": "uuid"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Structured project status update"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/ai/history": {
      "get": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Get paginated AI interaction history",
        "description": "Retrieves past prompts and answers for the authenticated user with cursor-based pagination.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20,
              "minimum": 1,
              "maximum": 50
            },
            "description": "Number of interactions to return"
          },
          {
            "name": "cursor",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "ID of the last item from previous page"
          },
          {
            "name": "actionType",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "chat",
                "search",
                "project_assistance",
                "quick_replies",
                "project_update"
              ]
            },
            "description": "Filter by action type"
          },
          {
            "name": "conversationId",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Filter by conversation UUID"
          }
        ],
        "responses": {
          "200": {
            "description": "Paginated interactions list with nextCursor"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "delete": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Clear all AI interaction history",
        "description": "Purges all interaction history records belonging to the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "All AI history deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/ai/history/{id}": {
      "delete": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Delete single AI interaction record",
        "description": "Deletes a specific interaction record by its UUID.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "description": "Interaction record UUID"
          }
        ],
        "responses": {
          "200": {
            "description": "Interaction deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Interaction not found or does not belong to user"
          }
        }
      }
    },
    "/api/saved-items": {
      "post": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Save an item (Bookmark)",
        "description": "Saves a message, file, chat conversation, document, or resource. Idempotent upsert.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "itemType",
                  "itemId"
                ],
                "properties": {
                  "itemType": {
                    "type": "string",
                    "enum": [
                      "MESSAGE",
                      "FILE",
                      "CHAT",
                      "DOCUMENT",
                      "RESOURCE"
                    ]
                  },
                  "itemId": {
                    "type": "string"
                  },
                  "note": {
                    "type": "string",
                    "nullable": true
                  },
                  "collectionId": {
                    "type": "string",
                    "format": "uuid",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Item saved successfully"
          },
          "400": {
            "description": "Invalid item or missing attachment"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Item not found or inaccessible"
          }
        }
      },
      "get": {
        "tags": [
          "Saved Items"
        ],
        "summary": "List saved items",
        "description": "Retrieves cursor-paginated saved items enriched with original metadata.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "itemType",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "MESSAGE",
                "FILE",
                "CHAT",
                "DOCUMENT",
                "RESOURCE"
              ]
            }
          },
          {
            "name": "collectionId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of saved items. Items whose underlying content was deleted or access revoked have isAccessible: false and content: null.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "items": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "itemType": {
                                "type": "string",
                                "enum": [
                                  "MESSAGE",
                                  "FILE",
                                  "CHAT",
                                  "DOCUMENT",
                                  "RESOURCE"
                                ]
                              },
                              "itemId": {
                                "type": "string"
                              },
                              "note": {
                                "type": "string",
                                "nullable": true
                              },
                              "isAccessible": {
                                "type": "boolean",
                                "example": true
                              },
                              "title": {
                                "type": "string",
                                "example": "Important message"
                              },
                              "content": {
                                "type": "object",
                                "nullable": true
                              },
                              "collection": {
                                "type": "object",
                                "nullable": true,
                                "properties": {
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  },
                                  "name": {
                                    "type": "string"
                                  },
                                  "color": {
                                    "type": "string",
                                    "nullable": true
                                  }
                                }
                              },
                              "createdAt": {
                                "type": "string",
                                "format": "date-time"
                              },
                              "updatedAt": {
                                "type": "string",
                                "format": "date-time"
                              }
                            }
                          }
                        },
                        "nextCursor": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "hasNextPage": {
                          "type": "boolean"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/saved-items/{id}": {
      "patch": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Update saved item",
        "description": "Updates note or collection assignment of a saved item.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "note": {
                    "type": "string",
                    "nullable": true
                  },
                  "collectionId": {
                    "type": "string",
                    "format": "uuid",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Saved item updated"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Saved item not found"
          }
        }
      },
      "delete": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Remove saved item",
        "description": "Deletes a saved item bookmark.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Saved item removed"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Saved item not found"
          }
        }
      }
    },
    "/api/saved-items/collections": {
      "post": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Create collection",
        "description": "Creates a new personal saved collection/folder.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string",
                    "nullable": true
                  },
                  "color": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Collection created"
          },
          "401": {
            "description": "Unauthorized"
          },
          "409": {
            "description": "Collection name conflict"
          }
        }
      },
      "get": {
        "tags": [
          "Saved Items"
        ],
        "summary": "List collections",
        "description": "Retrieves all personal collections for the user with item counts.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of collections"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/saved-items/collections/{id}": {
      "patch": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Update collection",
        "description": "Updates collection name, description, or color.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string",
                    "nullable": true
                  },
                  "color": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Collection updated"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Collection not found"
          },
          "409": {
            "description": "Collection name conflict"
          }
        }
      },
      "delete": {
        "tags": [
          "Saved Items"
        ],
        "summary": "Delete collection",
        "description": "Deletes a collection. Its saved items remain intact without collection.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Collection deleted"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Collection not found"
          }
        }
      }
    },
    "/api/notifications": {
      "get": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Get notifications",
        "description": "Retrieves paginated notifications for the current user, optionally filtered by read/unread state.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            },
            "description": "Page number"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Items per page"
          },
          {
            "name": "unreadOnly",
            "in": "query",
            "schema": {
              "type": "boolean",
              "default": false
            },
            "description": "Filter by unread notifications only"
          }
        ],
        "responses": {
          "200": {
            "description": "Paginated notifications list"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/notifications/unread-count": {
      "get": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Get unread notification count",
        "description": "Returns the number of unread notifications for badge counters.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Unread count object",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "unreadCount": {
                      "type": "integer",
                      "example": 3
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/notifications/read-all": {
      "patch": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Mark all notifications as read",
        "description": "Marks all active unread notifications as read for the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "All notifications marked as read"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/notifications/{id}/read": {
      "patch": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Mark single notification as read",
        "description": "Marks a specific notification as read by ID.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Notification ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Notification marked as read"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Notification not found"
          }
        }
      }
    },
    "/api/notifications/{id}": {
      "delete": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Delete notification",
        "description": "Deletes a notification from user history.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Notification ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Notification deleted"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Notification not found"
          }
        }
      }
    },
    "/api/notifications/preferences": {
      "get": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Get notification preferences",
        "description": "Retrieves user preferences for email digests, push notifications, and in-app alerts.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "User notification preferences"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "put": {
        "tags": [
          "Notifications & Devices"
        ],
        "summary": "Update notification preferences",
        "description": "Updates channel delivery preferences for notifications.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "emailNotifications": {
                    "type": "boolean"
                  },
                  "pushNotifications": {
                    "type": "boolean"
                  },
                  "inAppNotifications": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Preferences updated"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/invitations/pending": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get pending invitations for user",
        "description": "Fetches all pending community invitations addressed to the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of pending community invitations"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/communities/join/{token}": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Preview community invite by token",
        "description": "Retrieves public metadata and inviter details for a community invite token without requiring authentication.",
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invitation token"
          }
        ],
        "responses": {
          "200": {
            "description": "Community invite preview details"
          },
          "400": {
            "description": "Invalid or expired token"
          },
          "404": {
            "description": "Invite not found"
          }
        }
      },
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Accept and join community via token",
        "description": "Accepts a pending community invitation token and joins the authenticated user as a member.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Invitation token"
          }
        ],
        "responses": {
          "200": {
            "description": "Successfully joined community"
          },
          "400": {
            "description": "Invalid token or expired"
          },
          "401": {
            "description": "Unauthorized"
          },
          "409": {
            "description": "Already a member"
          }
        }
      }
    },
    "/api/communities/{id}/invitable-users": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "List invitable users for community",
        "description": "Searches and lists platform users who are not yet members of this community to invite them.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Search query for name or email"
          },
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of eligible invitable users"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Requires admin privileges"
          }
        }
      }
    },
    "/api/communities/{id}/channels": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "List community channels",
        "description": "Retrieves all discussion channels within a community.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "responses": {
          "200": {
            "description": "List of community channels"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Community not found"
          }
        }
      },
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Create community channel",
        "description": "Creates a new topic or discussion channel within a community. Requires ADMIN or OWNER.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "announcements"
                  },
                  "description": {
                    "type": "string",
                    "example": "Official announcements and updates"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Channel created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/communities/{id}/channels/{channelId}": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Get channel details",
        "description": "Retrieves specific community channel information.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Channel ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Channel details"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Channel not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Communities"
        ],
        "summary": "Update community channel",
        "description": "Modifies a channel name or description. Requires ADMIN or OWNER.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Channel ID"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Channel updated successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      },
      "delete": {
        "tags": [
          "Communities"
        ],
        "summary": "Delete community channel",
        "description": "Deletes a community channel and all associated posts. Requires ADMIN or OWNER.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Channel ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Channel deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          }
        }
      }
    },
    "/api/communities/{id}/channels/{channelId}/posts": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "List posts in channel",
        "description": "Retrieves paginated feed of posts within a designated community channel.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Channel ID"
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Cursor for pagination"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 10
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of posts in channel"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Create post in channel",
        "description": "Publishes a new post inside the specified channel.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Community ID"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Channel ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "content": {
                    "type": "string"
                  },
                  "mediaUrls": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Post published successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/conversations/unread-count": {
      "get": {
        "tags": [
          "Direct & Group Conversations"
        ],
        "summary": "Get aggregate unread message count",
        "description": "Calculates total unread messages across all 1-on-1 direct messages and group conversations.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Unread conversations message count",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "unreadCount": {
                      "type": "integer",
                      "example": 7
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/calendar": {
      "post": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Create calendar event",
        "description": "Creates a scheduled calendar event, reminder, meeting, or deadline with optional BullMQ automated email reminders.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title",
                  "startDate"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Product Architecture Review"
                  },
                  "description": {
                    "type": "string",
                    "example": "Quarterly system scalability and architecture discussion"
                  },
                  "eventType": {
                    "type": "string",
                    "enum": [
                      "REMINDER",
                      "MEETING",
                      "DEADLINE",
                      "GENERAL"
                    ],
                    "default": "REMINDER"
                  },
                  "startDate": {
                    "type": "string",
                    "format": "date-time",
                    "example": "2026-10-30T10:00:00Z"
                  },
                  "endDate": {
                    "type": "string",
                    "format": "date-time",
                    "example": "2026-10-30T11:00:00Z"
                  },
                  "isAllDay": {
                    "type": "boolean",
                    "default": false
                  },
                  "meetingLink": {
                    "type": "string",
                    "example": "https://quorum.me/call/arch-rev-101"
                  },
                  "attendeeEmails": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "email"
                    }
                  },
                  "hasReminder": {
                    "type": "boolean",
                    "default": true
                  },
                  "reminderMinutes": {
                    "type": "integer",
                    "default": 15,
                    "description": "Minutes before event to dispatch reminder"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Calendar event created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/calendar/month": {
      "get": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Get calendar events by month",
        "description": "Retrieves all events occurring within the requested month and year.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "year",
            "in": "query",
            "required": true,
            "schema": {
              "type": "integer",
              "example": 2026
            }
          },
          {
            "name": "month",
            "in": "query",
            "required": true,
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12,
              "example": 10
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Month events array"
          },
          "400": {
            "description": "Invalid query parameters"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/calendar/date": {
      "get": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Get calendar events by specific date",
        "description": "Retrieves events scheduled for a single date.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "date",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "example": "2026-10-30"
            },
            "description": "Format: YYYY-MM-DD"
          }
        ],
        "responses": {
          "200": {
            "description": "Date events array"
          },
          "400": {
            "description": "Invalid date format"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/calendar/upcoming": {
      "get": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Get upcoming calendar events",
        "description": "Retrieves upcoming scheduled events sorted chronologically.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Upcoming events array"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/calendar/{id}": {
      "get": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Get calendar event details",
        "description": "Retrieves specific calendar event details by ID.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Calendar event ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Event details"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Event not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Update calendar event",
        "description": "Modifies calendar event fields and dynamically reschedules reminder jobs in BullMQ.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Calendar event ID"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  },
                  "eventType": {
                    "type": "string",
                    "enum": [
                      "REMINDER",
                      "MEETING",
                      "DEADLINE",
                      "GENERAL"
                    ]
                  },
                  "startDate": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "endDate": {
                    "type": "string",
                    "format": "date-time",
                    "nullable": true
                  },
                  "isAllDay": {
                    "type": "boolean"
                  },
                  "meetingLink": {
                    "type": "string"
                  },
                  "attendeeEmails": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "hasReminder": {
                    "type": "boolean"
                  },
                  "reminderMinutes": {
                    "type": "integer"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Event updated successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Event not found"
          }
        }
      },
      "delete": {
        "tags": [
          "Calendar & Events"
        ],
        "summary": "Delete calendar event",
        "description": "Deletes a calendar event and cancels its scheduled reminder BullMQ job.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Calendar event ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Event deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Event not found"
          }
        }
      }
    },
    "/api/ai/chat/{conversationId}/summary": {
      "post": {
        "tags": [
          "AI Assistant"
        ],
        "summary": "Generate conversation summary",
        "description": "Analyzes the conversation transcript using Gemini AI and returns key discussion points, decisions made, and follow-up action items.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "conversationId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Conversation ID to summarize"
          }
        ],
        "responses": {
          "200": {
            "description": "Generated summary and action items",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "summary": {
                      "type": "string"
                    },
                    "actionItems": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Conversation not found"
          }
        }
      }
    },
    "/api/whiteboards": {
      "get": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "List user whiteboards",
        "description": "Retrieves paginated whiteboards accessible to the authenticated user within their organizations.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "organizationId",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Filter by organization ID"
          },
          {
            "name": "search",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Search whiteboards by title"
          },
          {
            "name": "page",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 1
            },
            "description": "Page number"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            },
            "description": "Items per page"
          }
        ],
        "responses": {
          "200": {
            "description": "Whiteboards retrieved successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "post": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Create a new whiteboard",
        "description": "Creates a new organization-scoped collaborative whiteboard canvas.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title",
                  "organizationId"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Sprint Architecture & Brainstorming"
                  },
                  "organizationId": {
                    "type": "string",
                    "format": "uuid",
                    "example": "123e4567-e89b-12d3-a456-426614174000"
                  },
                  "content": {
                    "type": "object",
                    "description": "Initial canvas content containing elements array and viewState",
                    "example": {
                      "elements": [],
                      "viewState": {
                        "zoom": 1,
                        "scrollX": 0,
                        "scrollY": 0
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Whiteboard created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/whiteboards/{id}": {
      "get": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Get whiteboard by ID",
        "description": "Fetches whiteboard details, element contents, view state, author metadata, and linked meetings.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Whiteboard ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Whiteboard details returned"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Whiteboard not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Update whiteboard",
        "description": "Updates whiteboard title or content with distributed Redis locking and optimistic concurrency checks.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Whiteboard ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "content": {
                    "type": "object",
                    "description": "Canvas content structure"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Whiteboard updated successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Whiteboard not found"
          },
          "409": {
            "description": "Conflict - locked or concurrent version mismatch"
          }
        }
      },
      "delete": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Delete whiteboard",
        "description": "Permanently deletes a whiteboard and invalidates all associated Redis session keys.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Whiteboard ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Whiteboard deleted successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Whiteboard not found"
          }
        }
      }
    },
    "/api/whiteboards/meetings/{code}": {
      "get": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Get meeting whiteboards",
        "description": "Retrieves all whiteboards attached or opened inside a specific meeting session.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting call code or meeting ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting whiteboards retrieved successfully"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Meeting not found"
          }
        }
      },
      "post": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Create whiteboard for meeting",
        "description": "Instantly provisions a whiteboard and binds it to the specified video conference call.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting call code or meeting ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Meeting Notes & Diagrams"
                  },
                  "organizationId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "content": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Meeting whiteboard created and linked"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/whiteboards/{id}/meetings/{meetingCode}/open": {
      "post": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Open existing whiteboard in meeting",
        "description": "Links and opens an existing whiteboard in the specified meeting, broadcasting whiteboard:opened event to call participants.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Whiteboard ID"
          },
          {
            "name": "meetingCode",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Meeting call code"
          }
        ],
        "responses": {
          "200": {
            "description": "Whiteboard opened in meeting"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Whiteboard or meeting not found"
          }
        }
      }
    },
    "/api/integrations/jira/oauth/authorize-url": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get Jira OAuth 2.0 authorization URL",
        "description": "Generates an Atlassian 3LO OAuth authorization URL with state nonce for connecting a Jira Cloud account.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Authorize URL generated successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "url": {
                          "type": "string",
                          "example": "https://auth.atlassian.com/authorize?..."
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          },
          "429": {
            "description": "Too many authorization requests"
          }
        }
      }
    },
    "/api/integrations/jira/oauth/callback": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Jira OAuth callback",
        "description": "Receives the OAuth authorization code and state from Atlassian, exchanges them for tokens, and redirects to client settings.",
        "parameters": [
          {
            "name": "code",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Authorization code from Atlassian"
          },
          {
            "name": "state",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Security state nonce"
          }
        ],
        "responses": {
          "302": {
            "description": "Redirects to frontend integration settings"
          }
        }
      }
    },
    "/api/integrations/jira/oauth/status": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get Jira integration status",
        "description": "Checks whether the authenticated user has an active Jira Cloud connection and returns connected site details.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Jira connection status retrieved"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/integrations/jira/disconnect": {
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Disconnect Jira integration",
        "description": "Revokes stored OAuth credentials and disconnects Jira Cloud from user account.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Jira disconnected successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/integrations/jira/tickets/my": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get user assigned Jira tickets",
        "description": "Retrieves Jira tickets assigned to the authenticated user from the connected Jira Cloud instance.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Tickets retrieved successfully"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/integrations/jira/webhook": {
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Jira webhook receiver",
        "description": "Ingests Jira Cloud webhook notifications for ticket creation, status changes, and issue transitions.",
        "responses": {
          "200": {
            "description": "Webhook processed successfully"
          },
          "401": {
            "description": "Invalid webhook signature"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/jira/tickets": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get team Jira tickets",
        "description": "Retrieves all Jira issues associated with the specified team.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "responses": {
          "200": {
            "description": "Team Jira tickets retrieved"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      },
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Create team Jira ticket",
        "description": "Creates a new Jira issue linked to the specified team in Jira Cloud.",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "summary"
                ],
                "properties": {
                  "summary": {
                    "type": "string",
                    "example": "Fix auth token refresh in mobile client"
                  },
                  "description": {
                    "type": "string",
                    "example": "Investigate disconnects during socket reconnect"
                  },
                  "issueType": {
                    "type": "string",
                    "example": "Bug"
                  },
                  "priority": {
                    "type": "string",
                    "example": "High"
                  },
                  "assigneeAccountId": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Jira ticket created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/jira/tickets/{key}": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get team Jira ticket details",
        "description": "Fetches detailed status, description, assignee, and comments for a team Jira issue.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          },
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Jira issue key (e.g. PROJ-123)"
          }
        ],
        "responses": {
          "200": {
            "description": "Ticket details retrieved"
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Ticket not found"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/jira/tickets/{key}/status": {
      "patch": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Transition team Jira ticket status",
        "description": "Transitions a Jira ticket workflow status (e.g. 'In Progress', 'Done').",
        "security": [
          {
            "BearerAuth": []
          },
          {
            "CSRFAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Organization ID"
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team ID"
          },
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Jira issue key"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "status"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "example": "In Progress"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Ticket status updated successfully"
          },
          "400": {
            "description": "Invalid transition status"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/projects": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Get user projects",
        "description": "Retrieves all projects where the authenticated user is an internal member or external freelancer.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of user projects"
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/projects/organization/{organizationId}": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Create a new project",
        "description": "Creates a new project scoped to an organization with a dedicated group conversation channel.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "organizationId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "example": "Mobile App Redesign"
                  },
                  "description": {
                    "type": "string",
                    "example": "Cross-company collaboration project for mobile redesign"
                  },
                  "budget": {
                    "type": "number",
                    "example": 5000
                  },
                  "dueDate": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Project created successfully"
          },
          "400": {
            "description": "Validation error"
          },
          "403": {
            "description": "Forbidden - requires ORG_ADMIN or TEAM_HEAD"
          }
        }
      },
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "List organization projects",
        "description": "Returns all projects under an organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "organizationId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Organization projects retrieved"
          }
        }
      }
    },
    "/api/projects/{id}": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Get project details",
        "description": "Retrieves project metadata, members, and task counts.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Project details"
          },
          "403": {
            "description": "Forbidden - not a member of project"
          },
          "404": {
            "description": "Project not found"
          }
        }
      },
      "patch": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Update project details",
        "description": "Updates project name, description, budget, or status. (Project Manager / Org Admin only)",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Project updated successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Delete project",
        "description": "Deletes project and cascades members and tasks. (Project Manager / Org Admin only)",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Project deleted successfully"
          }
        }
      }
    },
    "/api/projects/{id}/invites": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Invite collaborator to project",
        "description": "Invites an external freelancer, client, or internal member with custom role and hourly rate.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "example": "freelancer@example.com"
                  },
                  "role": {
                    "type": "string",
                    "enum": [
                      "PROJECT_MANAGER",
                      "INTERNAL_MEMBER",
                      "FREELANCER",
                      "CLIENT"
                    ],
                    "default": "FREELANCER"
                  },
                  "hourlyRate": {
                    "type": "number",
                    "example": 50
                  },
                  "companyName": {
                    "type": "string",
                    "example": "Acme Freelance Studio"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Invite created successfully"
          }
        }
      }
    },
    "/api/projects/accept-invite": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Accept project invite",
        "description": "Validates invite token and adds the user as a project member and conversation participant.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "token"
                ],
                "properties": {
                  "token": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Invite accepted and member enrolled"
          }
        }
      }
    },
    "/api/projects/{id}/tasks": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "List project tasks",
        "description": "Retrieves all tasks in project with assignee and deliverable metadata.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "TODO",
                "IN_PROGRESS",
                "IN_REVIEW",
                "COMPLETED",
                "CANCELLED"
              ]
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of tasks"
          }
        }
      },
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Create project task",
        "description": "Assigns a new task to an internal member or external freelancer.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Implement Authentication UI"
                  },
                  "description": {
                    "type": "string",
                    "example": "Deliverable should match Figma specs"
                  },
                  "priority": {
                    "type": "string",
                    "enum": [
                      "LOW",
                      "MEDIUM",
                      "HIGH",
                      "URGENT"
                    ],
                    "default": "MEDIUM"
                  },
                  "assigneeId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "dueDate": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Task created successfully"
          }
        }
      }
    },
    "/api/projects/{id}/tasks/{taskId}/deliverable": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Submit task deliverable",
        "description": "Freelancer submits S3 deliverable file URL and notes for review, advancing task to IN_REVIEW.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "taskId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "deliverableUrl"
                ],
                "properties": {
                  "deliverableUrl": {
                    "type": "string",
                    "example": "https://s3.amazonaws.com/quorum/deliverable.zip"
                  },
                  "deliverableNote": {
                    "type": "string",
                    "example": "Finished Figma designs with assets export."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Deliverable submitted for review"
          }
        }
      }
    },
    "/api/projects/{id}/tasks/{taskId}/review": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Approve or reject deliverable",
        "description": "Project Manager approves deliverable (completes task) or requests changes with feedback.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "taskId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "approved"
                ],
                "properties": {
                  "approved": {
                    "type": "boolean",
                    "example": true
                  },
                  "feedback": {
                    "type": "string",
                    "example": "Great work! Approved."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Review processed"
          }
        }
      }
    },
    "/api/documents": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Create collaborative document",
        "description": "Creates a new document scoped to a personal user, team, organization, project, or meeting.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Quarterly Strategy & Brainstorming"
                  },
                  "content": {
                    "type": "object"
                  },
                  "scopeType": {
                    "type": "string",
                    "enum": [
                      "PERSONAL",
                      "TEAM",
                      "ORGANIZATION",
                      "PROJECT",
                      "MEETING"
                    ],
                    "default": "PERSONAL"
                  },
                  "organizationId": {
                    "type": "string"
                  },
                  "teamId": {
                    "type": "string"
                  },
                  "projectId": {
                    "type": "string"
                  },
                  "originMeetingId": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Document created successfully"
          }
        }
      },
      "get": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "List documents",
        "description": "Lists documents accessible to the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "organizationId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "teamId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "projectId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "meetingId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of accessible documents"
          }
        }
      }
    },
    "/api/documents/{id}": {
      "get": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Get document details",
        "description": "Retrieves document content, collaborators, linked meetings, and embedded whiteboards.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Document details"
          }
        }
      },
      "patch": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Update document",
        "description": "Updates document title, content, or archive status.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "content": {
                    "type": "object"
                  },
                  "isArchived": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Document updated"
          }
        }
      },
      "delete": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Delete document",
        "description": "Deletes a document (owner/admin only).",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Document deleted"
          }
        }
      }
    },
    "/api/documents/{id}/collaborators": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Add collaborator",
        "description": "Shares document with a user with READ or WRITE permissions.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userId",
                  "permission"
                ],
                "properties": {
                  "userId": {
                    "type": "string"
                  },
                  "permission": {
                    "type": "string",
                    "enum": [
                      "READ",
                      "WRITE"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Collaborator added"
          }
        }
      }
    },
    "/api/documents/{id}/collaborators/{userId}": {
      "delete": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Remove collaborator",
        "description": "Removes a collaborator from the document.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Collaborator removed"
          }
        }
      }
    },
    "/api/documents/{id}/meeting": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Open or link document in video call meeting",
        "description": "Links document to an active meeting for live split-screen note taking and broadcasts to call participants.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "meetingCodeOrId"
                ],
                "properties": {
                  "meetingCodeOrId": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Document linked to meeting"
          }
        }
      }
    },
    "/api/documents/{id}/whiteboards": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Embed whiteboard inside document",
        "description": "Embeds an interactive or synced whiteboard viewport inside the document canvas.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "whiteboardId"
                ],
                "properties": {
                  "whiteboardId": {
                    "type": "string"
                  },
                  "title": {
                    "type": "string"
                  },
                  "viewport": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Whiteboard embedded"
          }
        }
      }
    },
    "/api/documents/{id}/ai": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "In-document AI copilot",
        "description": "Runs Gemini AI in-document actions: summarize, extract action items, rewrite, expand, grammar fix, or custom instruction.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "action"
                ],
                "properties": {
                  "action": {
                    "type": "string",
                    "enum": [
                      "summarize",
                      "action_items",
                      "rewrite",
                      "expand",
                      "fix_grammar",
                      "custom"
                    ]
                  },
                  "prompt": {
                    "type": "string"
                  },
                  "selectedText": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "AI completion generated"
          }
        }
      }
    },
    "/api/meetings/{code}/recordings": {
      "get": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "List all recordings for a meeting",
        "description": "Returns paginated recordings for the specified meeting code. Accessible by participants.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "page",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "List of recordings"
          }
        }
      }
    },
    "/api/meetings/{code}/recording/start": {
      "post": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Start recording a meeting (Host only)",
        "description": "Initiates video call recording session and broadcasts meeting:recording-status to all participants.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "201": {
            "description": "Recording started successfully"
          }
        }
      }
    },
    "/api/meetings/{code}/recording/stop": {
      "post": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Stop recording a meeting (Host only)",
        "description": "Stops active recording session, calculates duration, and transitions status to PROCESSING until video upload is finalized.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Recording stopped successfully"
          }
        }
      }
    },
    "/api/meetings/{code}/recording/upload-url": {
      "post": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Get presigned S3 / R2 upload URL for recording",
        "description": "Generates a presigned PUT URL for Cloudflare R2 / S3 storage upload.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Presigned upload credentials"
          }
        }
      }
    },
    "/api/recordings/{id}": {
      "get": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Get recording details with signed playback URL",
        "description": "Returns recording metadata and a time-limited presigned S3/R2 playback URL.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Recording details with playback URL"
          }
        }
      },
      "put": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Complete recording upload",
        "description": "Validates cloud storage upload and marks recording status as COMPLETED.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "fileUrl"
                ],
                "properties": {
                  "fileUrl": {
                    "type": "string"
                  },
                  "thumbnailUrl": {
                    "type": "string"
                  },
                  "transcriptUrl": {
                    "type": "string"
                  },
                  "summary": {
                    "type": "string"
                  },
                  "durationSeconds": {
                    "type": "integer"
                  },
                  "fileSizeBytes": {
                    "type": "integer"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Recording marked as COMPLETED"
          }
        }
      },
      "delete": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Delete a recording (Host or Creator only)",
        "description": "Deletes recording file from S3 / R2 and removes record from database.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Recording deleted successfully"
          }
        }
      }
    },
    "/api/recordings/{id}/summarize": {
      "post": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Generate or retrieve an on-demand AI summary of the meeting recording",
        "description": "Uses Google Gemini to analyze the meeting transcript and produce an executive summary with discussion points, decisions, and action items.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "transcriptText": {
                    "type": "string",
                    "description": "Optional inline transcript text if not fetching from transcriptUrl"
                  },
                  "regenerate": {
                    "type": "boolean",
                    "description": "Force regeneration even if a summary already exists"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Meeting summary generated or retrieved successfully"
          }
        }
      }
    },
    "/api/ai/workflows/plan": {
      "post": {
        "tags": [
          "AI Workflows"
        ],
        "summary": "Plan a multi-step workplace workflow from natural language",
        "description": "Parses a natural language instruction into ordered, validated workplace actions (team creation, meeting scheduling, document sharing, member notifications) with entity resolution.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "prompt"
                ],
                "properties": {
                  "prompt": {
                    "type": "string",
                    "example": "Create a Mobile Dev team with Alice and Bob, schedule a kickoff meeting for tomorrow at 10:00 AM, share Product Roadmap, and notify them."
                  },
                  "autoExecute": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Workflow plan generated successfully"
          }
        }
      }
    },
    "/api/ai/workflows/execute": {
      "post": {
        "tags": [
          "AI Workflows"
        ],
        "summary": "Execute a confirmed workflow plan",
        "description": "Executes the planned actions sequentially with dynamic variable resolution and returns an audit trail.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "planId"
                ],
                "properties": {
                  "planId": {
                    "type": "string",
                    "example": "wf_plan_abc123"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Workflow executed successfully"
          }
        }
      }
    },
    "/api/office/{teamId}": {
      "get": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Get Virtual Office floor state",
        "description": "Retrieves current floor layout, zones, desk occupancy, seated teammates, active war rooms, and real-time status messages for a team.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team UUID or slug"
          }
        ],
        "responses": {
          "200": {
            "description": "Virtual office floor state retrieved successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "teamId": {
                          "type": "string"
                        },
                        "teamName": {
                          "type": "string"
                        },
                        "members": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "userId": {
                                "type": "string"
                              },
                              "name": {
                                "type": "string"
                              },
                              "avatarUrl": {
                                "type": "string",
                                "nullable": true
                              },
                              "presenceStatus": {
                                "type": "string",
                                "example": "AVAILABLE"
                              },
                              "zoneId": {
                                "type": "string",
                                "example": "OPEN_WORKSPACE"
                              },
                              "deskId": {
                                "type": "string",
                                "example": "desk-1"
                              },
                              "isInMeeting": {
                                "type": "boolean",
                                "example": false
                              },
                              "statusMessage": {
                                "type": "string",
                                "nullable": true
                              }
                            }
                          }
                        },
                        "desks": {
                          "type": "array",
                          "items": {
                            "type": "object"
                          }
                        },
                        "warRoomMeeting": {
                          "type": "object",
                          "nullable": true
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          },
          "404": {
            "description": "Team not found"
          }
        }
      }
    },
    "/api/office/{teamId}/join": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Join Virtual Office floor",
        "description": "Enter the team office floor and automatically be seated at an available Open Workspace desk.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Team UUID"
          }
        ],
        "responses": {
          "200": {
            "description": "Joined office floor successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/api/office/{teamId}/leave": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Leave Virtual Office floor",
        "description": "Vacate current desk, leave the office floor, and broadcast departure to teammates via WebSocket.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Left office floor successfully"
          }
        }
      }
    },
    "/api/office/{teamId}/knock": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Knock on a desk or zone",
        "description": "Sends a real-time visual and audio knock notification to a seated teammate or zone.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "targetUserId"
                ],
                "properties": {
                  "targetUserId": {
                    "type": "string",
                    "example": "usr_abc123"
                  },
                  "deskId": {
                    "type": "string",
                    "example": "desk-2"
                  },
                  "message": {
                    "type": "string",
                    "example": "Quick question about API"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Knock sent successfully"
          }
        }
      }
    },
    "/api/office/{teamId}/desk/claim": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Claim or move to a specific desk",
        "description": "Select and claim a specific desk ID in the Open Workspace zone.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "deskId"
                ],
                "properties": {
                  "deskId": {
                    "type": "string",
                    "example": "desk-5"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Desk claimed successfully"
          },
          "409": {
            "description": "Desk already occupied"
          }
        }
      }
    },
    "/api/office/{teamId}/zone": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Move between office zones",
        "description": "Move avatar to OPEN_WORKSPACE, FOCUS_POD (auto DND), COFFEE_LOUNGE (auto Be Right Back), or WAR_ROOM.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "zoneId"
                ],
                "properties": {
                  "zoneId": {
                    "type": "string",
                    "enum": [
                      "OPEN_WORKSPACE",
                      "WAR_ROOM",
                      "FOCUS_POD",
                      "COFFEE_LOUNGE"
                    ],
                    "example": "COFFEE_LOUNGE"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Zone changed successfully"
          }
        }
      }
    },
    "/api/office/{teamId}/meeting/start": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "Start an instant War Room meeting",
        "description": "Launches a collaborative video meeting inside the team war room zone.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "War room meeting started"
          }
        }
      }
    },
    "/api/office/{teamId}/meeting/end": {
      "post": {
        "tags": [
          "Virtual Office"
        ],
        "summary": "End active War Room meeting",
        "description": "Ends the active war room meeting and returns participants to their desks.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "War room meeting ended"
          }
        }
      }
    },
    "/api/integrations/github/authorize-url": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Get GitHub OAuth authorization URL",
        "description": "Generates GitHub OAuth 2.0 app consent URL with repo and user scopes.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Authorization URL generated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "url": {
                          "type": "string",
                          "example": "https://github.com/login/oauth/authorize?..."
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/integrations/github/oauth/callback": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "GitHub OAuth callback handler",
        "description": "Exchanges authorization code for GitHub user access token and saves credentials.",
        "parameters": [
          {
            "name": "code",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "state",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "GitHub authenticated successfully"
          }
        }
      }
    },
    "/api/integrations/github/status": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Check GitHub connection status",
        "description": "Returns whether the user or team has an active, authenticated GitHub account linked.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Status returned",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "isConnected": {
                          "type": "boolean",
                          "example": true
                        },
                        "username": {
                          "type": "string",
                          "example": "octocat"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/integrations/github/disconnect": {
      "post": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Disconnect GitHub integration",
        "description": "Revokes access tokens and deletes GitHub OAuth connection for the user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Disconnected successfully"
          }
        }
      }
    },
    "/api/integrations/github/user/repos": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List user GitHub repositories",
        "description": "Fetches accessible public and private GitHub repositories for repository linking.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of repositories",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean",
                      "example": true
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "number"
                          },
                          "name": {
                            "type": "string"
                          },
                          "fullName": {
                            "type": "string",
                            "example": "org/repo-name"
                          },
                          "private": {
                            "type": "boolean"
                          },
                          "htmlUrl": {
                            "type": "string"
                          },
                          "defaultBranch": {
                            "type": "string"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/repo": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Get linked team GitHub repository",
        "description": "Retrieves the GitHub repository linked to a specific team workspace.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Linked repository details"
          }
        }
      },
      "post": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Link GitHub repository to team",
        "description": "Attaches a GitHub repository to a team for issue tracking, PR reviews, and commit views.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "repoFullName"
                ],
                "properties": {
                  "repoFullName": {
                    "type": "string",
                    "example": "facebook/react"
                  },
                  "repoUrl": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Repository linked successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Unlink GitHub repository from team",
        "description": "Removes repository link from team workspace.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Repository unlinked successfully"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/issues": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List issues for team repository",
        "description": "Retrieves open and closed GitHub issues from the linked team repository.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "state",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "open",
                "closed",
                "all"
              ],
              "default": "open"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Issues list retrieved"
          }
        }
      },
      "post": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Create issue in linked repository",
        "description": "Creates a new GitHub issue in the team repository.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Fix authentication error"
                  },
                  "body": {
                    "type": "string",
                    "example": "Steps to reproduce..."
                  },
                  "labels": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "assignees": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Issue created successfully"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/issues/{issueNumber}": {
      "patch": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "Update GitHub issue",
        "description": "Updates state, title, body, or assignees of a team repository issue.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "issueNumber",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "body": {
                    "type": "string"
                  },
                  "state": {
                    "type": "string",
                    "enum": [
                      "open",
                      "closed"
                    ]
                  },
                  "labels": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "assignees": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Issue updated successfully"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/pulls": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List pull requests for team repository",
        "description": "Fetches active pull requests with branch details and review statuses.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "state",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "open",
                "closed",
                "all"
              ],
              "default": "open"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Pull requests retrieved"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/commits": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List commits for team repository",
        "description": "Fetches recent commit history from default or specified branch.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "branch",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Commits list retrieved"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/branches": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List branches for team repository",
        "description": "Fetches all repository branches and protection statuses.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Branches retrieved"
          }
        }
      }
    },
    "/api/integrations/github/teams/{teamId}/collaborators": {
      "get": {
        "tags": [
          "GitHub Integration"
        ],
        "summary": "List team repository collaborators",
        "description": "Fetches assignable collaborators and permission roles.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Collaborators retrieved"
          }
        }
      }
    },
    "/api/users/status": {
      "patch": {
        "tags": [
          "User Presence & Status"
        ],
        "summary": "Set custom user presence status",
        "description": "Update user status to AVAILABLE, DO_NOT_DISTURB, BUSY, BE_RIGHT_BACK, AWAY, or OFFLINE with optional message and duration.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "status"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "enum": [
                      "AVAILABLE",
                      "DO_NOT_DISTURB",
                      "BUSY",
                      "BE_RIGHT_BACK",
                      "AWAY",
                      "OFFLINE"
                    ],
                    "example": "DO_NOT_DISTURB"
                  },
                  "statusMessage": {
                    "type": "string",
                    "example": "Deep work on backend"
                  },
                  "clearAfterMinutes": {
                    "type": "integer",
                    "example": 60
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Status updated successfully"
          }
        }
      },
      "delete": {
        "tags": [
          "User Presence & Status"
        ],
        "summary": "Clear custom user status",
        "description": "Clears custom status message and resets user presence to automatic detection.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Status cleared successfully"
          }
        }
      }
    },
    "/api/users/presence": {
      "get": {
        "tags": [
          "User Presence & Status"
        ],
        "summary": "Get current user presence",
        "description": "Returns real-time presence, online state, meeting status, and screen-sharing state.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Presence retrieved successfully"
          }
        }
      }
    },
    "/api/users/presence/batch": {
      "post": {
        "tags": [
          "User Presence & Status"
        ],
        "summary": "Batch fetch user presences",
        "description": "Retrieves current online/presence records for an array of user IDs in a single call.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "userIds"
                ],
                "properties": {
                  "userIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "example": [
                      "usr_1",
                      "usr_2"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Batch presence map returned"
          }
        }
      }
    },
    "/api/users/{userId}/presence": {
      "get": {
        "tags": [
          "User Presence & Status"
        ],
        "summary": "Get single user presence",
        "description": "Fetches real-time status and activity details for a specific user ID.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "User presence returned"
          }
        }
      }
    },
    "/api/organizations/{id}/transfer-ownership": {
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Transfer organization ownership",
        "description": "Transfers the primary owner role to another member. Current owner can remain as ORG_ADMIN or leave.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "newOwnerId"
                ],
                "properties": {
                  "newOwnerId": {
                    "type": "string",
                    "example": "usr_new_owner"
                  },
                  "leaveOrganization": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Ownership transferred successfully"
          }
        }
      }
    },
    "/api/organizations/{id}/feed": {
      "get": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Get organization announcement feed",
        "description": "Retrieves paginated company-wide posts with author information, reaction counts, and comment totals.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Feed posts retrieved"
          }
        }
      },
      "post": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Create organization feed post",
        "description": "Publishes an announcement post to the entire organization.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Quarterly Town Hall Announcement"
                  },
                  "content": {
                    "type": "string",
                    "example": "Join us live on Friday at 3 PM."
                  },
                  "attachments": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Feed post created"
          }
        }
      }
    },
    "/api/organizations/{id}/feed/{postId}": {
      "get": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Get single feed post",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Post details"
          }
        }
      },
      "patch": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Edit feed post",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "content": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Post updated"
          }
        }
      },
      "delete": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Delete feed post",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Post deleted"
          }
        }
      }
    },
    "/api/organizations/{id}/feed/{postId}/pin": {
      "post": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Pin or unpin feed post",
        "description": "Toggles pinned status of an organization announcement post.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Pin status toggled"
          }
        }
      }
    },
    "/api/organizations/{id}/feed/{postId}/react": {
      "post": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "React to feed post",
        "description": "Adds or removes an emoji reaction to a feed post.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "emoji"
                ],
                "properties": {
                  "emoji": {
                    "type": "string",
                    "example": "🚀"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Reaction toggled"
          }
        }
      }
    },
    "/api/organizations/{id}/feed/{postId}/comments": {
      "get": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "List comments on feed post",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Comments list"
          }
        }
      },
      "post": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Comment on feed post",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string",
                    "example": "Great update!"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Comment created"
          }
        }
      }
    },
    "/api/organizations/{id}/feed/{postId}/comments/{commentId}": {
      "patch": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Update feed post comment",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "commentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "content"
                ],
                "properties": {
                  "content": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Comment updated"
          }
        }
      },
      "delete": {
        "tags": [
          "Organization Feeds"
        ],
        "summary": "Delete feed post comment",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "commentId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Comment deleted"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/tasks": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "List team tasks",
        "description": "Fetches sprint and backlog tasks assigned within a specific team workspace.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Team tasks retrieved"
          }
        }
      },
      "post": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Create team task",
        "description": "Creates a new task assigned to team members.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Setup CI/CD pipeline"
                  },
                  "description": {
                    "type": "string"
                  },
                  "assigneeId": {
                    "type": "string"
                  },
                  "priority": {
                    "type": "string",
                    "enum": [
                      "LOW",
                      "MEDIUM",
                      "HIGH",
                      "URGENT"
                    ],
                    "default": "MEDIUM"
                  },
                  "dueDate": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Task created"
          }
        }
      }
    },
    "/api/organizations/{id}/teams/{teamId}/tasks/{taskId}/status": {
      "patch": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Update team task status",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "taskId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "status"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "enum": [
                      "TODO",
                      "IN_PROGRESS",
                      "IN_REVIEW",
                      "DONE"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Task status updated"
          }
        }
      }
    },
    "/api/organizations/{id}/tasks/my": {
      "get": {
        "tags": [
          "Organizations & Teams"
        ],
        "summary": "Get current user organization tasks",
        "description": "Lists all open and completed tasks across all teams in the organization assigned to the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "My tasks list"
          }
        }
      }
    },
    "/api/meetings/scoped": {
      "post": {
        "tags": [
          "Meetings & Video Calling"
        ],
        "summary": "Create or schedule scoped meeting",
        "description": "Launches or schedules a video call scoped to an Organization, Team, or Community.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title",
                  "scopeType"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Engineering Sync"
                  },
                  "scopeType": {
                    "type": "string",
                    "enum": [
                      "ORGANIZATION",
                      "TEAM",
                      "COMMUNITY",
                      "PERSONAL"
                    ]
                  },
                  "organizationId": {
                    "type": "string"
                  },
                  "teamId": {
                    "type": "string"
                  },
                  "communityId": {
                    "type": "string"
                  },
                  "scheduledStartTime": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "isRecorded": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Scoped meeting created successfully"
          }
        }
      }
    },
    "/api/meetings/upcoming": {
      "get": {
        "tags": [
          "Meetings & Video Calling"
        ],
        "summary": "Get user upcoming meetings",
        "description": "Fetches scheduled and recurring meetings across all teams and organizations for the authenticated user.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Upcoming meetings list"
          }
        }
      }
    },
    "/api/meetings/organization/{organizationId}": {
      "get": {
        "tags": [
          "Meetings & Video Calling"
        ],
        "summary": "List organization meetings",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "organizationId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Organization meetings list"
          }
        }
      }
    },
    "/api/meetings/team/{teamId}": {
      "get": {
        "tags": [
          "Meetings & Video Calling"
        ],
        "summary": "List team meetings",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Team meetings list"
          }
        }
      }
    },
    "/api/meetings/{code}/cancel": {
      "patch": {
        "tags": [
          "Meetings & Video Calling"
        ],
        "summary": "Cancel a scheduled meeting",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting cancelled"
          }
        }
      }
    },
    "/api/meetings/{code}/whiteboards": {
      "get": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Get whiteboards linked to meeting",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Meeting whiteboards retrieved"
          }
        }
      },
      "post": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Create whiteboard for meeting",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Sprint Architecture Diagram"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Whiteboard created and linked to meeting"
          }
        }
      }
    },
    "/api/meetings/{code}/whiteboards/{whiteboardId}/open": {
      "post": {
        "tags": [
          "Collaborative Whiteboards"
        ],
        "summary": "Broadcast whiteboard open in live meeting",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "whiteboardId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Whiteboard opened for all meeting participants"
          }
        }
      }
    },
    "/api/projects/my-projects": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Get my projects",
        "description": "Lists projects where the authenticated user is an owner, lead, member, or external freelancer.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "My projects retrieved"
          }
        }
      }
    },
    "/api/projects/invites/preview/{token}": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Preview project invitation",
        "description": "Public endpoint to view project title, organization, and role before accepting.",
        "parameters": [
          {
            "name": "token",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Invite preview retrieved"
          }
        }
      }
    },
    "/api/projects/invites/accept": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Accept project invitation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "token"
                ],
                "properties": {
                  "token": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Project invite accepted"
          }
        }
      }
    },
    "/api/projects/{id}/members/invite": {
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Invite project member or freelancer",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "role"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "role": {
                    "type": "string",
                    "enum": [
                      "PROJECT_LEAD",
                      "MEMBER",
                      "FREELANCER",
                      "VIEWER"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Invite sent"
          }
        }
      }
    },
    "/api/projects/{id}/members/{userId}": {
      "patch": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Update member role in project",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "PROJECT_LEAD",
                      "MEMBER",
                      "FREELANCER",
                      "VIEWER"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Member role updated"
          }
        }
      },
      "delete": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Remove member from project",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Member removed"
          }
        }
      }
    },
    "/api/projects/{id}/resources": {
      "get": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "List project resources",
        "description": "Retrieves external links, documents, and deliverables attached to the project.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Resources list"
          }
        }
      },
      "post": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Add project resource",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title",
                  "url"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "example": "Figma Design System"
                  },
                  "url": {
                    "type": "string",
                    "example": "https://figma.com/file/..."
                  },
                  "type": {
                    "type": "string",
                    "example": "LINK"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Resource added"
          }
        }
      }
    },
    "/api/projects/{id}/resources/{resourceId}": {
      "delete": {
        "tags": [
          "Projects & Freelancer Collaboration"
        ],
        "summary": "Delete project resource",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "resourceId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Resource deleted"
          }
        }
      }
    },
    "/api/recordings/{id}/complete": {
      "post": {
        "tags": [
          "Meeting Recordings"
        ],
        "summary": "Finalize meeting recording",
        "description": "Notifies the backend that browser/client chunk uploads are finished and triggers post-processing and transcription.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Recording finalized successfully"
          }
        }
      }
    },
    "/api/webhooks/jira": {
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Atlassian Jira webhook receiver",
        "description": "Receives and syncs real-time Jira Cloud issue updates and comment events.",
        "responses": {
          "200": {
            "description": "Webhook processed"
          }
        }
      }
    },
    "/api/integrations/jira/teams/{teamId}/tickets": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "List Jira tickets for team",
        "description": "Fetches Jira Cloud issues linked to the team project.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Jira tickets list"
          }
        }
      },
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Create Jira ticket from team workspace",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "summary",
                  "issueType"
                ],
                "properties": {
                  "summary": {
                    "type": "string",
                    "example": "Implement auth token refresh"
                  },
                  "description": {
                    "type": "string"
                  },
                  "issueType": {
                    "type": "string",
                    "example": "Task"
                  },
                  "priority": {
                    "type": "string",
                    "example": "Medium"
                  },
                  "assigneeAccountId": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Jira ticket created"
          }
        }
      }
    },
    "/api/integrations/jira/teams/{teamId}/tickets/{key}": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Get single Jira ticket details",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "example": "QUOR-101"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Ticket details retrieved"
          }
        }
      }
    },
    "/api/integrations/jira/teams/{teamId}/tickets/{key}/transition": {
      "post": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "Transition Jira ticket status",
        "description": "Advances Jira issue status through project workflow transitions (e.g. In Progress, Done).",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "transitionId"
                ],
                "properties": {
                  "transitionId": {
                    "type": "string",
                    "example": "31"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Transition executed"
          }
        }
      }
    },
    "/api/integrations/jira/teams/{teamId}/assignees": {
      "get": {
        "tags": [
          "Jira Integration"
        ],
        "summary": "List Jira assignable users for team",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "teamId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Assignable users list"
          }
        }
      }
    },
    "/api/conversations/messages/forward": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Forward messages to other conversations",
        "description": "Forwards one or more messages to target conversations or direct chats.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "messageIds",
                  "targetConversationIds"
                ],
                "properties": {
                  "messageIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "targetConversationIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Messages forwarded successfully"
          }
        }
      }
    },
    "/api/conversations/{id}/messages/poll": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Create an interactive chat poll",
        "description": "Creates a multi-option poll within the conversation.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "question",
                  "options"
                ],
                "properties": {
                  "question": {
                    "type": "string",
                    "example": "What time should we hold the demo?"
                  },
                  "options": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "example": [
                      "2 PM",
                      "4 PM",
                      "Tomorrow"
                    ]
                  },
                  "allowMultiple": {
                    "type": "boolean",
                    "default": false
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Poll created"
          }
        }
      }
    },
    "/api/conversations/{id}/messages/{messageId}/poll/vote": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Vote in conversation poll",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "optionIndexes"
                ],
                "properties": {
                  "optionIndexes": {
                    "type": "array",
                    "items": {
                      "type": "integer"
                    },
                    "example": [
                      0
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Vote cast"
          }
        }
      }
    },
    "/api/conversations/{id}/read": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Mark conversation as read",
        "description": "Marks all unread messages in the conversation as read and updates badge counters.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Conversation marked as read"
          }
        }
      }
    },
    "/api/conversations/{id}/clear": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Clear conversation history",
        "description": "Clears visible chat history for the authenticated user without deleting messages for others.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "History cleared"
          }
        }
      }
    },
    "/api/conversations/{id}/mute": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Mute conversation alerts",
        "description": "Mutes push and sound alerts for this conversation permanently or until specified date.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "mutedUntil": {
                    "type": "string",
                    "format": "date-time",
                    "nullable": true
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Conversation muted"
          }
        }
      }
    },
    "/api/conversations/{id}/unmute": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Unmute conversation alerts",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Conversation unmuted"
          }
        }
      }
    },
    "/api/conversations/{id}/block": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Block direct conversation",
        "description": "Blocks communications from the other participant in this 1-on-1 direct chat.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Conversation blocked"
          }
        }
      }
    },
    "/api/conversations/{id}/unblock": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Unblock direct conversation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Conversation unblocked"
          }
        }
      }
    },
    "/api/conversations/{id}/messages/{messageId}/pin": {
      "post": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Pin message to conversation",
        "description": "Pins an important message to the top banner of the chat.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Message pinned"
          }
        }
      },
      "delete": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Unpin message from conversation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "messageId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Message unpinned"
          }
        }
      }
    },
    "/api/conversations/{id}/pinned": {
      "get": {
        "tags": [
          "Conversations & Chat"
        ],
        "summary": "Get pinned messages in conversation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Pinned messages list"
          }
        }
      }
    },
    "/api/communities/discover": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Discover public communities",
        "description": "Explore and search publicly discoverable communities with preview statistics.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Public communities returned"
          }
        }
      }
    },
    "/api/communities/invitations/{identifier}/accept": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Accept community invitation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "identifier",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Community invitation accepted"
          }
        }
      }
    },
    "/api/communities/invitations/{identifier}/decline": {
      "post": {
        "tags": [
          "Communities"
        ],
        "summary": "Decline community invitation",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "identifier",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Community invitation declined"
          }
        }
      }
    },
    "/api/communities/{id}/search-users": {
      "get": {
        "tags": [
          "Communities"
        ],
        "summary": "Search users to invite to community",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Invitable users list"
          }
        }
      }
    },
    "/api/documents/{id}/open-in-meeting": {
      "post": {
        "tags": [
          "Collaborative Documents"
        ],
        "summary": "Open document live inside active meeting",
        "description": "Presents and synchronizes document real-time editor state for all participants in a meeting room.",
        "security": [
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "meetingCode"
                ],
                "properties": {
                  "meetingCode": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Document presented in meeting"
          }
        }
      }
    }
  },
  "tags": [
    {
      "name": "User Presence & Status",
      "description": "Real-time online presence, custom status messages (Available, DND, Busy, Be Right Back, Away), auto-expiration, and presence batch queries."
    },
    {
      "name": "Organization Feeds",
      "description": "Company-wide announcement feeds, rich posts, reactions, nested comments, and pinned items."
    },
    {
      "name": "GitHub Integration",
      "description": "GitHub OAuth 2.0 app authorization, repository mapping, issue tracking, pull requests, commits, and branch synchronization."
    },
    {
      "name": "Virtual Office",
      "description": "Real-time interactive 2.5D virtual office floor, desk occupancy, proximity zones (Open Workspace, War Room, Focus Pods, Coffee Lounge), and desk knocking."
    },
    {
      "name": "Meeting Recordings",
      "description": "Meeting video recordings, real-time capture status, Cloudflare R2 / S3 storage, and 7-day auto-purge lifecycle."
    },
    {
      "name": "Collaborative Documents",
      "description": "Live collaborative rich-text docs with whiteboard embeds, meeting notes, and AI copilot."
    },
    {
      "name": "Projects & Freelancer Collaboration",
      "description": "Cross-organization and freelancer collaboration workspace with task assignment, deliverable review, and sandboxed access."
    },
    {
      "name": "System & Health",
      "description": "System health checks, database status, Redis readiness, and CSRF token endpoints."
    },
    {
      "name": "Authentication",
      "description": "User registration, password login, JWT refresh tokens, multi-device sessions, and current user profile."
    },
    {
      "name": "OTP & Verification",
      "description": "Email OTP verification and secure forgot/reset password flows."
    },
    {
      "name": "User Management",
      "description": "Global user search, user profile queries, profile updates, and avatar management."
    },
    {
      "name": "Direct & Group Conversations",
      "description": "Real-time 1-on-1 direct messaging, group chats, message history, full-text search, typing indicators, and read receipts."
    },
    {
      "name": "Communities",
      "description": "Community workspaces, channels, invitations, role-based member administration (OWNER, ADMIN, MODERATOR, MEMBER), and activity feeds."
    },
    {
      "name": "Community Posts & Comments",
      "description": "Rich discussion posts, multi-media attachments, nested comments, and engagement within community channels."
    },
    {
      "name": "Organizations & Teams",
      "description": "Enterprise workspace hierarchy with multi-tenant organizations, scoped teams, RBAC roles (ORG_ADMIN, TEAM_HEAD, MEMBER), and team task tracking."
    },
    {
      "name": "Calendar & Events",
      "description": "Personal and collaborative calendar scheduling, monthly/daily queries, meeting links, and automated BullMQ reminder dispatch."
    },
    {
      "name": "Meetings & Video Calling",
      "description": "High-performance multi-party WebRTC meetings powered by custom SFU architecture, RTP forwarding, DTLS/SRTP encryption, and call life-cycle control."
    },
    {
      "name": "Collaborative Whiteboards",
      "description": "Real-time multi-user interactive canvas, organization boards, in-meeting live collaboration, and Redis-coordinated persistence."
    },
    {
      "name": "Jira Integration",
      "description": "Atlassian Jira Cloud OAuth 2.0 (3LO) connection, issue tracking, status transitions, and webhook event processing."
    },
    {
      "name": "Media & Storage",
      "description": "Secure AWS S3 presigned URL generation and direct uploads protected by burst and daily rate limits."
    },
    {
      "name": "Notifications & Devices",
      "description": "Real-time in-app alerts, unread counts, push notification device token registration, and delivery preference management."
    },
    {
      "name": "AI Assistant",
      "description": "Workplace intelligence, generative assistant, contextual quick replies, grounded workspace search, and interaction history."
    },
    {
      "name": "Saved Items",
      "description": "Personal bookmarks, saved messages, files, documents, chats, and custom collections."
    }
  ]
};

export const setupSwagger = (app: Express): void => {
  const options = {
    swaggerOptions: {
      requestInterceptor: (req: any) => {
        const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
        if (match) {
          req.headers['x-xsrf-token'] = decodeURIComponent(match[1]);
        }
        return req;
      }
    }
  };

  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerDocument);
  });

  app.get('/api-docs/swagger.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerDocument);
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
};

export default setupSwagger;
