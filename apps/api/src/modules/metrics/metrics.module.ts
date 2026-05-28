import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({
      name: 'image',
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
