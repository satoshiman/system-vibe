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

### What is JWT?

**JWT (JSON Web Token)** is a compact, URL-safe means of representing claims to be transferred between two parties. It consists of three parts separated by dots:

```
Header.Payload.Signature
```

**Example JWT:**

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

**Three Parts:**

1. **Header** - Algorithm and token type

   ```json
   {
     "alg": "HS256",
     "typ": "JWT"
   }
   ```

2. **Payload** - User data (claims)

   ```json
   {
     "sub": "user123",
     "email": "user@example.com",
     "iat": 1516239022,
     "exp": 1516242622
   }
   ```

3. **Signature** - Cryptographic signature to verify authenticity
   ```
   HMACSHA256(
     base64UrlEncode(header) + "." + base64UrlEncode(payload),
     secret
   )
   ```

**Why JWT?**

- **Stateless**: No server-side session storage needed
- **Self-contained**: All user info is in the token
- **Cross-domain**: Works across different services
- **Standard**: Widely adopted industry standard

### Access Token vs Refresh Token

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOKEN COMPARISON                              │
├──────────────────┬──────────────────────────────────────────────┤
│                  │              ACCESS TOKEN                      │
├──────────────────┼──────────────────────────────────────────────┤
│ Purpose          │ Authenticate API requests                     │
│ Lifetime         │ Short (15 minutes)                            │
│ Storage          │ Client memory / localStorage                  │
│ Sent with        │ Every API request (Authorization header)     │
│ Security         │ Less critical if leaked (short-lived)        │
│ Validation       │ Verify signature + check Redis session       │
└──────────────────┴──────────────────────────────────────────────┘

┌──────────────────┬──────────────────────────────────────────────┐
│                  │              REFRESH TOKEN                     │
├──────────────────┼──────────────────────────────────────────────┤
│ Purpose          │ Obtain new access tokens                     │
│ Lifetime         │ Long (7 days)                                │
│ Storage          │ Database (User.refreshToken field)            │
│ Sent with        │ Only to /refresh endpoint                    │
│ Security         │ Critical if leaked (long-lived)              │
│ Validation       │ Verify signature + match DB record           │
└──────────────────┴──────────────────────────────────────────────┘
```

### Access Token

- **Purpose:** Short-lived authentication for API requests
- **Expiration:** 15 minutes
- **Payload:** `{ sub: userId, email: userEmail }`
- **Secret:** `JWT_SECRET` environment variable
- **Usage:** Bearer token in `Authorization` header
- **Security:** Short lifetime reduces risk if leaked

### Refresh Token

- **Purpose:** Long-lived token for obtaining new access tokens
- **Expiration:** 7 days
- **Payload:** Same as access token
- **Secret:** `JWT_REFRESH_SECRET` environment variable
- **Storage:** Database (User.refreshToken field)
- **Rotation:** New refresh token issued on each refresh
- **Security:** Stored securely in database, rotated on use

### Token Lifecycle Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ 1. Register/Login
       │    (email + password)
       ▼
┌─────────────────────────────────────────┐
│         Auth API                         │
│  ┌───────────────────────────────────┐  │
│  │ 1. Validate credentials          │  │
│  │ 2. Hash password (bcrypt)         │  │
│  │ 3. Generate ACCESS TOKEN (15min)  │  │
│  │ 4. Generate REFRESH TOKEN (7d)   │  │
│  │ 5. Store session in Redis (24h)   │  │
│  │ 6. Save refresh token in DB       │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
               │ 2. Return both tokens
               ▼
┌─────────────────────────────────────────┐
│         Client                           │
│  ┌───────────────────────────────────┐  │
│  │ accessToken:  "eyJhbGci..."        │  │
│  │ refreshToken: "eyJhbGci..."        │  │
│  │                                    │  │
│  │ Store accessToken in memory       │  │
│  │ Store refreshToken securely       │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
               │ 3. API Request (every 15min)
               │    Authorization: Bearer <accessToken>
               ▼
┌─────────────────────────────────────────┐
│         Auth API                         │
│  ┌───────────────────────────────────┐  │
│  │ 1. Verify JWT signature           │  │
│  │ 2. Check Redis session exists    │  │
│  │ 3. Allow access if valid          │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
               │ 4. Access Token Expired (after 15min)
               ▼
┌─────────────────────────────────────────┐
│         Client                           │
│  ┌───────────────────────────────────┐  │
│  │ accessToken expired!              │  │
│  │ Use refreshToken to get new one  │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
               │ 5. Refresh Token Request
               │    POST /api/auth/refresh
               │    { refreshToken: "..." }
               ▼
┌─────────────────────────────────────────┐
│         Auth API                         │
│  ┌───────────────────────────────────┐  │
│  │ 1. Verify refresh token signature │  │
│  │ 2. Check DB for matching token   │  │
│  │ 3. Generate NEW access token     │  │
│  │ 4. Generate NEW refresh token    │  │
│  │ 5. Update DB with new refresh    │  │
│  │ 6. Renew Redis session TTL        │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │
               │ 6. Return new tokens
               ▼
┌─────────────────────────────────────────┐
│         Client                           │
│  ┌───────────────────────────────────┐  │
│  │ New accessToken (15min)         │  │
│  │ New refreshToken (7d)            │  │
│  │ Old refresh token invalidated    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Token Rotation Security

```
┌─────────────────────────────────────────────────────────────────┐
│              TOKEN ROTATION (Security Feature)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Request: Refresh with token A                             │
│       │                                                          │
│       ▼                                                          │
│  Server validates token A ✓                                      │
│       │                                                          │
│       ▼                                                          │
│  Server generates NEW token B                                   │
│       │                                                          │
│       ▼                                                          │
│  Server saves token B to database                                │
│       │                                                          │
│       ▼                                                          │
│  Server returns token B to client                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ SECURITY: Token A is now INVALID                          │  │
│  │ If attacker stole token A, they cannot use it again       │  │
│  │ because database now contains token B                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Token Validation

JWT Strategy (`strategies/jwt.strategy.ts`):

- Extracts token from `Authorization: Bearer <token>` header
- Verifies signature using `JWT_SECRET`
- Validates payload structure
- Checks Redis session exists (prevents revoked token usage)
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
import { UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@Controller("protected")
export class ProtectedController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getProtectedData(@Request() req) {
    // req.user contains { userId, email }
    return { message: "Protected data", user: req.user };
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

### Testing with Swagger UI

Swagger UI provides an interactive interface to test API endpoints without writing code.

**Access Swagger UI:**

```
http://localhost:3000/api/docs
```

#### Step 1: Register a New User

1. Open Swagger UI at `http://localhost:3000/api/docs`
2. Find the `POST /api/auth/register` endpoint
3. Click **Try it out**
4. Fill in the request body:

```json
{
  "email": "test@example.com",
  "password": "password123",
  "name": "Test User"
}
```

5. Click **Execute**
6. Copy the `accessToken` and `refreshToken` from the response

#### Step 2: Configure Authorization

1. Click the **Authorize** button (lock icon) at the top right
2. In the popup, enter your `accessToken` (without "Bearer " prefix)
3. Click **Authorize**
4. Close the popup

Now all requests will include the Bearer token automatically.

#### Step 3: Test Protected Endpoints

**Get Profile (`GET /api/auth/me`):**

1. Find the endpoint
2. Click **Try it out**
3. Click **Execute**
4. You should see your user profile

**Logout (`POST /api/auth/logout`):**

1. Find the endpoint
2. Click **Try it out**
3. Click **Execute**
4. After logout, the token is invalidated

#### Step 4: Test Login Flow

1. Find `POST /api/auth/login`
2. Click **Try it out**
3. Enter credentials:

```json
{
  "email": "test@example.com",
  "password": "password123"
}
```

4. Click **Execute**
5. Copy the new tokens and re-authorize in Swagger

#### Step 5: Test Token Refresh

1. Find `POST /api/auth/refresh`
2. Click **Try it out**
3. Enter your `refreshToken`:

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

4. Click **Execute**
5. You'll receive new `accessToken` and `refreshToken`
6. Update the authorization with the new access token

#### Testing Error Scenarios

**Invalid Credentials:**

```json
{
  "email": "wrong@example.com",
  "password": "wrongpassword"
}
```

Expected: `401 Unauthorized`

**Invalid Email Format:**

```json
{
  "email": "invalid-email",
  "password": "password123",
  "name": "Test"
}
```

Expected: `400 Bad Request`

**Short Password:**

```json
{
  "email": "test@example.com",
  "password": "123",
  "name": "Test"
}
```

Expected: `400 Bad Request`

**Access Without Token:**

1. Click **Authorize** and click **Logout** to clear token
2. Try accessing `GET /api/auth/me`
   Expected: `401 Unauthorized`

**Access After Logout:**

1. Login to get a token
2. Call `POST /api/auth/logout`
3. Try accessing `GET /api/auth/me` with the same token
   Expected: `401 Unauthorized` (session invalidated)

#### Tips

- **Use unique emails** for testing to avoid conflicts: `test-${Date.now()}@example.com`
- **Copy tokens carefully** - they are long strings
- **Re-authorize** after getting new tokens from login/refresh
- **Check response codes** - green = success, red = error
- **View response body** - click the response to see full details

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
