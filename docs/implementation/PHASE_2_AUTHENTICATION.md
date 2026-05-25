# SystemVibe Phase 2: Authentication & Users - Implementation Guide

**Duration**: 1 week | **Goal**: Implement authentication system with JWT and Redis sessions

After Phase 2, you'll have:

- ✅ User registration and login
- ✅ JWT token generation (access + refresh tokens)
- ✅ Auth guards on protected endpoints
- ✅ Session storage in Redis with TTL
- ✅ Password hashing with bcrypt
- ✅ Token refresh mechanism

---

## Prerequisites

**Before starting Phase 2, ensure Phase 1 is complete:**

- Docker Compose services running (PostgreSQL, Redis)
- NestJS API server operational
- Health check endpoint working
- Prisma database configured

---

## Step 1: Install Authentication Dependencies

```bash
# Install authentication packages
npm install --workspace=apps/api bcrypt @nestjs/jwt @nestjs/passport passport passport-jwt

# Install type definitions
npm install --workspace=apps/api -D @types/bcrypt @types/passport-jwt

# Install validation packages
npm install --workspace=apps/api class-validator class-transformer
```

**Dependencies explained:**

- `bcrypt`: Password hashing (10 rounds for security)
- `@nestjs/jwt`: JWT token generation and validation
- `@nestjs/passport`: Authentication framework integration
- `passport-jwt`: JWT strategy for Passport
- `class-validator`: DTO validation decorators
- `class-transformer`: Object transformation

---

## Step 2: Create Redis Package

```bash
# Create Redis package structure
mkdir -p packages/redis/src

# Create package.json
cat > packages/redis/package.json << 'EOF'
{
  "name": "@systemvibe/redis",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "ioredis": "^5.3.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
EOF

# Create TypeScript config
cat > packages/redis/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Create Redis client
cat > packages/redis/src/index.ts << 'EOF'
import Redis from 'ioredis';
import { env } from '@systemvibe/config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      connectTimeout: 10000,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected successfully');
    });
  }

  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export default getRedisClient;
EOF

# Build Redis package
npm run build --workspace=packages/redis
```

---

## Step 3: Update Prisma Schema

```bash
# Update User model with authentication fields
cat > packages/database/prisma/schema.prisma << 'EOF'
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  passwordHash   String
  refreshToken   String?  @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("user")
}
EOF

# Run migration
cd packages/database
DATABASE_URL="postgresql://systemvibe:devpassword@localhost:5433/systemvibe" npx prisma migrate dev --name add_auth_fields
cd ../..
```

**Schema changes:**

- `passwordHash`: Stores bcrypt-hashed passwords (never plain text)
- `refreshToken`: Stores current refresh token for validation

---

## Step 4: Create Auth Module

```bash
# Create auth module structure
mkdir -p apps/api/src/modules/auth/{dto,strategies,guards}

# Create Register DTO
cat > apps/api/src/modules/auth/dto/register.dto.ts << 'EOF'
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;
}
EOF

# Create Login DTO
cat > apps/api/src/modules/auth/dto/login.dto.ts << 'EOF'
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
EOF

# Create JWT Strategy
cat > apps/api/src/modules/auth/strategies/jwt.strategy.ts << 'EOF'
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { env } from '@systemvibe/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.sub,
      email: payload.email,
    };
  }
}
EOF

# Create JWT Auth Guard
cat > apps/api/src/modules/auth/guards/jwt-auth.guard.ts << 'EOF'
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
EOF

# Create Auth Service
cat > apps/api/src/modules/auth/auth.service.ts << 'EOF'
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import getRedisClient from '@systemvibe/redis';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const prisma = new PrismaClient();

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async register(dto: RegisterDto) {
    const existingUser = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    // Store session in Redis with TTL (24 hours)
    const redis = getRedisClient();
    await redis.set(
      `session:${user.id}`,
      JSON.stringify({ userId: user.id, email: user.email }),
      'EX',
      86400,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    // Store session in Redis with TTL (24 hours)
    const redis = getRedisClient();
    await redis.set(
      `session:${user.id}`,
      JSON.stringify({ userId: user.id, email: user.email }),
      'EX',
      86400,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      ...tokens,
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: env.JWT_REFRESH_SECRET,
      });

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user.id, user.email);

      // Update session in Redis
      const redis = getRedisClient();
      await redis.set(
        `session:${user.id}`,
        JSON.stringify({ userId: user.id, email: user.email }),
        'EX',
        86400,
      );

      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    // Remove session from Redis
    const redis = getRedisClient();
    await redis.del(`session:${userId}`);

    // Clear refresh token in database
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return { message: 'Logged out successfully' };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: env.JWT_REFRESH_SECRET,
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
    });

    // Store refresh token in database
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async validateUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check if session exists in Redis
    const redis = getRedisClient();
    const session = await redis.get(`session:${userId}`);

    if (!session) {
      throw new UnauthorizedException('Session expired');
    }

    return user;
  }
}
EOF

# Create Auth Controller
cat > apps/api/src/modules/auth/auth.controller.ts << 'EOF'
import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: { user: { userId: string } }) {
    return this.authService.logout(req.user.userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: { user: { userId: string } }) {
    return this.authService.validateUser(req.user.userId);
  }
}
EOF

# Create Auth Module
cat > apps/api/src/modules/auth/auth.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { env } from '@systemvibe/config';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.JWT_EXPIRES_IN },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
EOF
```

---

## Step 5: Update App Module

```bash
# Update app.module.ts to include AuthModule
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [HealthModule, AuthModule],
})
export class AppModule {}
EOF
```

---

## Step 6: Update Health Check

```bash
# Update health service to include auth status
cat > apps/api/src/modules/health/health.service.ts << 'EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import Redis from 'ioredis';
import { env } from '@systemvibe/config';

@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private dbClient!: Client;
  private redisClient!: Redis;
  private dbConnected = false;

  async onModuleInit() {
    this.dbClient = new Client({
      connectionString: env.DATABASE_URL,
    });
    this.redisClient = new Redis(env.REDIS_URL);

    try {
      await this.dbClient.connect();
      this.dbConnected = true;
    } catch (error) {
      console.error('Failed to connect to database on init:', error);
    }
  }

  async onModuleDestroy() {
    if (this.dbConnected) {
      await this.dbClient.end();
    }
    this.redisClient.quit();
  }

  async getHealth() {
    let dbStatus = 'unknown';
    let redisStatus = 'unknown';
    const authStatus = 'healthy';

    try {
      if (this.dbConnected) {
        await this.dbClient.query('SELECT 1');
        dbStatus = 'healthy';
      } else {
        dbStatus = 'unhealthy';
      }
    } catch (error) {
      console.error('Database health check error:', error);
      dbStatus = 'unhealthy';
    }

    try {
      const result = await this.redisClient.ping();
      redisStatus = result === 'PONG' ? 'healthy' : 'unhealthy';
    } catch (error) {
      console.error('Redis health check error:', error);
      redisStatus = 'unhealthy';
    }

    const overallStatus =
      dbStatus === 'healthy' && redisStatus === 'healthy' ? 'healthy' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        database: dbStatus,
        redis: redisStatus,
        auth: authStatus,
      },
      version: '0.2.0',
    };
  }
}
EOF
```

---

## Step 7: Update Environment Variables

```bash
# Add JWT secrets to .env.example
cat > .env.example << 'EOF'
# Database
DB_USER=systemvibe
DB_PASSWORD=devpassword
DB_NAME=systemvibe

# API
API_PORT=3000
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secrets
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
EOF
```

---

## Step 8: Build and Test

```bash
# Build the API
npm run build --workspace=apps/api

# Start PostgreSQL and Redis
cd infra/docker
docker compose up -d postgres redis
cd ../..

# Start API in development mode
cd apps/api
DATABASE_URL="postgresql://systemvibe:devpassword@localhost:5433/systemvibe" REDIS_URL="redis://localhost:6379" npm run dev
```

---

## Step 9: Test Authentication Endpoints

### Test Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }'
```

**Expected Response:**

```json
{
  "user": {
    "id": "cuid123",
    "email": "test@example.com",
    "name": "Test User"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Test Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Test Protected Endpoint

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

### Test Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

---

## Step 10: Verify Redis Session Storage

```bash
# Access Redis CLI
docker exec -it systemvibe-redis redis-cli

# Check session exists
GET session:<user_id>

# Expected: JSON string with user data
# {"userId":"cuid123","email":"test@example.com"}

# Check TTL
TTL session:<user_id>

# Expected: Remaining seconds (should be < 86400)
```

---

## What You've Learned (Phase 2)

✅ JWT token generation and validation
✅ Password hashing with bcrypt
✅ Session management with Redis TTL
✅ Auth guards and protected routes
✅ Token refresh mechanism
✅ DTO validation with class-validator
✅ Passport.js integration with NestJS
✅ Security best practices (never store plain passwords)

---

## Authentication Flow Diagram

```
1. REGISTER
   Client → POST /api/auth/register
   → Hash password with bcrypt
   → Create user in PostgreSQL
   → Generate JWT tokens
   → Store session in Redis (24h TTL)
   → Return tokens to client

2. LOGIN
   Client → POST /api/auth/login
   → Find user by email
   → Compare password hash
   → Generate JWT tokens
   → Store session in Redis
   → Return tokens to client

3. ACCESS PROTECTED ROUTE
   Client → GET /api/auth/me
   Header: Authorization: Bearer <access_token>
   → Validate JWT signature
   → Check session exists in Redis
   → Return user data

4. REFRESH TOKEN
   Client → POST /api/auth/refresh
   → Validate refresh token
   → Check against database
   → Generate new access token
   → Update session in Redis
   → Return new tokens

5. LOGOUT
   Client → POST /api/auth/logout
   → Delete session from Redis
   → Clear refresh token in database
   → Return success
```

---

## Security Considerations

**Password Security:**

- Always hash passwords with bcrypt (10+ rounds)
- Never store plain text passwords
- Use strong password requirements (min 6 characters)

**Token Security:**

- Access tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Use strong secrets in production
- Store secrets in environment variables

**Session Security:**

- Sessions stored in Redis with 24-hour TTL
- Session validation on every protected request
- Immediate session invalidation on logout

**Production Recommendations:**

- Use HTTPS only
- Rotate JWT secrets regularly
- Implement rate limiting on auth endpoints
- Add email verification for registration
- Implement password reset flow
- Add 2FA (Two-Factor Authentication)

---

## Troubleshooting

### Issue: JWT verification fails

```bash
# Check JWT_SECRET is set
echo $JWT_SECRET

# Ensure same secret used for signing and verification
# Check token expiration
```

### Issue: Redis session not found

```bash
# Check Redis is running
docker exec systemvibe-redis redis-cli ping

# Check session key exists
docker exec systemvibe-redis redis-cli GET session:<user_id>

# Check TTL
docker exec systemvibe-redis redis-cli TTL session:<user_id>
```

### Issue: Password comparison fails

```bash
# Ensure bcrypt rounds match (10)
# Check password is being hashed before storage
# Verify comparison uses correct hash
```

---

## Next Steps (Phase 3)

You're ready for **Phase 3: Job Queue with BullMQ**:

- Background job processing
- Worker implementation
- Job retry logic
- Queue monitoring
- Priority queues

---

## Quick Reference Commands

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass123","name":"User"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass123"}'

# Get profile (requires token)
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <token>"

# Logout
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <token>"

# Check Redis sessions
docker exec systemvibe-redis redis-cli KEYS "session:*"

# View session data
docker exec systemvibe-redis redis-cli GET session:<user_id>
```

---

**Phase 2 Complete! 🎉**
