import { Module } from '@nestjs/common';
import { JobsGateway } from './websocket.gateway';
import { PubSubService } from './pubsub.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  providers: [JobsGateway, PubSubService],
  exports: [JobsGateway, PubSubService],
})
export class WebsocketModule {}
