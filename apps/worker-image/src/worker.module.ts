import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ImageProcessor } from "./image.processor";
import { RedisConfigService } from "./redis-config.service";
import { PrismaService } from "@systemvibe/database";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [],
      useClass: RedisConfigService,
    }),
    BullModule.registerQueue({
      name: "image",
    }),
  ],
  providers: [ImageProcessor, RedisConfigService, PrismaService],
})
export class WorkerModule {}
