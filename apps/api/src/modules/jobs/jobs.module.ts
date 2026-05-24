import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '@systemvibe/database';

@Module({
  imports: [QueueModule, PrismaModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
