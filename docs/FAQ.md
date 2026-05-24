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

<details>
<summary>When is refresh token rotation triggered from the client?</summary>

Refresh token rotation is triggered from the client in the following scenarios:

**1. Access token expired**

- When API returns 401 Unauthorized, client calls `/auth/refresh` endpoint with current refresh token to get a new token pair

**2. Proactive refresh**

- Client can refresh before access token expires (e.g., when access token has 5 minutes remaining) to avoid user experience interruption

**3. User activity detected**

- When user interacts with app after long inactive period, client can refresh tokens to extend session

**Client-side flow:**

- Client stores both `accessToken` and `refreshToken` (typically in localStorage/cookies)
- When refresh is needed, client sends POST request to `/auth/refresh` with body `{ refreshToken: "..." }`
- Server returns new token pair `{ accessToken, refreshToken }`
- Client **replaces** both old tokens with new tokens (does not keep old token)

**Important notes:**

- Only 1 refresh token is valid at a time (due to rotation)
- If an old refresh token is reused after rotation, server will reject it (implemented at line 101 in auth.service.ts)

</details>

## Testing

<details>
<summary>What are the criteria for writing tests?</summary>

Writing tests in SystemVibe follows these criteria:

**1. Test Structure (AAA Pattern)**

- **Arrange**: Prepare test data and conditions
- **Act**: Execute the code being tested
- **Assert**: Verify the results

**2. Naming conventions**

- Test files: `*.spec.ts` (unit), `*.e2e-spec.ts` (E2E)
- Test description: "should [expected behavior] when [condition]"
- Example: "should return 401 when token is invalid"

**3. One assertion per test**

- Each test should check only one condition
- Separate test cases for easier debugging

**4. Test independence**

- Each test must not depend on other tests
- Do not share state between tests

**5. Use random data**

- Use `Date.now()` or random strings to avoid data conflicts
- Ensure tests can run repeatedly without errors

**6. Mock external dependencies**

- Unit tests must not connect to database, network, or file system
- Mock database, Redis, external services in unit tests

**7. Test ratio (Test Pyramid)**

- 70% Unit tests
- 20% Integration tests
- 10% E2E tests

See details at [docs/TEST.md](./TEST.md)

</details>
