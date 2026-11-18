FROM node:20-bookworm

# Install dependencies required by Playwright/Chromium and Xvfb virtual framebuffer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libgbm-dev \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm ci --legacy-peer-deps
RUN cd frontend && npm ci --legacy-peer-deps

# Copy application files
COPY . .

# Install Playwright Chromium & Google Chrome browser and system dependencies
RUN npx playwright install chromium chrome --with-deps

# Build the frontend
RUN cd frontend && npm run build

EXPOSE 3001

ENV PORT=3001
ENV HEADLESS=false
ENV NODE_ENV=production

# Start Node server directly so port binding happens immediately on Render; Xvfb is managed by server.js / screencast_helper.js
CMD ["node", "server.js"]
