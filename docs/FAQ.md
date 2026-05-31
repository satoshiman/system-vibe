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
<summary>What is the difference between Redis Commander and RedisInsight?</summary>

Both Redis Commander and RedisInsight are GUI tools for inspecting Redis data, but they have different characteristics:

**Redis Commander (Used in SystemVibe)**

- **Pros**: Lightweight, stable, web-based, easy to deploy with Docker
- **Cons**: Less feature-rich compared to RedisInsight
- **Best for**: Quick inspection, development environments, simple use cases
- **Deployment**: Included in docker-compose.yml at port 8001
- **Auto-connect**: Pre-configured to connect to `redis:6379`

**RedisInsight (Official Redis GUI)**

- **Pros**: Official Redis tool, more features, better UI, memory analysis, CLI browser
- **Cons**: Heavier resource usage, can be unstable on some platforms
- **Best for**: Production monitoring, deep analysis, advanced features
- **Deployment**: Run separately with Docker or download desktop app
- **Manual connect**: Must manually configure connection to Redis

**SystemVibe Recommendation**:

- Use **Redis Commander** for development (already in docker-compose)
- Use **RedisInsight** if you need advanced features or production monitoring

**Accessing Redis Commander in SystemVibe**:

```bash
cd infra/docker
docker compose up -d redis-commander
# Open http://localhost:8001
```

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

**2. Redis Commander (Included in docker-compose)**

```bash
# Start Redis Commander with docker-compose
cd infra/docker
docker compose up -d redis-commander

# Access dashboard
# Open http://localhost:8001
```

- Redis Commander is pre-configured in docker-compose.yml
- Auto-connects to Redis instance at `redis:6379`
- Browse all keys, values, and monitor commands
- View BullMQ queues and job data

**3. RedisInsight (Alternative GUI)**

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
<summary>What are all the Redis keys in SystemVibe?</summary>

SystemVibe uses Redis for multiple purposes. Here's a breakdown of all the keys you'll see in Redis Commander:

```
Redis Keys Structure in SystemVibe
└── bull:* (BullMQ Job Queues)
    ├── bull:image:* (Image Processing Queue)
    │   ├── bull:image:wait           (sorted set) - Jobs waiting to be processed
    │   ├── bull:image:active         (list)       - Jobs currently being processed
    │   ├── bull:image:completed       (list)       - Jobs that finished successfully
    │   ├── bull:image:failed          (list)       - Jobs that failed
    │   ├── bull:image:delayed         (sorted set) - Jobs delayed for retry
    │   ├── bull:image:paused          (sorted set) - Jobs that are paused
    │   ├── bull:image:stalled        (list)       - Jobs that stalled
    │   ├── bull:image:priority        (sorted set) - Jobs by priority
    │   ├── bull:image:meta            (hash)       - Queue metadata
    │   ├── bull:image:id              (string)     - Job ID counter
    │   ├── bull:image:events          (stream)     - Job events
    │   └── bull:image:jobs:{jobId}    (hash)       - Individual job data (multiple keys)
    │
    └── bull:jobs:* (General Jobs Queue)
        └── (Same structure as bull:image:* for general tasks)
└── session:* (User Authentication)
    └── session:{sessionId}            (hash)       - Session data for each user
        ├── userId
        ├── roles
        ├── createdAt
        ├── expiresAt
        └── refreshToken
        (TTL: 24 hours, configurable)
└── worker:heartbeat:* (Worker Health Monitoring)
    └── worker:heartbeat:{WORKER_ID}   (string)     - Heartbeat timestamp
        - Value: ISO timestamp
        - TTL: 30 seconds
        - Worker updates every 10 seconds
```

**Purpose of each key type:**

- **`bull:*`**: BullMQ job queue system for asynchronous job processing with retry, priority, and job state management
- **`session:*`**: User authentication session management with TTL-based expiration
- **`worker:heartbeat:*`**: Custom SystemVibe heartbeat mechanism for worker health monitoring and fault detection

**Key patterns:**

- Number of keys varies dynamically based on:
  - Number of jobs in queue (bull:image:jobs:{jobId})
  - Number of active user sessions (session:{sessionId})
  - Number of running workers (worker:heartbeat:{WORKER_ID})
- BullMQ keys are managed automatically by the queue library
- Worker heartbeat keys are managed by custom SystemVibe implementation

</details>

<details>
<summary>Do completed jobs get automatically deleted from Redis?</summary>

Completed jobs in Redis with BullMQ **do not automatically delete** by default. They remain in Redis until explicitly removed or configured with a TTL (Time To Live).

**Default Behavior:**

- Completed jobs stay in the `completed` set in Redis indefinitely
- Failed jobs stay in the `failed` set indefinitely
- This allows for job history, debugging, and potential retry

**SystemVibe Configuration:**

SystemVibe configures job retention in `apps/api/src/config/queue.config.ts`:

```typescript
defaultJobOptions: {
  removeOnComplete: {
    count: 1000,      // Keep last 1000 completed jobs
    age: 86400,       // Or jobs older than 24 hours
  },
  removeOnFail: {
    count: 5000,      // Keep last 5000 failed jobs
    age: 604800,      // Or jobs older than 7 days
  },
}
```

**How It Works:**

- BullMQ automatically cleans up jobs when they exceed the configured thresholds
- This prevents Redis memory bloat while preserving job history for debugging
- Jobs are removed from Redis but remain in PostgreSQL (source of truth)

**API Behavior:**

When a job is deleted from Redis:

- API still queries PostgreSQL for job status
- PostgreSQL is the source of truth for job data
- Client can still retrieve job information even if Redis job is gone

**Why This Architecture:**

- **Redis**: Temporary queue storage with retention policy
- **PostgreSQL**: Permanent job storage with full history
- **API**: Always queries PostgreSQL for job status (reliable source)

**If You Need Different Retention:**

- Increase `count` to keep more jobs in Redis
- Increase `age` to keep jobs longer
- Set `removeOnComplete: true` to delete immediately (not recommended - loses debug history)

</details>

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
- `low`: Processed last (BullMQ value: 5)

**How BullMQ Priority Works**

- BullMQ uses **lower numbers = higher priority**
- Jobs with priority 1 are processed before jobs with priority 10
- Jobs with priority 10 are processed before jobs with priority 5
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

<details>
<summary>How do BullMQ, Redis, and Workers work together?</summary>

BullMQ is a Redis-based queue system that enables asynchronous job processing. Here's how the components interact:

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Service                              │
│                    (Producer - NestJS)                           │
│                                                                  │
│  POST /api/jobs                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Create job in PostgreSQL (status: PENDING)            │   │
│  │ 2. Add job to BullMQ queue via Redis                     │   │
│  │    jobsQueue.add('image-resize', { data })               │   │
│  │ 3. Update job status to QUEUED                           │   │
│  │ 4. Return job ID to client                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Redis connection
                            │ (BullMQ Queue)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Redis Server                                │
│                 (Queue Backend & Storage)                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ BullMQ Data Structures:                                   │   │
│  │ - Queue: 'image' (FIFO list of jobs)                     │   │
│  │ - Job data: { id, type, payload, priority, attempts }    │   │
│  │ - Worker registry: { workerId, lastHeartbeat }           │   │
│  │ - Job state: waiting, active, completed, failed         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ Worker connection
                            │ (BullMQ Worker)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Worker Containers                              │
│               (Consumer - worker-image)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Worker Process 1                                          │   │
│  │ - Connects to Redis queue                                │   │
│  │ - Registers as worker (heartbeat every 5s)               │   │
│  │ - Polls for jobs (BRPOPLPUSH)                            │   │
│  │ - Processes job (image resize)                           │   │
│  │ - Updates job status in Redis                            │   │
│  │ - Updates job status in PostgreSQL                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Worker Process 2 (if scaled)                             │   │
│  │ - Same as Worker 1                                      │   │
│  │ - BullMQ distributes jobs round-robin                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Concepts:**

- **Redis**: Acts as the backend storage and message broker for BullMQ queues. Stores job data, queue state, and worker metadata.
- **BullMQ**: Library that provides queue semantics on top of Redis. Handles job scheduling, retry logic, priority, and worker coordination.
- **Workers**: Consumer processes that connect to Redis, poll for jobs, process them, and update status. Can be scaled horizontally.

**Data Flow:**

1. API creates job in PostgreSQL → adds to BullMQ queue in Redis
2. Redis stores job in queue data structure
3. Workers poll Redis for available jobs
4. Worker picks up job → processes → updates status in both Redis and PostgreSQL
5. Client polls API for job status or receives webhook

**Why this architecture:**

- **Decoupling**: API doesn't wait for processing to complete
- **Scalability**: Workers can be scaled independently based on queue length
- **Reliability**: Redis persistence + PostgreSQL as source of truth
- **Retry logic**: BullMQ automatically retries failed jobs

</details>

<details>
<summary>Is Pub/Sub typically used with WebSocket? What are other applications?</summary>

Pub/Sub is **not required** for WebSocket but is a common pattern in event-driven architectures.

**When to use Pub/Sub + WebSocket:**

- Multiple servers need to broadcast the same message
- Worker services need to communicate with API servers
- Need decoupling between publishers and subscribers
- Horizontal scaling (multiple API instances)

**When NOT to use Pub/Sub + WebSocket:**

- Single server application
- Simple direct communication
- Low traffic

**Other applications of Pub/Sub:**

**1. Microservices Communication**

```
Service A → Redis Pub/Sub → Service B, C, D
```

- Order service publishes "order.created"
- Inventory, shipping, notification services subscribe

**2. Real-time Analytics**

```
User actions → Redis Pub/Sub → Analytics service
```

- Track user behavior in real-time
- Update dashboards instantly

**3. Cache Invalidation**

```
DB update → Redis Pub/Sub → Clear cache
```

- When data changes, notify all services to clear cache
- Prevent stale data

**4. Chat Applications**

```
User A → Redis Pub/Sub → Room members
```

- Group chat messages
- Presence notifications (online/offline)

**5. Live Sports/News Updates**

```
Score update → Redis Pub/Sub → All connected clients
```

- Real-time scores
- Breaking news

**Pub/Sub vs Direct WebSocket:**

| Pattern                 | Pros                                             | Cons                                      |
| ----------------------- | ------------------------------------------------ | ----------------------------------------- |
| **Pub/Sub + WebSocket** | Scalable, decoupled, works with multiple servers | More complex, Redis dependency            |
| **Direct WebSocket**    | Simpler, no extra infrastructure                 | Limited to single server, harder to scale |

**When to use which:**

**Use Pub/Sub + WebSocket when:**

- Multiple API servers (load balancing)
- Worker services publish events
- Need fan-out (1 publisher → many subscribers)
- Event-driven architecture

**Use Direct WebSocket when:**

- Single server
- Simple notifications
- Low scale
- Want minimal infrastructure

</details>

## Docker & Workers

<details>
<summary>Why does API service run locally (npm run dev) instead of Docker container?</summary>

In SystemVibe's development environment, the API service runs locally with `npm run dev` instead of in a Docker container. This is a deliberate development choice for the following reasons:

**Benefits of Local Development (npm run dev):**

1. **Hot Reload & Faster Development**
   - `npm run dev` with `--watch` flag automatically reloads when code changes
   - No need to rebuild Docker image after every code change
   - Faster feedback loop during development

2. **Easier Debugging**
   - Can attach debugger directly to Node.js process
   - View console output in real-time
   - Use IDE debugging tools (VS Code breakpoints, etc.)

3. **Resource Efficiency**
   - No Docker container overhead
   - Avoids volume mounting performance issues on macOS/Windows
   - Reduced disk I/O

4. **Development Flexibility**
   - Easy to change environment variables
   - Run tests locally with npm scripts
   - Integration with dev tools (ESLint, Prettier, etc.)

**What is host.docker.internal?**

`host.docker.internal` is a special DNS name provided by Docker Desktop:

- **MacOS/Windows Docker Desktop**: Automatically added to Docker network
- **Linux**: Requires manual configuration or `--network host` flag
- **Purpose**: Allows containers running in Docker to access services on the host machine

**How it works in SystemVibe:**

```
┌─────────────────────────────────────────┐
│   Host Machine (MacOS/Windows)          │
│                                         │
│   API Service (npm run dev)             │
│   Listening on localhost:3000          │
│                                         │
└─────────────────────────────────────────┘
                    ↑
                    │ host.docker.internal:3000
                    │
┌─────────────────────────────────────────┐
│   Docker Container (Nginx)              │
│                                         │
│   Nginx proxy_pass                      │
│   to host.docker.internal:3000         │
│                                         │
└─────────────────────────────────────────┘
```

**Nginx Configuration:**

Development environment:

```nginx
upstream api {
  server host.docker.internal:3000;  # Points to local API
}
```

Production environment:

```nginx
upstream api {
  server api:3000;  # Points to Docker container
}
```

**Trade-offs:**

**Advantages:**

- Better development experience
- Easier debugging
- Faster iteration

**Disadvantages:**

- Not identical to production environment (API in Docker)
- Must ensure dependencies (Node version, packages) are consistent
- Potential port conflicts when running multiple services

**Production Setup:**

In production, both API and Nginx run in Docker containers:

- API runs in container with name `api`
- Nginx proxies to `api:3000` (container name in Docker network)
- Ensures consistent, reproducible environment
- Enables easy scaling (multiple API instances)
- Proper isolation between services

**Important Note:**

This development setup is specific to the SystemVibe project. Other projects may choose to run API in Docker even during development for environment consistency.

</details>

<details>
<summary>What does the Dockerfile in apps/worker-image do?</summary>

The Dockerfile in `apps/worker-image` is used to build and run the **image processing worker**. It performs the following steps:

1. **Base image**: Uses `node:20-alpine` (lightweight, optimized for production)
2. **Install Sharp dependencies**: Installs `vips-dev`, `build-base`, `pkgconfig` - these are required by Sharp for image processing
3. **Copy source**: Copies `package.json`, `tsconfig.json`, and source code from `apps/worker-image/src`
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
docker compose up -d --scale worker-image=3
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
<summary>What happens when scaling up or down workers?</summary>

**Scaling Up (Increasing Workers)**

```bash
docker compose up -d --scale worker-image=5
```

- New worker containers are created and started
- Workers automatically connect to Redis queue
- BullMQ distributes jobs to all available workers
- No disruption to existing workers or jobs
- Jobs in queue are processed faster with more workers

**Scaling Down (Decreasing Workers)**

```bash
docker compose up -d --scale worker-image=1
```

- Docker sends SIGTERM signal to workers being stopped
- Workers complete current job before shutting down (graceful shutdown)
- Workers stop accepting new jobs during shutdown
- If job doesn't complete in time, it's requeued for remaining workers
- No jobs are lost - queue persists in Redis

**What happens to jobs during scale down?**

1. **Jobs currently processing**: Worker attempts to complete before shutdown
2. **Jobs not started**: Remain in queue, picked up by remaining workers
3. **Jobs that timeout during shutdown**: Requeued automatically by BullMQ

**Graceful Shutdown in SystemVibe**

The worker has graceful shutdown implemented in `apps/worker-image/src/main.ts`:

```typescript
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await app.close();
  process.exit(0);
});
```

BullMQ worker handles:

- Completing active jobs
- Not accepting new jobs
- Requeueing incomplete jobs

**Best Practices**

- Scale down gradually to allow jobs to complete
- Monitor queue length before scaling down
- Use health checks to ensure workers are ready before scaling up
- Consider implementing auto-scaling based on queue depth

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

<details>
<summary>How does `pgrep -f node || exit 1` work as a Docker healthcheck?</summary>

The command `pgrep -f node || exit 1` is used in docker-compose.yml to check if the worker-image container is healthy.

**How it works:**

1. **`pgrep -f node`**
   - `pgrep`: searches for processes by pattern
   - `-f`: searches in the full command line (not just process name)
   - `node`: pattern to find Node.js processes
   - If a Node.js process is found: returns exit code 0 (success) and prints the PID
   - If no Node.js process is found: returns exit code 1 (failure)

2. **`|| exit 1`**
   - `||`: shell OR operator - only runs the next command if the previous command fails (exit code != 0)
   - If `pgrep` finds a Node.js process (exit 0): stops there, healthcheck passes
   - If `pgrep` doesn't find a process (exit 1): runs `exit 1`, healthcheck fails

**Why this is effective for worker-image:**

- Worker runs as a Node.js process, so if the Node.js process is alive, the worker is running
- Simple and doesn't require exposing an HTTP endpoint for healthcheck
- Detects when the worker crashes or is killed
- Suitable for background worker services

**Configuration in docker-compose.yml:**

```yaml
healthcheck:
  test: ["CMD-SHELL", "pgrep -f node || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

</details>

<details>
<summary>How does the health service check worker status?</summary>

The health service in `apps/api/src/modules/health/health.service.ts` checks worker status using BullMQ's built-in worker detection mechanism.

**Implementation:**

```typescript
try {
  const workers = await this.imageQueue.getWorkers();
  workerStatus = workers.length > 0 ? "healthy" : "unhealthy";
} catch (error) {
  console.error("Worker health check error:", error);
  workerStatus = "unhealthy";
}
```

**How it works:**

1. **`this.imageQueue.getWorkers()`**
   - BullMQ method that retrieves the list of active workers for the 'image' queue
   - Queries Redis to find worker metadata
   - Workers register themselves with Redis when they start
   - Workers send heartbeats to maintain their registration

2. **Workers array**
   - Returns an array of worker objects, e.g.:
     ```typescript
     [
       { id: 'worker:1', ... },
       { id: 'worker:2', ... }
     ]
     ```

3. **Logic check** - `workers.length > 0`
   - If there is at least one active worker → status is 'healthy'
   - If no workers are active → status is 'unhealthy'

4. **Error handling**
   - If Redis is disconnected or queue error occurs → status is 'unhealthy'

**Why this approach is effective:**

- Uses BullMQ's built-in mechanism (no custom endpoint needed)
- Real-time detection of worker availability
- Workers automatically unregister when they crash or stop
- No HTTP call required from API to worker
- Leverages existing Redis infrastructure

**Response in health endpoint:**

```json
{
  "status": "healthy",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "queue": "healthy",
    "worker": "healthy",
    "auth": "healthy"
  }
}
```

</details>

<details>
<summary>What does the startHeartbeat() method do in the worker?</summary>

The `startHeartbeat()` method in `apps/worker-image/src/image.processor.ts` sends periodic heartbeat signals to indicate the worker is still alive and operational.

**Implementation details:**

- **Frequency**: Sends heartbeat every 10 seconds (line 167: `setInterval` with 10000ms)
- **Storage**: Stores heartbeat data in Redis with key `worker:heartbeat:{WORKER_ID}` (line 170)
- **TTL**: Key expires after 30 seconds (line 178: `HEARTBEAT_TTL = 30`)
- **Worker ID**: Generated from Docker's HOSTNAME environment variable (line 23)

**Heartbeat data sent (lines 171-176):**

```json
{
  "workerId": "worker-image-{containerId}",
  "type": "image",
  "timestamp": "2026-05-25T09:30:00Z",
  "status": "active"
}
```

**Purpose:**

- **Health monitoring**: Allows the system to detect if a worker has crashed or stopped
- **Fault detection**: If the heartbeat key expires (no update for 30s), the system knows the worker is dead
- **Worker tracking**: Tracks which workers are active and their last activity time
- **Recovery trigger**: Can trigger recovery mechanisms when a worker fails

**How it works:**

1. Worker starts and calls `startHeartbeat()` in constructor (line 63)
2. Every 10 seconds, the interval callback updates the Redis key with current timestamp
3. Redis automatically expires the key after 30 seconds if not updated
4. If the worker crashes, the key expires → monitoring system detects failure
5. When worker shuts down gracefully, `stopHeartbeat()` is called to clear the interval (line 189)

**Why 10s interval with 30s TTL:**

- 3x safety margin: Worker can miss 2 heartbeat updates before being considered dead
- Accounts for network delays or temporary Redis issues
- Balances detection speed with Redis load

</details>

<details>
<summary>Does BullMQ use the custom heartbeat for job coordination?</summary>

No, the custom heartbeat in `startHeartbeat()` is a **SystemVibe-specific implementation**, not part of BullMQ. BullMQ has its own separate worker registration mechanism.

**Difference between the two:**

**1. Custom Heartbeat (SystemVibe)**

- Key: `worker:heartbeat:{WORKER_ID}`
- Purpose: Monitoring, fault detection, recovery triggers
- Not used by BullMQ for job coordination
- Implemented manually in `image.processor.ts`

**2. BullMQ Worker Tracking**

- Automatic: BullMQ tracks workers through active Redis connections
- Storage: Does NOT store worker metadata in persistent Redis keys
- Purpose: Job coordination, load balancing among workers
- Built-in to BullMQ framework

**How BullMQ actually tracks workers:**

BullMQ does NOT store worker metadata in persistent Redis keys like `bull:image:workers:*`. Instead:

1. **Connection-based tracking**: Workers are tracked through active Redis connections
2. **Runtime registry**: Worker registry exists only in memory of BullMQ instances
3. **getWorkers() method**: When calling `this.imageQueue.getWorkers()`, BullMQ queries active Redis connections, not persistent keys
4. **Ephemeral**: Worker tracking is ephemeral - if a worker disconnects, it's immediately removed from the registry

**What `bull:image:*` actually contains:**

The `bull:image:*` keys in Redis store job data only, not worker metadata:

- `bull:image:wait` - Jobs waiting to be processed (sorted set)
- `bull:image:active` - Jobs currently being processed (list)
- `bull:image:completed` - Jobs that finished successfully (list)
- `bull:image:failed` - Jobs that failed (list)
- `bull:image:jobs:{jobId}` - Individual job data (hash)
- `bull:image:meta` - Queue metadata (hash)
- `bull:image:id` - Job ID counter
- `bull:image:events` - Job events stream

**How BullMQ coordinates jobs:**

BullMQ coordinates jobs using:

- Active Redis connections to detect available workers
- Queue data structures (wait, active, completed, failed) to manage job state
- Built-in polling mechanism (BRPOPLPUSH) to distribute jobs
- No persistent worker registry needed

**Why SystemVibe has custom heartbeat:**

- BullMQ does not provide a built-in persistent heartbeat mechanism
- Custom heartbeat enables monitoring and fault detection
- Can trigger recovery mechanisms when workers fail
- Provides visibility into worker health beyond BullMQ's ephemeral connection tracking

**Summary:**

- BullMQ tracks workers through active Redis connections (ephemeral, not persistent)
- `bull:image:*` keys store job data only, not worker metadata
- Custom heartbeat is for monitoring, not job distribution
- Both mechanisms serve different purposes and operate independently

</details>

## Monitoring & Performance

<details>
<summary>What are P50 and P95?</summary>

P50 and P95 are **percentiles** (phân vị) in statistics, commonly used to measure system performance:

**P50 (50th percentile)**

- Also known as the median value
- 50% of measurements are less than or equal to this value
- Represents the "typical" or average performance experience

**P95 (95th percentile)**

- 95% of measurements are less than or equal to this value
- Represents performance for 95% of users
- Helps identify outliers and worst-case scenarios

**In monitoring and performance:**

- **P50**: Shows the typical/average system performance
- **P95**: Shows performance experienced by most users (excluding the worst 5%)
- **P99**: Sometimes used to show near-worst-case performance

**Example: Response Time**
If P95 response time is 200ms:

- 95% of requests are processed in 200ms or less
- 5% of requests take longer than 200ms
- Helps identify if performance issues affect a small subset of users

**Why use percentiles instead of averages:**

- Averages can be skewed by extreme outliers
- Percentiles give a better picture of real user experience
- P50 shows typical case, P95 shows common case, P99 shows worst case

</details>

<details>
<summary>Why does `/api/metrics` return text format instead of JSON?</summary>

The `/api/metrics` endpoint returns **Prometheus Exposition Format** (`text/plain`), not JSON. This is the standard format for Prometheus metrics.

**Example format:**

```
# HELP systemvibe_queue_depth Current number of jobs waiting in queue
# TYPE systemvibe_queue_depth gauge
systemvibe_queue_depth{queue="image"} 5

# HELP systemvibe_job_completed_total Total number of completed jobs
# TYPE systemvibe_job_completed_total counter
systemvibe_job_completed_total{type="resize",priority="high"} 42
```

**Why not JSON?**

| Reason                  | Explanation                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Prometheus standard** | Prometheus only understands this text format when scraping metrics           |
| **Metadata comments**   | `# HELP` and `# TYPE` lines explain each metric (not possible in JSON)       |
| **Histogram support**   | Histograms need multiple lines (buckets, sum, count) - JSON would be complex |
| **Performance**         | Text format is optimized for frequent scraping (every 5-15s)                 |

**Code implementation:**

`apps/api/src/modules/metrics/metrics.controller.ts`:

```typescript
res.set("Content-Type", "text/plain");
res.send(metrics);
```

**Need JSON format?**

Create a separate endpoint like `/api/metrics/json` if you need JSON for other purposes (e.g., frontend dashboard). Prometheus will continue to use the standard text format at `/api/metrics`.

</details>

<details>
<summary>How does Prometheus store metrics from `/api/metrics`?</summary>

The `/api/metrics` endpoint only returns a **snapshot** of current metrics at the moment of the request. Prometheus is responsible for storing historical data.

**Data Flow:**

```
┌─────────────────┐     scrape (5s)      ┌─────────────────┐
│   /api/metrics  │ ◄────────────────────  │   Prometheus    │
│   (snapshot)    │    fetch current       │   (time-series  │
│                 │    metrics at point    │    database)    │
└─────────────────┘                       └────────┬────────┘
                                                    │
                                                    │ query
                                                    ▼
                                           ┌─────────────────┐
                                           │     Grafana     │
                                           │  (visualize)    │
                                           └─────────────────┘
```

**How it works:**

| Component          | Role                                                             |
| ------------------ | ---------------------------------------------------------------- |
| **`/api/metrics`** | Returns current values at request time (snapshot)                |
| **Prometheus**     | Scrapes `/api/metrics` every 5 seconds, stores in time-series DB |
| **Grafana**        | Queries Prometheus to display charts over time                   |

**Example:**

```
Time    Queue Depth    Prometheus Stores
────────────────────────────────────────
10:00   5 jobs         systemvibe_queue_depth{queue="image"} 5 @10:00
10:05   8 jobs         systemvibe_queue_depth{queue="image"} 8 @10:05
10:10   3 jobs         systemvibe_queue_depth{queue="image"} 3 @10:10
```

**Configuration:**

Prometheus scrape interval is configured in `infra/docker/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: "systemvibe-api"
    static_configs:
      - targets: ["host.docker.internal:3000"]
    metrics_path: /api/metrics
    scrape_interval: 5s # Pull metrics every 5 seconds
```

**Key Points:**

- `/api/metrics` = real-time snapshot (no history)
- Prometheus = historical storage (time-series database)
- Without Prometheus, you only see current values, not trends over time
- Grafana queries Prometheus, not the API directly

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

## Monitoring & Logging

<details>
<summary>What is Correlation ID and how does it work in SystemVibe?</summary>

**What is Correlation ID?**

Correlation ID is a unique identifier attached to every request that flows through multiple services in a distributed system. It allows you to trace a single request across different components (API, queue, workers, etc.) by tagging all related logs with the same ID.

**Why is Correlation ID important?**

In distributed systems, a single user request can touch multiple services:

```
Client → API → Queue → Worker → Database
        ↓      ↓       ↓
       Logs scattered across 3+ services
```

Without Correlation ID, when something goes wrong, you have to manually search logs across all services. With Correlation ID:

```bash
# Find all logs for a specific request across all services
docker compose logs api | grep "abc-123"
docker compose logs worker-image | grep "abc-123"
```

**How Correlation ID Works in SystemVibe:**

![Correlation ID Flow](https://www.figma.com/online-whiteboard/create-diagram/33d4052b-e8f9-4b50-b978-bb9a536c1826?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=1942a6bd-af97-4b06-916a-c90131f49ad6)

**Flow:**

1. **Client sends request** with optional `X-Correlation-Id` header
2. **API receives request** via `pino-http` middleware
   - If header exists: uses it
   - If not: generates new UUID
   - Sets `X-Correlation-Id` in response header
3. **API passes ID to BullMQ** job data via `jobs.service.ts`
4. **Worker receives job** with correlation ID in `job.data.correlationId`
5. **Worker creates logger** with correlation ID for structured logging
6. **All logs** (API + Worker) contain same correlation ID

**Implementation Details:**

**API Layer** (`apps/api/src/main.ts`):

```typescript
app.use(
  pinoHttp({
    genReqId: (req, res) => {
      const existingId = req.headers["x-correlation-id"] as string;
      if (existingId) return existingId;
      const id = uuidv4();
      res.setHeader("X-Correlation-Id", id);
      return id;
    },
  }),
);
```

**Service Layer** (`apps/api/src/modules/jobs/jobs.service.ts`):

```typescript
async create(createJobDto: CreateJobDto, correlationId?: string) {
  await this.imageQueue.add(
    createJobDto.type,
    {
      jobId: job.id,
      correlationId, // Pass to worker
    },
    { ... }
  );
}
```

**Worker Layer** (`apps/worker-image/src/image.processor.ts`):

```typescript
const createLogger = (correlationId?: string) => {
  return pino({
    base: {
      service: "worker-image",
      correlationId: correlationId || "unknown",
    },
  });
};

@OnWorkerEvent("active")
async onActive(job: Job) {
  const correlationId = job.data.correlationId as string;
  const jobLogger = createLogger(correlationId);
  jobLogger.info("Job started processing", { correlationId });
}
```

**Usage Examples:**

**1. Client provides correlation ID:**

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "X-Correlation-Id: my-trace-123" \
  -H "Content-Type: application/json" \
  -d '{"type":"image-resize","payload":{...}}'
```

Response header: `X-Correlation-Id: my-trace-123`

**2. Search logs by correlation ID:**

```bash
# Find all logs across services
docker compose logs api | grep "my-trace-123"
docker compose logs worker-image | grep "my-trace-123"
```

**3. View structured logs:**

```json
// API Log
{
  "level": 30,
  "service": "systemvibe-api",
  "req": { "id": "my-trace-123", "method": "POST", "url": "/api/jobs" },
  "msg": "request completed"
}

// Worker Log
{
  "level": 30,
  "service": "worker-image",
  "correlationId": "my-trace-123",
  "msg": "Job completed"
}
```

**Benefits:**

| Without Correlation ID                  | With Correlation ID                   |
| --------------------------------------- | ------------------------------------- |
| Hard to trace requests                  | Easy to follow request flow           |
| Manual log correlation                  | Single search query                   |
| Cannot debug distributed issues         | Full visibility across services       |
| Support tickets are hard to investigate | Quickly identify where failures occur |

**Best Practices:**

1. **Generate at entry point**: API gateway or load balancer should generate if not provided
2. **Propagate through all services**: Pass to queues, workers, downstream APIs
3. **Include in all logs**: Use structured logging with correlation ID in base context
4. **Return in response**: Let clients use their correlation ID for support tickets
5. **Use in error tracking**: Include in error reports for faster debugging

</details>
