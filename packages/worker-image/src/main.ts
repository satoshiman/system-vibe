import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module";
import pino from "pino";
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

async function bootstrap() {
  logger.info("Starting Image Worker...");

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "error", "warn", "debug"],
  });

  logger.info("Image Worker started successfully");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.error("Failed to start Image Worker", error);
  process.exit(1);
});
