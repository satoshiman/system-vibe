# Phase 8: Webhook Notifications

## Overview

Phase 8 implements a reliable webhook notification system that notifies external systems when jobs complete. Includes retry logic, HMAC signature verification, and delivery tracking.

## Goals

- Send webhook notifications on job completion/failure
- Implement exponential backoff retry logic
- Add HMAC signature for webhook security
- Track webhook delivery status
- Support configurable webhook URLs per job

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Webhook Notification Flow                       │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Client    │────▶│   Submit    │────▶│    Job      │        │
│  │             │     │   Job       │     │   Created   │        │
│  └─────────────┘     └─────────────┘     └──────┬──────┘        │
│                                                 │               │
│                          webhookUrl:            │               │
│                          "https://client.com"   │               │
│                                                 ▼               │
│                                        ┌─────────────┐         │
│                                        │   Worker    │         │
│                                        │  Processes  │         │
│                                        │    Job      │         │
│                                        └──────┬──────┘         │
│                                               │               │
│                                               ▼               │
│                                        ┌─────────────┐         │
│                                        │   Publish   │         │
│                                        │  Job:status │         │
│                                        │  COMPLETED  │         │
│                                        └──────┬──────┘         │
│                                               │               │
│                                               ▼               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              API Server (Webhook Handler)              │ │
│  │                                                          │ │
│  │  1. Receive job:status COMPLETED event                │ │
│  │  2. Check if job has webhookUrl                         │ │
│  │  3. Sign payload with HMAC                            │ │
│  │  4. POST to webhook URL                               │ │
│  │  5. Retry on failure (max 3 attempts)                   │ │
│  │  6. Update webhook delivery status                    │ │
│  └──────────────────────────┬──────────────────────────────┘ │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              External Client System                    │   │
│  │                                                          │   │
│  │  1. Receive webhook POST                              │   │
│  │  2. Verify HMAC signature                             │   │
│  │  3. Process job result                                │   │
│  │  4. Return 200 OK                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Phase 1-6 completed
- Job entity with webhookUrl field
- Redis Pub/Sub working
- API server running

## Implementation Steps

### Step 1: Update Job Entity

Ensure `webhookUrl` field exists in schema. Update `packages/database/prisma/schema.prisma`:

```prisma
model Job {
  // ... existing fields ...

  webhookUrl        String?
  webhookDeliveredAt DateTime?
  webhookRetryCount  Int       @default(0)
  webhookStatus      String?   // pending, delivered, failed
}
```

Run migration:

```bash
cd packages/database
npx prisma migrate dev --name add_webhook_fields
```

### Step 2: Create Webhook Service

Create `apps/api/src/modules/webhook/webhook.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@systemvibe/database";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

interface WebhookPayload {
  jobId: string;
  type: string;
  status: "COMPLETED" | "FAILED";
  result?: any;
  error?: string;
  timestamp: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookSecret: string;
  private readonly maxRetries = 3;
  private readonly retryDelays = [5000, 15000, 45000]; // 5s, 15s, 45s

  constructor(private prisma: PrismaService) {
    this.webhookSecret = process.env.WEBHOOK_SECRET || "default-secret";
  }

  async sendWebhook(jobId: string, payload: WebhookPayload): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job || !job.webhookUrl) {
      this.logger.debug(`No webhook URL for job ${jobId}`);
      return;
    }

    // Check if already delivered
    if (job.webhookStatus === "delivered") {
      this.logger.debug(`Webhook already delivered for job ${jobId}`);
      return;
    }

    // Check retry limit
    if (job.webhookRetryCount >= this.maxRetries) {
      this.logger.warn(`Max retries reached for job ${jobId} webhook`);
      await this.updateWebhookStatus(jobId, "failed");
      return;
    }

    // Sign payload
    const signature = this.signPayload(payload);

    try {
      this.logger.log(`Sending webhook for job ${jobId} to ${job.webhookUrl}`);

      await axios.post(job.webhookUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Job-ID": jobId,
        },
        timeout: 30000, // 30 second timeout
      });

      // Success - mark as delivered
      await this.updateWebhookStatus(jobId, "delivered");
      this.logger.log(`Webhook delivered successfully for job ${jobId}`);
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Webhook delivery failed for job ${jobId}: ${axiosError.message}`,
      );

      // Schedule retry
      const nextRetry = job.webhookRetryCount + 1;
      if (nextRetry < this.maxRetries) {
        const delay = this.retryDelays[nextRetry];
        this.logger.log(`Scheduling retry ${nextRetry} in ${delay}ms`);

        setTimeout(() => {
          this.sendWebhook(jobId, payload);
        }, delay);
      } else {
        await this.updateWebhookStatus(jobId, "failed");
      }
    }
  }

  private signPayload(payload: WebhookPayload): string {
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payloadString)
      .digest("hex");
  }

  private async updateWebhookStatus(
    jobId: string,
    status: "delivered" | "failed",
  ): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        webhookStatus: status,
        webhookDeliveredAt: status === "delivered" ? new Date() : undefined,
      },
    });
  }
}
```

### Step 3: Create Webhook Module

Create `apps/api/src/modules/webhook/webhook.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { WebhookService } from "./webhook.service";

@Module({
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
```

### Step 4: Update PubSub Service

Update `apps/api/src/modules/websocket/pubsub.service.ts` to trigger webhooks:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { JobsGateway } from "./websocket.gateway";
import { WebhookService } from "../webhook/webhook.service";
import getRedisClient from "@systemvibe/redis";
import { Redis } from "ioredis";

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private redis: Redis;
  private subscriber: Redis;
  private channels = ["job:status", "job:progress"];

  constructor(
    private jobsGateway: JobsGateway,
    private webhookService: WebhookService,
  ) {
    this.redis = getRedisClient();
    this.subscriber = getRedisClient();
  }

  // ... existing onModuleInit and onModuleDestroy ...

  private handleJobStatus(event: JobStatusEvent) {
    this.logger.log(
      `Received job status event: ${event.jobId} - ${event.status}`,
    );

    // Broadcast to WebSocket clients
    this.jobsGateway.broadcastJobStatus(event.jobId, {
      status: event.status,
      result: event.result,
      error: event.error,
    });

    // Send webhook for terminal states
    if (event.status === "COMPLETED" || event.status === "FAILED") {
      this.webhookService.sendWebhook(event.jobId, {
        jobId: event.jobId,
        type: "image-resize", // Get from job data
        status: event.status as "COMPLETED" | "FAILED",
        result: event.result,
        error: event.error,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ... existing handleJobProgress ...
}
```

### Step 5: Update CreateJobDto

Ensure `webhookUrl` is in the DTO (`apps/api/src/modules/jobs/dto/create-job.dto.ts`):

```typescript
export class CreateJobDto {
  // ... existing fields ...

  @ApiProperty({
    description: "Webhook URL to notify on completion",
    example: "https://example.com/webhook",
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  webhookUrl?: string;
}
```

### Step 6: Update JobsService

Update `apps/api/src/modules/jobs/jobs.service.ts` to store webhookUrl:

```typescript
async create(createJobDto: CreateJobDto): Promise<JobResponseDto> {
  const job = await this.prisma.job.create({
    data: {
      type: createJobDto.type,
      payload: createJobDto.payload as any,
      priority: createJobDto.priority || 'normal',
      timeout: createJobDto.timeout || 3600,
      webhookUrl: createJobDto.webhookUrl,
      webhookStatus: createJobDto.webhookUrl ? 'pending' : null,
      status: 'PENDING',
    },
  });

  // ... rest of create logic ...
}
```

### Step 7: Update App Module

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
  ],
})
export class AppModule {}
```

### Step 8: Add Environment Variable

Update `.env.example`:

```bash
# Webhook
WEBHOOK_SECRET=your-webhook-secret-key
```

## Webhook Payload Format

When a job completes, the webhook payload will be:

```json
{
  "jobId": "uuid",
  "type": "image-resize",
  "status": "COMPLETED",
  "result": {
    "outputUrl": "https://storage.example.com/result.jpg",
    "width": 800,
    "height": 600
  },
  "timestamp": "2026-05-28T10:30:00.000Z"
}
```

For failed jobs:

```json
{
  "jobId": "uuid",
  "type": "image-resize",
  "status": "FAILED",
  "error": "Failed to download image: 404 Not Found",
  "timestamp": "2026-05-28T10:30:00.000Z"
}
```

## Headers

| Header                | Description                      |
| --------------------- | -------------------------------- |
| `Content-Type`        | `application/json`               |
| `X-Webhook-Signature` | HMAC-SHA256 signature of payload |
| `X-Job-ID`            | Job UUID                         |

## Verifying Webhook Signature

Clients should verify the HMAC signature:

```typescript
import crypto from "crypto";

function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

// Express example
app.post("/webhook", (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const payload = JSON.stringify(req.body);

  if (!verifyWebhook(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).send("Invalid signature");
  }

  // Process webhook
  console.log("Job completed:", req.body.jobId);
  res.status(200).send("OK");
});
```

## Testing

### 1. Start Webhook Test Server

Create a simple test server:

```bash
# test-webhook-server.js
const http = require('http');
const crypto = require('crypto');

const WEBHOOK_SECRET = 'your-webhook-secret-key';

const server = http.createServer((req, res) => {
  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const signature = req.headers['x-webhook-signature'];

      // Verify signature
      const expected = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(body)
        .digest('hex');

      if (signature === expected) {
        console.log('✓ Webhook received:', JSON.parse(body));
        res.writeHead(200);
        res.end('OK');
      } else {
        console.log('✗ Invalid signature');
        res.writeHead(401);
        res.end('Invalid signature');
      }
    });
  }
});

server.listen(4000, () => console.log('Webhook test server on port 4000'));
```

Run:

```bash
node test-webhook-server.js
```

### 2. Submit Job with Webhook

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-resize",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "width": 800,
      "height": 600
    },
    "webhookUrl": "http://host.docker.internal:4000/webhook"
  }'
```

### 3. Verify Webhook Delivery

Check webhook test server logs and database:

```bash
docker exec -it systemvibe-postgres psql -U systemvibe -d systemvibe -c \
  "SELECT id, webhookStatus, webhookDeliveredAt FROM Job WHERE webhookUrl IS NOT NULL;"
```

## Retry Behavior

| Attempt | Delay      | Action on Failure |
| ------- | ---------- | ----------------- |
| 1       | Immediate  | Wait 5 seconds    |
| 2       | 5 seconds  | Wait 15 seconds   |
| 3       | 15 seconds | Wait 45 seconds   |
| 4       | 45 seconds | Mark as failed    |

## Troubleshooting

### Webhook Not Received

1. Check job has `webhookUrl` set
2. Verify webhook server is accessible from API container
3. Check API logs for webhook errors
4. Verify `WEBHOOK_SECRET` is set

### Invalid Signature

1. Ensure client uses same secret as server
2. Check payload is not modified before verification
3. Use `crypto.timingSafeEqual` to prevent timing attacks

## Next Steps

After completing Phase 7:

1. **Phase 8**: Implement rate limiting
2. **Add webhook dashboard**: Track delivery status in UI
3. **Webhook retry UI**: Allow manual retry from dashboard
4. **Multiple webhooks**: Support multiple URLs per job

## Summary

Phase 7 adds reliable webhook notifications with:

- **Automatic delivery** on job completion/failure
- **HMAC security** for payload verification
- **Exponential backoff** retry logic
- **Delivery tracking** in database

This enables SystemVibe to integrate with external systems and notify them of job status changes.
