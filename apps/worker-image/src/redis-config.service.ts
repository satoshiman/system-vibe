import { Injectable } from "@nestjs/common";
import { SharedBullConfigurationFactory } from "@nestjs/bullmq";
import { env } from "@systemvibe/config";

@Injectable()
export class RedisConfigService implements SharedBullConfigurationFactory {
  createSharedConfiguration() {
    return {
      connection: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD || undefined,
      },
    };
  }
}
