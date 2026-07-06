# CLAUDE.md — Pasa Eventos

Contexto de arranque para cualquier sesión. Léelo completo antes de trabajar.
**Idioma de comunicación: español.** El detalle de diseño vive en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — es la fuente de verdad.

---

## Qué es esto

`pasaeventos` es la boletera de eventos a **producción**, cuyo objetivo es **competir en tecnología** con las grandes boleteras: vender/validar **miles de boletos**, boletos **descargables a wallet**, **validables offline** pero **dinámicos** (un screenshot no sirve). Moneda **GTQ (Q)**, zona horaria **America/Guatemala**.

Es un **port/rediseño** del proyecto de referencia `ticketera` (misma carpeta padre `/var/www/server/proyectos/`):
- `ticketera/server` = backend **Laravel/PHP** (referencia del dominio). `ticketera/src` = frontend Angular 14.
- `tiketera` (otra carpeta) = legacy con 2checkout; solo referencia histórica.
- `pasaeventos/api` = backend **Node/TS** (lo que construimos). `pasaeventos/frontend` = Angular 20 SSR (scaffold, se hace en fase 2).

**Del análisis de ticketera:** el dominio útil es eventos → localidades → asientos → transacciones → caja. Pero ticketera **NO tiene**: motor de precios (campos fiscales existen pero nunca se aplican), pasarela real (stubs `true`), QR/wallet/validación, RBAC; y arrastra modelo vestigial. Todo eso se construye bien aquí. **No te guíes por el nombre de un módulo/endpoint**: verifica qué hace realmente.

---

## Estado actual (jul 2026)

- Rama de trabajo: **`feature/backend-core-v1`** (partió de `develop`). **Todo el trabajo va aquí, commiteado pero SIN subir** hasta que el usuario valide.
- **Ola 0 (Fundaciones) COMPLETADA y verificada.** El backend `api/` es ahora **NestJS + Prisma + PostgreSQL**. Arranca con todo el stack; tests unitarios verdes (9) y smoke E2E (HTTP + Puppeteer) en verde.
- Endpoints: `GET /api/v1/health` (completo), `/api/v1/health/live` (liveness), `/api/v1/health/ready` (readiness), `/docs` (Swagger, no-prod).
- Estructura NestJS: `api/src/{config, common/filters, infra/{prisma,redis,mail,storage,messaging}, health}`. El dominio (auth, events, etc.) llega en las olas 1+.
- Warning benigno conocido: NestJS/path-to-regexp emite "Unsupported route path /api/*" al arrancar; lo auto-convierte, no afecta.

### Mapa de puertos (local)
| Servicio | Host | Interno |
|---|---|---|
| API (NestJS) | 8080 | 8080 |
| Adminer (DB UI) | 8081 | 8080 |
| PostgreSQL 16 | 54320 | 5432 |
| Redis 7 | **63790** | 6379 |
| RabbitMQ / UI | 5672 / 15672 | idem |
| MailHog / UI | 1025 / 8025 | idem |
| LocalStack (S3) | 4566 | 4566 |

Credenciales locales: DB/Rabbit user=pass=`pasaeventos`; bucket S3 `pasaeventos-local`. Adminer server: `pasaeventos_db`.

---

## Decisiones de stack (acordadas — no re-litigar sin motivo)

| Área | Decisión |
|---|---|
| Framework | **NestJS** (migrar del Express plano) |
| DB fuente de verdad | **PostgreSQL 16** (Cloud SQL en prod) |
| ORM | **Prisma** + SQL crudo puntual para `FOR UPDATE` |
| Cache/locks/colas | **Redis** (Memorystore) — holds, rate-limit, contadores, BullMQ |
| Jobs | **BullMQ**; **RabbitMQ** solo para ingest masivo de validación |
| Docs flexibles | Postgres `jsonb`; **MongoDB diferido** |
| Boletos | **Ed25519 (firma) + TOTP (QR rotativo)**, validación offline |
| Wallet | Google Wallet (`rotatingBarcode`) + Apple `.pkpass` (push-refresh, NFC premium) |
| Pagos | Puerto `PaymentProvider` + **simulador** → Pagalo → Stripe/GPay/PayPal; fulfillment por **webhook** |
| Storage | GCS + signed URLs + CDN (LocalStack/MinIO local) |
| Frontend | **Angular** PWA + SSR (fase 2, no ahora) |
| Deploy | GCP Cloud Run + GitHub Actions + Secret Manager |

**Se descarta:** el cifrado `Encripter` del cliente (ofuscación → usar TLS+JWT+validación real) y el modelo vestigial de ticketera (`areas, sales, votings, promoters*, discounts, costs, comisions, policies, cash_doc, events_type`).

---

## Modelo de negocio (crítico — no suponer)

### Calculadora de precios (gross-up de 2 capas) — el corazón, debe ser exacto
```
subtotal = neto_promotor * (1 + %plataforma) + fijos   # plataforma sobre el NETO del promotor
P (total) = subtotal / (1 - %pasarela)                  # gross-up de la pasarela por DIVISIÓN
```
- Ej.: neto 100, plataforma 10%, pasarela 5%, IVA 12% → base_gravable 110 → IVA 13.20 → 123.20 → **P = 129.68**. (pasarela 6.48 → 123.20 → IVA 13.20 → 110 → plataforma 10 → promotor **100 exacto**).
- `%plataforma` configurable por **admin** (default global; a futuro por evento/promotor).
- **IVA 12% solo sobre la base gravable = neto + comisión plataforma** (NO sobre la comisión de pasarela; esa tributa IVA en Pagalo → evitar doble IVA). Fórmula: `base=N*(1+%plat)+fijos; iva=base*0.12; P=(base+iva)/(1-%pasarela)`. Comprador ve **all-in arriba**; **desglose solo al pagar**.
- `PricingEngine` puro y versionado (`fee_schedules`) + snapshot inmutable `price_quote` por orden + tests de redondeo exhaustivos. **Server-authoritative** siempre.

### Transferencia de boletos
- Regalo interno con **handshake de doble confirmación** (código común). Límite **mín 1 / máx lo define el promotor**.
- **Chain-of-custody hash-chain** (inborrable) de cada movimiento. Al transferir: **re-emitir firma/QR** e invalidar el anterior.
- Diseñar (NO implementar aún) para reventa: mismo backend, frontend aparte; revendedor setea precio como promotor; abona al saldo interno el valor menos %pasarela y %plataforma.

### Contabilidad + saldo interno
- **Libro contable doble-entrada con hash-chain (blockchain)** — huella inborrable.
- Admin/promotor ven payouts; usuario ve lo pagado y lo ganado por reventas.
- **Saldo interno (wallet):** método de pago más; recibe devoluciones/reventas; **retiro cuesta el doble** al usuario que al promotor; **pago mixto obligatorio** si la compra supera el saldo.

### Anti-doble-venta
Hold Redis `SET NX EX` (10 min) + commit Postgres con `FOR UPDATE` + `UNIQUE INDEX ... WHERE status='sold'` + sweeper.

---

## Comandos y entorno

**Regla de oro: NUNCA correr comandos fuera del contenedor.** Todo vía Docker/Makefile.

```bash
make init            # crea red+volúmenes, build y levanta el stack local
make start / stop    # levantar / bajar ; make down (baja y borra contenedores)
make rebuild         # rebuild tras cambiar package.json (renueva node_modules)
make logs            # logs de la API en vivo
make migrate         # prisma migrate dev (crear migración)
make db-push         # prisma db push (sincroniza schema sin migración)
make seed            # settings por defecto
make test            # tests unitarios (jest) dentro del contenedor
make smoke           # smoke E2E: HTTP + Puppeteer (Swagger) dentro del contenedor
make db-shell        # psql ; make redis-shell ; make rabbit-shell ; make node-shell
make deploy          # deploy a Cloud Run (gcloud)
```
Stack local (docker-compose.local.yml): api (NestJS), postgres 16, redis 7, rabbitmq, mailhog, localstack (S3), adminer. El frontend Angular se reintegra en la fase de frontend.
Config **12-factor**: todo por env URIs (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`, storage `S3_*`/`GCS_*`, `MAIL_*`, `PAGALO_*`, `JWT_*`, `TICKET_SIGNING_*`). Mismo binario local↔prod. Ver `.env.example`.

---

## Seguridad — pendiente importante

`.env` y `gcp-service-account.json` tuvieron **secretos de producción reales** commiteados (MySQL prod, llave GCP, Redis Cloud, Gmail app password). Ya están en `.gitignore` pero **siguen en el historial de git**. Pendiente: sacarlos del tracking, migrar a **Secret Manager**, y el usuario debe **ROTAR** esas credenciales.

---

## Cómo trabajar aquí

- Responder **en español**. Comportarse como **ingeniero senior**: seguridad, logging, debug, multi-entorno, tests.
- **Preguntar** dudas de negocio/componentes en vez de suponer.
- Patrón: **controllers finos → services → repositories (Prisma)**. Lógica de dinero **server-authoritative**.
- **Tests por endpoint** (unit + integration Testcontainers + e2e Supertest). Prueba de concurrencia que demuestre **0 doble-venta**.
- Commitear en `feature/backend-core-v1`, justificar, **no subir** hasta validación del usuario.
- **Commits SIN línea `Co-Authored-By`** (el usuario lo pidió; los commits antiguos que ya la tienen se dejan).
- Usar agentes para explorar/QA cuando ayude (el usuario lo pidió explícitamente).

## Plan de ejecución (olas) — ver detalle en docs/ARQUITECTURA.md §17

0. Fundaciones (NestJS+Prisma+Postgres, docker, quitar secretos) →
1. Identidad+catálogo (auth/RBAC, users, events, localities, seat_maps) →
2. Precios+inventario (PricingEngine, holds, commit) →
3. Órdenes+pagos (orders, PaymentProvider+simulador, pago mixto, ledger) →
4. Boletos+wallet (Ed25519+TOTP, QR/PDF, Google/Apple, emails) →
5. Transferencias+validación (handshake, chain-of-custody, manifest offline, ingest) →
6. Colas+observabilidad+endurecimiento (BullMQ/Rabbit, pino+OTel, Secret Manager, Cloud Run).

QA transversal en cada ola.
