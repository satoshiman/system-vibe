FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./

# Copy workspace packages
COPY packages/config ./packages/config
COPY packages/database ./packages/database
COPY packages/database/prisma ./packages/database/prisma
COPY packages/redis ./packages/redis

# Copy api app
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Install all dependencies (needed for TypeScript build)
RUN npm install

# Install nestjs cli globally for build
RUN npm install -g @nestjs/cli

# Install api specific dependencies
RUN npm install --workspace=apps/api

# Generate Prisma client
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# Build TypeScript
RUN npm run build --workspace=apps/api

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# Set environment variables for Docker network
ENV DATABASE_URL="postgresql://systemvibe:devpassword@postgres:5432/systemvibe"
ENV REDIS_URL="redis://redis:6379"
ENV REDIS_HOST="redis"
ENV DB_USER="systemvibe"
ENV DB_PASSWORD="devpassword"
ENV DB_NAME="systemvibe"

# Copy entire api directory from builder (includes node_modules)
COPY --from=builder /app/apps/api ./apps/api

# Copy shared packages
COPY --from=builder /app/packages/config ./packages/config
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/redis ./packages/redis

# Copy root node_modules for workspace resolution
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

EXPOSE 3000
CMD ["node", "apps/api/dist/src/main.js"]
