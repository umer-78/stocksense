FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Copy manifests first (layer caching). prisma/ is copied early so that
# @prisma/client's postinstall can run `prisma generate` during npm ci.
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# --include=dev: NODE_ENV=production would otherwise make npm skip
# devDependencies, and `remix vite:build` needs vite + @remix-run/dev.
RUN npm ci --include=dev

COPY . .

RUN npm run build && npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]