# Boletiva

**Boletiva** (`boletiva.com`) — *tu boletera activa*. Plataforma de venta y validación de boletos para
eventos pensada para **competir en tecnología** con las grandes boleteras: vender/validar **miles de
boletos**, boletos **descargables a wallet**, **validables offline** pero **dinámicos** (un screenshot no
sirve). Moneda **GTQ (Q)**, zona horaria **America/Guatemala**.

Monorepo dockerizado: **un solo comando** levanta backend + frontend + toda la infraestructura local.

> Repo: `github.com/jdanielrodriguez/boletiva` · ramas **`master`** (producción) y **`develop`**
> (desarrollo). El repo anterior `pasa-eventos` queda como copia histórica.

---

## 🏗️ Stack

| Capa | Tecnología |
|---|---|
| Backend | **NestJS + Prisma + PostgreSQL 16** (SQL crudo puntual para `FOR UPDATE`) |
| Frontend | **Angular 20 SSR PWA** (zoneless, signals) |
| Cache / locks / colas | **Redis** (holds, rate-limit, contadores, **BullMQ**) |
| Ingest masivo de validación | **RabbitMQ** |
| Almacenamiento | **GCS** (prod) · **LocalStack S3** (local), URLs firmadas |
| Correo | SMTP · **MailHog** en local |
| Boletos | **Ed25519** (firma) + **TOTP** (QR rotativo), validación offline (SafeTix) |
| Wallet | Google Wallet + Apple `.pkpass` (detrás de un puerto, stub en sandbox) |
| Pagos | Puerto `PaymentProvider` + **simulador** · Recurrente/Pagalo (config-gated) |
| Observabilidad | OpenTelemetry (opcional) + logs JSON (pino) |
| Deploy | **GCP Cloud Run** + GitHub Actions (WIF) + Secret Manager |

Idioma del proyecto: **español**. Detalle de diseño en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md);
contrato API en [docs/openapi.json](docs/openapi.json).

---

## ⚡ Arranque local (un comando)

**Pre-requisitos:** Docker + Docker Compose. (Node solo si quieres correr scripts fuera del contenedor.)

```bash
cp .env.example .env      # config local (Postgres local, sin secretos reales)
make init                 # crea red+volúmenes, build y levanta TODO el stack
# o, si ya está construido:
make start
```

`make start` levanta: **API (NestJS)**, **frontend (Angular 20 SSR)**, PostgreSQL, Redis, RabbitMQ,
MailHog, LocalStack (S3) y Adminer.

> ⚠️ Los `node_modules` de los contenedores viven en **volúmenes anónimos**: tras `make down` o al
> cambiar dependencias corre **`make rebuild`** (reinstala deps como exceljs/ApexCharts).

### Mapa de puertos (host → contenedor)

| Servicio | Host |
|---|---|
| Frontend (Angular SSR) | http://localhost:4200 |
| API (NestJS) | http://localhost:8080 |
| Swagger (solo fuera de prod) | http://localhost:8080/docs |
| Health | http://localhost:8080/api/v1/health |
| Adminer (DB UI) | http://localhost:8082 |
| PostgreSQL 16 | 54320 |
| Redis 7 | 63790 |
| RabbitMQ (AMQP / UI) | 56720 / 15673 |
| MailHog (SMTP / UI) | 10250 / 8026 |
| LocalStack (S3) | 45660 |
| Jaeger (OTel, perfil `observability`) | 16687 |

Credenciales seed: `admin@boletiva.com` / `promotor@boletiva.com` / `cliente@boletiva.com`, todas con
password `Password123` (cámbialas en prod).

---

## 🛠️ Comandos (Makefile)

**Regla de oro: NUNCA correr comandos fuera del contenedor.** Todo vía Docker/Makefile.

```bash
make init          # primera vez: red+volúmenes, build y levanta el stack
make start / stop  # levantar / detener ; make down (baja y borra contenedores)
make rebuild       # rebuild + reinstala node_modules (tras cambiar dependencias)
make logs          # logs de la API en vivo ; make front-logs (frontend)
make migrate       # prisma migrate dev ; make db-push (sincroniza sin migración)
make seed          # settings + datos baseline (admin/promotor/cliente + demo)
make test          # tests unitarios/e2e del backend (jest, en el contenedor)
make smoke         # smoke E2E (HTTP + Puppeteer/Swagger)
make e2e           # E2E de cara al usuario (Puppeteer contra el stack real)
make load          # carga K6: estadio 10k + spike + verificación 0 doble-venta
make gen-api       # regenera el SDK tipado del frontend desde docs/openapi.json
make front-test / front-lint
make db-shell / redis-shell / rabbit-shell / node-shell
```

**Producción / alpha** (requieren `gcloud` autenticado — ver [docs/GUIA-GCP.md](docs/GUIA-GCP.md)):

```bash
make prod-db-seed     # siembra la baseline en la BD de prod (1er arranque)
make prod-db-reset    # ⚠️ DESTRUCTIVO: borra TODA la data de prod y re-siembra (pruebas alpha)
make prod-logs        # logs de prod limpios (sin ruido) ; make prod-logs-errors (solo errores)
make prod-logs-follow # streaming en vivo
```

---

## 🧪 Calidad y CI

- **Tests exhaustivos por endpoint** son el criterio de aceptación (happy path por rol, todos los
  errores, seguridad/hacking, concurrencia 0 doble-venta, bordes de dinero con Banker's rounding).
- **GitHub Actions:** `test.yml` (backend + frontend en cada push/PR), `staging.yml` (deploy a staging
  al mergear `develop`), `release-prod.yml` (deploy a prod al mergear `master`: pruebas → mantenimiento →
  deploy → tag). Autenticación por **Workload Identity Federation** (sin llaves estáticas).
- El **merge/push a ramas principales lo hace el usuario**; el deploy solo corre cuando están
  configuradas las variables WIF en GitHub.

---

## 🚀 Desplegar a producción

Guía paso a paso (crear proyecto, APIs, Secret Manager, WIF, primer deploy, reset de BD alpha y lectura
de logs limpios): **[docs/GUIA-GCP.md](docs/GUIA-GCP.md)** (§7–§11). Topología objetivo en Cloud Run:
**api** (HTTP) · **worker** (BullMQ) · **ingest** (validación masiva RabbitMQ).

---

## 📚 Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — diseño y decisiones (fuente de verdad).
- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) — despliegue, secretos y topología.
- [docs/GUIA-GCP.md](docs/GUIA-GCP.md) — GCP paso a paso (proyecto, WIF, secretos, lanzamiento, logs).
- [docs/INTEGRACIONES-CREDENCIALES.md](docs/INTEGRACIONES-CREDENCIALES.md) — credenciales de integraciones (Wallet, reCAPTCHA, pagos, FEL).
- `CLAUDE.md` — contexto de arranque para trabajar en el repo.

---

*Boletiva — plataforma en construcción activa. Reportes o mejoras: abre un
[issue](https://github.com/jdanielrodriguez/boletiva/issues).*
