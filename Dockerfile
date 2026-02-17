FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["npx", "tsx", "watch", "src/index.ts"]
