FROM node:20-alpine

# Install minimal build dependencies for Sharp
RUN apk add --no-cache \
    vips-dev \
    build-base \
    pkgconfig

WORKDIR /app

# Copy package.json and source code from packages/worker-image
COPY packages/worker-image/package.json ./
COPY packages/worker-image/tsconfig.json ./
COPY packages/worker-image/src ./src

# Install all dependencies (needed for TypeScript build)
RUN npm install

# Build TypeScript
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Start the worker
CMD ["node", "dist/main.js"]
