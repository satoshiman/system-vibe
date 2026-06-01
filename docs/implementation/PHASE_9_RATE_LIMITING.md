# Phase 9: Rate Limiting

## Overview

Phase 9 implements distributed rate limiting to protect the SystemVibe API from abuse. Uses Redis atomic operations for accurate counting across multiple API instances.

## Goals

- Implement user-based rate limiting (jobs per hour)
- Add IP-based rate limiting for unauthenticated requests
- Support different limits for different job types
- Return clear 429 Too Many Requests responses
- Use Redis for distributed rate limit state

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Rate Limiting Architecture                    │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Client 1  │────▶│             │     │             │        │
│  │   (User A)  │     │             │     │   Redis     │        │
│  └─────────────┘     │   API       │────▶│   Server    │        │
│                      │   Server 1  │     │             │        │
│  ┌─────────────┐     │             │     │  rate_limit:│        │
│  │   Client 2  │────▶│             │     │  user:123   │        │
│  │   (User A)  │     └─────────────┘     │  = 95        │        │
│  └─────────────┘                       │  (TTL: 1h)   │        │
│                                        │             │        │
│  ┌─────────────┐     ┌─────────────┐   │  rate_limit:│        │
│  │   Client 3  │────▶│   API       │──▶│  user:456   │        │
│  │   (User B)  │     │   Server 2  │   │  = 42        │        │
│  └─────────────┘     │             │   └─────────────┘        │
│                      └─────────────┘                           │
│                                                                  │
│  Rate Limit Logic:                                              │
│  ─────────────────                                               │
│  1. INCR rate_limit:user:{userId}:image                         │
│  2. If result == 1 → SET EX 3600 (first request)               │
│  3. If result > limit → REJECT with 429                         │
│  4. If TTL exists and result ≤ limit → ALLOW                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Phase 1-8 completed
- Redis running
- Authentication system working (for user-based limits)
- API server running

## Implementation Steps

### Step 1: Install Rate Limit Dependencies

```bash
npm install --workspace=apps/api @nestjs/throttler
```

### Step 2: Create Rate Limit Service

Create `apps/api/src/modules/rate-limit/rate-limit.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import getRedisClient from "@systemvibe/redis";
import { Redis } from "ioredis";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;

  // Default limits
  private readonly limits = {
    user: {
      image: { windowMs: 60 * 60 * 1000, maxRequests: 100 }, // 100 jobs/hour
      default: { windowMs: 60 * 60 * 1000, maxRequests: 100 },
    },
    ip: {
      default: { windowMs: 60 * 1000, maxRequests: 10 }, // 10 requests/minute
    },
  };

  constructor() {
    this.redis = getRedisClient();
  }

  async checkUserLimit(
    userId: string,
    jobType: string,
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `rate_limit:user:${userId}:${jobType}`;
    const config =
      this.limits.user[jobType as keyof typeof this.limits.user] ||
      this.limits.user.default;

    return this.checkLimit(key, config);
  }

  async checkIpLimit(
    ip: string,
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `rate_limit:ip:${ip}`;
    const config = this.limits.ip.default;

    return this.checkLimit(key, config);
  }

  private async checkLimit(
    key: string,
    config: RateLimitConfig,
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const windowSeconds = Math.ceil(config.windowMs / 1000);

    // Use Redis INCR for atomic increment
    const current = await this.redis.incr(key);

    // If first request, set expiry
    if (current === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    // Get TTL for reset time calculation
    const ttl = await this.redis.ttl(key);
    const resetTime = now + ttl * 1000;

    const remaining = Math.max(0, config.maxRequests - current);
    const allowed = current <= config.maxRequests;

    this.logger.debug(
      `Rate limit check: ${key} = ${current}/${config.maxRequests}`,
    );

    return { allowed, remaining, resetTime };
  }

  async getLimitStatus(
    userId: string,
    jobType: string,
  ): Promise<{ limit: number; current: number; windowMs: number }> {
    const key = `rate_limit:user:${userId}:${jobType}`;
    const config =
      this.limits.user[jobType as keyof typeof this.limits.user] ||
      this.limits.user.default;

    const current = parseInt((await this.redis.get(key)) || "0", 10);

    return {
      limit: config.maxRequests,
      current,
      windowMs: config.windowMs,
    };
  }
}
```

### Step 3: Create Rate Limit Guard

Create `apps/api/src/modules/rate-limit/rate-limit.guard.ts`:

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(private rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Get user ID from request (set by auth guard)
    const userId = request.user?.id;
    const jobType = request.body?.type || "default";

    // Get client IP
    const ip = this.getClientIp(request);

    let limitResult;

    if (userId) {
      // Check user-based limit for authenticated users
      limitResult = await this.rateLimitService.checkUserLimit(userId, jobType);
    } else {
      // Check IP-based limit for anonymous requests
      limitResult = await this.rateLimitService.checkIpLimit(ip);
    }

    // Set rate limit headers
    response.setHeader(
      "X-RateLimit-Limit",
      this.getLimitValue(userId, jobType),
    );
    response.setHeader("X-RateLimit-Remaining", limitResult.remaining);
    response.setHeader(
      "X-RateLimit-Reset",
      new Date(limitResult.resetTime).toISOString(),
    );

    if (!limitResult.allowed) {
      this.logger.warn(`Rate limit exceeded: ${userId || ip}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Rate limit exceeded. Please try again later.",
          error: "Too Many Requests",
          retryAfter: Math.ceil((limitResult.resetTime - Date.now()) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getClientIp(request: any): string {
    return (
      request.headers["x-forwarded-for"]?.split(",")[0] ||
      request.headers["x-real-ip"] ||
      request.connection.remoteAddress ||
      request.ip ||
      "unknown"
    );
  }

  private getLimitValue(userId: string | undefined, jobType: string): number {
    // Return appropriate limit based on user/IP and job type
    if (userId) {
      return jobType === "image" ? 100 : 100; // 100 jobs/hour for users
    }
    return 10; // 10 requests/minute for IPs
  }
}
```

### Step 4: Create Rate Limit Module

Create `apps/api/src/modules/rate-limit/rate-limit.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { RateLimitGuard } from "./rate-limit.guard";

@Module({
  providers: [RateLimitService, RateLimitGuard],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
```

### Step 5: Apply Rate Limit to Jobs Controller

Update `apps/api/src/modules/jobs/jobs.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JobsService } from "./jobs.service";
import { CreateJobDto } from "./dto/create-job.dto";
import { JobResponseDto } from "./dto/job-response.dto";
import { FilterJobsDto } from "./dto/filter-jobs.dto";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard";

@ApiTags("jobs")
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @UseGuards(RateLimitGuard) // Apply rate limiting
  @ApiOperation({ summary: "Create a new job" })
  @ApiResponse({
    status: 201,
    description: "Job created",
    type: JobResponseDto,
  })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async create(@Body() createJobDto: CreateJobDto): Promise<JobResponseDto> {
    return this.jobsService.create(createJobDto);
  }

  // ... other endpoints (GET, DELETE) don't need rate limiting ...
}
```

### Step 6: Update App Module

Update `apps/api/src/app.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { WebhookModule } from "./modules/webhook/webhook.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import queueConfig from "./config/queue.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [queueConfig],
    }),
    HealthModule,
    AuthModule,
    JobsModule,
    WebsocketModule,
    MetricsModule,
    WebhookModule,
    RateLimitModule,
  ],
})
export class AppModule {}
```

### Step 7: Add Rate Limit Endpoint

Add to `apps/api/src/modules/jobs/jobs.controller.ts`:

```typescript
import { RateLimitService } from "../rate-limit/rate-limit.service";

@Controller("jobs")
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly rateLimitService: RateLimitService, // Add this
  ) {}

  // ... existing methods ...

  @Get("rate-limit/status")
  @ApiOperation({ summary: "Get current rate limit status" })
  @ApiResponse({ status: 200, description: "Rate limit status" })
  async getRateLimitStatus(@Req() req): Promise<any> {
    const userId = req.user?.id;

    if (!userId) {
      return {
        type: "ip",
        limit: 10,
        window: "1 minute",
      };
    }

    const status = await this.rateLimitService.getLimitStatus(userId, "image");

    return {
      type: "user",
      jobType: "image",
      limit: status.limit,
      current: status.current,
      remaining: Math.max(0, status.limit - status.current),
      windowMs: status.windowMs,
    };
  }
}
```

## Rate Limit Configuration

### Default Limits

| Type | Target       | Limit | Window     |
| ---- | ------------ | ----- | ---------- |
| User | image jobs   | 100   | per hour   |
| User | other jobs   | 100   | per hour   |
| IP   | all requests | 10    | per minute |

### Redis Keys

```
rate_limit:user:{userId}:{jobType}  → counter with TTL
rate_limit:ip:{ipAddress}            → counter with TTL
```

### Response Headers

| Header                  | Description                     |
| ----------------------- | ------------------------------- |
| `X-RateLimit-Limit`     | Maximum requests allowed        |
| `X-RateLimit-Remaining` | Requests remaining in window    |
| `X-RateLimit-Reset`     | ISO timestamp when limit resets |

### 429 Response

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Please try again later.",
  "error": "Too Many Requests",
  "retryAfter": 3600
}
```

## Testing

### 1. Test User-Based Rate Limit

```bash
# Login first to get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'

# Submit jobs rapidly (should fail after 100)
for i in {1..105}; do
  curl -X POST http://localhost:3000/api/jobs \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"type": "image-resize", "payload": {"imageUrl": "test.jpg", "width": 100}}' \
    -w "%{http_code}\n" \
    -s -o /dev/null
done
```

### 2. Test IP-Based Rate Limit

```bash
# Submit jobs without auth (should fail after 10)
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/jobs \
    -H "Content-Type: application/json" \
    -d '{"type": "image-resize", "payload": {"imageUrl": "test.jpg"}}' \
    -w "%{http_code}\n" \
    -s -o /dev/null
done
```

### 3. Check Rate Limit Status

```bash
curl http://localhost:3000/api/jobs/rate-limit/status \
  -H "Authorization: Bearer <token>"
```

Expected response:

```json
{
  "type": "user",
  "jobType": "image",
  "limit": 100,
  "current": 45,
  "remaining": 55,
  "windowMs": 3600000
}
```

### 4. Verify Redis Keys

```bash
docker exec -it systemvibe-redis redis-cli
KEYS rate_limit:*
GET rate_limit:user:{userId}:image
TTL rate_limit:user:{userId}:image
```

## Rate Limiting Strategies

### Sliding Window (More Accurate)

For more accurate rate limiting, use sliding window with Redis Sorted Sets:

```typescript
async checkSlidingWindow(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Remove old entries
  await this.redis.zremrangebyscore(key, '-inf', windowStart);

  // Count recent requests
  const count = await this.redis.zcard(key);

  if (count >= limit) {
    return false;
  }

  // Add current request
  await this.redis.zadd(key, now, `${now}-${Math.random()}`);
  await this.redis.expire(key, Math.ceil(windowMs / 1000));

  return true;
}
```

### Token Bucket (Burst Support)

For allowing bursts:

```typescript
async checkTokenBucket(
  key: string,
  capacity: number,
  refillRate: number
): Promise<boolean> {
  const now = Date.now();
  const bucket = await this.redis.hmget(key, 'tokens', 'lastRefill');

  let tokens = parseFloat(bucket[0] || capacity);
  const lastRefill = parseInt(bucket[1] || '0', 10);

  // Refill tokens
  const timePassed = now - lastRefill;
  tokens = Math.min(capacity, tokens + timePassed * refillRate);

  if (tokens < 1) {
    return false;
  }

  tokens -= 1;
  await this.redis.hmset(key, 'tokens', tokens, 'lastRefill', now);

  return true;
}
```

## Troubleshooting

### Rate Limits Not Working

1. Check Redis connection
2. Verify RateLimitGuard is applied to controller
3. Check Redis keys exist: `KEYS rate_limit:*`

### Incorrect IP Detection

If behind a proxy, ensure `X-Forwarded-For` header is trusted:

```typescript
// In main.ts
app.set("trust proxy", 1);
```

### Redis Memory Growth

Rate limit keys auto-expire. To manually clear:

```bash
docker exec systemvibe-redis redis-cli EVAL \
  "return redis.call('del', unpack(redis.call('keys', ARGV[1])))" \
  0 rate_limit:*
```

## Advanced Configuration

### Per-User Custom Limits

Store custom limits in user profile:

```prisma
model User {
  // ... existing fields ...
  maxJobsPerHour Int @default(100)
  maxJobsPerDay  Int @default(1000)
}
```

Update RateLimitService to check user-specific limits:

```typescript
async getUserLimit(userId: string): Promise<number> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { maxJobsPerHour: true },
  });
  return user?.maxJobsPerHour || 100;
}
```

## Next Steps

After completing Phase 8:

1. **Add API keys**: Different rate limits for different API keys
2. **Premium tiers**: Higher limits for paid users
3. **Rate limit dashboard**: Show users their current usage
4. **Alerts**: Notify when approaching limits

## Summary

Phase 8 adds API protection with:

- **User-based rate limiting** (100 jobs/hour)
- **IP-based rate limiting** (10 requests/minute)
- **Redis-backed counters** for distributed accuracy
- **Clear 429 responses** with retry information

This protects SystemVibe from abuse while providing fair access to all users.
