# Use Node.js v20 (LTS) as the base image
FROM node:20-slim AS builder

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:20-slim

# Set node environment to production
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy only necessary files from builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/index.js ./

# Don't run as root
USER node

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["node", "index.js"] 