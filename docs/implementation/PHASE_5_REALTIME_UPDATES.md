# Phase 5: Real-time Updates via WebSocket

## Overview

Phase 5 implements real-time job status updates using WebSocket (Socket.IO) and Redis Pub/Sub. This allows clients to receive instant notifications when jobs change status without polling.

## Goals

- Enable real-time job status broadcasts to connected clients
- Use Redis Pub/Sub for worker-to-API communication
- Implement WebSocket gateway with Socket.IO
- Support job-specific channel subscriptions
- Provide progress updates for long-running jobs

## Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ WebSocket
       ↓
┌─────────────────────────────────┐
│   NestJS API Server            │
│                                │
│  ┌─────────────────────────┐  │
│  │  WebSocket Gateway      │  │
│  │  (Socket.IO)            │  │
│  └──────────┬──────────────┘  │
│             │                 │
│  ┌──────────▼──────────────┐  │
│  │  Pub/Sub Service        │  │
│  │  (Redis Subscriber)     │  │
│  └─────────────────────────┘  │
└──────────────┬──────────────────┘
               │ Redis Pub/Sub
               ↓
┌─────────────────────────────────┐
│      Redis Server               │
│  (Channels: job:status,         │
│   job:progress)                │
└──────────────┬──────────────────┘
               │ Publish
               ↓
┌─────────────────────────────────┐
│   Worker (Image Processor)      │
│  (Publishes job events)         │
└─────────────────────────────────┘
```

## Prerequisites

- Phase 1-4 completed
- Redis running
- NestJS API server running
- Worker service running

## Implementation Steps

### Step 1: Install Socket.IO Dependencies

Install Socket.IO packages compatible with NestJS 10:

```bash
npm install --workspace=apps/api @nestjs/websockets@^10.0.0 @nestjs/platform-socket.io@^10.0.0 socket.io
```

### Step 2: Create WebSocket Gateway

Create `apps/api/src/modules/websocket/websocket.gateway.ts`:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class JobsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(JobsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("subscribe:job")
  handleSubscribeToJob(client: Socket, jobId: string) {
    client.join(`job:${jobId}`);
    this.logger.log(`Client ${client.id} subscribed to job ${jobId}`);
  }

  @SubscribeMessage("unsubscribe:job")
  handleUnsubscribeFromJob(client: Socket, jobId: string) {
    client.leave(`job:${jobId}`);
    this.logger.log(`Client ${client.id} unsubscribed from job ${jobId}`);
  }

  // Method to broadcast job status updates to all subscribers
  broadcastJobStatus(
    jobId: string,
    data: { status: string; result?: unknown; error?: string },
  ) {
    this.server.to(`job:${jobId}`).emit("job:status", {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Broadcasted status for job ${jobId}: ${data.status}`);
  }

  // Method to broadcast job progress updates
  broadcastJobProgress(
    jobId: string,
    data: { progress: number; message?: string },
  ) {
    this.server.to(`job:${jobId}`).emit("job:progress", {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Broadcasted progress for job ${jobId}: ${data.progress}%`);
  }
}
```

### Step 3: Create Pub/Sub Service

Create `apps/api/src/modules/websocket/pubsub.service.ts`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { JobsGateway } from "./websocket.gateway";
import getRedisClient from "@systemvibe/redis";
import { Redis } from "ioredis";

interface JobStatusEvent {
  jobId: string;
  status: string;
  result?: unknown;
  error?: string;
}

interface JobProgressEvent {
  jobId: string;
  progress: number;
  message?: string;
}

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private redis: Redis;
  private subscriber: Redis;
  private channels = ["job:status", "job:progress"];

  constructor(private jobsGateway: JobsGateway) {
    this.redis = getRedisClient();
    this.subscriber = getRedisClient();
  }

  async onModuleInit() {
    // Subscribe to Redis Pub/Sub channels
    await this.subscriber.subscribe(...this.channels);
    this.logger.log(`Subscribed to channels: ${this.channels.join(", ")}`);

    // Listen for messages
    this.subscriber.on("message", (channel, message) => {
      this.handleMessage(channel, message);
    });
  }

  async onModuleDestroy() {
    await this.subscriber.unsubscribe(...this.channels);
    await this.subscriber.quit();
    this.logger.log("Unsubscribed from channels");
  }

  private handleMessage(channel: string, message: string) {
    try {
      const data = JSON.parse(message);

      if (channel === "job:status") {
        this.handleJobStatus(data as JobStatusEvent);
      } else if (channel === "job:progress") {
        this.handleJobProgress(data as JobProgressEvent);
      }
    } catch (error) {
      this.logger.error(`Failed to parse message from ${channel}`, {
        error: (error as Error).message,
      });
    }
  }

  private handleJobStatus(event: JobStatusEvent) {
    this.logger.log(
      `Received job status event: ${event.jobId} - ${event.status}`,
    );
    this.jobsGateway.broadcastJobStatus(event.jobId, {
      status: event.status,
      result: event.result,
      error: event.error,
    });
  }

  private handleJobProgress(event: JobProgressEvent) {
    this.logger.log(
      `Received job progress event: ${event.jobId} - ${event.progress}%`,
    );
    this.jobsGateway.broadcastJobProgress(event.jobId, {
      progress: event.progress,
      message: event.message,
    });
  }
}
```

### Step 4: Create WebSocket Module

Create `apps/api/src/modules/websocket/websocket.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { JobsGateway } from "./websocket.gateway";
import { PubSubService } from "./pubsub.service";

@Module({
  providers: [JobsGateway, PubSubService],
  exports: [JobsGateway, PubSubService],
})
export class WebsocketModule {}
```

### Step 5: Register WebSocket Module in App Module

Update `apps/api/src/app.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
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
  ],
})
export class AppModule {}
```

### Step 6: Update Worker to Publish Events

Update `apps/worker-image/src/image.processor.ts` to publish job status events:

```typescript
@OnWorkerEvent("active")
async onActive(job: Job) {
  logger.info(`Job started processing`, { jobId: job.id, name: job.name });

  // Publish job status to Redis Pub/Sub
  await redis.publish(
    'job:status',
    JSON.stringify({
      jobId: job.id,
      status: 'PROCESSING',
    }),
  );
}

@OnWorkerEvent("completed")
async onCompleted(job: Job, result: any) {
  logger.info(`Job completed`, { jobId: job.id, name: job.name, result });

  // Publish job status to Redis Pub/Sub
  await redis.publish(
    'job:status',
    JSON.stringify({
      jobId: job.id,
      status: 'COMPLETED',
      result,
    }),
  );
}

@OnWorkerEvent("failed")
async onFailed(job: Job, error: Error) {
  logger.error(`Job failed`, {
    jobId: job?.id,
    name: job?.name,
    error: error.message,
  });

  // Publish job status to Redis Pub/Sub
  if (job?.id) {
    await redis.publish(
      'job:status',
      JSON.stringify({
        jobId: job.id,
        status: 'FAILED',
        error: error.message,
      }),
    );
  }
}
```

## Client Usage

### Connecting to WebSocket

```javascript
const socket = io("http://localhost:3000");

// Subscribe to job updates
socket.emit("subscribe:job", "job-id-here");

// Listen for job status updates
socket.on("job:status", (data) => {
  console.log("Job status:", data);
  // { jobId: '...', status: 'PROCESSING', timestamp: '...' }
});

// Listen for job progress updates
socket.on("job:progress", (data) => {
  console.log("Job progress:", data);
  // { jobId: '...', progress: 50, message: 'Processing...', timestamp: '...' }
});

// Unsubscribe when done
socket.emit("unsubscribe:job", "job-id-here");
```

## Redis Pub/Sub Channels

### job:status

Published when job status changes:

- `PROCESSING` - Job started processing
- `COMPLETED` - Job finished successfully
- `FAILED` - Job failed with error

Payload:

```json
{
  "jobId": "uuid",
  "status": "PROCESSING",
  "result": {},
  "error": null
}
```

### job:progress

Published for long-running job progress updates (optional for future use).

Payload:

```json
{
  "jobId": "uuid",
  "progress": 50,
  "message": "Processing..."
}
```

## Testing

### 1. Start Services

```bash
# Start infrastructure (PostgreSQL, Redis)
docker compose up postgres redis -d

# Start API locally
cd apps/api
npm run dev

# Start worker in Docker
cd infra/docker
docker compose up -d worker-image
```

**Note:** Worker runs in Docker, API runs locally for development (per project setup).

### 2. Rebuild Worker After Code Changes

If you modify worker code (e.g., adding Redis Pub/Sub publish), rebuild the Docker image:

```bash
cd infra/docker
docker compose up -d --build worker-image
```

This rebuilds the worker container with the latest code changes.

### 3. Submit a Job

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-resize",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "width": 800,
      "height": 600
    }
  }'
```

### 3. Connect with WebSocket Client

Create a simple HTML file to test:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>WebSocket Test</title>
    <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>
  </head>
  <body>
    <h1>Job Status Monitor</h1>
    <input type="text" id="jobId" placeholder="Enter Job ID" />
    <button onclick="subscribe()">Subscribe</button>
    <button onclick="unsubscribe()">Unsubscribe</button>
    <pre id="log"></pre>

    <script>
      const socket = io("http://localhost:3000");
      const log = document.getElementById("log");

      socket.on("job:status", (data) => {
        log.textContent += JSON.stringify(data, null, 2) + "\n";
      });

      socket.on("job:progress", (data) => {
        log.textContent += JSON.stringify(data, null, 2) + "\n";
      });

      function subscribe() {
        const jobId = document.getElementById("jobId").value;
        socket.emit("subscribe:job", jobId);
      }

      function unsubscribe() {
        const jobId = document.getElementById("jobId").value;
        socket.emit("unsubscribe:job", jobId);
      }
    </script>
  </body>
</html>
```

### 4. Verify Real-time Updates

1. Submit a job and get the job ID
2. Enter the job ID in the test client
3. Click "Subscribe"
4. Watch for real-time status updates:
   - First: `PROCESSING` (when worker picks up job)
   - Then: `COMPLETED` or `FAILED` (when job finishes)

## Troubleshooting

### WebSocket Connection Fails

**Issue**: Client cannot connect to WebSocket

**Solutions**:

- Check if API server is running
- Verify CORS settings in gateway
- Check firewall rules
- Ensure correct WebSocket URL

### No Events Received

**Issue**: Client subscribed but no events received

**Solutions**:

- Check Redis Pub/Sub is working
- Verify worker is publishing events
- Check API logs for Pub/Sub subscription errors
- Ensure client is subscribed to correct job ID

### Redis Connection Errors

**Issue**: Pub/Sub service cannot connect to Redis

**Solutions**:

- Verify Redis is running: `docker-compose ps redis`
- Check Redis connection string in config
- Ensure Redis is accessible from API container

### Multiple Events Received

**Issue**: Client receives duplicate events

**Solutions**:

- Check if client is subscribed multiple times
- Verify worker is not publishing duplicate events
- Check for multiple API instances (should use Redis adapter for Socket.IO clustering)

## Key Concepts

### WebSocket vs HTTP Polling

| WebSocket                   | HTTP Polling                   |
| --------------------------- | ------------------------------ |
| Real-time bidirectional     | Request-response               |
| Lower latency               | Higher latency                 |
| Server can push             | Client must pull               |
| Persistent connection       | New connection each request    |
| Better for frequent updates | Better for infrequent requests |

### Redis Pub/Sub

- **Publisher**: Worker publishes events to Redis channels
- **Subscriber**: API subscribes to channels and receives events
- **Fire-and-forget**: No persistence, messages lost if no subscriber
- **Multiple subscribers**: All subscribers receive same message
- **Use case**: Real-time notifications where occasional message loss is acceptable

### Socket.IO Rooms

- **Room**: Logical grouping of clients
- **Job-specific rooms**: `job:{jobId}` for job updates
- **Broadcast**: Send to all clients in a room
- **Join/Leave**: Clients can join/leave rooms dynamically

## Next Steps

After completing Phase 5, you can:

1. **Phase 6**: Implement caching with TTL for performance optimization
2. **Add authentication**: Require JWT for WebSocket connections
3. **Progress updates**: Implement progress reporting for long-running jobs
4. **Socket.IO clustering**: Use Redis adapter for multi-instance deployments
5. **Error handling**: Add retry logic for failed WebSocket connections

## Summary

Phase 5 adds real-time capabilities to SystemVibe using:

- **Socket.IO** for WebSocket communication
- **Redis Pub/Sub** for worker-to-API event broadcasting
- **Job-specific rooms** for targeted updates
- **Real-time status updates** without polling

This provides a better user experience with instant notifications and reduces server load from polling requests.
