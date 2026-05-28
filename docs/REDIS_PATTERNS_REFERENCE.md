# Redis Patterns Quick Reference

**A developer's cheat sheet for Redis patterns used in SystemVibe.**

Keep this open during development!

---

## Quick Navigation

- [Queues & Jobs](#queues--jobs)
- [Caching](#caching)
- [Real-time & Pub/Sub](#real-time--pubsub)
- [Rate Limiting](#rate-limiting)
- [Locks & Coordination](#locks--coordination)
- [Sessions](#sessions)
- [Performance Tips](#performance-tips)
- [Debugging Commands](#debugging-commands)
- [Essential CLI Commands](#essential-cli-commands)

---

## Queues & Jobs

### Pattern: BullMQ Queue

**When to use**: Reliable background job processing with retries

```typescript
import { Queue, Worker } from "bullmq";

// Create queue
const queue = new Queue("image-processing", {
  connection: redisConnection,
});

// Submit job
const job = await queue.add(
  "resize",
  {
    imageUrl: "https://...",
    width: 800,
    height: 600,
  },
  {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
    priority: 10,
    delay: 5000, // Process after 5 seconds
  },
);

console.log(`Job ${job.id} queued`);

// Process jobs
const worker = new Worker(
  "image-processing",
  async (job) => {
    console.log(`Processing ${job.id}`);
    // Do work here
    return { outputUrl: "..." };
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process 5 at a time
  },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed: ${job.returnvalue}`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});
```

**Monitor**:

```bash
redis-cli
> LLEN bull:image-processing:queue
> LLEN bull:image-processing:active
> LLEN bull:image-processing:completed
> LLEN bull:image-processing:failed
```

---

## Caching

### Pattern 1: Simple Cache (Read-Through)

**When to use**: Cache expensive database queries

```typescript
async function getUser(id: string) {
  const cacheKey = `user:${id}`;

  // Try cache first
  let user = await redis.get(cacheKey);
  if (user) return JSON.parse(user);

  // Cache miss - fetch from DB
  user = await db.getUser(id);

  // Store in cache for 1 hour
  await redis.set(cacheKey, JSON.stringify(user), "EX", 3600);

  return user;
}
```

### Pattern 2: Write-Through Cache

**When to use**: Keep cache in sync when data changes

```typescript
async function updateUser(id: string, data: any) {
  // Update database
  const user = await db.updateUser(id, data);

  // Update cache immediately
  await redis.set(`user:${id}`, JSON.stringify(user), "EX", 3600);

  return user;
}

async function deleteUser(id: string) {
  // Delete from database
  await db.deleteUser(id);

  // Invalidate cache
  await redis.del(`user:${id}`);
}
```

### Pattern 3: Cache Stampede Prevention

**When to use**: Prevent thundering herd when cache expires

```typescript
async function getCachedData(key: string, fetchFn: () => Promise<any>) {
  // Try to get from cache
  let data = await redis.get(key);
  if (data) return JSON.parse(data);

  // Cache miss - acquire lock to prevent multiple fetches
  const lockKey = `lock:${key}`;
  const token = randomUUID();

  const acquired = await redis.set(lockKey, token, "NX", "EX", 5);

  if (acquired) {
    try {
      // I have lock - fetch fresh data
      const freshData = await fetchFn();

      // Cache for longer with soft expiration
      await redis.set(key, JSON.stringify(freshData), "EX", 3600);

      return freshData;
    } finally {
      // Release lock safely
      const current = await redis.get(lockKey);
      if (current === token) await redis.del(lockKey);
    }
  } else {
    // Another process is fetching - wait and retry
    await new Promise((r) => setTimeout(r, 100));
    return getCachedData(key, fetchFn);
  }
}
```

### Common Cache Keys

```
user:{id}                      # User data
job:{id}                       # Job status/result
dashboard:{userId}             # Dashboard metrics
stats:{date}                   # Daily stats
api:response:{hash}            # API response cache
```

---

## Real-time & Pub/Sub

### Pattern: Publish-Subscribe

**When to use**: Broadcast real-time events (no persistence needed)

```typescript
// PUBLISHER: Worker completes job
await redis.publish(
  `job:progress:${jobId}`,
  JSON.stringify({
    jobId,
    progress: 100,
    status: "COMPLETED",
    result: { outputUrl: "..." },
  }),
);

// SUBSCRIBER: API server listening for updates
const subscriber = redis.duplicate();

subscriber.subscribe(`job:progress:${jobId}`, (message) => {
  const data = JSON.parse(message);
  console.log(`Job ${data.jobId} is ${data.progress}% done`);

  // Broadcast to WebSocket clients
  io.to(`job:${data.jobId}`).emit("progress", data);
});
```

**Pattern Subscription**:

```typescript
// Subscribe to pattern instead of exact key
subscriber.psubscribe("job:progress:*", (message, channel) => {
  const jobId = channel.split(":")[2];
  console.log(`Job ${jobId} update: ${message}`);
});
```

### Common Channels

```
job:progress:{jobId}           # Job progress updates
job:completed                  # Broadcast: any job completed
worker:online                  # Worker came online
webhook:failed                 # Webhook delivery failed
error:system                   # System errors
notification:new               # New notification
```

---

## Rate Limiting

### Pattern: Fixed Window Counter

**When to use**: Simple, effective rate limiting

```typescript
async function checkRateLimit(
  userId: string,
  limit: number = 100,
  windowSeconds: number = 3600,
): Promise<boolean> {
  const key = `rate:${userId}`;

  // Increment counter
  const current = await redis.incr(key);

  // Set expiration on first request
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  // Check if exceeded
  return current > limit;
}

// Usage
const isLimited = await checkRateLimit("user:123", 100, 3600);
if (isLimited) {
  throw new Error("Rate limit exceeded. Max 100 requests per hour");
}
```

### Pattern: Sliding Window (More Accurate)

```typescript
async function checkRateLimitSliding(
  userId: string,
  limit: number = 100,
  windowSeconds: number = 3600,
): Promise<boolean> {
  const key = `rate:${userId}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Remove old entries outside window
  await redis.zremrangebyscore(key, "-inf", windowStart);

  // Count requests in window
  const count = await redis.zcard(key);

  if (count >= limit) {
    return true; // Limited
  }

  // Add current request
  const score = Math.random(); // Unique score
  await redis.zadd(key, score, `${now}-${score}`);

  // Set expiration
  await redis.expire(key, windowSeconds);

  return false;
}
```

---

## Locks & Coordination

### Pattern: Distributed Lock

**When to use**: Prevent concurrent access (webhook delivery, cron jobs)

```typescript
class DistributedLock {
  constructor(private redis: Redis) {}

  async acquire(key: string, ttlSeconds: number = 30): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(
      key,
      token,
      "NX", // Only if not exists
      "EX", // Set expiration
      ttlSeconds,
    );

    return result === "OK" ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    // Must verify token to prevent releasing others' locks
    const current = await this.redis.get(key);

    if (current === token) {
      await this.redis.del(key);
      return true;
    }

    return false; // Token mismatch
  }

  async executeExclusive<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 30,
  ): Promise<T> {
    const token = await this.acquire(key, ttlSeconds);

    if (!token) {
      throw new Error(`Could not acquire lock: ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }
}

// Usage
await lock.executeExclusive("webhook:process:123", async () => {
  // Only one process executes this at a time
  await processWebhook("123");
});
```

---

## Sessions

### Pattern: User Session Storage

**When to use**: Store authentication state for API requests

```typescript
// Create session after login
async function createSession(userId: string, roles: string[]) {
  const sessionId = randomUUID();
  const sessionKey = `session:${sessionId}`;

  const sessionData = {
    userId,
    roles,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  };

  // Store for 24 hours
  await redis.set(sessionKey, JSON.stringify(sessionData), "EX", 24 * 3600);

  return sessionId;
}

// Retrieve session
async function getSession(sessionId: string) {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

// Logout (invalidate)
async function invalidateSession(sessionId: string) {
  await redis.del(`session:${sessionId}`);
}

// Refresh session (extend TTL)
async function refreshSession(sessionId: string) {
  await redis.expire(`session:${sessionId}`, 24 * 3600);
}
```

---

## Performance Tips

### Tip 1: Use Pipelining for Bulk Operations

```typescript
// ❌ SLOW: 1000 round trips
for (let i = 0; i < 1000; i++) {
  await redis.set(`key:${i}`, `value:${i}`);
}

// ✅ FAST: 1 round trip
const pipeline = redis.pipeline();
for (let i = 0; i < 1000; i++) {
  pipeline.set(`key:${i}`, `value:${i}`);
}
await pipeline.exec();
```

### Tip 2: Use SET with Options

```typescript
// ✅ DO: Combine SET options
await redis.set(key, value, "NX", "EX", 3600);

// ❌ DON'T: Multiple commands
await redis.set(key, value);
await redis.expire(key, 3600);
```

### Tip 3: Use GETEX Instead of GET + EXPIRE

```typescript
// ✅ Atomic refresh
const value = await redis.getex(key, "EX", 3600);

// ❌ Race condition
const value = await redis.get(key);
await redis.expire(key, 3600);
```

### Tip 4: Use SCAN Instead of KEYS

```typescript
// ❌ BLOCKS Redis for large datasets
const allKeys = await redis.keys("pattern:*");

// ✅ Non-blocking iteration
const cursor = "0";
let keys = [];
do {
  const [newCursor, batch] = await redis.scan(
    cursor,
    "MATCH",
    "pattern:*",
    "COUNT",
    100,
  );
  keys = keys.concat(batch);
  cursor = newCursor;
} while (cursor !== "0");
```

---

## Debugging Commands

### Monitor Queue Health

```bash
redis-cli

# Queue size
LLEN bull:image:queue

# Jobs being processed
LLEN bull:image:active

# Completed (if kept)
LLEN bull:image:completed

# Failed jobs
LLEN bull:image:failed
LRANGE bull:image:failed 0 -1
```

### Monitor Cache

```bash
# List all cache keys
SCAN 0 MATCH cache:* COUNT 100

# Check TTL
TTL cache:user:123

# Check size
STRLEN cache:user:123
MEMORY USAGE cache:user:123
```

### Monitor Pub/Sub

```bash
# Active channels
PUBSUB CHANNELS

# Subscriber count
PUBSUB NUMSUB job:progress

# Active subscriptions
PUBSUB NUMPAT  # Pattern subscriptions
```

### Monitor Performance

```bash
# Get slowest commands
SLOWLOG GET 10

# Memory analysis
INFO memory
MEMORY DOCTOR
MEMORY STATS

# Key statistics
DBSIZE
INFO keyspace

# Live command monitor (use sparingly!)
MONITOR
```

### Connection Health

```bash
# Basic connectivity
PING
ECHO "hello"

# Connection info
INFO server
INFO clients
INFO stats

# Connection count
CLIENT LIST
CLIENT ID
```

---

## Essential CLI Commands

### Docker Compose Commands

```bash
# Start Redis in development
docker compose -f infra/docker/docker-compose.yml up -d redis

# Start all services (Redis + API + PostgreSQL)
docker compose -f infra/docker/docker-compose.yml up -d

# Stop Redis
docker compose -f infra/docker/docker-compose.yml stop redis

# Stop all services
docker compose -f infra/docker/docker-compose.yml down

# View Redis logs
docker compose -f infra/docker/docker-compose.yml logs -f redis

# Restart Redis
docker compose -f infra/docker/docker-compose.yml restart redis

# Remove Redis volumes (clears all data)
docker compose -f infra/docker/docker-compose.yml down -v
```

### Redis CLI Connection

```bash
# Connect to local Redis (default port 6379)
redis-cli

# Connect to Docker Redis
redis-cli -h localhost -p 6379

# Connect with password (if configured)
redis-cli -a your_password

# Connect to specific database
redis-cli -n 1

# Execute single command
redis-cli PING
redis-cli DBSIZE
redis-cli INFO memory
```

### BullMQ Queue Management

```bash
# Check queue status
redis-cli LLEN bull:image-processing:queue
redis-cli LLEN bull:image-processing:active
redis-cli LLEN bull:image-processing:completed
redis-cli LLEN bull:image-processing:failed

# View failed jobs
redis-cli LRANGE bull:image-processing:failed 0 10

# View delayed jobs
redis-cli ZRANGE bull:image-processing:delayed 0 10 WITHSCORES

# View waiting jobs
redis-cli ZRANGE bull:image-processing:wait 0 10 WITHSCORES

# View paused jobs
redis-cli ZRANGE bull:image-processing:paused 0 10 WITHSCORES

# Clean up completed jobs (if removeOnComplete: false)
redis-cli LTRIM bull:image-processing:completed 0 -1000

# Retry failed jobs (move from failed to wait)
redis-cli LRANGE bull:image-processing:failed 0 -1 | xargs -I {} redis-cli RPUSH bull:image-processing:wait {}
redis-cli DEL bull:image-processing:failed
```

### Cache Management

```bash
# View all cache keys
redis-cli SCAN 0 MATCH cache:* COUNT 100

# View specific cache
redis-cli GET cache:user:123
redis-cli HGETALL cache:dashboard:456

# Check TTL
redis-cli TTL cache:user:123

# Extend TTL (refresh cache)
redis-cli EXPIRE cache:user:123 3600

# Delete specific cache
redis-cli DEL cache:user:123

# Delete all cache keys (use with caution!)
redis-cli --scan --pattern 'cache:*' | xargs redis-cli DEL

# Delete cache by pattern
redis-cli --scan --pattern 'cache:user:*' | xargs redis-cli DEL
```

### Session Management

```bash
# View active sessions
redis-cli SCAN 0 MATCH session:* COUNT 100

# View specific session
redis-cli GET session:abc-123-def

# Check session TTL
redis-cli TTL session:abc-123-def

# Invalidate session
redis-cli DEL session:abc-123-def

# Count active sessions
redis-cli --scan --pattern 'session:*' | wc -l

# Invalidate all sessions (logout all users)
redis-cli --scan --pattern 'session:*' | xargs redis-cli DEL
```

### Rate Limit Monitoring

```bash
# View rate limit keys
redis-cli SCAN 0 MATCH rate:* COUNT 100

# Check current rate limit count
redis-cli GET rate:user:123

# Check rate limit TTL
redis-cli TTL rate:user:123

# Reset rate limit for user
redis-cli DEL rate:user:123

# View sliding window rate limit
redis-cli ZRANGE rate:user:123 0 -1 WITHSCORES
```

### Pub/Sub Monitoring

```bash
# View active channels
redis-cli PUBSUB CHANNELS

# View subscriber count for channel
redis-cli PUBSUB NUMSUB job:progress:123

# View pattern subscriptions
redis-cli PUBSUB NUMPAT

# Publish test message
redis-cli PUBLISH job:progress:123 '{"progress":50,"status":"PROCESSING"}'
```

### Memory & Performance

```bash
# Memory usage overview
redis-cli INFO memory

# Memory usage of specific key
redis-cli MEMORY USAGE cache:user:123

# Memory analysis
redis-cli MEMORY DOCTOR
redis-cli MEMORY STATS

# Slow log (slowest commands)
redis-cli SLOWLOG GET 10

# Clear slow log
redis-cli SLOWLOG RESET

# Database size
redis-cli DBSIZE

# Keyspace info (keys per database)
redis-cli INFO keyspace
```

### Connection & Server Info

```bash
# Server info
redis-cli INFO server
redis-cli INFO clients
redis-cli INFO stats
redis-cli INFO replication

# Connected clients
redis-cli CLIENT LIST

# Kill specific client
redis-cli CLIENT KILL ID 123

# Server uptime
redis-cli INFO server | grep uptime

# Redis version
redis-cli INFO server | grep redis_version
```

### Development Workflow

```bash
# Flush entire database (development only!)
redis-cli FLUSHDB

# Flush all databases (development only!)
redis-cli FLUSHALL

# Save to disk
redis-cli SAVE

# Background save
redis-cli BGSAVE

# Last save time
redis-cli LASTSAVE

# Monitor live commands (use sparingly in production)
redis-cli MONITOR

# Stop monitoring
# Press Ctrl+C
```

### Backup & Restore

```bash
# Create backup
redis-cli BGSAVE

# Copy RDB file (after BGSAVE completes)
cp /var/lib/redis/dump.rdb /backup/dump-$(date +%Y%m%d).rdb

# Restore (stop Redis first)
# Copy backup to /var/lib/redis/dump.rdb
# Start Redis

# Export specific keys
redis-cli --scan --pattern 'cache:*' | xargs -I {} redis-cli DUMP {} > cache_backup.txt

# Import keys (requires scripting)
```

### Health Check Script

```bash
#!/bin/bash
# redis-health-check.sh

echo "Checking Redis health..."

# Ping
redis-cli PING > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✓ Redis is responding"
else
  echo "✗ Redis is not responding"
  exit 1
fi

# Memory
MEMORY=$(redis-cli INFO memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')
echo "✓ Memory usage: $MEMORY"

# Connections
CLIENTS=$(redis-cli INFO clients | grep connected_clients | cut -d: -f2 | tr -d '\r')
echo "✓ Connected clients: $CLIENTS"

# Queue sizes
QUEUE_SIZE=$(redis-cli LLEN bull:image-processing:queue)
echo "✓ Queue size: $QUEUE_SIZE"

# Failed jobs
FAILED=$(redis-cli LLEN bull:image-processing:failed)
if [ "$FAILED" -gt 0 ]; then
  echo "⚠ Failed jobs: $FAILED"
else
  echo "✓ No failed jobs"
fi

echo "Health check complete!"
```

---

## Common Mistakes & Fixes

| Mistake             | Impact              | Fix                               |
| ------------------- | ------------------- | --------------------------------- |
| No TTL on cache     | Memory leak         | Always set `EX` with `SET`        |
| Using `KEYS *`      | Blocks Redis        | Use `SCAN` instead                |
| No locks on updates | Race conditions     | Use `SET NX` or transactions      |
| Pub/Sub only        | Lost messages       | Use Streams for durability        |
| No error handling   | Silent failures     | Log and monitor `on('error')`     |
| Connection leak     | Resource exhaustion | Properly `.disconnect()`          |
| Large objects       | Memory pressure     | Compress or store reference       |
| No monitoring       | Blind to issues     | Track queue size, latency, errors |

---

## Redis Data Structure Cheat Sheet

```
STRING        Set/Get values              SET key value
HASH          Key-value pairs             HSET user:1 name John
LIST          Ordered items               LPUSH queue item1 item2
SET           Unique items                SADD tags redis queue
SORTED SET    Scored items (ranking)      ZADD scores 100 player1
STREAM        Log/queue entries           XADD events * field value
```

---

## Useful npm Packages

```bash
# Redis client
npm install redis

# Job queue
npm install bullmq

# Redis monitoring
npm install redis-commander

# Redis ORM
npm install ioredis

# Testing utilities
npm install fakeredis  # or testcontainers
```

---

## External Resources

- [Redis Documentation](https://redis.io/documentation)
- [BullMQ Documentation](https://docs.bullmq.io)
- [Redis Patterns](https://redis.io/docs/manual/patterns/)
- [Redis Best Practices](https://redis.io/docs/management/optimization/performance-tuning/)

---

**Print this out or keep in your IDE sidebar. Reference often!** 🚀
