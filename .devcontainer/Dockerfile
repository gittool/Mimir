# Development container - extends production image with dev tools
FROM node:22-alpine

# Install development tools
RUN apk add --no-cache \
    git \
    bash \
    curl \
    wget \
    ca-certificates \
    python3 \
    make \
    g++ \
    # Text editors
    vim \
    nano \
    # Network debugging
    netcat-openbsd \
    bind-tools \
    # Process tools
    htop \
    procps

# Install global npm packages for development
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    npm-check-updates

# Set bash as default shell for better compatibility
ENV SHELL=/bin/bash

WORKDIR /app

# Create node_modules directories with proper ownership
# This ensures anonymous volumes don't create root-owned directories
RUN mkdir -p /app/node_modules /app/frontend/node_modules && \
    chown -R node:node /app

# Note: node user already exists in node:22-alpine (uid 1000, gid 1000)
# Switch to non-root user for development (matches production)
USER node

# Keep container running for development
CMD ["sleep", "infinity"]
