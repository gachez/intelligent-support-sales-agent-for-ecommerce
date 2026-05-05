FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies from lockfile for a deterministic image
COPY package*.json ./
RUN npm ci --include=dev

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY demo/ ./demo/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "node_modules/tsx/dist/cli.mjs", "watch", "src/index.ts"]
