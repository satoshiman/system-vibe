FROM node:20-alpine AS builder

# Install minimal build dependencies for Sharp
RUN apk add --no-cache \
    vips-dev \
    build-base \
    pkgconfig

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./

# Copy workspace packages
COPY packages/config ./packages/config
COPY packages/database ./packages/database
COPY packages/redis ./packages/redis

# Copy worker-image app
COPY apps/worker-image/package.json ./apps/worker-image/
COPY apps/worker-image/tsconfig.json ./apps/worker-image/
COPY apps/worker-image/src ./apps/worker-image/src

# Install all dependencies (needed for TypeScript build)
RUN npm install

# Build TypeScript
RUN npm run build --workspace=apps/worker-image

FROM node:20-alpine

# Install runtime dependencies for Sharp
RUN apk add --no-cache \
    vips-dev

WORKDIR /app

# Copy built files and dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker-image/dist ./dist
COPY --from=builder /app/apps/worker-image/package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Start the worker
CMD ["node", "dist/main.js"]
