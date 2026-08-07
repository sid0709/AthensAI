# syntax=docker/dockerfile:1

FROM node:20-bookworm AS builder

WORKDIR /app

# Keep the published image light: do not download Chrome during build/push.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=1

# zip/rsync: pack Athens Lens + Extension + LI-scrapper downloads for the Apps page.
RUN apt-get update \
 && apt-get install -y --no-install-recommends zip rsync \
 && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm ci \
 && npm ci --prefix Athens \
 && npm ci --prefix athens-lens \
 && npm ci --prefix athens-backend \
 && npm ci --prefix Extension \
 && npm run prisma:generate --prefix athens-backend \
 && npm run build --prefix athens-backend

WORKDIR /app/Athens
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# Chrome extension zips → /downloads/ (served by nginx; linked from Apps & Plugins).
# Set by CI from secrets.VPS_HOST (no hardcoded host in the image recipe).
ARG PUBLIC_ORIGIN=
ARG WXT_API_URL=
ARG ATHENS_API_URL=
ENV PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
ENV WXT_API_URL=${WXT_API_URL}
ENV ATHENS_API_URL=${ATHENS_API_URL}
RUN chmod +x /app/docker/pack-extensions.sh \
 && /app/docker/pack-extensions.sh


FROM node:20-bookworm

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8980 \
    CORS_ORIGIN=*

# libreoffice-writer-nogui + poppler-utils: uploaded resume template preview
# (DOCX → PDF via soffice, PDF → PNG pages via pdftoppm).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates \
    nginx \
    supervisor \
    fonts-liberation \
    fonts-noto-color-emoji \
    libreoffice-writer-nogui \
    poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/athens-backend ./athens-backend
COPY --from=builder /app/Athens/dist ./Athens/dist
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /app/docker/supervisord.conf
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh \
 && find /app -name '.env' -delete \
 && find /app -name '.env.*' ! -name '.env.example' -delete \
 && mkdir -p /var/log/nginx

EXPOSE 80 8980 9101

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://127.0.0.1:8980/readyz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
