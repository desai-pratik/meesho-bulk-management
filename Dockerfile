FROM node:20-bookworm

# Install dependencies required by Playwright/Chromium and Xvfb virtual framebuffer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libgbm-dev \
    xvfb \
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

# Run with xvfb-run to provide a virtual display for headed Chrome (bypasses Akamai WAF)
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24", "node", "server.js"]
