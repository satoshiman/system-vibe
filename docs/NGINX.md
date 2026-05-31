# Nginx in SystemVibe

## What is Nginx?

Nginx (pronounced "engine-x") is a high-performance, open-source web server and reverse proxy. It's known for:

- **High performance**: Low memory footprint and high concurrency handling using an event-driven architecture
- **Reverse proxy**: Can forward requests to backend servers
- **Load balancing**: Distributes traffic across multiple servers
- **SSL/TLS termination**: Handles HTTPS encryption
- **Static file serving**: Efficiently serves static assets
- **Caching**: Improves performance by caching responses

## Why Use Nginx in SystemVibe?

In SystemVibe, Nginx serves as a reverse proxy for the API service. Here's why it's beneficial:

### 1. **Single Entry Point**

- All external traffic enters through Nginx on port 80
- Simplifies client configuration (single URL)
- Hides internal service architecture

### 2. **Security**

- Acts as a security barrier between external clients and backend services
- Can implement rate limiting, IP whitelisting, and other security measures
- Hides backend service ports from direct access

### 3. **Load Balancing (Future)**

- Can distribute traffic across multiple API instances
- Supports various load balancing algorithms (round-robin, least connections, etc.)
- Enables horizontal scaling

### 4. **SSL/TLS Termination (Future)**

- Can handle HTTPS encryption/decryption
- Reduces load on backend services
- Centralized certificate management

### 5. **Caching (Future)**

- Can cache API responses to reduce backend load
- Improves response times for frequently accessed data
- Reduces database queries

### 6. **Request Routing**

- Routes requests based on URL patterns
- Can serve static files directly
- Proxies API requests to backend services

## Current Configuration

The current Nginx configuration is located at `infra/docker/nginx.conf`:

```nginx
events {
  worker_connections 1024;
}

http {
  upstream api {
    server host.docker.internal:3000;
  }

  server {
    listen 80;
    server_name localhost;

    location /api/ {
      proxy_pass http://api/api/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_cache_bypass $http_upgrade;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      return 200 "SystemVibe API Gateway\n";
      add_header Content-Type text/plain;
    }
  }
}
```

### Configuration Breakdown

- **`upstream api`**: Defines the backend API server
  - `host.docker.internal:3000`: Points to the host machine where API runs with `npm run dev` (development setup)
  - In production, this would point to container names (e.g., `api:3000`) or load-balanced endpoints

- **`location /api/`**: Handles all API requests
  - `proxy_pass http://api/api/`: Forwards requests to the backend API
  - `proxy_http_version 1.1`: Uses HTTP/1.1 for better performance
  - `proxy_set_header`: Sets various headers for proper request forwarding
    - `Upgrade`, `Connection`: Supports WebSocket connections
    - `Host`: Preserves the original host header
    - `X-Real-IP`, `X-Forwarded-For`: Preserves client IP information
    - `X-Forwarded-Proto`: Preserves the original protocol (http/https)

- **`location /`**: Root endpoint returns a simple message

## Development vs Production Setup

### Development Environment

- API runs locally with `npm run dev` on port 3000
- Nginx proxies to `host.docker.internal:3000` (Docker Desktop special DNS name)
- Enables hot-reload and debugging
- Nginx runs in Docker container for consistency

### Production Environment

- API runs in Docker containers
- Nginx proxies to container names (e.g., `api:3000`)
- Multiple API instances can be load-balanced
- SSL/TLS termination at Nginx
- Health checks and automatic failover

## Applications in SystemVibe

### Current Use Cases

1. **API Gateway**: Single entry point for all API requests
2. **Request Routing**: Routes `/api/*` requests to the backend API
3. **Header Management**: Adds forwarding headers for proper client identification

### Future Use Cases

1. **Load Balancing**: Distribute traffic across multiple API instances
2. **SSL/TLS Termination**: Handle HTTPS encryption
3. **Rate Limiting**: Protect against abuse and DDoS attacks
4. **Caching**: Cache API responses to improve performance
5. **Static File Serving**: Serve frontend assets directly
6. **WebSocket Support**: Enable real-time communication
7. **Request Logging**: Centralized logging and monitoring
8. **API Versioning**: Route different API versions to different backends

## Testing Nginx

### Check Nginx Status

```bash
docker compose ps nginx
```

### Restart Nginx

```bash
docker compose restart nginx
```

### Test Health Check through Nginx

```bash
curl http://localhost/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2026-05-25T05:56:02.998Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "queue": "healthy",
    "worker": "healthy"
  },
  "version": "0.3.0"
}
```

### View Nginx Logs

```bash
docker compose logs nginx
```

### Reload Nginx Configuration (without restart)

```bash
docker compose exec nginx nginx -s reload
```

## Best Practices

1. **Always use Nginx as a reverse proxy** in production, never expose backend services directly
2. **Keep Nginx configuration in version control** (as we do with `nginx.conf`)
3. **Use environment variables** for configuration where possible
4. **Monitor Nginx logs** for errors and performance issues
5. **Implement rate limiting** to prevent abuse
6. **Use SSL/TLS in production** for secure communication
7. **Regularly update Nginx** for security patches
8. **Test configuration changes** in development before production

## Resources

- [Official Nginx Documentation](https://nginx.org/en/docs/)
- [Nginx Reverse Proxy Guide](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- [Nginx Load Balancing](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/)
