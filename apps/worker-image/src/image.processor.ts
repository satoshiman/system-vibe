import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Job } from "bullmq";
import sharp from "sharp";
import pino from "pino";
import getRedisClient from "@systemvibe/redis";
import { env } from "@systemvibe/config";

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
export class ImageProcessor extends WorkerHost {
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    super();
    logger.info("ImageProcessor initialized");
    this.startHeartbeat();
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    logger.info(`Job started processing`, { jobId: job.id, name: job.name });
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job, result: any) {
    logger.info(`Job completed`, { jobId: job.id, name: job.name, result });
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job, error: Error) {
    logger.error(`Job failed`, {
      jobId: job?.id,
      name: job?.name,
      error: error.message,
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await redis.set(
          HEARTBEAT_KEY,
          JSON.stringify({
            workerId: WORKER_ID,
            type: "image",
            timestamp: new Date().toISOString(),
            status: "active",
          }),
          "EX",
          HEARTBEAT_TTL,
        );
        logger.debug("Heartbeat sent", { workerId: WORKER_ID });
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
