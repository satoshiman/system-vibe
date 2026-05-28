import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const route = request.route?.path || request.path || 'unknown';
    
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(context, method, route, startTime);
        },
        error: () => {
          this.recordMetrics(context, method, route, startTime);
        },
      }),
    );
  }

  private recordMetrics(
    context: ExecutionContext,
    method: string,
    route: string,
    startTime: number,
  ): void {
    try {
      const response = context.switchToHttp().getResponse();
      const statusCode = response.statusCode || 200;
      const durationMs = Date.now() - startTime;
      const durationSeconds = durationMs / 1000;

      // Normalize route path to avoid high cardinality
      const normalizedRoute = this.normalizeRoute(route);

      this.metricsService.recordHttpRequest(
        method,
        normalizedRoute,
        statusCode,
        durationSeconds,
      );
    } catch (error) {
      this.logger.warn('Failed to record HTTP metrics', error);
    }
  }

  private normalizeRoute(route: string): string {
    // Replace dynamic segments with placeholders to reduce cardinality
    // e.g., /jobs/123 -> /jobs/:id
    // e.g., /jobs/abc-123/result -> /jobs/:id/result
    
    if (!route || route === 'unknown') {
      return 'unknown';
    }

    // Remove query strings
    const path = route.split('?')[0];

    // Replace UUID-like segments
    let normalized = path.replace(
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
      '/:id',
    );

    // Replace numeric segments (but not at root level)
    normalized = normalized.replace(/\/\d+/g, '/:id');

    return normalized;
  }
}
