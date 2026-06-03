# FAQ (Frequently Asked Questions)

## Architecture & Design Decisions

### Why organize Redis as a separate package?

<details>
<summary>Answer</summary>

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

### Where should JWT be stored: localStorage or Cookie?

<details>
<summary>Answer</summary>

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

### What is the difference between Worker and Webhook? When to use each?

<details>
<summary>Answer</summary>

When designing a distributed system like SystemVibe, classifying a background task as **Worker** or **Webhook Delivery Service** depends on answering: **"Where does the output go and who controls the receiving infrastructure?"**

Here are 4 core criteria to distinguish them when designing architecture:

### 1. Network Boundary & Infrastructure Control (Most Important)

This is the primary criterion for drawing the boundary between the two services.

- **Worker (Internal-Facing):** Only interacts with components **inside** your private network (VPC) - Database, Redis, S3 Storage. You have full control over these. If S3 is slow, you can upgrade bandwidth; if Database is congested, you can optimize indexes.
- **Webhook (External-Facing):** Must interact with systems on the **public Internet** - specifically the client's URL/Server. You are **completely blind** to their infrastructure. Their server might use slow languages, be infected with malware, be powered off, or have firewalls blocking your requests.

### 2. Error Behavior & Retry Strategy

How the system handles failures determines the queue architecture.

- **For Worker:** Errors are typically **Logic or Data** errors.
  - _Examples:_ Code bugs, corrupted uploaded files.
  - _Strategy:_ Immediate retry 2-3 times. If still failing, push to **Dead Letter Queue (DLQ)** for developers to investigate. Retrying 100 times won't fix a corrupted file.

- **For Webhook:** Errors are typically **Network or Temporary Overload** from the partner side.
  - _Examples:_ Client server under maintenance (503), temporary outage.
  - _Strategy:_ Use **Exponential Backoff** (retry after 5 min, 15 min, 1 hour, 6 hours...). Space out retries to give their server time to recover, avoiding unintentional DDoS on their struggling system.

### 3. Resource Utilization Profile

This helps optimize infrastructure costs on Cloud (AWS, GCP) or Docker.

- **Worker:** Usually **CPU-Bound** or **Memory-Bound**. Tasks like video processing (FFmpeg), image compression (Sharp), data analysis (AI/ML), heavy PDF/Excel exports require servers with multi-core CPU and large RAM.
- **Webhook:** Purely **I/O-Bound (Network I/O)**. No heavy computation - just read from DB/Queue, package into JSON, send via HTTP. Requires optimizing concurrent connections and network bandwidth. Can run on cheap, low-CPU nodes.

### 4. Push vs Pull Model (Data Flow)

- **Worker uses Pull model:** Your system actively "pulls" jobs from internal queue to process. You control the pull rate (throttling) based on your hardware capacity.
- **Webhook uses Push model:** Your system "pushes" data to another system. You must follow their rules (e.g., _"Max 10 webhooks/second to our server or we block your IP"_). You need a separate Webhook service to control output rate (Rate Limiting per Client).

### 💡 Rule of Thumb

Look at the last line of your background task code:

1. If the last line is: `await prisma.user.update(...)` or `await s3.upload(...)` → **Choose Worker**
2. If the last line is: `await axios.post(client_callback_url, data)` → **Separate into Webhook Service**

**SystemVibe Examples:**

| Task                        | Output Destination | Type    |
| --------------------------- | ------------------ | ------- |
| Image resize                | S3 (internal)      | Worker  |
| Job status notification     | Client's HTTPS URL | Webhook |
| PDF export                  | Database + Storage | Worker  |
| Email via SendGrid API      | External API       | Webhook |
| Database aggregation report | PostgreSQL         | Worker  |

</details>

### What is the difference between Redis Commander and RedisInsight?

<details>
<summary>Answer</summary>

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

### How to debug Redis in SystemVibe?

<details>
<summary>Answer</summary>

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

### When is refresh token rotation triggered from the client?

<details>
<summary>Answer</summary>

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

### What are all the Redis keys in SystemVibe?

<details>
<summary>Answer</summary>

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

### Do completed jobs get automatically deleted from Redis?

<details>
<summary>Answer</summary>

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

### What is the difference between PENDING and QUEUED job status?

<details>
<summary>Answer</summary>

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

### How does job priority work in BullMQ?

<details>
<summary>Answer</summary>

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

### What happens when Redis is restarted in SystemVibe?

<details>
<summary>Answer</summary>

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

### How do BullMQ, Redis, and Workers work together?

<details>
<summary>Answer</summary>

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

### Is Pub/Sub typically used with WebSocket? What are other applications?

<details>
<summary>Answer</summary>

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

### Why does API service run locally (npm run dev) instead of Docker container?

<details>
<summary>Answer</summary>

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

### What does the Dockerfile in apps/worker-image do?

<details>
<summary>Answer</summary>

The Dockerfile in `apps/worker-image` is used to build and run the **image processing worker**. It performs the following steps:

1. **Base image**: Uses `node:20-alpine` (lightweight, optimized for production)
2. **Install Sharp dependencies**: Installs `vips-dev`, `build-base`, `pkgconfig` - these are required by Sharp for image processing
3. **Copy source**: Copies `package.json`, `tsconfig.json`, and source code from `apps/worker-image/src`
4. **Install & Build**: Installs dependencies and compiles TypeScript to JavaScript
5. **Environment**: Sets `NODE_ENV=production` and `LOG_LEVEL=info`
6. **Run**: Starts the worker with `node dist/main.js`

This worker processes image jobs from the Redis queue (resize, optimize, convert format, etc.) using Sharp as the primary image processing library.

</details>

### How to scale the worker-image to multiple containers?

<details>
<summary>Answer</summary>

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

### What happens when scaling up or down workers?

<details>
<summary>Answer</summary>

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

### What are the criteria for creating a worker? Why not use an API instead?

<details>
<summary>Answer</summary>

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

### How does `pgrep -f node || exit 1` work as a Docker healthcheck?

<details>
<summary>Answer</summary>

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

### How does the health service check worker status?

<details>
<summary>Answer</summary>

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

### What does the startHeartbeat() method do in the worker?

<details>
<summary>Answer</summary>

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

### Does BullMQ use the custom heartbeat for job coordination?

<details>
<summary>Answer</summary>

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

## Monitoring & Logging

### What are P50 and P95?

<details>
<summary>Answer</summary>

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

### Why does `/api/metrics` return text format instead of JSON?

<details>
<summary>Answer</summary>

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

### How does Prometheus store metrics from `/api/metrics`?

<details>
<summary>Answer</summary>

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

### What is Correlation ID and how does it work in SystemVibe?

<details>
<summary>Answer</summary>

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

![Correlation ID Flow](https://www.figma.com/online-whiteboard/create-diagram/33d4052b-e8f9-4b50-b978-bb9a536c1826)

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

### Who creates Correlation ID - client or server?

<details>
<summary>Answer</summary>

**Both can create - depending on the scenario:**

| Scenario           | Who creates ID                              | Example                                                |
| ------------------ | ------------------------------------------- | ------------------------------------------------------ |
| **Client creates** | Frontend/mobile app generates ID            | Mobile app wants to trace request across microservices |
| **Server creates** | API generates UUID when client doesn't send | Regular web request from browser                       |

**Flow in SystemVibe:**

```
Client Request                    Server Behavior
─────────────────────────────────────────────────
No X-Correlation-Id header  →   Server generates UUID
                            →   Response: X-Correlation-Id: <uuid>

Has X-Correlation-Id header →   Server uses client-provided ID
                            →   Response: X-Correlation-Id: <client-id>
```

**Code in `main.ts`:**

```typescript
genReqId: (req, res) => {
  const existingId = req.headers["x-correlation-id"] as string;

  // 1. Client sent ID → use it
  if (existingId) return existingId;

  // 2. No ID from client → server creates UUID
  const id = uuidv4();
  res.setHeader("X-Correlation-Id", id);
  return id;
};
```

**When should client create ID?**

- Microservice calling microservice (preserve trace context)
- Mobile app wants to log same ID on device and server
- API gateway forwarding to downstream services
- Client needs ID for support/debugging before sending request

**When should server create?**

- Regular web requests from browsers
- Client doesn't care about tracing
- External API consumers
- Simple use cases where traceability isn't critical

**Best practice:**

Server **always returns** the ID in response header, even if it was created by server. This allows client to:

- Use it for debugging
- Include in support tickets
- Log on client side for correlation with server logs

```bash
# Client can now use this ID for debugging
curl -I http://localhost:3000/api/jobs
# Response: X-Correlation-Id: 550e8400-e29b-41d4-a716-446655440000
```

</details>

## Testing

### What are the criteria for writing tests?

<details>
<summary>Answer</summary>

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

## Kubernetes

### Why does Cloud SQL Proxy appear in both API and Worker pods?

<details>
<summary>Answer</summary>

**Because both services need to connect to the database through Cloud SQL Proxy.**

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│      API Pod                │     │     Worker Pod              │
│  ┌─────────────────────┐   │     │  ┌─────────────────────┐     │
│  │  API (NestJS)       │   │     │  │  Worker (BullMQ)    │     │
│  │  → localhost:5432   │   │     │  │  → localhost:5432   │     │
│  └─────────────────────┘   │     │  └─────────────────────┘     │
│  ┌─────────────────────┐   │     │  ┌─────────────────────┐     │
│  │  Cloud SQL Proxy    │   │     │  │  Cloud SQL Proxy    │     │
│  │  → Cloud SQL DB     │   │     │  │  → Cloud SQL DB     │     │
│  └─────────────────────┘   │     │  └─────────────────────┘     │
└─────────────────────────────┘     └─────────────────────────────┘
```

**Why each pod needs its own proxy:**

| Reason                | Explanation                                                          |
| --------------------- | -------------------------------------------------------------------- |
| **Network Isolation** | Each pod has its own network namespace - they cannot share localhost |
| **Security**          | Each pod has its own encrypted tunnel to the database                |
| **High Availability** | If one proxy fails, only that pod is affected                        |
| **Simplicity**        | No need for shared proxy service or complex networking               |

**Alternative approaches (not used):**

- **Shared proxy service**: Would require all pods to connect to a single proxy endpoint, creating a single point of failure
- **Direct connection**: Would expose database credentials in application code

The sidecar pattern (proxy in same pod) is the recommended approach for Cloud SQL on Kubernetes.

</details>

### What does "2/2 Ready" mean in pod status?

<details>
<summary>Answer</summary>

**"2/2 Ready" means 2 out of 2 containers in the pod are ready to accept traffic.**

**Example - API Pod:**

```
Pod: api-79c54bc5f7-7ccws
├── Container 1: api ✅ Ready (NestJS app on port 3000)
└── Container 2: cloud-sql-proxy ✅ Ready (proxy on port 5432)
```

**Understanding Ready column:**

| Status | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `0/2`  | No containers ready (starting or crashed)                       |
| `1/2`  | 1 container ready, 1 not ready (usually sidecar still starting) |
| `2/2`  | All containers ready (fully operational)                        |

**Check individual containers:**

```bash
kubectl get pod <pod-name> -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.ready}{"\n"}{end}'
```

Output:

```
api                  true
cloud-sql-proxy      true
```

**Note:** The `cloud-sql-proxy` container doesn't have a readiness probe defined, so Kubernetes considers it ready immediately after it starts.

</details>

### Why don't I see Redis and PostgreSQL pods/containers like in Docker Compose?

<details>
<summary>Answer</summary>

**In GKE production, you use managed services instead of containers:**

| Docker Compose (Local) | GKE (Production)             | Benefits                                 |
| ---------------------- | ---------------------------- | ---------------------------------------- |
| Redis container        | **Memorystore for Redis**    | Managed, auto-scaling, high availability |
| PostgreSQL container   | **Cloud SQL for PostgreSQL** | Automated backups, replication, patching |

**Architecture difference:**

```
Docker Compose (Local)                GKE (Production)
┌─────────────────────────┐          ┌─────────────────────────┐
│  Local Machine          │          │  GKE Cluster            │
│                         │          │                         │
│  ┌─────────────────┐    │          │  ┌─────────┐ ┌────────┐ │
│  │ Redis Container │    │          │  │ API Pod │ │ Worker │ │
│  │ Port: 6379      │    │          │  │ + Proxy │ │ + Proxy│ │
│  └─────────────────┘    │          │  └────┬────┘ └───┬────┘ │
│                         │          │       └────┬────┘      │
│  ┌─────────────────┐    │          │            │           │
│  │ Postgres        │    │          │  ┌─────────┴─────────┐ │
│  │ Container       │    │          │  │  Cloud SQL Proxy  │ │
│  │ Port: 5432      │    │          │  │  (Sidecar)        │ │
│  └─────────────────┘    │          │  └───────────────────┘ │
└─────────────────────────┘          └─────────────────────────┘
                                              │
                    ┌───────────────────────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
  ┌──────▼──────┐     ┌───────▼───────┐
  │ Memorystore │     │  Cloud SQL    │
  │ for Redis   │     │ for Postgres  │
  └─────────────┘     └───────────────┘
```

**Connection in K8s:**

- **Redis**: Direct connection via private IP (configured in secret)
- **PostgreSQL**: Through Cloud SQL Proxy sidecar for security

**Why managed services?**

- No pod management (no `CrashLoopBackOff` for database)
- Automatic backups and point-in-time recovery
- Scaling without managing storage
- Google handles patching and maintenance
- VPC-native private connectivity (no public IP exposure)

</details>

### How to scale Redis and PostgreSQL in production?

<details>
<summary>Answer</summary>

**Current Setup (Development/Basic):**

| Service    | Current Tier                 | Scaling Options                       |
| ---------- | ---------------------------- | ------------------------------------- |
| Redis      | Memorystore Basic (1GB)      | Upgrade to Standard HA                |
| PostgreSQL | Cloud SQL db-f1-micro (10GB) | Enable Regional HA, add Read Replicas |

**Scale Redis (Memorystore):**

```bash
# Upgrade to Standard HA with replica
# (2 nodes: 1 primary + 1 replica, automatic failover)
gcloud redis instances update system-vibe-redis \
  --tier=standard \
  --size=5 \
  --region=asia-southeast1

# Or just increase memory size
gcloud redis instances update system-vibe-redis \
  --size=10 \
  --region=asia-southeast1
```

**Scale PostgreSQL (Cloud SQL):**

```bash
# Enable High Availability (Regional)
# (2 zones: primary + standby, automatic failover)
gcloud sql instances patch system-vibe-db \
  --availability-type=REGIONAL \
  --tier=db-g1-small

# Add Read Replica (for read-heavy workloads)
gcloud sql instances create system-vibe-db-replica-1 \
  --master-instance-name=system-vibe-db \
  --tier=db-f1-micro \
  --region=asia-southeast1
```

**Architecture after scaling:**

```
┌─────────────────────────────────────────┐
│      Memorystore Redis HA             │
│                                         │
│   ┌─────────┐         ┌─────────┐      │
│   │ Primary │ ←────── │ Replica │      │
│   │  6379   │  sync   │  6379   │      │
│   └─────────┘         └─────────┘      │
│        ↑                                │
│        │ (automatic failover)          │
│   ┌────┴────┐                          │
│   │  Client │                          │
│   └─────────┘                          │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         Cloud SQL HA + Replicas         │
│                                         │
│   ┌─────────┐         ┌─────────┐      │
│   │ Primary │ ←────── │ Standby │      │
│   │  (R/W)  │  sync   │  (HA)   │      │
│   │ Zone A  │         │ Zone B  │      │
│   └────┬────┘         └─────────┘      │
│        │                                │
│   ┌────┴─────────┐                     │
│   │ Read Replica │ (for analytics)      │
│   │    (R/O)     │                     │
│   └──────────────┘                     │
└─────────────────────────────────────────┘
```

**Application Changes (for read replicas):**

To utilize read replicas, update Prisma configuration:

```typescript
// packages/config/src/env.ts
DATABASE_URL: z.string().url(),           // Primary (writes)
DATABASE_REPLICA_URL: z.string().url().optional(), // Replica (reads)

// packages/database/src/prisma.service.ts
// Use replica for read operations, primary for writes
```

**When to scale:**

| Metric               | Threshold       | Action                              |
| -------------------- | --------------- | ----------------------------------- |
| Redis memory usage   | > 80%           | Increase size or upgrade to HA      |
| Database CPU         | > 70% sustained | Upgrade tier or add replica         |
| Database connections | > 80%           | Increase connection pool or upgrade |
| Read/write ratio     | > 10:1          | Add read replica                    |

**Cost considerations:**

- **Redis Standard HA**: ~2x cost of Basic (but with HA)
- **Cloud SQL Regional**: ~2x cost of Zonal (but with HA)
- **Read Replicas**: Additional cost per replica (use only if needed)

</details>

### Does adding DB replicas increase read and write capacity?

<details>
<summary>Answer</summary>

**No** - it depends on the type of replica:

| Replica Type              | Read   | Write | Purpose                            |
| ------------------------- | ------ | ----- | ---------------------------------- |
| **HA Standby** (Regional) | ❌ No  | ❌ No | Failover only when primary is down |
| **Read Replica**          | ✅ Yes | ❌ No | Distribute read load only          |

**Architecture:**

```
┌─────────────────────────────────────────┐
│        Cloud SQL Primary                │
│        (Read + Write)                   │
│         34.126.86.151                   │
└─────────────────────────────────────────┘
        │
        ├── Write operations (INSERT/UPDATE/DELETE)
        └── Read operations (SELECT)

┌─────────────────────────────────────────┐
│        HA Standby (Regional)            │
│        ❌ Doesn't handle requests         │
│        Waits for failover               │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│        Read Replica 1                   │
│        ✅ Read only (SELECT)            │
│        ❌ No Write                      │
└─────────────────────────────────────────┘
```

**Key Points:**

- **Enable HA (Regional)**: Doesn't increase performance, only increases availability (99.95% uptime SLA)
- **Add Read Replicas**: Increases **READ** capacity (scalability), but **WRITE** still only on primary

**To increase BOTH read and write:**

1. **Scale up primary tier** (db-f1-micro → db-g1-small → db-n1-standard-2)
2. **Implement database sharding** (split data across multiple databases)
3. **Optimize queries** and add proper indexes
4. **Use caching** (Redis) to reduce database load

**Rule of thumb:**

- Read-heavy workload (10:1 ratio) → Add read replicas
- Write-heavy workload → Scale up primary tier
- Need high availability → Enable HA

</details>

### What about Prometheus and Grafana in production?

<details>
<summary>Answer</summary>

**Current Status:**

| Environment                | Prometheus      | Grafana         | Notes                                        |
| -------------------------- | --------------- | --------------- | -------------------------------------------- |
| **Local (Docker Compose)** | ✅ Container    | ✅ Container    | Defined in `infra/docker/docker-compose.yml` |
| **GKE Production**         | ❌ Not deployed | ❌ Not deployed | Need to choose monitoring approach           |

**Option 1: Google Managed Prometheus (Recommended)**

Fully managed monitoring for GKE:

```bash
# Enable GMP (one-time)
gcloud container clusters update system-vibe-cluster \
  --enable-managed-prometheus \
  --region=asia-southeast1

# Deploy collectors (automatically scrapes pods)
kubectl apply -f https://raw.githubusercontent.com/GoogleCloudPlatform/prometheus-engine/main/manifests/setup.yaml
```

**Pros:**

- No Prometheus server to manage
- Auto-scaling storage
- Integrated with Cloud Monitoring
- Grafana can use GMP as data source

**Option 2: Self-Hosted Prometheus/Grafana**

Deploy via Helm chart:

```bash
# Add Prometheus Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

# Install Prometheus + Grafana
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.adminPassword=admin \
  --set prometheus.prometheusSpec.retention=15d

# Expose Grafana via LoadBalancer
kubectl patch svc monitoring-grafana -n monitoring \
  -p '{"spec": {"type": "LoadBalancer"}}'
```

**Required: ServiceMonitor for your apps**

```yaml
# infra/k8s/monitoring/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-metrics
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: metrics
      path: /metrics
      interval: 15s
```

**Option 3: Cloud Monitoring (Native GCP)**

Dùng GCP native monitoring không cần Prometheus:

```bash
# GKE đã tự động gửi metrics vào Cloud Monitoring
# Xem tại: https://console.cloud.google.com/monitoring

# Để log aggregation
gcloud logging sinks create system-vibe-logs \
  bigquery.googleapis.com/projects/system-vibe/datasets/logs \
  --log-filter='resource.type="k8s_container"'
```

**Recommendation:**

| Use Case                         | Recommendation                            |
| -------------------------------- | ----------------------------------------- |
| Minimal setup                    | **Google Managed Prometheus**             |
| Full control + custom dashboards | **Self-hosted Grafana + GMP data source** |
| Simple, GCP-native               | **Cloud Monitoring only**                 |

</details>

### What is Google Managed Prometheus (GMP)?

<details>
<summary>Answer</summary>

**Google Managed Prometheus (GMP)** is Google Cloud's fully-managed Prometheus service for GKE clusters.

**What it is:**

- Prometheus-compatible monitoring **without managing Prometheus servers**
- Collects metrics from your GKE pods using OpenTelemetry collectors
- Stores metrics in Google Cloud with auto-scaling storage
- Query using familiar **PromQL** syntax

**Architecture:**

```
┌─────────────────────────────────────────┐
│           GKE Cluster                   │
│                                         │
│  ┌─────────────────────────────┐         │
│  │  GMP Collectors (DaemonSet) │         │
│  │  - Auto-scrape pods via     │         │
│  │    ServiceMonitor resources │         │
│  │  - Send to Google Cloud     │         │
│  └─────────────────────────────┘         │
│            ↑                            │
│  ┌─────────┴─────────┐                   │
│  │ Your Apps (Pods)  │                   │
│  │ - API             │                   │
│  │ - Worker          │                   │
│  └───────────────────┘                   │
└─────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│      Google Cloud (Fully Managed)       │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Google Managed Prometheus      │    │
│  │  - Storage: Auto-scaling        │    │
│  │  - Retention: 15 days default   │    │
│  │  - Query: PromQL compatible      │    │
│  │  - No server to manage          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Cloud Monitoring               │    │
│  │  - Dashboards                   │    │
│  │  - Alerting policies            │    │
│  │  - SLO monitoring               │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**GMP vs Self-Hosted Prometheus:**

| Feature               | Self-Hosted          | Google Managed Prometheus |
| --------------------- | -------------------- | ------------------------- |
| **Server management** | You run pods         | Google manages completely |
| **Storage**           | Manual PVC sizing    | Auto-scaling              |
| **Retention**         | Configure manually   | 15 days (configurable)    |
| **Scaling**           | Manual replica count | Automatic                 |
| **Backup**            | Self-managed         | Built-in                  |
| **PromQL**            | ✅                   | ✅                        |
| **Grafana support**   | ✅                   | ✅ (via data source)      |

**Cost model:**

- **Ingestion**: Per metric sample ingested (first 50M samples/month free)
- **Storage**: Included in ingestion cost for 15 days
- **Query**: No additional cost for queries

**When to use GMP:**

- ✅ Don't want to manage Prometheus infrastructure
- ✅ Already using GKE and other Google Cloud services
- ✅ Need Prometheus-style monitoring (PromQL, exporters)
- ✅ Want integration with Cloud Monitoring

**When NOT to use GMP:**

- ❌ Need multi-cloud monitoring (not locked to GCP)
- ❌ Require long retention without exporting
- ❌ Want full control over Prometheus configuration

</details>

### Does GMP include Grafana?

<details>
<summary>Answer</summary>

**No** - Google Managed Prometheus (GMP) is only the managed Prometheus service. It does **not** include Grafana.

**Options for visualization with GMP:**

| Option                          | Description                                     | Setup                                |
| ------------------------------- | ----------------------------------------------- | ------------------------------------ |
| **Self-hosted Grafana**         | Deploy Grafana on GKE, use GMP as data source   | Helm chart or manual deployment      |
| **Google Managed Grafana**      | GCP-hosted Grafana (connects GMP automatically) | GCP Console (if available in region) |
| **Cloud Monitoring Dashboards** | Native GCP dashboards using GMP metrics         | Console-based, no additional setup   |

**Connecting Self-Hosted Grafana to GMP:**

```yaml
# Grafana data source configuration
apiVersion: 1
datasources:
  - name: GMP
    type: prometheus
    url: https://monitoring.googleapis.com/v1/projects/PROJECT_ID/location/global/prometheus/api/v1/query
    access: proxy
    jsonData:
      httpMethod: POST
      manageAlerts: false
      prometheusType: Prometheus
      prometheusVersion: 2.40.0
      cacheLevel: "High"
      incrementalQuerying: true
    secureJsonData:
      httpHeaderValue1: "Bearer $__token"
```

**Recommended approach:**

For most use cases:

- **Development/Simple**: Use Cloud Monitoring dashboards (no extra setup)
- **Production/Advanced**: Deploy self-hosted Grafana + connect GMP
- **GCP-native**: Check if Google Managed Grafana available in your region

</details>

### What are Cloud Monitoring Dashboards?

<details>
<summary>Answer</summary>

**Cloud Monitoring Dashboards** are Google Cloud's native visualization tool for metrics, built into the Google Cloud Console.

**What it is:**

- **Fully managed** dashboards in GCP (no deployment needed)
- Visualizes metrics from GMP, Cloud Monitoring, and Logs
- Drag-and-drop interface in [Google Cloud Console](https://console.cloud.google.com/monitoring/dashboards)
- No infrastructure to manage

**Example dashboard:**

```
┌─────────────────────────────────────────────┐
│  Google Cloud Console → Monitoring         │
│                                             │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │ CPU Usage       │  │ Memory Usage    │  │
│  │ [=======   ]    │  │ [========  ]    │  │
│  │ 70%             │  │ 80%             │  │
│  └─────────────────┘  └─────────────────┘  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Request Latency (p99)               │   │
│  │    ╱╲    ╱╲    ╱╲                  │   │
│  │   ╱  ╲  ╱  ╲  ╱  ╲                 │   │
│  │  ╱    ╲╱    ╲╱    ╲                │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Error Rate      │  │ Active Users    │  │
│  │ 0.5%            │  │ 1,234           │  │
│  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────┘
```

**Pros:**

- ✅ **Zero setup** - already available in GCP
- ✅ **Native integration** with GMP, Cloud SQL, GKE, Load Balancers
- ✅ **Auto-scaling** storage and retention
- ✅ **Built-in alerting** - create alerts directly from dashboards
- ✅ **Shareable** - share with team or embed in docs
- ✅ **Pre-built dashboards** for common GCP services

**Cons:**

- ❌ Less flexible than Grafana (fewer visualization options)
- ❌ No community plugins or dashboards
- ❌ GCP lock-in (can't export to other platforms)
- ❌ Limited customization compared to Grafana

**When to use:**

| Scenario                         | Recommendation                  |
| -------------------------------- | ------------------------------- |
| Quick start, minimal setup       | **Cloud Monitoring Dashboards** |
| Simple monitoring needs          | **Cloud Monitoring Dashboards** |
| Advanced visualizations, plugins | **Grafana**                     |
| Multi-cloud monitoring           | **Grafana**                     |
| Custom business metrics          | **Grafana**                     |

**Creating a dashboard:**

1. Go to [Cloud Monitoring → Dashboards](https://console.cloud.google.com/monitoring/dashboards)
2. Click "Create Dashboard"
3. Add widgets (Line chart, Bar chart, Scorecard, etc.)
4. Select metrics from GMP or Cloud Monitoring
5. Save and share

</details>
