import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class JobsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(JobsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:job')
  handleSubscribeToJob(client: Socket, jobId: string) {
    client.join(`job:${jobId}`);
    this.logger.log(`Client ${client.id} subscribed to job ${jobId}`);
  }

  @SubscribeMessage('unsubscribe:job')
  handleUnsubscribeFromJob(client: Socket, jobId: string) {
    client.leave(`job:${jobId}`);
    this.logger.log(`Client ${client.id} unsubscribed from job ${jobId}`);
  }

  // Method to broadcast job status updates to all subscribers
  broadcastJobStatus(jobId: string, data: { status: string; result?: unknown; error?: string }) {
    this.server.to(`job:${jobId}`).emit('job:status', {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Broadcasted status for job ${jobId}: ${data.status}`);
  }

  // Method to broadcast job progress updates
  broadcastJobProgress(jobId: string, data: { progress: number; message?: string }) {
    this.server.to(`job:${jobId}`).emit('job:progress', {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Broadcasted progress for job ${jobId}: ${data.progress}%`);
  }
}
