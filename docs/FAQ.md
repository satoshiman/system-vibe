# FAQ (Frequently Asked Questions)

## Architecture & Design Decisions

<details>
<summary>Why organize Redis as a separate package?</summary>

Organizing Redis as a separate package (`@systemvibe/redis`) in the monorepo provides the following benefits:

**1. Reusability**

- Redis client can be used by multiple apps (API, worker, other microservices)
- Avoids code duplication when multiple services need to connect to Redis

**2. Single Responsibility**

- Package only handles Redis connection management
- Singleton pattern ensures only 1 connection instance
- Retry logic and error handling are centralized

**3. Configuration Centralization**

- Redis URL, retry strategy, timeout are configured in one place
- Easy to change configuration without affecting other apps

**4. Testing & Mocking**

- Easy to mock Redis client when testing other apps
- Can test Redis package independently

**5. Dependency Management**

- `ioredis` dependency is managed in one package
- Apps only need to depend on `@systemvibe/redis` instead of installing ioredis directly

**6. Scalability**

- Easy to add new features (connection pool, multi-instance, cluster)
- Can evolve into a shared library for the entire organization

In monorepo architecture, this pattern is typically applied to shared services: database, cache, message queue, logging, etc.

</details>

<details>
<summary>Where should JWT be stored: localStorage or Cookie?</summary>

For SystemVibe, JWT should be stored in **HttpOnly Cookies** rather than localStorage.

**HttpOnly Cookies (Recommended):**

- **XSS Protection**: HttpOnly cookies cannot be accessed by JavaScript, preventing XSS attacks from stealing tokens
- **CSRF Protection**: Can be combined with SameSite and CSRF tokens
- **Automatic sending**: Browser automatically includes cookies with requests
- **Security**: More secure by default for authentication tokens

**localStorage (Not Recommended for JWT):**

- **XSS Vulnerable**: Any malicious JavaScript can access localStorage and steal tokens
- **Manual handling**: Must manually attach token to request headers
- **No expiration control**: Browser doesn't automatically clear expired tokens

**Implementation approach for SystemVibe:**

1. Backend sets HttpOnly cookie with JWT on login
2. Configure cookie with: `httpOnly: true`, `secure: true` (HTTPS), `sameSite: 'strict'`
3. Backend validates JWT from cookie instead of Authorization header
4. Add CSRF protection if needed (though SameSite=strict mitigates most CSRF)

**Exception:** localStorage might be acceptable if:

- Your app has zero XSS risk (rare)
- You need token access from multiple subdomains
- You're implementing additional XSS mitigation (CSP, input sanitization)

</details>

<details>
<summary>How to debug Redis in SystemVibe?</summary>

**1. Redis CLI (Quickest)**

```bash
# Connect to Redis container
docker exec -it systemvibe-redis redis-cli

# Or from host
redis-cli -h localhost -p 6379

# List all keys
KEYS *

# Get value by key
GET your_key_name

# Get all hash fields
HGETALL your_hash_name

# Monitor real-time commands
MONITOR
```

**2. RedisInsight (Recommended GUI)**

```bash
# Download RedisInsight: https://redis.com/redis-enterprise/redis-insight/
# Or run with Docker
docker run -v redisinsight:/db -p 8001:8001 redislabs/redisinsight:latest
```

- Open http://localhost:8001
- Connect to: `localhost:6379`
- Browse all keys, values, and monitor commands

**3. Debug in NestJS Code**

```typescript
// Add logging to packages/redis/src/index.ts
redisClient.on("connect", () => {
  console.log("Redis connected successfully");
});

// In service using Redis
this.logger.debug(`SET ${key}: ${value}`);
this.logger.debug(`GET ${key}: ${result}`);
```

**4. Debug Endpoint (Development only)**

```typescript
@Get('debug/redis')
async debugRedis() {
  const redis = getRedisClient();
  const keys = await redis.keys('*');
  const data = {};
  for (const key of keys) {
    const type = await redis.type(key);
    if (type === 'string') {
      data[key] = await redis.get(key);
    } else if (type === 'hash') {
      data[key] = await redis.hgetall(key);
    }
  }
  return data;
}
```

**5. Check Connection Status**

```bash
# Check if Redis container is running
docker ps | grep systemvibe-redis

# Check Redis logs
docker logs systemvibe-redis

# Test connection
docker exec systemvibe-redis redis-cli ping
# Should return: PONG
```

**SystemVibe Specific Notes:**

- Redis runs on port `6379` of host
- Container name: `systemvibe-redis`
- API connects via internal network: `redis://redis:6379`
- Local development: `redis://localhost:6379`

</details>

## Testing

<details>
<summary>Việc viết test có tiêu chí gì không?</summary>

Việc viết test trong SystemVibe tuân theo các tiêu chí sau:

**1. Cấu trúc test (AAA Pattern)**

- **Arrange**: Chuẩn bị dữ liệu và điều kiện test
- **Act**: Thực thi code cần test
- **Assert**: Kiểm tra kết quả

**2. Quy tắc đặt tên**

- File test: `*.spec.ts` (unit), `*.e2e-spec.ts` (E2E)
- Mô tả test: "should [hành vi mong đợi] when [điều kiện]"
- Ví dụ: "should return 401 when token is invalid"

**3. Một assertion mỗi test**

- Mỗi test chỉ nên kiểm tra một điều kiện
- Tách các test case riêng biệt để dễ debug

**4. Độc lập giữa các test**

- Mỗi test không được phụ thuộc vào test khác
- Không chia sẻ state giữa các test

**5. Sử dụng dữ liệu ngẫu nhiên**

- Dùng `Date.now()` hoặc random string để tránh xung đột dữ liệu
- Đảm bảo test có thể chạy lặp lại mà không lỗi

**6. Mock external dependencies**

- Unit test không được kết nối database, network, file system
- Mock database, Redis, external services trong unit test

**7. Tỷ lệ test (Test Pyramid)**

- 70% Unit tests
- 20% Integration tests
- 10% E2E tests

Xem chi tiết tại [docs/TEST.md](./TEST.md)

</details>
