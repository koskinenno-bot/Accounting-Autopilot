# Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package json to install deps
COPY package.json package-lock.json ./
RUN npm install

# Copy source code and build
COPY . .
# We need to ensure Next.js fetches from the backend API externally via Docker networking, 
# But for client side requests, it uses NEXT_PUBLIC_API_URL or a proxy.
# We will pass this in via build arguments or environment.
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build


# Production Run Stage
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone build output. Ensure next.config.mjs has `output: 'standalone'`
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]
