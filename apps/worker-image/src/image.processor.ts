import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Job } from "bullmq";
import sharp from "sharp";
import pino from "pino";
import getRedisClient from "@systemvibe/redis";
import { env } from "@systemvibe/config";
import { PrismaService } from "@systemvibe/database";
import { Injectable } from "@nestjs/common";

const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const redis = getRedisClient();

// HOSTNAME is a runtime variable set by Docker, not in .env
const WORKER_ID = `worker-image-${process.env.HOSTNAME || "local"}`;
const HEARTBEAT_KEY = `worker:heartbeat:${WORKER_ID}`;
const HEARTBEAT_TTL = 30; // 30 seconds

interface ImageResizeJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    width: number;
    height: number;
  };
}

interface ImageThumbnailJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    size: number;
  };
}

interface ImageCompressJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    quality: number;
  };
}

@Processor("image")
@Injectable()
export class ImageProcessor extends WorkerHost {
  private heartbeatInterval: NodeJS.Timeout;
  private jobStartTimes = new Map<string, number>();
  private jobsProcessed = 0;
  private jobsFailed = 0;

  constructor(private prisma: PrismaService) {
    super();
    logger.info("ImageProcessor initialized");
    this.startHeartbeat();
  }

  @OnWorkerEvent("active")
  async onActive(job: Job) {
    logger.info(`Job started processing`, { jobId: job.id, name: job.name });

    // Track start time for metrics
    this.jobStartTimes.set(job.id!, Date.now());

    // Update job status in database
    try {
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error("Failed to update job status in database", {
        jobId: job.id,
        error: (error as Error).message,
      });
    }

    // Publish job status to Redis Pub/Sub
    await redis.publish(
      "job:status",
      JSON.stringify({
        jobId: job.id,
        status: "PROCESSING",
      }),
    );
  }

  @OnWorkerEvent("completed")
  async onCompleted(job: Job, result: any) {
    const startTime = this.jobStartTimes.get(job.id!);
    const durationMs = startTime ? Date.now() - startTime : 0;
    const durationSeconds = durationMs / 1000;

    this.jobsProcessed++;
    this.jobStartTimes.delete(job.id!);

    logger.info(`Job completed`, {
      jobId: job.id,
      name: job.name,
      durationMs,
      result,
    });

    // Update job status in database
    try {
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          result: result as any,
        },
      });
    } catch (error) {
      logger.error("Failed to update job status in database", {
        jobId: job.id,
        error: (error as Error).message,
      });
    }

    // Publish job status to Redis Pub/Sub
    await redis.publish(
      "job:status",
      JSON.stringify({
        jobId: job.id,
        status: "COMPLETED",
        result,
      }),
    );

    // Publish job metrics for Prometheus
    await redis.publish(
      "job:metrics",
      JSON.stringify({
        event: "job_completed",
        jobId: job.id,
        type: job.name,
        priority: job.data?.priority || "normal",
        durationSeconds,
        timestamp: new Date().toISOString(),
        workerId: WORKER_ID,
      }),
    );
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job, error: Error) {
    const startTime = job?.id ? this.jobStartTimes.get(job.id) : null;
    const durationMs = startTime ? Date.now() - startTime : 0;
    const durationSeconds = durationMs / 1000;

    this.jobsFailed++;
    if (job?.id) {
      this.jobStartTimes.delete(job.id);
    }

    logger.error(`Job failed`, {
      jobId: job?.id,
      name: job?.name,
      durationMs,
      error: error.message,
    });

    // Update job status in database
    if (job?.id) {
      try {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: error.message,
            attemptCount: { increment: 1 },
          },
        });
      } catch (dbError) {
        logger.error("Failed to update job status in database", {
          jobId: job.id,
          error: (dbError as Error).message,
        });
      }

      // Publish job status to Redis Pub/Sub
      await redis.publish(
        "job:status",
        JSON.stringify({
          jobId: job.id,
          status: "FAILED",
          error: error.message,
        }),
      );

      // Publish job metrics for Prometheus
      await redis.publish(
        "job:metrics",
        JSON.stringify({
          event: "job_failed",
          jobId: job.id,
          type: job.name,
          priority: job.data?.priority || "normal",
          durationSeconds,
          error: error.message,
          timestamp: new Date().toISOString(),
          workerId: WORKER_ID,
        }),
      );
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await redis.set(
          HEARTBEAT_KEY,
          JSON.stringify({
            id: WORKER_ID,
            workerId: WORKER_ID,
            type: "image",
            timestamp: new Date().toISOString(),
            status: "active",
            jobsProcessed: this.jobsProcessed,
            jobsFailed: this.jobsFailed,
            uptime: process.uptime(),
          }),
          "EX",
          HEARTBEAT_TTL,
        );
        logger.debug("Heartbeat sent", {
          workerId: WORKER_ID,
          jobsProcessed: this.jobsProcessed,
          jobsFailed: this.jobsFailed,
        });
      } catch (error) {
        logger.error("Failed to send heartbeat", { error: error.message });
      }
    }, 10000);

    logger.info("Heartbeat started", { workerId: WORKER_ID, interval: "10s" });
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      logger.info("Heartbeat stopped");
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { name, data } = job;
    logger.info(`Processing job: ${name}`, { jobId: job.id, data });

    try {
      let result;

      switch (name) {
        case "image-resize":
          result = await this.processResize(job);
          break;
        case "image-thumbnail":
          result = await this.processThumbnail(job);
          break;
        case "image-compress":
          result = await this.processCompress(job);
          break;
        default:
          throw new Error(`Unknown job type: ${name}`);
      }

      logger.info(`Job completed successfully: ${name}`, { jobId: job.id });
      return result;
    } catch (error) {
      logger.error(`Job failed: ${name}`, {
        jobId: job.id,
        error: error.message,
      });
      throw error;
    }
  }

  private async processResize(job: Job<ImageResizeJob>) {
    const { payload } = job.data;
    const { imageUrl, width, height } = payload;

    // In a real implementation, you would:
    // 1. Download the image from imageUrl
    // 2. Process it with sharp
    // 3. Upload the result to storage
    // 4. Return the new URL

    // For now, we'll simulate the processing
    logger.info(`Resizing image to ${width}x${height}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(1000);

    return {
      outputUrl: `${imageUrl}_resized_${width}x${height}`,
      durationMs: 1000,
      originalSize: { width: 1920, height: 1080 },
      newSize: { width, height },
    };
  }

  private async processThumbnail(job: Job<ImageThumbnailJob>) {
    const { payload } = job.data;
    const { imageUrl, size } = payload;

    logger.info(`Creating thumbnail of size ${size}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(500);

    return {
      thumbnailUrl: `${imageUrl}_thumb_${size}`,
      size,
    };
  }

  private async processCompress(job: Job<ImageCompressJob>) {
    const { payload } = job.data;
    const { imageUrl, quality } = payload;

    logger.info(`Compressing image with quality ${quality}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(1500);

    return {
      compressedUrl: `${imageUrl}_compressed_q${quality}`,
      originalSize: 2048000, // 2MB
      newSize: 512000, // 500KB
      compressionRatio: 0.25,
    };
  }

  private async simulateProcessing(ms: number) {
    // Random delay between 5-15 seconds for testing
    const randomDelay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
    logger.info(`Simulating processing with ${randomDelay}ms delay`);
    return new Promise((resolve) => setTimeout(resolve, randomDelay));
  }
}
