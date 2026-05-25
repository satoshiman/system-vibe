FROM node:20-alpine AS builder
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

# Install api specific dependencies
RUN npm install --workspace=apps/api

# Generate Prisma client
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# Build TypeScript
RUN npm run build --workspace=apps/api

FROM node:20-alpine
WORKDIR /app

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
CMD ["node", "apps/api/dist/main"]
