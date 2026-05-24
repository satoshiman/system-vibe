# Authentication Documentation

## Overview

SystemVibe uses a JWT-based authentication system with Redis session management for enhanced security and performance. The authentication flow combines:

- **JWT (JSON Web Tokens)** for stateless authentication
- **Redis** for active session tracking and revocation
- **PostgreSQL** for user data and refresh token storage
- **Passport.js** with JWT strategy for request authentication

## Architecture

### Components

1. **AuthModule** (`apps/api/src/modules/auth/`)
   - `auth.controller.ts` - HTTP endpoints
   - `auth.service.ts` - Business logic
   - `auth.module.ts` - Module configuration
   - `dto/` - Data transfer objects with validation
   - `strategies/jwt.strategy.ts` - Passport JWT strategy
   - `guards/jwt-auth.guard.ts` - Route protection

2. **Database Schema** (`packages/database/prisma/schema.prisma`)
   - `User` model with authentication fields

3. **Redis** (`packages/redis/`)
   - Session storage with TTL
   - Active session tracking

### Authentication Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ 1. Register/Login
       ▼
┌─────────────┐
│   Auth API  │
└──────┬──────┘
       │
       ├─► PostgreSQL (User data)
       ├─► Redis (Session storage)
       │
       │ 2. Return JWT tokens
       ▼
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ 3. Subsequent requests with Bearer token
       ▼
┌─────────────┐
│   Auth API  │
└──────┬──────┘
       │
       ├─► Verify JWT signature
       ├─► Check Redis session
       │
       │ 4. Allow/Deny access
       ▼
┌─────────────┐
│   Resource  │
└─────────────┘
```

## Database Schema

### User Model

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  passwordHash   String
  refreshToken   String?  @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

**Fields:**
- `id` - Unique user identifier (CUID)
- `email` - User email (unique, used for login)
- `name` - Optional display name
- `passwordHash` - Bcrypt hashed password (never store plain text)
- `refreshToken` - Current refresh token (unique, for token rotation)
- `createdAt` - Account creation timestamp
- `updatedAt` - Last update timestamp

## Redis Session Management

### Session Storage

Sessions are stored in Redis with the following pattern:

```
Key: session:{userId}
Value: { "userId": "...", "email": "..." }
TTL: 86400 seconds (24 hours)
```

**Purpose:**
- Track active sessions
- Enable session revocation (logout)
- Prevent token reuse after logout
- Fast session validation without database queries

### Session Lifecycle

1. **Login/Register** - Session created in Redis with 24h TTL
2. **Token Refresh** - Session TTL renewed
3. **Logout** - Session deleted from Redis + refresh token cleared in DB
4. **Token Validation** - Check Redis session exists before allowing access

## JWT Token Strategy

### Access Token

- **Purpose:** Short-lived authentication for API requests
- **Expiration:** 15 minutes
- **Payload:** `{ sub: userId, email: userEmail }`
- **Secret:** `JWT_SECRET` environment variable
- **Usage:** Bearer token in `Authorization` header

### Refresh Token

- **Purpose:** Long-lived token for obtaining new access tokens
- **Expiration:** 7 days
- **Payload:** Same as access token
- **Secret:** `JWT_REFRESH_SECRET` environment variable
- **Storage:** Database (User.refreshToken field)
- **Rotation:** New refresh token issued on each refresh

### Token Validation

JWT Strategy (`strategies/jwt.strategy.ts`):
- Extracts token from `Authorization: Bearer <token>` header
- Verifies signature using `JWT_SECRET`
- Validates payload structure
- Returns user context for request

## API Endpoints

### 1. Register

**Endpoint:** `POST /api/auth/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

**Validation:**
- `email` - Must be valid email format
- `password` - Minimum 6 characters
- `name` - Optional string

**Response:**
```json
{
  "user": {
    "id": "clxxx...",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Process:**
1. Check if email already exists
2. Hash password with bcrypt (10 rounds)
3. Create user in PostgreSQL
4. Generate JWT tokens
5. Store session in Redis (24h TTL)
6. Return user data + tokens

### 2. Login

**Endpoint:** `POST /api/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Validation:**
- `email` - Must be valid email format
- `password` - Required string

**Response:**
```json
{
  "user": {
    "id": "clxxx...",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Process:**
1. Find user by email
2. Compare password hash with bcrypt
3. Generate JWT tokens
4. Store session in Redis (24h TTL)
5. Return user data + tokens

### 3. Refresh Tokens

**Endpoint:** `POST /api/auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Process:**
1. Verify refresh token signature
2. Extract user ID from payload
3. Find user and verify refresh token matches
4. Generate new access + refresh tokens
5. Update refresh token in database (rotation)
6. Renew Redis session TTL
7. Return new tokens

**Security:** Token rotation prevents refresh token reuse attacks.

### 4. Logout

**Endpoint:** `POST /api/auth/logout`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

**Process:**
1. Validate access token (JWT guard)
2. Delete session from Redis
3. Clear refresh token in database
4. Return success message

**Security:** Invalidates both session and refresh token.

### 5. Get Profile

**Endpoint:** `GET /api/auth/me`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "id": "clxxx...",
  "email": "user@example.com",
  "name": "John Doe"
}
```

**Process:**
1. Validate access token (JWT guard)
2. Extract user ID from token
3. Find user in database
4. Check Redis session exists
5. Return user profile

**Security:** Session check ensures token hasn't been revoked.

## Security Best Practices

### Password Security
- **Bcrypt hashing** with 10 salt rounds
- Never store plain text passwords
- Minimum 6 character password requirement

### Token Security
- **Short-lived access tokens** (15 minutes)
- **Separate secrets** for access and refresh tokens
- **Token rotation** on refresh
- **Bearer token** in Authorization header

### Session Security
- **Redis session tracking** for revocation
- **24-hour session TTL** for automatic cleanup
- **Immediate invalidation** on logout
- **Session validation** on protected routes

### Environment Variables
```env
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
```

**Important:**
- Use strong, random secrets in production
- Never commit secrets to version control
- Use different secrets for access and refresh tokens
- Rotate secrets periodically

## Usage Examples

### Register a new user
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Access protected route
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

### Refresh tokens
```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refreshToken>"
  }'
```

### Logout
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <accessToken>"
```

## Protecting Routes

Use the `JwtAuthGuard` to protect routes:

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('protected')
export class ProtectedController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getProtectedData(@Request() req) {
    // req.user contains { userId, email }
    return { message: 'Protected data', user: req.user };
  }
}
```

## Error Handling

### Common Errors

- **401 Unauthorized** - Invalid credentials, expired token, or missing session
- **400 Bad Request** - Invalid input data (validation errors)
- **409 Conflict** - User already exists (on registration)

### Error Response Format
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

## Testing

Run auth tests:
```bash
npm test -- auth.service.spec.ts
```

Test endpoints via Swagger UI:
```
http://localhost:3000/api/docs
```

## Troubleshooting

### Session expired
- Redis session TTL is 24 hours
- User must re-login after session expires
- Access tokens expire in 15 minutes (use refresh token)

### Invalid refresh token
- Refresh token may have been revoked on logout
- Token rotation invalidates old refresh tokens
- User must re-login

### Redis connection issues
- Ensure Redis is running on `localhost:6379`
- Check `REDIS_URL` environment variable
- Verify Redis is accessible from API server

## Future Enhancements

Potential improvements to consider:
- Email verification on registration
- Password reset functionality
- Multi-factor authentication (2FA)
- OAuth2/OIDC integration (Google, GitHub, etc.)
- Rate limiting on auth endpoints
- IP-based session tracking
- Device management (multiple sessions)
- Session activity logs
