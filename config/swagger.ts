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
      "url": process.env.API_BASE_URL || "/",
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
        "tags": ["Saved Items"],
        "summary": "Save an item (Bookmark)",
        "description": "Saves a message, file, chat conversation, document, or resource. Idempotent upsert.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["itemType", "itemId"],
                "properties": {
                  "itemType": { "type": "string", "enum": ["MESSAGE", "FILE", "CHAT", "DOCUMENT", "RESOURCE"] },
                  "itemId": { "type": "string" },
                  "note": { "type": "string", "nullable": true },
                  "collectionId": { "type": "string", "format": "uuid", "nullable": true }
                }
              }
            }
          }
        },
        "responses": {
          "201": { "description": "Item saved successfully" },
          "400": { "description": "Invalid item or missing attachment" },
          "401": { "description": "Unauthorized" },
          "404": { "description": "Item not found or inaccessible" }
        }
      },
      "get": {
        "tags": ["Saved Items"],
        "summary": "List saved items",
        "description": "Retrieves cursor-paginated saved items enriched with original metadata.",
        "security": [{ "BearerAuth": [] }],
        "parameters": [
          { "name": "itemType", "in": "query", "schema": { "type": "string", "enum": ["MESSAGE", "FILE", "CHAT", "DOCUMENT", "RESOURCE"] } },
          { "name": "collectionId", "in": "query", "schema": { "type": "string", "format": "uuid" } },
          { "name": "search", "in": "query", "schema": { "type": "string" } },
          { "name": "cursor", "in": "query", "schema": { "type": "string", "format": "uuid" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 20 } }
        ],
        "responses": {
          "200": {
            "description": "List of saved items. Items whose underlying content was deleted or access revoked have isAccessible: false and content: null.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": { "type": "boolean", "example": true },
                    "data": {
                      "type": "object",
                      "properties": {
                        "items": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "id": { "type": "string", "format": "uuid" },
                              "itemType": { "type": "string", "enum": ["MESSAGE", "FILE", "CHAT", "DOCUMENT", "RESOURCE"] },
                              "itemId": { "type": "string" },
                              "note": { "type": "string", "nullable": true },
                              "isAccessible": { "type": "boolean", "example": true },
                              "title": { "type": "string", "example": "Important message" },
                              "content": { "type": "object", "nullable": true },
                              "collection": {
                                "type": "object",
                                "nullable": true,
                                "properties": {
                                  "id": { "type": "string", "format": "uuid" },
                                  "name": { "type": "string" },
                                  "color": { "type": "string", "nullable": true }
                                }
                              },
                              "createdAt": { "type": "string", "format": "date-time" },
                              "updatedAt": { "type": "string", "format": "date-time" }
                            }
                          }
                        },
                        "nextCursor": { "type": "string", "nullable": true, "format": "uuid" },
                        "hasNextPage": { "type": "boolean" }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/api/saved-items/{id}": {
      "patch": {
        "tags": ["Saved Items"],
        "summary": "Update saved item",
        "description": "Updates note or collection assignment of a saved item.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "note": { "type": "string", "nullable": true },
                  "collectionId": { "type": "string", "format": "uuid", "nullable": true }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Saved item updated" },
          "401": { "description": "Unauthorized" },
          "404": { "description": "Saved item not found" }
        }
      },
      "delete": {
        "tags": ["Saved Items"],
        "summary": "Remove saved item",
        "description": "Deletes a saved item bookmark.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": {
          "200": { "description": "Saved item removed" },
          "401": { "description": "Unauthorized" },
          "404": { "description": "Saved item not found" }
        }
      }
    },
    "/api/saved-items/collections": {
      "post": {
        "tags": ["Saved Items"],
        "summary": "Create collection",
        "description": "Creates a new personal saved collection/folder.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                  "name": { "type": "string" },
                  "description": { "type": "string", "nullable": true },
                  "color": { "type": "string", "nullable": true }
                }
              }
            }
          }
        },
        "responses": {
          "201": { "description": "Collection created" },
          "401": { "description": "Unauthorized" },
          "409": { "description": "Collection name conflict" }
        }
      },
      "get": {
        "tags": ["Saved Items"],
        "summary": "List collections",
        "description": "Retrieves all personal collections for the user with item counts.",
        "security": [{ "BearerAuth": [] }],
        "responses": {
          "200": { "description": "List of collections" },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/api/saved-items/collections/{id}": {
      "patch": {
        "tags": ["Saved Items"],
        "summary": "Update collection",
        "description": "Updates collection name, description, or color.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "description": { "type": "string", "nullable": true },
                  "color": { "type": "string", "nullable": true }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Collection updated" },
          "401": { "description": "Unauthorized" },
          "404": { "description": "Collection not found" },
          "409": { "description": "Collection name conflict" }
        }
      },
      "delete": {
        "tags": ["Saved Items"],
        "summary": "Delete collection",
        "description": "Deletes a collection. Its saved items remain intact without collection.",
        "security": [{ "BearerAuth": [] }, { "CSRFAuth": [] }],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": {
          "200": { "description": "Collection deleted" },
          "401": { "description": "Unauthorized" },
          "404": { "description": "Collection not found" }
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
    }
  },
  "tags": [
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
