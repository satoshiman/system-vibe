FROM node:20-alpine AS builder

# Install minimal build dependencies for Sharp
RUN apk add --no-cache \
    vips-dev \
    build-base \
    pkgconfig \
    openssl-dev

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./

# Copy workspace packages
COPY packages/config ./packages/config
COPY packages/database ./packages/database
COPY packages/database/prisma ./packages/database/prisma
COPY packages/redis ./packages/redis

# Copy worker-image app
COPY apps/worker-image/package.json ./apps/worker-image/
COPY apps/worker-image/tsconfig.json ./apps/worker-image/
COPY apps/worker-image/src ./apps/worker-image/src

# Install all dependencies (needed for TypeScript build)
RUN npm install

# Install worker-image specific dependencies
RUN npm install --workspace=apps/worker-image

# Generate Prisma client
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# Build TypeScript
RUN npm run build --workspace=apps/worker-image

FROM node:20

# Install runtime dependencies for Sharp and Prisma
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy entire worker-image directory from builder (includes node_modules)
COPY --from=builder /app/apps/worker-image ./apps/worker-image

# Copy shared packages
COPY --from=builder /app/packages/config ./packages/config
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/redis ./packages/redis

# Copy root node_modules for workspace resolution
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Start the worker
CMD ["node", "apps/worker-image/dist/main.js"]
