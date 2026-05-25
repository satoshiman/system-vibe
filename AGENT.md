# SystemVibe - Distributed Task Processing Platform

**Tagline**: _Learn production-grade system design through building a distributed task queue with Redis, Docker, workers, events, and complete observability._

**Status**: Open-source learning project | **Timeline**: 4-6 weeks | **Target**: Junior backend developers & DevOps engineers

---

## 1. Project Vision & Goals

### 1.1 Core Vision

**SystemVibe** is a production-style distributed task processing platform designed as a comprehensive learning project. It demonstrates how to build scalable backend systems using:

- **Event-driven architecture** with Redis Streams for async processing
- **Worker-based job queue** pattern using BullMQ
- **Real-time communication** via WebSockets and Redis Pub/Sub
- **Complete observability** with metrics, logging, and distributed tracing
- **Containerized infrastructure** with Docker Compose

By building SystemVibe, developers learn not just _what_ distributed systems are, but _how to build them in production_.

### 1.2 Primary Learning Outcomes

**PRIMARY GOAL: Practical Redis Mastery at Scale**

After completing SystemVibe, you will be a Redis expert who can:

- Design and implement production-grade Redis patterns for different use cases
- Understand when to use Queues vs. Streams vs. Pub/Sub vs. Caching
- Build distributed systems that rely on Redis as the coordination backbone
- Optimize Redis for performance and manage memory efficiently
- Debug Redis issues in production environments

**Secondary Learning Outcomes:**

1. **Redis Patterns Deep Dive** (Core Focus)
   - **Queues**: BullMQ for reliable job processing with retries
   - **Caching**: TTL strategies, cache invalidation patterns, hot/cold data
   - **Pub/Sub**: Real-time messaging, multi-subscriber coordination
   - **Streams**: Event sourcing, consumer groups, durable logs
   - **Atomic Operations**: INCR for rate limiting, SET NX for locks
   - **Session Storage**: User session management with expiration
   - **Performance**: Pipeline commands, connection pooling, memory optimization

2. **Production Backend Architecture**
   - Modular monolith patterns with clear separation of concerns
   - API servers, queue systems, and worker processes
   - Horizontal scaling of worker replicas

3. **Event-Driven Systems**
   - Domain events flowing through the system
   - Multiple consumers processing the same event
   - Eventual consistency patterns
   - Event sourcing mindset

4. **Observability & Production Readiness**
   - Structured logging with correlation IDs
   - Metrics collection and visualization
   - Distributed tracing concepts
   - Health checks and alerting
   - Log aggregation

5. **Docker & Infrastructure**
   - Multi-container orchestration
   - Service discovery and networking
   - Container-to-container communication
   - Development vs. production configurations

---

## 2A. Redis Mastery Roadmap

This is your guide to becoming a Redis expert through SystemVibe. Each phase teaches specific Redis patterns and trade-offs.

### Pattern 1: Queues with BullMQ (Phase 3)

**What You'll Learn**:

- How job queues work under the hood (Streams-based)
- FIFO ordering vs. priority queues
- Job states and transitions
- Reliability: acknowledgments and retries
- Dead letter queues for unrecoverable failures
- Scaling: multiple workers consuming from same queue

**Real-World Use Cases**:

```
- Background job processing
- Task scheduling
- Email delivery
- Image/video processing
- Payment processing pipelines
```

**Key Commands**:

```redis
XADD queue:image job-123
XLEN queue:image
XREAD COUNT 1 STREAMS queue:image 0
XACK queue:image consumer-group job-123
```

**Metrics to Track**:

- Queue depth (jobs waiting)
- Processing rate (jobs/second)
- P99 latency (how long jobs wait)
- Dead letter queue size

---

### Pattern 2: Caching with TTL (Phase 6)

**What You'll Learn**:

- Cache strategy: write-through vs. write-behind
- TTL (Time To Live) for automatic expiration
- Cache invalidation strategies
- Cache warming and preloading
- Hit/miss ratios and performance impact
- Memory management and eviction policies

**Real-World Use Cases**:

```
- Database query result caching
- API response caching
- User preference caching
- Hot data acceleration
```

**Key Commands**:

```redis
SET cache:user:123 '{"name":"John"}' EX 3600
GET cache:user:123
TTL cache:user:123
DEL cache:user:123  # Invalidate
EXPIRE cache:user:123 7200  # Update TTL
```

**Cache Strategies You'll Implement**:

```typescript
// Strategy 1: Cache-Aside (Lazy Loading)
async function getUser(id) {
  const cached = await redis.get(`cache:user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.getUser(id);
  await redis.set(`cache:user:${id}`, JSON.stringify(user), "EX", 3600);
  return user;
}

// Strategy 2: Write-Through
async function updateUser(id, data) {
  const user = await db.updateUser(id, data);
  await redis.set(`cache:user:${id}`, JSON.stringify(user), "EX", 3600);
  return user;
}

// Strategy 3: Cache Invalidation on Update
async function deleteUser(id) {
  await db.deleteUser(id);
  await redis.del(`cache:user:${id}`);
}
```

**Monitoring**:

- Cache hit rate: (hits / (hits + misses)) \* 100
- Memory usage trend
- Eviction rate

---

### Pattern 3: Pub/Sub for Real-Time Events (Phase 5)

**What You'll Learn**:

- Publisher/Subscriber pattern
- Multiple subscribers on same channel
- Fire-and-forget messaging (no persistence)
- Message ordering and delivery guarantees
- Use cases where Pub/Sub is appropriate (vs. Streams)
- Performance characteristics

**Real-World Use Cases**:

```
- Real-time notifications
- Chat messages
- Live event streaming
- Progress updates
- Status broadcasts
```

**Key Commands**:

```redis
PUBLISH job:completed '{"jobId":"123","status":"COMPLETED"}'
SUBSCRIBE job:completed
PSUBSCRIBE job:*  # Pattern subscription
UNSUBSCRIBE
PUBSUB CHANNELS
PUBSUB NUMSUB job:completed
```

**Architecture Pattern**:

```
Worker publishes:
PUBLISH job:progress:uuid {"progress":50,"eta":"5m"}
                    ↓
Redis routes to all subscribers
                    ↓
    API Server 1    API Server 2    API Server 3
    (broadcasts)    (broadcasts)    (broadcasts)
                    ↓
WebSocket clients receive real-time update
```

**Important Limitation**:

- Pub/Sub has NO message persistence
- If no subscriber is listening, message is lost
- Solution for critical events: use Streams instead

---

### Pattern 4: Streams for Durable Event Logs (Phase 9 - Nice-to-Have)

**What You'll Learn**:

- Event sourcing pattern
- Consumer groups for distributed processing
- Message persistence and replay
- Exactly-once processing semantics
- Trade-offs vs. Pub/Sub (slower but durable)

**Real-World Use Cases**:

```
- Audit logs
- Event sourcing
- Change data capture
- Message replay scenarios
```

**Key Commands**:

```redis
XADD stream:events * field value
XLEN stream:events
XREAD COUNT 10 STREAMS stream:events 0
XGROUP CREATE stream:events consumer-group 0
XREADGROUP GROUP consumer-group consumer STREAMS stream:events >
XACK stream:events consumer-group message-id
```

**Pub/Sub vs. Streams Comparison**:

```
                    Pub/Sub          Streams
Persistence         ✗ None           ✓ Durable
Replay              ✗ Impossible     ✓ Possible
Consumer Groups     ✗ No             ✓ Yes
Ordering            ✓ Yes            ✓ Yes
Use When            Real-time only   Need durability
Performance         Faster           Slightly slower
```

---

### Pattern 5: Atomic Operations for Rate Limiting (Phase 8)

**What You'll Learn**:

- Atomic increment operations
- Distributed rate limiting algorithms
- Token bucket pattern
- Sliding window approach
- Race condition prevention

**Real-World Use Cases**:

```
- API rate limiting
- User throttling
- Anti-spam protection
- Resource quota enforcement
```

**Key Commands**:

```redis
INCR rate_limit:user:123
EXPIRE rate_limit:user:123 3600
SET rate_limit:user:123 0 EX 3600
GETEX rate_limit:user:123 EX 3600
```

**Implementation - Fixed Window**:

```typescript
async function isRateLimited(userId: string, limit: number): Promise<boolean> {
  const key = `rate_limit:user:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    // First request in this window
    await redis.expire(key, 3600); // 1 hour window
  }

  return current > limit;
}
```

**Implementation - Sliding Window with Streams** (More accurate):

```typescript
async function isRateLimited(userId: string, limit: number, window: number) {
  const key = `rate_limit:${userId}`;
  const now = Date.now();
  const windowStart = now - window * 1000;

  // Remove old requests
  await redis.zremrangebyscore(key, "-inf", windowStart);

  // Count recent requests
  const count = await redis.zcard(key);

  if (count >= limit) {
    return true;
  }

  // Add current request
  await redis.zadd(key, now, `${now}-${Math.random()}`);
  await redis.expire(key, window);

  return false;
}
```

**Metrics to Track**:

- Rate limit hit rate (how often users get throttled)
- Limit effectiveness (are aggressive users stopped?)

---

### Pattern 6: Distributed Locks (Phase 11 - Nice-to-Have)

**What You'll Learn**:

- Race condition prevention
- Lock ownership and timeouts
- Deadlock avoidance
- RedLock algorithm
- Trade-offs between safety and complexity

**Real-World Use Cases**:

```
- Singleton cron job execution (only one instance runs)
- Preventing duplicate processing
- Exclusive resource access
- Distributed transactions
```

**Key Commands**:

```redis
SET lock:job:123 unique-token NX EX 30
GET lock:job:123
DEL lock:job:123
```

**Simple Lock Implementation**:

```typescript
async function acquireLock(key: string, ttl: number): Promise<string | null> {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, "NX", "EX", ttl);
  return result ? token : null; // result is 'OK' or null
}

async function releaseLock(key: string, token: string): Promise<boolean> {
  // Must check token to prevent releasing another process's lock
  const current = await redis.get(key);
  if (current === token) {
    await redis.del(key);
    return true;
  }
  return false;
}

// Usage
const token = await acquireLock("lock:webhook:123", 30);
if (token) {
  try {
    await processWebhook();
  } finally {
    await releaseLock("lock:webhook:123", token);
  }
}
```

---

### Pattern 7: Session Storage (Phase 2)

**What You'll Learn**:

- Session persistence
- TTL for automatic cleanup
- Session invalidation on logout
- Session data structure (what to store)

**Real-World Use Cases**:

```
- User authentication sessions
- API token blacklisting
- Temporary user state
```

**Key Commands**:

```redis
SET session:uuid '{"userId":"123","roles":["admin"]}' EX 86400
GET session:uuid
DEL session:uuid  # Logout
EXPIREAT session:uuid timestamp
```

---

### Pattern 8: Sorted Sets for Leaderboards & Metrics (Bonus)

**What You'll Learn**:

- Sorted sets for ranking
- Score-based operations
- Real-time calculations
- Efficient range queries

**Real-World Use Cases**:

```
- Job processing leaderboards
- Worker performance rankings
- Time-series metrics
- Priority queues
```

**Key Commands**:

```redis
ZADD leaderboard 100 "worker-1"
ZADD leaderboard 150 "worker-2"
ZRANGE leaderboard 0 -1 WITHSCORES  # Get all
ZREVRANGE leaderboard 0 9  # Top 10
ZRANK leaderboard "worker-1"  # Position
ZSCORE leaderboard "worker-1"  # Score
ZINCRBY leaderboard 50 "worker-1"  # Increment
```

---

### Pattern 9: Pipelining for Performance (Optimization)

**What You'll Learn**:

- Batch Redis commands
- Reduce round-trip latency
- Transaction semantics
- Performance gains (10-100x faster for bulk operations)

**Key Commands**:

```redis
MULTI
SET key1 value1
SET key2 value2
INCR counter
EXEC
```

**Implementation in TypeScript**:

```typescript
// Without pipeline (slow)
for (let i = 0; i < 1000; i++) {
  await redis.set(`key:${i}`, `value${i}`); // 1000 round trips
}

// With pipeline (fast)
const pipeline = redis.pipeline();
for (let i = 0; i < 1000; i++) {
  pipeline.set(`key:${i}`, `value${i}`);
}
await pipeline.exec(); // 1 round trip
```

---

### Pattern 10: Connection Pooling & Performance Tuning (Advanced)

**What You'll Learn**:

- Connection pool configuration
- Maxmemory policies
- Key eviction strategies
- Memory optimization
- Monitoring Redis performance

**Configuration**:

```javascript
const redis = new Redis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: true,
  connectTimeout: 10000,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  // Connection pool
  connectionPoolSize: 100,
});
```

**Monitoring Commands**:

```redis
INFO memory  # Memory usage
INFO stats   # Stats
DBSIZE       # Number of keys
SLOWLOG GET 10  # Slow queries
MONITOR      # Live command stream
```

---

### Redis Patterns Summary Table

| Pattern             | Phase | Use Case                 | Trade-off                  |
| ------------------- | ----- | ------------------------ | -------------------------- |
| **Queues (BullMQ)** | 3     | Reliable async jobs      | Need worker infrastructure |
| **Caching**         | 6     | Reduce DB load           | Invalidation complexity    |
| **Pub/Sub**         | 5     | Real-time broadcasts     | No persistence             |
| **Streams**         | 9+    | Durable events           | Slower than Pub/Sub        |
| **Rate Limiting**   | 8     | Protect API              | Redis dependency           |
| **Locks**           | 11+   | Distributed coordination | Complexity, deadlock risk  |
| **Sessions**        | 2     | Store auth state         | Session size limits        |
| **Sorted Sets**     | Bonus | Ranking/leaderboards     | Memory for large datasets  |
| **Pipelining**      | -     | Batch operations         | Less granular control      |
| **Connection Pool** | -     | Performance              | Configuration complexity   |

---

### 2.1 Primary Users

- **Junior Backend Developers**: Learning how systems scale beyond monoliths
- **DevOps/Infrastructure Engineers**: Understanding Redis patterns and containerization
- **Engineering Teams**: Seeking reference architecture for similar platforms
- **Open-Source Contributors**: Learning distributed systems by contributing
- **Companies**: Building internal async job processing platforms

### 2.2 Success Metrics

**For Learning**:

- Developer can explain all 12 core Redis patterns by end
- Successfully deploys multi-worker system and scales it horizontally
- Understands trade-offs between consistency, availability, and partition tolerance

**For Project**:

- 100+ GitHub stars by month 3 (community validation)
- Clear, reproducible example that works out-of-the-box
- Production-ready code quality (not just demo code)

---

## 3. Core Workflows & User Stories

### 3.1 Primary Workflow: Job Submission & Processing

A typical end-to-end flow:

```
1. CLIENT SUBMITS JOB
   → Client POST /jobs { type: "image-resize", payload: {...} }
   → API validates input, creates Job record in PostgreSQL
   → Job status: PENDING

2. API ENQUEUES TASK
   → API pushes job to Redis queue (BullMQ)
   → Job moves to QUEUED status
   → WebSocket notifies client: "Job queued"

3. WORKER PICKS UP JOB
   → Worker A pulls from queue
   → Job status changes to PROCESSING
   → Real-time event: "job:processing" published to client
   → Worker executes job logic (e.g., image resize)

4. WORKER COMPLETES/FAILS
   → Success: Job marked COMPLETED, result stored
   → Failure: Retry queued automatically (exponential backoff)
   → Event published: "job:completed" or "job:failed"
   → WebSocket notifies client with result

5. CLIENT RETRIEVES RESULT
   → Client polls GET /jobs/{id} or receives WebSocket notification
   → Returns job status and result
```

### 3.2 Secondary Workflows

1. **Monitor Queue Health**
   - DevOps views dashboard showing queue depth, processing latency, failed jobs
   - Alerts trigger if queue backlog exceeds threshold

2. **Scale Workers Horizontally**
   - DevOps runs: `docker-compose up --scale worker=5`
   - 5 worker instances automatically coordinate via Redis
   - Job distribution is automatic (no manual routing needed)

3. **Webhook Notifications**
   - Job completion triggers webhook call to external system
   - Retry on webhook failure with exponential backoff

4. **Real-time Progress Tracking**
   - Long-running job (video processing) publishes progress events
   - Client receives real-time updates via WebSocket
   - Shows "50% complete" without polling

---

## 4. Data Model & Domain Entities

### 4.1 Core Entities

#### **Entity: Job**

Primary entity representing a unit of work

```
Job {
  id: UUID
  type: "image-resize" | "video-transcode" | "ai-inference" | "email-send"
  userId: UUID (who submitted the job)

  // Input data
  payload: JSON (job-specific input)

  // Processing tracking
  status: PENDING | QUEUED | PROCESSING | COMPLETED | FAILED | CANCELLED
  createdAt: DateTime
  startedAt: DateTime?
  completedAt: DateTime?

  // Results
  result: JSON? (output after completion)
  error: String? (error message if failed)

  // Retry tracking
  attemptCount: Int (current attempt number)
  maxRetries: Int (default: 3)
  nextRetryAt: DateTime?

  // Metadata
  priority: "low" | "normal" | "high" (default: normal)
  timeout: Int (seconds, default: 3600)
  webhookUrl: String? (notify on completion)

  // Indexing
  indexes: [userId, status, createdAt, type]
}
```

**Key Design Decisions**:

- `status` transitions: PENDING → QUEUED → PROCESSING → COMPLETED/FAILED
- Once COMPLETED or FAILED, no further transitions
- If FAILED and retries remaining: move back to QUEUED
- CANCELLED is terminal (no further action)
- `payload` and `result` are untyped JSON for flexibility across job types

**State Transition Diagram**:

```
PENDING → QUEUED → PROCESSING → COMPLETED ✓
                       ↓
                    FAILED (if maxRetries exceeded) ✓
                       ↓
                    QUEUED (if retries remain)

At any point → CANCELLED ✓
```

---

#### **Entity: Worker**

Represents an active worker instance processing jobs

```
Worker {
  id: UUID
  instanceId: String (e.g., "worker-ai-1", "worker-image-2")
  type: "ai" | "image" | "video" | "email"

  // Health tracking
  status: ACTIVE | IDLE | PAUSED | OFFLINE
  lastHeartbeat: DateTime

  // Performance metrics
  jobsProcessed: Int (total in session)
  successCount: Int
  failureCount: Int
  totalProcessingTime: Int (seconds)

  // Current job
  currentJobId: UUID?
  currentJobStartTime: DateTime?

  createdAt: DateTime
  updatedAt: DateTime

  // Indexing
  indexes: [type, status, lastHeartbeat]
}
```

**Purpose**:

- Track which workers are alive (periodic heartbeat to Redis)
- Monitor worker performance and health
- Display in dashboard "3/5 image workers online"

---

#### **Entity: Event**

Represents system events in the event log (optional but recommended)

```
Event {
  id: UUID
  eventType: "job.created" | "job.queued" | "job.started" |
             "job.completed" | "job.failed" | "job.retried" |
             "worker.online" | "worker.offline"

  jobId: UUID? (if job-related)
  workerId: UUID? (if worker-related)

  payload: JSON (event-specific data)
  metadata: {
    timestamp: DateTime
    source: String (which service/worker)
    correlationId: String (for tracing)
    userId: UUID?
  }

  createdAt: DateTime

  // Indexing
  indexes: [jobId, eventType, createdAt]
}
```

**Purpose**:

- Complete audit trail of what happened
- Enables event sourcing pattern
- Can replay events for debugging

---

### 4.2 Entity Relationships

```
Job (one) ──────→ (many) Event
   ↓
 User
   ↓
Worker (processes) → Job
```

**Key Relationships**:

- One Job generates multiple Events (created, queued, started, completed)
- One User submits many Jobs
- One Worker processes many Jobs sequentially
- One Worker belongs to one type (e.g., "image" worker only processes image jobs)

---

### 4.3 Data Constraints & Business Rules

1. **Job Lifetime**: Once completed or failed (with no retries left), never changes
2. **Retry Logic**: Exponential backoff - 2^attemptCount seconds wait
3. **Timeout**: If job processing exceeds timeout, kill it and mark FAILED
4. **Priority**: High-priority jobs are processed before normal ones
5. **Worker Type Isolation**: Image jobs only go to image workers
6. **Webhook Retries**: Webhook calls retry up to 3 times with exponential backoff

---

## 5. Tech Stack & Architecture

### 5.1 Technology Choices

| Layer                | Technology                | Rationale                                |
| -------------------- | ------------------------- | ---------------------------------------- |
| **API Server**       | NestJS + TypeScript       | Production-grade, modular, built-in DI   |
| **Database**         | PostgreSQL + Prisma ORM   | Relational model fits job metadata well  |
| **Queue & Cache**    | Redis + BullMQ            | Industry standard, high performance      |
| **Event Streaming**  | Redis Streams             | Built into Redis, simple distributed log |
| **Real-time**        | Socket.IO + Redis Adapter | WebSockets with automatic clustering     |
| **Media Processing** | Sharp, FFmpeg             | Industry standard libraries              |
| **Logging**          | Pino + Loki               | High-performance structured logging      |
| **Monitoring**       | Prometheus + Grafana      | Standard observability stack             |
| **Containerization** | Docker + Docker Compose   | Local dev and demo deployment            |

### 5.2 System Architecture

```
                    ┌──────────────────┐
                    │   Web Client     │
                    │  (Browser/App)   │
                    └────────┬─────────┘
                             │
                     HTTP + WebSocket
                             │
         ┌───────────────────┴────────────────────┐
         │                                        │
         v                                        v
    ┌─────────┐                          ┌──────────────┐
    │ API GW  │                          │  Socket.IO   │
    │(Nginx)  │                          │  Server      │
    └────┬────┘                          └──────┬───────┘
         │                                      │
         v                                      v
    ┌─────────────────────────────────────────────────┐
    │         NestJS API Server (Monolith)             │
    │                                                   │
    │  Auth    │  Jobs   │  Workers  │  Webhooks      │
    │  Module  │ Module  │  Module   │  Module        │
    └────────┬─────────────────────────────────────────┘
             │
    ┌────────┴────────────────────────────┐
    │                                      │
    v                                      v
┌─────────────┐                    ┌──────────────┐
│ PostgreSQL  │                    │    Redis     │
│             │                    │              │
│ - Jobs      │                    │ - Queue      │
│ - Users     │                    │ - Cache      │
│ - Workers   │                    │ - Pub/Sub    │
│ - Events    │                    │ - Streams    │
└─────────────┘                    └──────┬───────┘
                                          │
         ┌────────────────────────────────┼────────────────────────────┐
         │                                │                            │
         v                                v                            v
    ┌──────────┐                  ┌──────────────┐            ┌──────────────┐
    │  Worker  │                  │   Worker     │   ...      │   Worker     │
    │  AI      │                  │   Image      │            │   Video      │
    │ (x1-5)   │                  │  (x1-10)     │            │  (x1-5)      │
    │          │                  │              │            │              │
    │ Process: │                  │ Process:     │            │ Process:     │
    │ - Embed. │                  │ - Resize     │            │ - Transcode  │
    │ - Summ.  │                  │ - Thumbnail  │            │ - HLS Gen    │
    │ - Tags   │                  │ - Compress   │            │ - Thumbnail  │
    └──────────┘                  └──────────────┘            └──────────────┘

    ┌──────────────────────┐      ┌──────────────────────┐
    │   Prometheus         │      │     Grafana          │
    │   (Metrics)          │      │  (Dashboards)        │
    └──────────────────────┘      └──────────────────────┘

    ┌──────────────────────┐      ┌──────────────────────┐
    │   Loki               │      │   Pino (Logs)        │
    │   (Log Storage)      │      │   (Log Client)       │
    └──────────────────────┘      └──────────────────────┘
```

### 5.3 Redis Usage Breakdown

| Feature               | Redis Structure                  | Use Case                              |
| --------------------- | -------------------------------- | ------------------------------------- |
| **Job Queue**         | BullMQ (uses Streams under hood) | Queue and distribute jobs to workers  |
| **Cache**             | Key-Value with TTL               | Cache expensive API responses         |
| **Real-time Events**  | Pub/Sub channels                 | Push job updates to connected clients |
| **Progress Tracking** | Pub/Sub + simple KV              | Long-running jobs publish progress    |
| **Worker Heartbeat**  | Key-Value with TTL               | Track if worker is alive              |
| **Rate Limiting**     | Atomic INCR with TTL             | Throttle job submissions per user     |
| **Session Storage**   | Key-Value with TTL               | Store user sessions (optional)        |
| **Distributed Lock**  | SET NX with TTL                  | Prevent duplicate webhook calls       |
| **Event Stream**      | Redis Streams                    | Durable event log (optional V2)       |

### 5.4 Data Flow Examples

**Example 1: Image Resize Job**

```
1. Client: POST /jobs { type: "image-resize", payload: { url, width, height } }
2. API: Create Job record (status: PENDING)
3. API: Enqueue to BullMQ (queue: "image")
4. API: Return job ID to client
5. Worker (image): Dequeue from "image" queue
6. Worker: Update Job status → PROCESSING
7. Worker: Download image, resize using Sharp
8. Worker: Upload result to object storage
9. Worker: Update Job { status: COMPLETED, result: { imageUrl } }
10. API/WebSocket: Notify client job is done
```

**Example 2: Webhook Notification**

```
1. Job completes with status COMPLETED
2. API checks if job.webhookUrl is set
3. API enqueues webhook task to "webhook" queue
4. Webhook Worker dequeues
5. Worker HTTP POST to webhookUrl with job result
6. If 200 response: mark webhook as delivered
7. If error: retry with exponential backoff (3 retries)
8. If all retries fail: log and alert
```

**Example 3: Real-time Progress**

```
1. Worker starts long-running job (video transcode)
2. Worker publishes to Redis pub/sub: "job:progress:{jobId}"
   → { progress: 25, message: "Analyzing video..." }
3. API receives and broadcasts to all connected WebSocket clients for this job
4. Client receives: { progress: 25 } and updates UI progress bar
5. Repeat every 10 seconds during processing
```

---

## 6. MVP Feature Set (4-6 Week Timeline)

### 6.1 Phase 1: Foundation (Week 1) ✅ COMPLETED

**Goal**: Get the basic infrastructure working

**Features**:

- [x] Docker Compose setup (API, PostgreSQL, Redis, Nginx)
- [x] NestJS project structure with proper modules
- [x] Database initialization and migrations
- [x] API health check endpoint
- [x] Basic error handling & logging setup
- [x] Environment configuration management
- [x] Swagger API documentation (@nestjs/swagger)
- [x] API README documentation

**Deliverables**:

- [x] `docker-compose up` works end-to-end
- [x] All services (API, DB, Redis) are healthy
- [x] Logs flow to console properly
- [x] Health endpoint: `GET /api/health` → `{ status: "healthy", services: {...} }`
- [x] Swagger UI available at `/api/docs`
- [x] API documentation in `apps/api/README.md`

**Learning**:

- Docker multi-container networking
- Service discovery patterns
- Environment management
- Modular project structure
- Swagger/OpenAPI documentation setup
- Centralized environment configuration with validation

**Environment Configuration**:

- Created `packages/config/` for centralized env management
- Uses Zod for runtime validation of environment variables
- Single source of truth for all env vars across services
- Type-safe configuration with TypeScript
- Fail-fast validation on startup if env vars are missing or invalid
- Docker Compose uses `env_file` to load `.env` from root
- All services import from `@systemvibe/config` instead of `process.env` directly

---

### 6.2 Phase 2: Authentication & Users (Week 1-2) ✅ COMPLETED

**Goal**: Implement auth system to track job submissions

**Features**:

- [x] User registration and login
- [x] JWT token generation
- [x] Refresh token mechanism
- [x] Auth guards on protected endpoints
- [x] User profile management
- [x] Session storage in Redis

**Deliverables**:

- [x] Register: `POST /auth/register` → JWT token
- [x] Login: `POST /auth/login` → JWT token + refresh token
- [x] Protected endpoints require Authorization header
- [x] Tokens store user ID and expiration

**Learning**:

- Auth flow implementation
- Redis TTL usage for sessions
- JWT security best practices
- Guards and interceptors in NestJS

---

### 6.3 Phase 3: Job Queue Basics (Week 2-3) ✅ COMPLETED

**Goal**: Implement core job submission and queue system

**Features**:

- [x] Job creation and storage (PostgreSQL)
- [x] Job enqueueing to Redis queue (BullMQ)
- [x] Job status tracking (PENDING → QUEUED → PROCESSING → COMPLETED/FAILED)
- [x] Job retrieval and filtering
- [x] Automatic retry on failure (exponential backoff)
- [x] Job timeout handling
- [x] Unit tests for JobsService
- [x] E2E tests for JobsController
- [x] Public jobs API (no authentication required)
- [x] Optional userId in Job entity

**API Endpoints**:

```
POST   /jobs                    # Submit new job (public, no auth)
GET    /jobs/{id}               # Get job by ID (public, no auth)
GET    /jobs                    # List all jobs (public, no auth)
DELETE /jobs/{id}               # Cancel job (public, no auth)
```

**Deliverables**:

- [x] Job entity in PostgreSQL
- [x] BullMQ queue setup and configuration
- [x] Job lifecycle management
- [x] Retry logic with exponential backoff
- [x] Unit tests (13 tests for JobsService)
- [x] E2E tests (18 tests for JobsController)
- [x] Public jobs API without authentication
- [x] BullMQ Board UI for queue monitoring at `/admin/queues`
- [x] Jest configuration for testing
- [x] Test scripts in package.json
- [x] BullMQ Board UI dashboard for queue monitoring (http://localhost:3000/admin/queues)

**Learning**:

- Producer/consumer pattern
- Async job processing
- Redis queue internals
- Job lifecycle management
- Testing strategies for job queues
- Mocking external dependencies in unit tests

---

### 6.4 Phase 4: Single Worker Type (Week 3)

**Goal**: Build first worker to process jobs

**Features**:

- [ ] Image Worker service (separate Docker container)
- [ ] Image processing jobs: resize, thumbnail, compress
- [ ] Worker picks jobs from BullMQ queue
- [ ] Worker updates job status
- [ ] Error handling and failure logging
- [ ] Worker health checks

**Worker Jobs**:

```
Job Type: "image-resize"
Payload: { imageUrl: string, width: number, height: number }
Result: { outputUrl: string, durationMs: number }

Job Type: "image-thumbnail"
Payload: { imageUrl: string, size: number }
Result: { thumbnailUrl: string }

Job Type: "image-compress"
Payload: { imageUrl: string, quality: number }
Result: { compressedUrl: string, originalSize: number, newSize: number }
```

**Deliverables**:

- [x] Worker Docker image that connects to Redis queue
- [x] Image processing using Sharp library
- [x] Proper error handling and logging
- [x] `docker-compose up --scale worker-image=3` works
- [x] Worker heartbeat mechanism for health monitoring
- [x] Graceful shutdown handling
- [x] Job event logging (active, completed, failed)

**Learning**:

- Worker architecture
- Long-running processes
- CPU-bound task handling
- Health monitoring
- Horizontal scaling

---

### 6.5 Phase 5: Real-time Updates via WebSocket (Week 3-4) ✅ COMPLETED

**Goal**: Push job status updates to clients in real-time

**Features**:

- [x] Socket.IO setup with Redis Pub/Sub
- [x] WebSocket gateway with job-specific rooms
- [x] Job status broadcast to interested clients
- [x] Progress updates from workers
- [x] Event channels for different job types

**Behavior**:

```
Client connects → Socket.IO authenticates with JWT
Client subscribes: socket.on("job:progress:{jobId}", (data) => {...})
Job status changes → Worker publishes to Redis pub/sub
API subscribes to Redis pub/sub and broadcasts to WebSocket clients
All connected clients for that job receive update immediately
```

**Deliverables**:

- [x] Socket.IO server with Redis Pub/Sub integration
- [x] Real-time job status updates
- [x] Client can watch job progress without polling
- [x] Automatic cleanup when client disconnects
- [x] Pub/Sub service for worker-to-API communication

**Learning**:

- WebSocket architecture
- Redis Pub/Sub for distributed messaging
- Real-time event distribution
- Socket.IO rooms for targeted updates

---

### 6.6 Phase 6: Monitoring & Logging (Week 4)

**Goal**: Observe what's happening in the system

**Features**:

- [ ] Structured logging (Pino) with correlation IDs
- [ ] Prometheus metrics collection
- [ ] Grafana dashboards
- [ ] Key metrics:
  - Queue depth (jobs waiting)
  - Processing latency (avg time to complete)
  - Worker uptime and health
  - Job success/failure rates
  - Redis memory usage
- [ ] Basic health check dashboard

**Metrics to Track**:

```
queue_size{queue="image"}           # Current jobs in queue
job_processing_time_seconds         # Time to complete
job_success_total{type="image"}     # Completed jobs
job_failure_total{type="image"}     # Failed jobs
worker_online{type="image"}         # Active workers
redis_memory_bytes                  # Redis usage
```

**Deliverables**:

- Prometheus scraping API metrics
- Grafana dashboard with key charts
- Correlation IDs in logs for tracing
- Health check endpoint returns detailed status

**Learning**:

- Observability fundamentals
- Metrics collection and visualization
- Distributed tracing concepts
- Production monitoring patterns

---

### 6.7 Phase 7: Webhook Notifications (Week 4)

**Goal**: Notify external systems when jobs complete

**Features**:

- [ ] Webhook URL in job payload
- [ ] Webhook delivery on job completion
- [ ] Retry logic for failed webhooks
- [ ] Webhook event signatures (HMAC)
- [ ] Webhook delivery logging

**Flow**:

```
Client submits job with webhookUrl: "https://example.com/callback"
Job completes
API enqueues webhook delivery task
Webhook Worker retrieves task
Worker POST to webhook URL with job result
Response 200 → Success
Response 5xx → Retry (exponential backoff, max 3 times)
```

**Deliverables**:

- Webhook delivery system with retry logic
- Security: HMAC signature on webhook payload
- Webhook delivery logs and status tracking

**Learning**:

- Reliable notification patterns
- HMAC security
- Callback mechanisms

---

### 6.8 Phase 8: Rate Limiting

**Goal**: Protect system from abuse

**Features**:

- [ ] User-based rate limiting (e.g., 100 jobs/hour)
- [ ] IP-based rate limiting
- [ ] Different limits for different job types
- [ ] Clear error messages when rate limited

**Implementation**:

```
Redis Key: rate_limit:user:{userId}:image
Value: count (number)
TTL: 1 hour
Logic: INCR key; if result > limit → reject
```

**Deliverables**:

- Rate limiting middleware
- Configurable limits per job type
- Clear 429 Too Many Requests responses

**Learning**:

- Distributed rate limiting
- Atomic Redis operations (INCR)
- API protection strategies

---

## 7. Nice-to-Have Features (V1.1, V2)

If timeline permits or after MVP:

- [ ] Event sourcing with Redis Streams
- [ ] Job scheduling (run at specific time)
- [ ] Job dependencies (job B waits for job A)
- [ ] Batch job processing
- [ ] Video worker (transcoding, HLS)
- [ ] AI worker (embeddings, summarization)
- [ ] Email worker (send email jobs)
- [ ] Queue priorities (high/normal/low)
- [ ] Job cancellation while processing
- [ ] Distributed tracing (Jaeger/Zipkin)
- [ ] Multi-region deployment
- [ ] Kubernetes manifests
- [ ] GraphQL API alternative

---

## 8. Data Model - Detailed Schema

### 8.1 PostgreSQL Schema

```sql
-- Users table
CREATE TABLE "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  passwordHash VARCHAR(255) NOT NULL,

  -- API quota
  maxJobsPerHour INT DEFAULT 100,
  maxConcurrentJobs INT DEFAULT 10,

  -- Status
  isActive BOOLEAN DEFAULT true,

  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),

  INDEX(email),
  INDEX(createdAt)
);

-- Jobs table
CREATE TABLE "job" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID REFERENCES "user"(id) ON DELETE CASCADE,

  -- Job metadata
  type VARCHAR(50) NOT NULL,  -- "image-resize", "video-transcode", etc
  priority VARCHAR(20) DEFAULT 'normal',  -- low, normal, high

  -- Input/Output
  payload JSONB NOT NULL,
  result JSONB,

  -- Status tracking
  status VARCHAR(50) DEFAULT 'PENDING',  -- PENDING, QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED

  -- Error details
  errorMessage TEXT,
  errorStack TEXT,

  -- Retry tracking
  attemptCount INT DEFAULT 0,
  maxRetries INT DEFAULT 3,
  nextRetryAt TIMESTAMP,

  -- Timing
  timeout INT DEFAULT 3600,  -- seconds
  startedAt TIMESTAMP,
  completedAt TIMESTAMP,

  -- Webhook
  webhookUrl VARCHAR(500),
  webhookDeliveredAt TIMESTAMP,
  webhookRetryCount INT DEFAULT 0,

  -- Metadata
  correlationId VARCHAR(255),

  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'normal', 'high')),

  INDEX(userId),
  INDEX(status),
  INDEX(type),
  INDEX(createdAt),
  INDEX(userId, createdAt),
  INDEX(status, type)
);

-- Workers table (for monitoring)
CREATE TABLE "worker" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  instanceId VARCHAR(255) UNIQUE NOT NULL,  -- e.g., "worker-image-1"
  type VARCHAR(50) NOT NULL,  -- "image", "video", "ai", "email"

  -- Health
  status VARCHAR(50) DEFAULT 'IDLE',  -- ACTIVE, IDLE, PAUSED, OFFLINE
  lastHeartbeat TIMESTAMP DEFAULT NOW(),

  -- Stats
  jobsProcessed INT DEFAULT 0,
  successCount INT DEFAULT 0,
  failureCount INT DEFAULT 0,
  totalProcessingTimeMs BIGINT DEFAULT 0,

  -- Current job
  currentJobId UUID REFERENCES "job"(id) ON DELETE SET NULL,
  currentJobStartTime TIMESTAMP,

  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),

  INDEX(type),
  INDEX(status),
  INDEX(lastHeartbeat)
);

-- Events table (for audit trail)
CREATE TABLE "event" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event metadata
  eventType VARCHAR(100) NOT NULL,  -- "job.created", "job.completed", etc
  jobId UUID REFERENCES "job"(id) ON DELETE CASCADE,
  workerId UUID REFERENCES "worker"(id) ON DELETE SET NULL,

  -- Payload and context
  payload JSONB,
  correlationId VARCHAR(255),
  source VARCHAR(100),  -- which service

  createdAt TIMESTAMP DEFAULT NOW(),

  INDEX(jobId),
  INDEX(eventType),
  INDEX(createdAt)
);
```

### 8.2 Redis Data Structures

```redis
# BullMQ Queues (auto-managed by BullMQ)
bull:image:queue
bull:image:active
bull:image:completed
bull:image:failed

# Cache keys
cache:job:{jobId}
cache:user:{userId}:stats

# Session storage
session:{sessionId}

# Rate limiting
rate_limit:user:{userId}:image
rate_limit:ip:{ipAddress}

# Worker heartbeat
worker:heartbeat:{workerId}

# Real-time progress (Pub/Sub channels)
job:progress:{jobId}
job:completed:{jobId}
worker:online
worker:offline

# Locks (for distributed coordination)
lock:job:{jobId}:webhook
lock:cron:daily-report
```

---

## 9. API Specification

### 9.1 Authentication Endpoints

```http
POST /auth/register
Content-Type: application/json
Body: {
  "email": "user@example.com",
  "password": "securepass",
  "name": "John Doe"
}
Response 201: {
  "user": { "id", "email", "name" },
  "tokens": { "accessToken", "refreshToken" }
}

POST /auth/login
Body: { "email", "password" }
Response 200: { "tokens": { "accessToken", "refreshToken" } }

POST /auth/refresh
Body: { "refreshToken" }
Response 200: { "accessToken", "refreshToken" }

POST /auth/logout
Headers: { "Authorization": "Bearer {token}" }
Response 200: { "message": "Logged out" }
```

### 9.2 Job Endpoints

```http
POST /jobs
Headers: { "Authorization": "Bearer {token}" }
Content-Type: application/json
Body: {
  "type": "image-resize",
  "priority": "normal",
  "payload": {
    "imageUrl": "https://...",
    "width": 800,
    "height": 600
  },
  "webhookUrl": "https://example.com/callback",
  "timeout": 3600
}
Response 201: {
  "job": {
    "id": "uuid",
    "type": "image-resize",
    "status": "PENDING",
    "createdAt": "2025-01-01T10:00:00Z"
  }
}

GET /jobs/{id}
Headers: { "Authorization": "Bearer {token}" }
Response 200: {
  "job": {
    "id", "type", "status", "payload", "result",
    "attemptCount", "createdAt", "startedAt", "completedAt"
  }
}

GET /jobs?type=image-resize&status=COMPLETED&limit=10&offset=0
Headers: { "Authorization": "Bearer {token}" }
Response 200: {
  "jobs": [...],
  "total": 42,
  "limit": 10,
  "offset": 0
}

DELETE /jobs/{id}
Headers: { "Authorization": "Bearer {token}" }
Response 200: { "message": "Job cancelled" }
```

### 9.3 Worker Endpoints

```http
GET /workers
Response 200: {
  "workers": [
    {
      "id", "instanceId", "type", "status",
      "jobsProcessed", "successCount", "failureCount",
      "currentJobId", "lastHeartbeat"
    }
  ]
}

GET /workers/{type}
Response 200: {
  "type": "image",
  "online": 3,
  "offline": 0,
  "workers": [...]
}
```

### 9.4 Health & Monitoring Endpoints

```http
GET /health
Response 200: {
  "status": "healthy",
  "timestamp": "2025-01-01T10:00:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "queue": {
      "image": { "size": 5, "processing": 2 },
      "video": { "size": 0, "processing": 0 }
    },
    "workers": {
      "image": { "online": 3, "offline": 0 },
      "video": { "online": 1, "offline": 0 }
    }
  }
}

GET /metrics
Response: Prometheus format metrics

GET /events?limit=50&offset=0
Response 200: {
  "events": [
    {
      "id", "eventType", "jobId", "workerId",
      "payload", "correlationId", "createdAt"
    }
  ],
  "total": 1000
}
```

### 9.5 WebSocket Events

```javascript
// Connect
socket.on("connect", () => {
  socket.emit("authenticate", { token: "jwt-token" });
});

// Subscribe to job updates
socket.emit("subscribe:job", { jobId: "uuid" });

// Receive job status updates
socket.on("job:status", (data) => {
  console.log({ status, updatedAt });
});

// Receive progress updates
socket.on("job:progress", (data) => {
  console.log({ progress: 0 - 100, message: "..." });
});

// Job completed
socket.on("job:completed", (data) => {
  console.log({ jobId, result });
});

// Job failed
socket.on("job:failed", (data) => {
  console.log({ jobId, errorMessage });
});
```

---

## 10. Architecture Decisions & Trade-offs

### 10.1 Why NestJS?

**Chosen**: NestJS + TypeScript

**Alternatives Considered**:

- Express: Too minimal, would build a lot of plumbing ourselves
- Fastify: Great performance, but less ecosystem for enterprise patterns

**Why NestJS**:

- Built-in dependency injection (perfect for testing)
- Module system (clear separation of concerns)
- Decorators for cleaner code
- Huge ecosystem and community
- Built for production-scale applications
- Easy to add middlewares, guards, interceptors

### 10.2 Why PostgreSQL + Prisma?

**Chosen**: PostgreSQL + Prisma ORM

**Why not MongoDB**:

- Job metadata has clear relational structure (user → jobs → events)
- PostgreSQL is more mature for transactions and constraints
- JSONB in PostgreSQL gives flexibility when needed

**Why Prisma**:

- Type-safe ORM (catches bugs at compile time)
- Auto-generated migrations
- Clear schema definition
- Better DX than raw SQL or other ORMs

### 10.3 Why BullMQ over native Redis?

**Chosen**: BullMQ for queue management

**Why not raw Redis**:

- BullMQ handles job retry logic, exponential backoff, scheduling
- Built-in monitoring and dashboards
- Cleaner API than raw Redis commands
- Handles edge cases (job timeouts, worker crashes, etc.)

**Why BullMQ**:

- Industry standard for Node.js job queues
- Well-maintained and battle-tested
- Good documentation and community

### 10.4 Why Redis Streams optional?

**Current**: Using BullMQ (Streams under the hood)

**Future (V2)**: Consider explicit event sourcing with Redis Streams

- Provides complete audit trail
- Enables event replay for debugging
- Fits event-driven architecture mindset
- But adds complexity, so deferred to V2

### 10.5 Why Docker Compose only (no K8s)?

**Chosen**: Docker Compose for MVP

**Why not Kubernetes immediately**:

- K8s is complex to learn alongside everything else
- Docker Compose is sufficient for learning core patterns
- Can be migrated to K8s later (V2)

**Future**: Add K8s manifests in V1.1

---

## 11. Code Organization & Modules

### 11.1 Monorepo Structure

```
systemvibe/
├── apps/
│   ├── api/                          # NestJS API server
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/             # Authentication
│   │       │   ├── users/            # User management
│   │       │   ├── jobs/             # Job submission & retrieval
│   │       │   ├── workers/          # Worker monitoring
│   │       │   ├── events/           # Event log
│   │       │   ├── webhooks/         # Webhook delivery
│   │       │   ├── queue/            # Queue integration
│   │       │   └── websocket/        # Socket.IO
│   │       ├── guards/               # Auth guards
│   │       ├── interceptors/         # Logging, error handling
│   │       ├── filters/              # Exception filters
│   │       └── app.module.ts
│   │
│   ├── worker-image/                 # Image processing worker
│   │   └── src/
│   │       ├── processors/
│   │       │   ├── resize.processor.ts
│   │       │   ├── thumbnail.processor.ts
│   │       │   └── compress.processor.ts
│   │       ├── services/
│   │       └── app.module.ts
│   │
│   ├── worker-video/                 # Video processing worker
│   ├── worker-ai/                    # AI inference worker
│   └── worker-email/                 # Email delivery worker
│
├── packages/                         # Shared packages
│   ├── redis/                        # Redis client configuration
│   ├── queue/                        # Queue setup & types
│   ├── logger/                       # Pino logger setup
│   ├── config/                       # Environment & config
│   ├── shared/                       # Shared types, constants, utilities
│   └── database/                     # Prisma schema & migrations
│
├── docker/                           # Docker configuration
│   ├── docker-compose.yml
│   └── nginx.conf
│
├── infra/                            # Infrastructure as Code
│   ├── prometheus/
│   ├── grafana/
│   ├── loki/
│   └── kubernetes/ (V2)
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATABASE.md
│   └── CONTRIBUTING.md
│
└── package.json                      # Monorepo root
```

### 11.2 NestJS API Modules

**auth.module.ts**

```typescript
// Responsible for: registration, login, token refresh, JWT validation
// Exports: AuthService, AuthGuard
```

**users.module.ts**

```typescript
// Responsible for: user profile, settings, quota management
// Depends on: auth, database
```

**jobs.module.ts**

```typescript
// Responsible for: job CRUD, job lifecycle, status updates
// Depends on: auth, queue, database, logger
// Exports: JobsService (used by API endpoints and workers)
```

**queue.module.ts**

```typescript
// Responsible for: BullMQ setup, queue configuration
// Provides: QueueService to other modules
// Exports: Job queues for different types
```

**workers.module.ts**

```typescript
// Responsible for: monitoring workers, health checks
// Depends on: database, redis
```

**events.module.ts**

```typescript
// Responsible for: event logging and audit trail
// Depends on: database
```

**webhooks.module.ts**

```typescript
// Responsible for: webhook delivery, retry logic
// Depends on: queue, jobs, logger
```

**websocket.module.ts**

```typescript
// Responsible for: Socket.IO setup, real-time updates
// Depends on: auth, redis adapter, jobs
// Exports: WebSocketGateway for event broadcasting
```

---

## 12. Development Workflow & Standards

### 12.1 Coding Standards

**TypeScript**:

```typescript
// ✅ DO: Use strict types
interface CreateJobDto {
  type: JobType; // Not `string`
  payload: Record<string, unknown>;
  webhookUrl?: string;
}

// ❌ DON'T: Use `any`
interface Job {
  payload: any; // ❌ Avoid
}
```

**Error Handling**:

```typescript
// ✅ DO: Create custom exceptions
throw new BadRequestException(
  "Job type must be one of: image-resize, video-transcode",
);

// ❌ DON'T: Throw raw errors
throw new Error("Something went wrong");
```

**Naming Conventions**:

```
- Files: kebab-case.ts (job.service.ts, job.controller.ts)
- Classes: PascalCase (JobService, JobController)
- Methods/variables: camelCase (getJobById, userEmail)
- Constants: UPPER_SNAKE_CASE (MAX_RETRIES, DEFAULT_TIMEOUT)
- Database columns: camelCase in migrations
- Job types: kebab-case ("image-resize", "video-transcode")
```

**Logging**:

```typescript
// ✅ DO: Structured logging with context
this.logger.info({ jobId, workerId, durationMs }, "Job processing completed");

// ❌ DON'T: String concatenation
this.logger.info(`Job ${jobId} completed in ${durationMs}ms`);
```

### 12.2 Testing Strategy

**Unit Tests**: Service logic

```typescript
describe('JobService', () => {
  it('should create a job with PENDING status', async () => {
    const job = await jobService.create({
      type: 'image-resize',
      payload: { ... }
    });
    expect(job.status).toBe('PENDING');
  });
});
```

**Integration Tests**: Full flows (API → DB → Queue)

```typescript
describe("Job Submission Flow", () => {
  it("should enqueue job to Redis when API receives request", async () => {
    const response = await request(app.getHttpServer())
      .post("/jobs")
      .send(createJobDto);

    expect(response.status).toBe(201);
    const queueSize = await queue.count();
    expect(queueSize).toBe(1);
  });
});
```

**E2E Tests**: Complete workflows

```typescript
describe("End-to-End: Image Resize", () => {
  it("should process image resize from submission to completion", async () => {
    // 1. Submit job via API
    // 2. Wait for worker to process
    // 3. Verify job is COMPLETED
    // 4. Verify result is stored
  });
});
```

### 12.2 Testing Redis Patterns

**Unit Tests: Individual Redis Operations**

```typescript
describe("Redis Cache Pattern", () => {
  it("should cache data with TTL", async () => {
    const key = "test:user:123";
    const data = { id: 123, name: "John" };

    // Set with 1 second TTL
    await redis.set(key, JSON.stringify(data), "EX", 1);

    // Verify it exists
    let cached = await redis.get(key);
    expect(cached).toBe(JSON.stringify(data));

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Verify it's gone
    cached = await redis.get(key);
    expect(cached).toBeNull();
  });

  it("should invalidate cache on update", async () => {
    const key = "test:user:456";

    // Set initial cache
    await redis.set(key, "initial");
    expect(await redis.get(key)).toBe("initial");

    // Invalidate
    await redis.del(key);
    expect(await redis.get(key)).toBeNull();
  });
});
```

**Integration Tests: Redis Pattern Interactions**

```typescript
describe("Job Queue Pattern", () => {
  it("should process jobs FIFO order", async () => {
    // Add 3 jobs
    await queue.add("job1", { id: 1 });
    await queue.add("job2", { id: 2 });
    await queue.add("job3", { id: 3 });

    const processed: number[] = [];

    // Process all jobs
    await queue.process(async (job) => {
      processed.push(job.data.id);
    });

    // Wait for completion
    await new Promise((resolve) => queue.once("drained", resolve));

    // Verify FIFO
    expect(processed).toEqual([1, 2, 3]);
  });

  it("should retry failed jobs with exponential backoff", async () => {
    let attemptCount = 0;

    await queue.add(
      "failing-job",
      {},
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 100 },
      },
    );

    await queue.process(async (job) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error("Simulated failure");
      }
      return { success: true };
    });

    await new Promise((resolve) => queue.once("drained", resolve));

    expect(attemptCount).toBe(3);
  });
});
```

**Rate Limiting Tests**

```typescript
describe("Distributed Rate Limiting", () => {
  it("should block requests exceeding rate limit", async () => {
    const userId = "user:test-rate-limit";
    const limit = 5;

    // Make 5 requests (should all succeed)
    for (let i = 0; i < 5; i++) {
      const isLimited = await rateLimiter.isLimited(userId, limit, 3600);
      expect(isLimited).toBe(false);
    }

    // 6th request should fail
    const isLimited = await rateLimiter.isLimited(userId, limit, 3600);
    expect(isLimited).toBe(true);
  });

  it("should reset limits after time window", async () => {
    const userId = "user:test-reset";
    const limit = 2;
    const windowSeconds = 1;

    // Exceed limit
    await rateLimiter.isLimited(userId, limit, windowSeconds);
    await rateLimiter.isLimited(userId, limit, windowSeconds);
    let isLimited = await rateLimiter.isLimited(userId, limit, windowSeconds);
    expect(isLimited).toBe(true);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, windowSeconds * 1000 + 100));

    // Should be allowed again
    isLimited = await rateLimiter.isLimited(userId, limit, windowSeconds);
    expect(isLimited).toBe(false);
  });
});
```

**Pub/Sub Tests**

```typescript
describe("Real-Time Pub/Sub Pattern", () => {
  it("should broadcast to multiple subscribers", async () => {
    const messages1: string[] = [];
    const messages2: string[] = [];

    // Subscriber 1
    const sub1 = redis.duplicate();
    sub1.subscribe("job:updates", (message) => {
      messages1.push(message);
    });

    // Subscriber 2
    const sub2 = redis.duplicate();
    sub2.subscribe("job:updates", (message) => {
      messages2.push(message);
    });

    // Wait for subscriptions to be ready
    await new Promise((r) => setTimeout(r, 100));

    // Publish
    await redis.publish("job:updates", "Update 1");
    await redis.publish("job:updates", "Update 2");

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 100));

    // Both subscribers should receive
    expect(messages1).toEqual(["Update 1", "Update 2"]);
    expect(messages2).toEqual(["Update 1", "Update 2"]);

    // Cleanup
    await sub1.unsubscribe();
    await sub2.unsubscribe();
  });
});
```

**Distributed Lock Tests**

```typescript
describe("Distributed Lock Pattern", () => {
  it("should prevent concurrent execution", async () => {
    const lockKey = "test:lock";
    const results: string[] = [];

    const tryExecute = async (name: string) => {
      const token = crypto.randomUUID();
      const acquired = await redis.set(lockKey, token, "NX", "EX", 5);

      if (!acquired) return false; // Couldn't acquire

      try {
        results.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 100));
        results.push(`${name}:end`);
        return true;
      } finally {
        // Safe release (check token)
        const current = await redis.get(lockKey);
        if (current === token) await redis.del(lockKey);
      }
    };

    // Both try to execute
    const [result1, result2] = await Promise.all([
      tryExecute("task1"),
      tryExecute("task2"),
    ]);

    // Only one should succeed
    expect(result1 || result2).toBe(true);
    expect(result1 && result2).toBe(false);

    // Should not interleave
    const startEnds = results.filter((r) => r.includes("end"));
    expect(startEnds.length).toBe(1);
  });
});
```

**Performance/Load Tests**

```typescript
describe("Redis Performance Tests", () => {
  it("should handle high throughput cache operations", async () => {
    const iterations = 10000;
    const start = Date.now();

    // Simulate cache reads
    for (let i = 0; i < iterations; i++) {
      const key = `perf:test:${i % 100}`;
      await redis.get(key); // Most will miss, that's fine
    }

    const duration = Date.now() - start;
    const opsPerSecond = iterations / (duration / 1000);

    console.log(`${opsPerSecond.toFixed(0)} ops/sec`);

    // Redis should easily handle 100k+ ops/sec
    expect(opsPerSecond).toBeGreaterThan(50000);
  });

  it("should handle concurrent queue submissions", async () => {
    const jobCount = 1000;
    const start = Date.now();

    // Submit 1000 jobs concurrently
    const promises = [];
    for (let i = 0; i < jobCount; i++) {
      promises.push(queue.add(`job-${i}`, { index: i }));
    }

    await Promise.all(promises);

    const duration = Date.now() - start;
    console.log(`Submitted ${jobCount} jobs in ${duration}ms`);

    const queueSize = await queue.count();
    expect(queueSize).toBe(jobCount);
  });
});
```

---

**Branch Naming**:

```
feature/job-retry-logic
bugfix/worker-heartbeat-timeout
hotfix/redis-connection-leak
chore/update-dependencies
docs/api-documentation
```

**Commit Messages**:

```
feat: Add exponential backoff for job retries
fix: Handle Redis connection timeout gracefully
docs: Document webhook payload format
test: Add E2E test for complete job flow
refactor: Extract queue configuration to shared package
```

**PR Process**:

1. Create feature branch from `main`
2. Make changes with tests
3. Push and open PR
4. Address code review feedback
5. Get approval from maintainer
6. Squash and merge to `main`

**Pre-commit Checklist**:

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Tests pass: `npm run test`
- [ ] Linting passes: `npm run lint`
- [ ] Code formatted: `npm run format`
- [ ] No hardcoded secrets or API keys
- [ ] Database migration is reversible (if applicable)
- [ ] Documentation updated

---

## 2B. Redis Debugging & Troubleshooting Guide

As you build SystemVibe, you'll encounter Redis issues. Here's how to debug and fix them.

### Common Issues & Solutions

#### Issue 1: Queue not processing jobs

**Symptoms**: Jobs added but workers don't process them

**Debugging Steps**:

```bash
# 1. Check if queue exists and has jobs
redis-cli
> LLEN bull:image:queue  # Should show job count > 0

# 2. Check queue metrics
> HGET bull:image:meta  # Metadata about queue

# 3. Check for stuck workers
> KEYS bull:image:*
> GET bull:image:worker  # Who's processing?

# 4. Check for errors in dead letter queue
> LRANGE bull:image:failed 0 -1
```

**Common Causes**:

- Worker not connected to Redis
- Worker crashed without cleanup
- Job type mismatch (queue expects type X, worker handles Y)
- Worker filter not matching job type

**Solution**:

```typescript
// Ensure worker is subscribed to correct queue type
const processor = new Worker("image", {
  connection: redisConnection,
});

// Add event listeners for debugging
processor.on("failed", (job, err) => {
  logger.error({ jobId: job.id, error: err.message }, "Job failed");
});

processor.on("error", (err) => {
  logger.error({ error: err.message }, "Worker error");
});

processor.on("progress", (job, progress) => {
  logger.info({ jobId: job.id, progress }, "Progress update");
});
```

---

#### Issue 2: Memory growing unbounded

**Symptoms**: `INFO memory` shows used_memory continuously increasing

**Debugging Steps**:

```bash
redis-cli
> INFO memory
# Look for:
# - used_memory: Should stabilize
# - used_memory_peak: Max ever used
# - used_memory_overhead: Redis internal overhead

> DBSIZE  # Total keys

# Find largest keys
> MEMORY DOCTOR  # Redis memory analysis
> MEMORY USAGE key-name  # Single key size

# Monitor in realtime
> MEMORY STATS
```

**Common Causes**:

- Cache TTLs not set (keys never expire)
- Large objects stored in cache
- Memory leak in application (allocating without cleanup)
- Publish-subscribe subscribers leaking

**Solution**:

```typescript
// ✅ Always set TTL on cache keys
await redis.set(
  'cache:user:123',
  JSON.stringify(largeData),
  'EX', 3600  // Expire in 1 hour
);

// ✅ Monitor memory in application
setInterval(async () => {
  const info = await redis.info('memory');
  logger.info({ memory: info }, 'Redis memory stats');
}, 60000);

// ✅ Configure Redis maxmemory policy
redis-cli CONFIG SET maxmemory 1gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru  // LRU eviction
```

---

#### Issue 3: Slow queries or latency spikes

**Symptoms**: API requests to Redis are slow, WebSocket updates lag

**Debugging Steps**:

```bash
redis-cli
> SLOWLOG GET 10  # Last 10 slow commands
# Shows: id, timestamp, duration (microseconds), command, client

> SLOWLOG RESET  # Clear log

# Monitor commands in realtime
> MONITOR  # Shows every command

# For production, use sampling
# Instead of MONITOR, use:
> INFO stats
# Look for: total_commands_processed, instantaneous_ops_per_sec
```

**Common Causes**:

- O(N) command on large data (KEYS \*, SCAN on huge dataset)
- Memory pressure (Redis swapping to disk)
- Network latency (Redis client → Redis server)
- Single-threaded bottleneck (too many commands)

**Solution**:

```typescript
// ❌ DON'T: Use KEYS pattern
const keys = await redis.keys("cache:*"); // Dangerous on large DB!

// ✅ DO: Use SCAN (non-blocking)
const cursor = "0";
const keys = [];
do {
  const [newCursor, batch] = await redis.scan(cursor, "MATCH", "cache:*");
  keys.push(...batch);
} while (cursor !== "0");

// ✅ Use pipelining for batch operations
const pipeline = redis.pipeline();
for (let i = 0; i < 100; i++) {
  pipeline.get(`key:${i}`);
}
const results = await pipeline.exec();
```

---

#### Issue 4: Connection pool exhaustion

**Symptoms**: "ECONNREFUSED" errors, timeouts, requests queuing up

**Debugging Steps**:

```typescript
// Monitor connection pool
logger.info({
  waitingClients: redis.waitingClients,
  readyClients: redis.readyClients,
  establishingClients: redis.establishingClients
});

// Check network
netstat -an | grep 6379  # Count connections
```

**Solution**:

```typescript
const redis = new Redis({
  host: "localhost",
  port: 6379,

  // Tune connection pool
  maxRetriesPerRequest: 10, // Retry failed commands
  lazyConnect: false, // Connect immediately

  // Retry strategy for timeouts
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },

  // Connection limits
  connectionPoolSize: 100, // More connections

  // Timeouts
  connectTimeout: 10000, // Initial connection
  commandTimeout: 5000, // Per command
});

// Monitor and alert
redis.on("error", (err) => {
  logger.error({ error: err.message }, "Redis connection error");
});

redis.on("warning", (msg) => {
  logger.warn({ message: msg }, "Redis warning");
});
```

---

#### Issue 5: Data inconsistency or race conditions

**Symptoms**: Wrong data, duplicate processing, lost updates

**Debugging Steps**:

```typescript
// Add correlation IDs to trace requests through system
const correlationId = randomUUID();
logger.info({ correlationId, jobId }, "Starting job");

// Use transactions for atomic operations
const result = await redis.multi().set("key1", "value1").incr("counter").exec(); // Both execute or both fail
```

**Solution**:

```typescript
// ✅ Use WATCH for optimistic locking
const transaction = async (jobId) => {
  await redis.watch(`job:${jobId}`);

  const current = await redis.get(`job:${jobId}`);

  // Start transaction
  const pipe = redis.multi();
  pipe.set(
    `job:${jobId}`,
    JSON.stringify({
      ...current,
      status: "PROCESSING",
    }),
  );

  try {
    await pipe.exec();
  } catch (err) {
    // Key was modified, retry
    logger.warn({ jobId }, "Transaction conflict, retrying");
    return transaction(jobId);
  }
};

// ✅ Use SET NX for atomic operations
const acquireLock = async (key, ttl) => {
  const result = await redis.set(key, "1", "NX", "EX", ttl);
  return result === "OK";
};

// ✅ Use Lua scripts for complex atomic operations
const lua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;
const result = await redis.eval(lua, 1, "lock:key", "token");
```

---

### Redis Monitoring Checklist

**Daily**:

- [ ] Check memory usage trend
- [ ] Review error rates
- [ ] Check SLOWLOG for regressions
- [ ] Verify no stuck workers

**Weekly**:

- [ ] Analyze key distribution (hot keys?)
- [ ] Review expiration rates
- [ ] Check connection pool health
- [ ] Review backup status

**Monthly**:

- [ ] Capacity planning (growing?)
- [ ] Update Redis version (security patches)
- [ ] Review and optimize slow queries
- [ ] Disaster recovery drill

---

### Production Redis Checklist

Before deploying to production:

- [ ] Enable persistence (AOF or RDB)
- [ ] Configure backup strategy
- [ ] Set maxmemory and eviction policy
- [ ] Enable authentication
- [ ] Use TLS for client connections
- [ ] Monitor memory, CPU, network
- [ ] Set up alerting for key metrics
- [ ] Test failover procedures
- [ ] Document runbook for common issues
- [ ] Capacity plan for growth

---

### 13.1 Docker Compose Stack

```yaml
services:
  nginx: # Reverse proxy, handles load balancing
  api: # NestJS API server (1 instance)
  postgres: # PostgreSQL database
  redis: # Redis cache & queue

  worker-image: # Image processing (scalable: 1-10)
  worker-video: # Video processing (scalable: 1-5)
  worker-ai: # AI inference (scalable: 1-3)
  worker-email: # Email delivery (scalable: 1-2)

  prometheus: # Metrics collection
  grafana: # Metrics visualization
  loki: # Log aggregation
```

### 13.2 Scaling Example

```bash
# Default: 1 image worker
docker-compose up

# Scale to 5 image workers
docker-compose up --scale worker-image=5

# Workers automatically coordinate via Redis
# Jobs are distributed fairly (no manual routing needed)
```

### 13.3 Environment Configuration

```bash
# .env.local (development)
DATABASE_URL=postgresql://user:pass@postgres:5432/systemvibe
REDIS_URL=redis://redis:6379
NODE_ENV=development
JWT_SECRET=dev-secret-key

# .env.staging (CI environment)
DATABASE_URL=postgresql://user:pass@postgres:5432/systemvibe-staging
REDIS_URL=redis://redis-staging:6379
NODE_ENV=staging
JWT_SECRET=${VAULT_JWT_SECRET}  # From secrets manager

# .env.production (managed by CI/CD)
DATABASE_URL=${DB_CONNECTION_STRING}
REDIS_URL=${REDIS_CONNECTION_STRING}
NODE_ENV=production
JWT_SECRET=${VAULT_JWT_SECRET}
ENABLE_MONITORING=true
```

---

## 14. Monitoring & Observability

### 14.1 Key Metrics

**Queue Metrics**:

```
systemvibe_queue_size{queue="image"}          # Jobs waiting
systemvibe_queue_processing{queue="image"}    # Jobs being processed
systemvibe_job_duration_seconds{type="image"} # Time to completion
```

**Job Metrics**:

```
systemvibe_job_completed_total{type="image",status="success"}   # Completed jobs
systemvibe_job_failed_total{type="image"}                       # Failed jobs
systemvibe_job_retry_total{type="image"}                        # Retry attempts
systemvibe_job_timeout_total{type="image"}                      # Timeout jobs
```

**Worker Metrics**:

```
systemvibe_worker_online{type="image"}                  # Online workers
systemvibe_worker_processing_jobs{type="image"}         # Current load
systemvibe_worker_uptime_seconds{workerId="worker-1"}   # Worker uptime
```

**System Metrics**:

```
systemvibe_redis_memory_bytes        # Redis memory usage
systemvibe_postgres_connections      # DB connection pool
systemvibe_api_request_duration      # API latency
```

### 14.2 Grafana Dashboards

**Dashboard 1: System Overview**

- Queue depths per type
- Job success rate
- Worker online status
- Redis memory usage
- API latency

**Dashboard 2: Job Processing**

- Job lifecycle visualization
- Failure rate per job type
- Retry distribution
- Processing time trends

**Dashboard 3: Worker Health**

- Worker count per type
- Processing rate per worker
- Error rate per worker
- Resource usage per worker

**Dashboard 4: Real-time Events**

- Live job events (created, completed, failed)
- Active WebSocket connections
- Webhook delivery status

### 14.3 Logging

**Structured Logging Example**:

```typescript
// When job starts
logger.info(
  {
    jobId: job.id,
    type: job.type,
    userId: job.userId,
    correlationId: job.correlationId,
  },
  "Job processing started",
);

// When job completes
logger.info(
  {
    jobId: job.id,
    durationMs: Date.now() - startTime,
    correlationId: job.correlationId,
  },
  "Job processing completed",
);

// When job fails
logger.error(
  {
    jobId: job.id,
    error: err.message,
    stack: err.stack,
    correlationId: job.correlationId,
  },
  "Job processing failed",
);
```

**Log Aggregation**: Loki stores logs indexed by labels

```
{jobId="uuid", type="image-resize", status="FAILED"}
→ Find all failed image jobs
→ Search by correlationId for distributed trace
```

---

## 15. Development Roadmap

### Phase 1 (Week 1): Foundation ✅

- [x] Docker Compose setup
- [x] NestJS project scaffolding
- [x] Database schema
- [x] API health endpoint
- [x] Logging configuration

### Phase 2 (Week 1-2): Auth ✅

- [x] User registration/login
- [x] JWT tokens
- [x] Auth guards

### Phase 3 (Week 2-3): Job Queue ✅

- [x] Job CRUD API
- [x] BullMQ queue integration
- [x] Job retry logic
- [x] Status tracking

### Phase 4 (Week 3): Image Worker ✅

- [x] Image worker service
- [x] Sharp integration
- [x] Job processing loop
- [x] Error handling

### Phase 5 (Week 3-4): Real-time ✅

- [x] Socket.IO setup
- [x] Job status broadcasts
- [x] Progress updates

### Phase 6 (Week 4): Monitoring ✅

- [x] Prometheus metrics
- [x] Grafana dashboards
- [x] Health checks
- [x] Structured logging

### Phase 7 (Week 4): Webhooks ✅

- [x] Webhook delivery
- [x] Retry logic
- [x] HMAC signatures

### Phase 8 (Week 4): Rate Limiting ✅

- [x] User-based limiting
- [x] IP-based limiting

---

## 16. Launch Checklist

### Development Complete

- [ ] All MVP features implemented
- [ ] TypeScript strict mode passing
- [ ] ESLint & Prettier clean
- [ ] All unit tests passing (70%+ coverage)
- [ ] All integration tests passing
- [ ] E2E tests for critical flows passing

### QA & Testing

- [ ] Manual testing of key flows completed
- [ ] Performance testing done (latency, throughput)
- [ ] Load testing completed (can handle 1000 jobs/minute)
- [ ] Security review done (no secrets in code, rate limiting works)

### DevOps & Infrastructure

- [ ] Docker images build successfully
- [ ] Docker Compose brings up full stack
- [ ] All services healthchecks passing
- [ ] Monitoring and alerting active
- [ ] Logging configured and tested

### Documentation

- [ ] README.md with setup instructions
- [ ] ARCHITECTURE.md with diagrams
- [ ] API.md with endpoint documentation
- [ ] DATABASE.md with schema explanation
- [ ] CONTRIBUTING.md with development guide
- [ ] CHANGELOG.md created

### GitHub & Publishing

- [ ] GitHub repo created and public
- [ ] Code pushed to main branch
- [ ] GitHub Actions CI/CD configured
- [ ] README badges added (build, coverage, license)
- [ ] GitHub Releases created with v1.0.0 tag
- [ ] Topics added (nestjs, redis, bullmq, docker, distributed-system)

---

## 17. Resources & Learning Materials

### Official Docs

- [NestJS Docs](https://docs.nestjs.com)
- [BullMQ Docs](https://docs.bullmq.io)
- [Redis Docs](https://redis.io/documentation)
- [Prisma Docs](https://www.prisma.io/docs)

### Articles & Guides

- Redis Patterns: https://redis.io/docs/manual/patterns/
- Event-Driven Architecture: https://martinfowler.com/articles/201701-event-driven.html
- Distributed Systems Primer: https://github.com/aphyr/distsys-class

### Books

- "Designing Data-Intensive Applications" by Martin Kleppmann
- "The Art of Scalability" by Martin Abbott & Michael Fisher

### Related Open-Source Projects

- [Bullmq Dashboard](https://github.com/felixbr/bull-board)
- [EventMesh](https://github.com/apache/eventmesh) (the inspiration for this project!)

---

## 18. Update Log & Living Document

This AGENT.md is a **living document** - update it as you discover new insights:

```
[2025-01-XX] Phase X completed - Added learnings
[2025-01-XX] Architecture decision - Switched from X to Y because Z
[2025-01-XX] New feature discovered - Added to nice-to-have list
```

---

## 19. Contact & Support

- **Author**: SystemVibe Contributors
- **GitHub**: github.com/[username]/systemvibe
- **Issues**: github.com/[username]/systemvibe/issues
- **Discussions**: github.com/[username]/systemvibe/discussions

---

**This specification ensures clarity on what to build, why to build it, and how to build it production-style. Happy building! 🚀**
