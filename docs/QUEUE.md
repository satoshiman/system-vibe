# Queue System Documentation

## Overview

SystemVibe uses **BullMQ** (built on Redis Streams) for reliable job queue management. This document covers the queue architecture, configuration, and usage patterns implemented in Phase 3.

---

## Table of Contents

- [Architecture](#architecture)
- [Configuration](#configuration)
- [Queue Setup](#queue-setup)
- [Job Lifecycle](#job-lifecycle)
- [API Endpoints](#api-endpoints)
- [Queue Operations](#queue-operations)
- [Monitoring](#monitoring)
- [Best Practices](#best-practices)

---

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ POST /jobs
       ↓
┌─────────────────────────────────┐
│   NestJS API Server             │
│                                 │
│  ┌──────────────────────────┐  │
│  │   JobsController         │  │
│  │   - Validates input      │  │
│  │   - Creates Job record   │  │
│  └──────────┬───────────────┘  │
│             │                  │
│  ┌──────────▼───────────────┐  │
│  │   JobsService            │  │
│  │   - Enqueues to BullMQ   │  │
│  └──────────┬───────────────┘  │
└─────────────┼──────────────────┘
              │
              ↓
┌─────────────────────────────────┐
│         Redis (BullMQ)          │
│                                 │
│  ┌──────────────────────────┐  │
│  │   Queue: "jobs"          │  │
│  │   - FIFO ordering        │  │
│  │   - Priority support     │  │
│  │   - Retry logic          │  │
│  └──────────────────────────┘  │
└─────────────────────────────────┘
              │
              ↓ (future)
┌─────────────────────────────────┐
│         Workers                 │
│  - Image Worker                 │
│  - Video Worker                 │
│  - AI Worker                   │
└─────────────────────────────────┘
```

---

## Redis (BullMQ) Role and Service

### What is Redis (BullMQ)?

**Redis (BullMQ)** serves as the job queue backend for SystemVibe. It combines two technologies:

- **Redis**: An in-memory data store used for high-performance caching and message queuing
- **BullMQ**: A job queue library built on top of Redis Streams that provides reliable job processing

### What It Does

Redis (BullMQ) handles the following responsibilities in SystemVibe:

1. **Job Storage**: Stores job data, payloads, and metadata in memory for fast access
2. **Queue Management**: Maintains FIFO (First-In-First-Out) ordering of jobs
3. **Retry Logic**: Automatically retries failed jobs with exponential backoff
4. **Priority Support**: Processes high-priority jobs before normal/low priority
5. **State Tracking**: Tracks job states (waiting, active, completed, failed)
6. **Concurrency Control**: Manages multiple workers processing jobs in parallel

### Which Service It Runs On

Redis (BullMQ) runs as a **separate Docker service** in the SystemVibe infrastructure:

**Service Name:** `redis`

**Docker Compose Configuration:** `infra/docker/docker-compose.yml`

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
```

**Connection Details:**

- **Host**: `localhost` (or `redis` when connecting from other Docker services)
- **Port**: `6379`
- **Protocol**: Redis protocol
- **Data Persistence**: Enabled via AOF (Append Only File)

### Why Separate Service?

Redis runs as a separate service because:

1. **Performance**: In-memory storage provides sub-millisecond job queue operations
2. **Reliability**: Independent service prevents API server crashes from affecting queue
3. **Scalability**: Can scale Redis independently (cluster mode, persistence options)
4. **Isolation**: Queue failures don't impact API response times
5. **Persistence**: Redis can persist jobs to disk, surviving restarts

### Communication Flow

```
NestJS API Service (port 3000)
    ↓ (Redis client: ioredis)
Redis Service (port 6379)
    ↓ (Redis Streams)
BullMQ Queue Operations
```

---

## Configuration

### Environment Variables

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379

# Queue Configuration
QUEUE_REDIS_HOST=localhost
QUEUE_REDIS_PORT=6379
QUEUE_REDIS_PASSWORD=
```

### Queue Configuration File

**File:** `apps/api/src/config/queue.config.ts`

```typescript
export const queueConfig = {
  redis: {
    host: process.env.QUEUE_REDIS_HOST || "localhost",
    port: parseInt(process.env.QUEUE_REDIS_PORT || "6379", 10),
    password: process.env.QUEUE_REDIS_PASSWORD || undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 3600, // Remove jobs older than 1 hour
    },
    removeOnFail: {
      count: 50, // Keep last 50 failed jobs
    },
  },
};
```

---

## Queue Setup

### Queue Module

**File:** `apps/api/src/modules/queue/queue.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { ConfigModule, ConfigService } from "@nestjs/config";

@Module({
  imports: [
    // Global BullMQ configuration
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get("queue.redis.host"),
          port: configService.get("queue.redis.port"),
          password: configService.get("queue.redis.password"),
        },
      }),
    }),
    // Register specific queues
    BullModule.registerQueue({
      name: "jobs",
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

### Jobs Module

**File:** `apps/api/src/modules/jobs/jobs.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { QueueModule } from "../queue/queue.module";

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({
      name: "jobs",
    }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
```

---

## Job Lifecycle

### State Transitions

```
PENDING (created in DB)
    ↓
QUEUED (added to BullMQ)
    ↓
PROCESSING (picked by worker)
    ↓
    ├─→ COMPLETED (success)
    └─→ FAILED (error)
         ↓
    (if retries remaining)
         ↓
    QUEUED (retry)
```

### Job Status Values

| Status       | Description                 | Terminal |
| ------------ | --------------------------- | -------- |
| `PENDING`    | Job created, not yet queued | No       |
| `QUEUED`     | Job waiting in queue        | No       |
| `PROCESSING` | Worker is processing        | No       |
| `COMPLETED`  | Job finished successfully   | Yes      |
| `FAILED`     | Job failed with error       | Yes      |
| `CANCELLED`  | Job cancelled by user       | Yes      |

---

## API Endpoints

### Create Job

**Endpoint:** `POST /api/jobs`

**Request:**

```json
{
  "type": "image-resize",
  "payload": {
    "imageUrl": "https://example.com/image.jpg",
    "width": 800,
    "height": 600
  },
  "priority": "normal",
  "timeout": 3600,
  "webhookUrl": "https://example.com/callback"
}
```

**Response (201):**

```json
{
  "id": "uuid",
  "type": "image-resize",
  "userId": "uuid",
  "payload": { ... },
  "status": "QUEUED",
  "priority": "normal",
  "timeout": 3600,
  "webhookUrl": "https://example.com/callback",
  "createdAt": "2024-01-01T00:00:00Z",
  "startedAt": null,
  "completedAt": null,
  "result": null,
  "error": null,
  "attemptCount": 0,
  "maxRetries": 3,
  "nextRetryAt": null
}
```

### Get Job

**Endpoint:** `GET /api/jobs/:id`

**Response (200):**

```json
{
  "id": "uuid",
  "type": "image-resize",
  "status": "COMPLETED",
  "result": { "outputUrl": "https://..." },
  ...
}
```

### List Jobs

**Endpoint:** `GET /api/jobs`

**Query Parameters:**

- `status` - Filter by status (e.g., `COMPLETED`)
- `type` - Filter by job type (e.g., `image-resize`)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

**Response (200):**

```json
{
  "jobs": [...],
  "total": 100
}
```

### Cancel Job

**Endpoint:** `DELETE /api/jobs/:id`

**Response (200):**

```json
{
  "id": "uuid",
  "status": "CANCELLED",
  ...
}
```

---

## Queue Operations

### Adding Jobs

```typescript
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bullmq";

@Injectable()
export class JobsService {
  constructor(@InjectQueue("jobs") private jobsQueue: Queue) {}

  async createJob(createJobDto: CreateJobDto) {
    // Add job to queue
    await this.jobsQueue.add(
      createJobDto.type,
      {
        jobId: job.id,
        type: createJobDto.type,
        payload: createJobDto.payload,
      },
      {
        jobId: job.id,
        priority: this.getPriorityValue(createJobDto.priority || "normal"),
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    );
  }

  private getPriorityValue(priority: string): number {
    const priorityMap: Record<string, number> = {
      low: 5,
      normal: 10,
      high: 1,
    };
    return priorityMap[priority] || 10;
  }
}
```

### Priority Levels

| Priority | BullMQ Value | Description            |
| -------- | ------------ | ---------------------- |
| `high`   | 1            | Processed first        |
| `normal` | 10           | Default priority       |
| `low`    | 5            | Processed after normal |

### Retry Logic

BullMQ automatically retries failed jobs with exponential backoff:

```typescript
{
  attempts: 3,              // Max retry attempts
  backoff: {
    type: 'exponential',    // Exponential backoff
    delay: 2000,           // Initial delay: 2s
  }
}
```

**Retry Schedule:**

- Attempt 1: Immediate
- Attempt 2: 2 seconds later
- Attempt 3: 4 seconds later
- Attempt 4: 8 seconds later

---

## Monitoring

### Health Check

**Endpoint:** `GET /api/health`

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "queue": "healthy",
    "auth": "healthy"
  },
  "version": "0.3.0"
}
```

### Queue Metrics

To get queue metrics (future implementation):

```typescript
const jobCounts = await jobsQueue.getJobCounts();
// Returns: { waiting: 10, active: 2, completed: 100, failed: 5 }
```

### Redis Commands

```bash
# Check queue length
XLEN bull:jobs

# View queue jobs
XRANGE bull:jobs - +

# Check consumer groups
XINFO GROUPS bull:jobs
```

---

## Best Practices

### 1. Job Payload Size

- Keep payloads under 1MB
- Store large data in object storage (S3, etc.)
- Pass URLs/references in payload instead of raw data

### 2. Timeout Configuration

- Set appropriate timeouts based on job type
- Image resize: 30-60 seconds
- Video transcode: 5-30 minutes
- AI inference: 1-10 minutes

### 3. Error Handling

- Always catch errors in worker code
- Log detailed error messages
- Set meaningful error messages in job metadata

### 4. Idempotency

- Design jobs to be idempotent
- Workers should handle duplicate processing gracefully
- Use job IDs for deduplication

### 5. Monitoring

- Track queue depth (waiting jobs)
- Monitor processing latency
- Alert on high failure rates
- Track retry counts

### 6. Cleanup

- Configure `removeOnComplete` to prevent memory bloat
- Configure `removeOnFail` to keep failed jobs for debugging
- Periodically clean up old completed jobs

---

## Testing

### Unit Tests

Unit tests mock the queue to test service logic:

```typescript
const mockQueue = {
  add: jest.fn(),
  remove: jest.fn(),
};

jest.mock("@nestjs/bull", () => ({
  InjectQueue: () => (target: any, key: string) => {},
  getQueueToken: (name: string) => `BullQueue_${name}`,
}));
```

### E2E Tests

E2E tests use real Redis and queue:

```typescript
beforeAll(async () => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  await app.init();
});
```

---

## Debugging BullMQ Queues

### Using Redis CLI

Connect to Redis and inspect queue data:

```bash
# Connect to Redis
redis-cli

# List all BullMQ queues
KEYS bull:*

# Check queue length (waiting jobs)
XLEN bull:jobs

# View jobs in queue (first 10)
XRANGE bull:jobs - + COUNT 10

# View jobs in waiting state
LRANGE bull:jobs:waiting 0 10

# View jobs in active state
LRANGE bull:jobs:active 0 10

# View jobs in delayed state (for retries)
LRANGE bull:jobs:delayed 0 10

# View jobs in failed state
LRANGE bull:jobs:failed 0 10

# View jobs in completed state
LRANGE bull:jobs:completed 0 10

# Check consumer groups
XINFO GROUPS bull:jobs

# Check consumers in a group
XINFO CONSUMERS bull:jobs jobs-group
```

### Using BullMQ Board (UI Dashboard)

**Status**: ✅ Deployed in SystemVibe

BullMQ Board is integrated into the NestJS API server for visual queue monitoring.

**Installation**:

```bash
npm install @bull-board/api @bull-board/express
```

**Configuration**:
Located in `apps/api/src/main.ts`:

```typescript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";

// In bootstrap()
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

const configService = app.get(ConfigService);
const jobsQueue = new Queue("jobs", {
  connection: {
    host: configService.get("queue.redis.host"),
    port: configService.get("queue.redis.port"),
    password: configService.get("queue.redis.password"),
  },
});

createBullBoard({
  queues: [new BullMQAdapter(jobsQueue, { readOnlyMode: false })],
  serverAdapter,
});

app.use("/admin/queues", serverAdapter.getRouter());
```

**Access**: `http://localhost:3000/admin/queues`

**Note**: Currently, the BullMQ Board endpoint is not protected by authentication. Consider adding JWT middleware or IP whitelist for production use.

**Features**:

- View all jobs in queue (waiting, active, completed, failed)
- Inspect job details and payloads
- Retry failed jobs manually
- Clean up old jobs
- Monitor queue statistics

### Programmatic Debugging

Add debugging endpoints to your API:

```typescript
// jobs.controller.ts
@Get('debug/queue-stats')
async getQueueStats() {
  const counts = await this.jobsQueue.getJobCounts();
  return {
    waiting: counts.waiting,
    active: counts.active,
    completed: counts.completed,
    failed: counts.failed,
    delayed: counts.delayed,
  };
}

@Get('debug/failed-jobs')
async getFailedJobs() {
  const jobs = await this.jobsQueue.getFailed(0, 10);
  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  }));
}

@Get('debug/active-jobs')
async getActiveJobs() {
  const jobs = await this.jobsQueue.getActive(0, 10);
  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    progress: job.progress,
    data: job.data,
    processedOn: job.processedOn,
  }));
}
```

### Logging

Enable BullMQ debug logging:

```typescript
// queue.module.ts
BullModule.forRootAsync({
  useFactory: () => ({
    redis: { host: 'localhost', port: 6379 },
    defaultJobOptions: { attempts: 3 },
  }),
  settings: {
    stalledInterval: 1000, // Check for stalled jobs every 1s
    maxStalledCount: 1, // Max stalled jobs before moving to failed
  },
}),
```

Add job event listeners:

```typescript
// jobs.service.ts
async onModuleInit() {
  this.jobsQueue.on('waiting', (job) => {
    console.log(`Job ${job.id} is waiting`);
  });

  this.jobsQueue.on('active', (job) => {
    console.log(`Job ${job.id} is now active`);
  });

  this.jobsQueue.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  this.jobsQueue.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err.message);
  });

  this.jobsQueue.on('stalled', (job) => {
    console.warn(`Job ${job.id} stalled`);
  });
}
```

### Common Debugging Scenarios

#### Jobs Stuck in "Waiting" State

```bash
# Check if workers are running
ps aux | grep node

# Check queue length
redis-cli XLEN bull:jobs

# Force move stuck jobs
redis-cli LTRIM bull:jobs:waiting 0 -1
```

#### Jobs Not Retrying

```typescript
// Check job configuration
const job = await this.jobsQueue.getJob(jobId);
console.log("Job config:", {
  attempts: job.opts.attempts,
  backoff: job.opts.backoff,
  attemptsMade: job.attemptsMade,
});
```

#### High Memory Usage in Redis

```bash
# Check Redis memory usage
redis-cli INFO memory

# Check key space
redis-cli INFO keyspace

# Find large keys
redis-cli --bigkeys

# Clean up completed jobs
await this.jobsQueue.clean(0, 100, 'completed');
await this.jobsQueue.clean(0, 50, 'failed');
```

### Monitoring Tools

- **BullMQ Board**: Visual dashboard for queue monitoring
- **Redis Insight**: Official Redis GUI tool
- **Prometheus + Grafana**: For production monitoring
- **Pino logs**: Check application logs for queue events

---

## Troubleshooting

### Queue Not Processing Jobs

**Symptoms:** Jobs stuck in `QUEUED` status

**Solutions:**

1. Check if workers are running
2. Verify Redis connection
3. Check worker logs for errors
4. Ensure queue name matches between producer and consumer

### High Memory Usage

**Symptoms:** Redis memory growing

**Solutions:**

1. Configure `removeOnComplete` and `removeOnFail`
2. Clean up old jobs manually
3. Check for stuck jobs in `active` state
4. Monitor queue depth

### Jobs Not Retrying

**Symptoms:** Failed jobs not retrying

**Solutions:**

1. Check `attempts` configuration
2. Verify backoff settings
3. Ensure worker throws errors (not silent failures)
4. Check BullMQ version compatibility

---

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Redis Streams](https://redis.io/docs/data-types/streams/)
- [NestJS Bull Module](https://docs.nestjs.com/techniques/queues)
- [Job Queue Patterns](https://www.enterpriseintegrationpatterns.com/patterns/messaging/Observer.html)
