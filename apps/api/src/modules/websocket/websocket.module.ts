import { Module } from '@nestjs/common';
import { JobsGateway } from './websocket.gateway';
import { PubSubService } from './pubsub.service';

@Module({
  providers: [JobsGateway, PubSubService],
  exports: [JobsGateway, PubSubService],
})
export class WebsocketModule {}
