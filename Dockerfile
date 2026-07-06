# ---- Etapa 1: build ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY nx.json tsconfig.base.json ./
COPY prisma ./prisma
COPY api ./api

RUN npm install --legacy-peer-deps

# Cliente Prisma + build del backend
RUN npx prisma generate
RUN npx nx build api

# ---- Etapa 2: imagen final ligera ----
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --legacy-peer-deps

# Cliente Prisma generado + build del backend
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist/api ./dist

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# En prod, las migraciones se aplican con `prisma migrate deploy` (paso previo del pipeline).
CMD ["node", "dist/main.js"]
