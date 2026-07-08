FROM node:20-alpine

WORKDIR /app

# chromium + fuentes: para correr los tests de karma en modo headless dentro del
# contenedor (mismo patrón que el contenedor de la API con puppeteer).
RUN apk add --no-cache \
    bash \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Karma usa el chromium del sistema (no descarga uno propio).
ENV CHROME_BIN=/usr/bin/chromium-browser

# Instala dependencias primero (capa cacheable). El código se monta por volumen.
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./

EXPOSE 4200

# Dev server de Angular escuchando en todas las interfaces del contenedor.
CMD ["npm", "run", "dev"]
