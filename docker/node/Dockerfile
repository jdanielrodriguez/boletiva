FROM node:20-alpine

WORKDIR /app

# openssl: requerido por Prisma en Alpine (musl).
# chromium + fuentes: para el smoke E2E con puppeteer-core (validación "como usuario").
RUN apk add --no-cache \
    bash \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# puppeteer-core usa el chromium del sistema (no descarga uno propio).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 8080

# Genera el cliente Prisma, sincroniza el esquema con la BD y levanta la API en watch.
CMD ["sh", "-c", "npx prisma generate && npx prisma db push --skip-generate --accept-data-loss && npx nx serve api"]
