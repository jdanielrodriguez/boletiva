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
- El backend actual (`api/`) es **solo un esqueleto de infra**: único endpoint real `GET /api/v1/health`; `models/`, `repositories/`, `utils/` vacíos; `mysql2` crudo (1 conexión); frontend Angular sin vistas. Buena infra base: helmet/cors/rate-limit, Winston, validación de env (Joi), Docker, CI/CD a Cloud Run, Swagger.
- Se está migrando a **NestJS + PostgreSQL + Prisma** (ver decisiones).

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
- Ej.: neto 100, plataforma 10%, pasarela 5% → subtotal 110 → **P = 115.79**. (pasarela 5.79 → 110 → plataforma 10 → promotor **100 exacto**).
- `%plataforma` configurable por **admin** (default global; a futuro por evento/promotor).
- **IVA 12% incluido** en P (`base = P/1.12`). Comprador ve el **all-in arriba**; **desglose solo al pagar**.
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
make init         # crea red+volúmenes, build y levanta el stack local
make start / stop # levantar / bajar
make test         # tests dentro del contenedor api
make deploy       # deploy a Cloud Run (gcloud)
make *-shell      # shell en cada contenedor (node/db/redis/...)
```
Stack local objetivo (docker-compose): postgres, redis, rabbitmq, mailhog, localstack (GCS/S3), pgadmin, api, frontend.
Config **12-factor**: todo por env URIs (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`, `MAIL_URL`, `GCS_BUCKET`, `PAGALO_*`, `JWT_*`, `TICKET_SIGNING_KEY`). Mismo binario local↔prod.

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
