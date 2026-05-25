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

## Redis & Queue

<details>
<summary>What is the difference between PENDING and QUEUED job status?</summary>

In SystemVibe's job queue system, PENDING and QUEUED represent different stages of the job lifecycle:

**PENDING Status**

- Job has just been created in the PostgreSQL database
- Not yet added to BullMQ queue
- This is the initial state when a job creation request is received
- Set at line 26 in `jobs.service.ts` during job creation

**QUEUED Status**

- Job has been successfully added to BullMQ queue
- Waiting for a worker to pick it up for processing
- Set at line 50-53 in `jobs.service.ts` after `jobsQueue.add()` succeeds
- Job is now in Redis and ready to be processed

**Status Flow:**

```
PENDING (create in DB) → QUEUED (add to BullMQ) → PROCESSING (worker picks up)
```

**Why separate statuses?**

- Clear tracking: Know if job was successfully enqueued or not
- Debugging: If job stuck in PENDING, there's a queue connection issue
- Error handling: If `jobsQueue.add()` fails, job remains in PENDING for retry
- Data integrity: PostgreSQL is the source of truth, Redis is the processing queue

**Practical example:**

- If Redis is down, jobs will be created with PENDING status but never transition to QUEUED
- Once Redis recovers, a recovery mechanism can scan for PENDING jobs and re-enqueue them

</details>

<details>
<summary>How does job priority work in BullMQ?</summary>

In SystemVibe, job priority determines the order in which jobs are processed by workers.

**Priority Levels**

- `high`: Processed first (BullMQ value: 1)
- `normal`: Default priority (BullMQ value: 10)
- `low`: Processed last (BullMQ value: 20)

**How BullMQ Priority Works**

- BullMQ uses **lower numbers = higher priority**
- Jobs with priority 1 are processed before jobs with priority 10
- Jobs with priority 10 are processed before jobs with priority 20
- Jobs with the same priority are processed in FIFO order

**Implementation in SystemVibe**

- Priority mapping is defined in `jobs.service.ts` at line 134-141
- When creating a job, priority is converted to BullMQ numeric value
- The priority is stored in PostgreSQL for filtering and tracking

**Example Usage**

```json
{
  "type": "image-resize",
  "payload": { ... },
  "priority": "high"
}
```

**Filtering by Priority**

- Jobs can be filtered by priority via GET /api/jobs?priority=high
- BullMQ Board UI has a "PRIORITIES" tab to view prioritized jobs
- This helps monitor and manage high-priority workloads

**Best Practices**

- Use `high` priority sparingly for urgent tasks
- Use `normal` for most jobs (default)
- Use `low` for background tasks that can wait
- Avoid setting all jobs to high priority (defeats the purpose)

</details>

<details>
<summary>What happens when Redis is restarted in SystemVibe?</summary>

With the current setup in `docker-compose.yml`, Redis is configured with AOF persistence:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes
  volumes:
    - redis_data:/data
```

**When Redis restarts:**

1. **AOF Persistence Behavior**
   - Redis writes every write operation to `appendonly.aof` file
   - Data is persisted to volume `redis_data`
   - On restart, Redis recovers data from AOF file

2. **Potential Job Loss**
   - Default `appendfsync everysec` → can lose up to 1 second of data before restart
   - If Redis crashes hard (kill -9), data in the last second may be lost
   - BullMQ does not guarantee durability even with Redis persistence

3. **PostgreSQL Jobs Remain Safe**
   - Job entities are stored in PostgreSQL
   - PostgreSQL has volume persistence
   - Jobs in database are not lost

4. **After Restart**
   - Redis recovers from AOF (may lose some recent jobs)
   - BullMQ queue is recreated (may be empty or partial)
   - API server automatically reconnects to Redis
   - Workers can reconnect and start processing new jobs

**Conclusion with current setup:**

- **Does not guarantee 100% jobs survive Redis restart**
- Jobs in PostgreSQL are the safer source of truth
- Job recovery mechanism should be implemented to re-enqueue jobs from DB after Redis restart

**Recommended Improvements:**

1. Implement job recovery: scan DB for jobs stuck in `QUEUED` status and re-enqueue
2. Configure stronger Redis persistence: enable both AOF and RDB
3. Use `appendfsync always` for maximum durability (slower but safer)

</details>

## Docker & Workers

<details>
<summary>What does the Dockerfile in packages/worker-image do?</summary>

The Dockerfile in `packages/worker-image` is used to build and run the **image processing worker**. It performs the following steps:

1. **Base image**: Uses `node:20-alpine` (lightweight, optimized for production)
2. **Install Sharp dependencies**: Installs `vips-dev`, `build-base`, `pkgconfig` - these are required by Sharp for image processing
3. **Copy source**: Copies `package.json`, `tsconfig.json`, and source code from `packages/worker-image/src`
4. **Install & Build**: Installs dependencies and compiles TypeScript to JavaScript
5. **Environment**: Sets `NODE_ENV=production` and `LOG_LEVEL=info`
6. **Run**: Starts the worker with `node dist/main.js`

This worker processes image jobs from the Redis queue (resize, optimize, convert format, etc.) using Sharp as the primary image processing library.

</details>

<details>
<summary>How to scale the worker-image to multiple containers?</summary>

There are three ways to scale the `worker-image` to multiple containers:

**1. Docker Compose Scale (Simplest)**

```bash
docker-compose up -d --scale worker-image=3
```

This scales to 3 worker-image containers. Note: You must remove the `container_name` from docker-compose.yml because scaling doesn't allow multiple containers with the same name.

**2. Docker Swarm (Production)**

Add to docker-compose.yml:

```yaml
worker-image:
  deploy:
    replicas: 3
    mode: replicated
```

Then deploy with Docker Swarm.

**3. Kubernetes (Large Production)**

Use a Deployment with `replicas: 3` and HorizontalPodAutoscaler.

**Important Notes:**

- Redis queue automatically distributes jobs to worker consumers
- No load balancer needed for workers (no exposed ports)
- Monitor Redis queue length to determine when to auto-scale

</details>

<details>
<summary>What are the criteria for creating a worker? Why not use an API instead?</summary>

**Criteria for Creating a Worker:**

1. **Task characteristics:**
   - **Async/Long-running**: Processing takes significant time (image resize, video encoding, PDF generation)
   - **CPU-intensive**: Consumes substantial CPU/GPU resources
   - **Non-blocking**: No immediate response required
   - **Retry-able**: Can be retried on failure

2. **Architecture pattern:**
   - **Producer-Consumer**: API pushes jobs to queue, worker consumes and processes
   - **Decoupling**: API doesn't depend on processing time
   - **Scalability**: Scale workers independently from API

3. **Suitable use cases:**
   - Image/video processing
   - Email sending
   - Data import/export
   - Report generation
   - Background jobs

**Why Worker Instead of API?**

**API (Synchronous):**

- Client waits for response → timeout if processing takes long
- Blocks threads → reduces throughput
- Difficult to retry on failure
- Scales based on HTTP traffic

**Worker (Asynchronous):**

- Client receives job ID immediately → polling/webhook when complete
- Non-blocking → API handles other requests
- Queue automatically retries on failure
- Scales based on queue length
- Resource separation: API for HTTP, worker for CPU

**Real-world example:**
Resizing a 100MB image:

- API: Client times out after 30s, worker still running
- Worker: Client gets job ID, checks back after 2 minutes → image ready

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
