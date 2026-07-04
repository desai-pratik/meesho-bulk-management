FROM node:20-bookworm

# Install dependencies required by Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libgbm-dev \
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

# Install Playwright Chromium browser and its system dependencies
RUN npx playwright install chromium --with-deps

# Build the frontend
RUN cd frontend && npm run build

EXPOSE 3001

ENV PORT=3001
ENV HEADLESS=true
ENV NODE_ENV=production

CMD ["node", "server.js"]
