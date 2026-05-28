import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MetricsInterceptor } from './modules/metrics/metrics.interceptor';
import queueConfig from './config/queue.config';

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
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
