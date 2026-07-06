# Pasa Eventos — Plan Maestro de Arquitectura (Backend v1)

> Documento de diseño de la reescritura del backend. Fuente de verdad de las decisiones.
> Rama de trabajo: `feature/backend-core-v1` (partiendo de `develop`). Moneda: **GTQ (Q)**. Zona horaria: **America/Guatemala**.
> Estado: **propuesta para validación** (jul 2026).

---

## 0. Contexto

`pasaeventos` es la versión a producción de una boletera de eventos cuyo objetivo es **competir en tecnología** con las grandes boleteras: vender y validar **miles de boletos**, boletos **descargables a wallet** del teléfono, **validables offline** pero **dinámicos** (un screenshot no sirve).

Es un **port/rediseño** de `ticketera` (Laravel/PHP) a **Node/TypeScript**. Del análisis de ticketera concluimos que su backend tiene un modelo de dominio útil (eventos → localidades → asientos → transacciones → caja) pero **carece de**: motor de precios (los campos fiscales existen pero nunca se aplican), pasarela de pago real (stubs `true`), QR/wallet/validación, RBAC, y arrastra mucho modelo vestigial. Todo eso lo construimos aquí, bien hecho.

---

## 1. Decisiones de stack (acordadas)

| Área | Decisión | Motivo |
|---|---|---|
| Lenguaje | Node 20 + TypeScript | Base actual del repo |
| Framework | **NestJS** (migrar del Express plano) | DI/módulos/guards para un dominio grande; espejo del patrón Laravel y de Angular |
| Fuente de verdad | **PostgreSQL 16** | Dinero + inventario + concurrencia: `FOR UPDATE`, `NUMERIC`, `jsonb`, constraints de exclusión |
| ORM/migraciones | **Prisma** + SQL crudo puntual (`FOR UPDATE`) | Tipos + migraciones versionadas; escape hatch para locks |
| Cache/locks/colas | **Redis** (Memorystore en prod) | Holds de asiento, rate-limit, contadores, BullMQ |
| Jobs | **BullMQ** (Redis) | Email, PDF/QR, wallet passes, sweepers |
| Bus de validación masiva | **RabbitMQ** (CloudAMQP en prod) | Fan-in de miles de escaneos desde múltiples puertas |
| Documentos flexibles | **Postgres `jsonb`** ahora; **MongoDB** diferido | Evitar 2º datastore hasta que el seat-map/validación lo justifique |
| Boletos | **Ed25519 (firma) + TOTP (QR rotativo)** | Anti-screenshot + verificación **offline** |
| Wallet | Google Wallet (`rotatingBarcode` nativo) + Apple `.pkpass` (push-refresh, NFC premium) | Estándares de cada plataforma |
| Pagos | Puerto `PaymentProvider` + **simulador** → Pagalo → Stripe/GPay/PayPal | Proveedores intercambiables; fulfillment por webhook |
| Storage | **GCS** (LocalStack/MinIO local) + signed URLs + CDN | Multimedia e imágenes de boleto |
| Frontend (fase 2) | **Angular** PWA + SSR + service worker/IndexedDB | Experiencia del equipo; offline; seat-map |
| Deploy | **GCP Cloud Run** + GitHub Actions + Secret Manager | Autoescala por demanda |
| Config | 12-factor: todo por env URIs | Mismo binario local↔prod |

Se **descarta**: cifrado `Encripter` del cliente (ofuscación, no seguridad → TLS+JWT+validación real) y el modelo vestigial de ticketera (`areas`, `sales`, `votings`, `promoters*`, `discounts`, `costs`, `comisions`, `policies`, `cash_doc`, `events_type`).

---

## 2. Arquitectura de módulos (NestJS)

```
api/src/
  app.module.ts
  common/            # guards, interceptors, filtros, decoradores, pipes de validación (zod/class-validator)
  config/            # ConfigModule tipado + validación de env (reusar el Joi actual)
  infra/
    prisma/          # PrismaService (pool), migraciones
    redis/           # cliente + locks (SET NX EX) + rate-limit store
    queue/           # BullMQ (colas) y RabbitMQ (bus validación)
    storage/         # GCS/MinIO (signed URLs)
    mail/            # Nodemailer + plantillas MJML (MailHog local)
    crypto/          # Ed25519 keypair, firma/verificación, TOTP, hash-chain
  modules/
    auth/            # login, signup, refresh rotation, recovery, RBAC
    users/           # perfil, roles
    events/          # eventos, categorías, publicación
    venues/          # localidades + mapas de asiento (seat maps versionados) + places
    pricing/         # PricingEngine, fee schedules, price_quote, panel admin de comisiones
    inventory/       # holds (Redis) + reserva + commit (Postgres) anti-doble-venta
    orders/          # carrito → orden → items → estado
    payments/        # PaymentProvider port, adaptadores, webhooks, pago mixto (saldo+complemento)
    tickets/         # emisión (firma+TOTP), QR, PDF, wallet passes
    transfers/       # regalo/transferencia con handshake + chain-of-custody
    validation/      # manifest offline, ingest de escaneos, dedup, reportes
    ledger/          # libro contable hash-chain, payouts, saldo interno (wallet), retiros
    advertisements/  # anuncios (opcional v1)
    notifications/   # emails transaccionales
    health/          # el health actual, ampliado
```

Regla transversal: **controllers finos → services (lógica) → repositories (Prisma)**. Toda la lógica de dinero es **server-authoritative**.

---

## 3. Modelo de datos (PostgreSQL) — entidades núcleo

Convenciones: PK `uuid` (v7 ordenable), dinero `NUMERIC(12,2)` + `currency`, timestamps `timestamptz`, estados como `enum`.

- **users** (`id, email, password_hash, names, phone, picture, status, created_at…`) — sin los campos sociales/2FA vestigiales.
- **roles / user_roles** — RBAC real: `admin, promoter, promoter_staff, gate_operator, buyer`. (multi-rol por usuario)
- **refresh_tokens** (rotación + detección de reuso), **password_recoveries**.
- **categories** (name, slug, state).
- **events** (`id, promoter_id→users, name, slug, description, address, lat, lng, starts_at, ends_at, status, cover_media_id…`). Se eliminan los duplicados `start/end` de ticketera.
- **event_media** (galería, en GCS).
- **localities** (`id, event_id, name, slug, capacity, kind[seated|general], base_currency…`) — **sin** los campos fiscales dormidos; el precio y comisiones viven en `pricing`.
- **seat_maps** (`id, venue/event_id, version, width, height, background_refs, layout jsonb`) — **versionado inmutable**; un evento referencia una versión.
- **sections / rows / seats** (o representación en `layout jsonb` + tabla `seats` para inventario): `seat(id, locality_id, section, row, label, x, y, status)`.
- **fee_schedules** (`id, scope[platform|event|promoter], version, rules jsonb, effective_from, effective_to`) — reglas ordenadas (`percentage|fixed|tax`), base configurable. Panel admin edita el default global.
- **price_quotes** (`id, order_id/cart_id, fee_schedule_version, inputs jsonb, net, platform_fee, gateway_fee, iva, total, computed_at`) — **snapshot inmutable** por orden.
- **carts / cart_items** (efímeros, ligados a holds).
- **orders** (`id, buyer_id, event_id, status[pending|authorized|paid|failed|refunded|cancelled], total, quote_id…`).
- **order_items** (`id, order_id, seat_id/locality_id, price_quote_ref, ticket_id`).
- **tickets** (`id, order_item_id, owner_id, event_id, locality_id, seat_id, secret_ref, status[valid|transferred|revoked|used], issued_at`). El **secreto TOTP** no se guarda en claro: se deriva de un master del evento (HKDF).
- **ticket_events** (chain-of-custody hash-chain: `id, ticket_id, type[issued|transferred|revoked|checked_in], from_user, to_user, prev_hash, hash, created_at`).
- **payment_intents / payments** (`id, order_id, provider, provider_ref, status, amount, raw_webhook jsonb, idempotency_key`).
- **payment_methods** (tokenizados por el PSP; **no** guardamos PAN/CVV como ticketera).
- **ledger_accounts** (`platform, promoter:{id}, user:{id}, gateway, tax`) y **ledger_entries** (doble entrada + **hash-chain**: `id, account_id, order_id, type, debit, credit, prev_hash, hash, created_at`).
- **wallet_balances** (saldo interno por usuario) + **wallet_movements** (recargas, compras, devoluciones, ganancias de reventa, retiros).
- **validation_events** (append-only, particionado por `event_id`: `id(uuid cliente=idempotencia), ticket_id, gate_id, device_id, scanned_at, server_received_at, result, direction, device_seq, offline`).

Constraint clave anti-doble-venta:
```sql
-- un asiento no puede estar vendido dos veces
CREATE UNIQUE INDEX uniq_seat_sold ON order_items (seat_id) WHERE status = 'sold';
```

---

## 4. Motor de precios (PricingEngine) — el corazón

Función pura, versionada, con snapshot inmutable. **Nunca** se confía en un precio calculado en el cliente.

**Gross-up de dos capas + IVA sobre base gravable** (validado contigo):
```
N            = ganancia neta deseada del promotor (o precio de localidad)
%plataforma  = comisión de plataforma sobre el NETO del promotor (config admin, default global)
%pasarela    = comisión de la pasarela sobre el TOTAL cobrado
IVA          = 12% (Guatemala)
fijos        = cargos fijos (opcional, se suman a la base gravable)

comision_plataforma = N * %plataforma
base_gravable       = N + comision_plataforma + fijos      # neto + comisión plataforma
iva                 = base_gravable * IVA                  # IVA NO aplica a la comisión de pasarela
monto_pre_pasarela  = base_gravable + iva
P (total)           = monto_pre_pasarela / (1 - %pasarela)  # gross-up de la pasarela por división
comision_pasarela   = P - monto_pre_pasarela
```
Ejemplo (N=100, plataforma 10%, pasarela 5%): base_gravable=110, iva=13.20, monto_pre_pasarela=123.20, **P=129.68**.
Verificación: pasarela 6.48 → 123.20; IVA 13.20 → 110; plataforma 10 → promotor recibe **100 exacto**. ✅

**Regla clave del IVA (evitar doble cobro):** el IVA (12%) se calcula **solo sobre la base gravable = neto del promotor + comisión de plataforma**. **NO** se le aplica IVA a la comisión de la pasarela, porque esa ya tributa IVA en Pagalo. La plataforma es la responsable del IVA sobre lo que ella cobra (neto + su comisión).

Se muestra el **all-in arriba** (`P`); el **desglose al pagar**: precio base (neto), comisión de servicio (plataforma), IVA 12%, comisión de procesamiento (pasarela), total.

- Redondeo al centavo con política definida y **tests de borde exhaustivos** (comisiones compuestas, fijos, redondeo).
- `fee_schedules` versionados; el `price_quote` guarda inputs + versión → auditable para liquidaciones y disputas.
- Panel de configuración del **admin** para el % de plataforma por defecto (y a futuro por evento/promotor).

---

## 5. Flujo de compra y anti-doble-venta

1. **Selección** → por ahora **tabla/lista de asientos** (el mapa SVG llega en el módulo `venues`, pero el flujo de compra no depende de él).
2. **Hold (Redis, rápido):** `SET hold:{eventId}:{seatId} {cartId} NX EX 600` (10 min) atómico vía Lua; si no se pueden tomar todos, se liberan los tomados y se responde "asiento ya tomado" (409).
3. **Cotización:** `PricingEngine` genera el `price_quote` (snapshot).
4. **Pago:** se crea `payment_intent`; el proveedor procesa (ver §6). El pago mixto (saldo interno + complemento) se resuelve aquí.
5. **Commit (Postgres, correcto):** en una transacción `SELECT ... FOR UPDATE` de los asientos, se verifica que sigan `held` por este cart, se marcan `sold`, se crean `order`/`order_items`/`tickets`, se emiten firmas, se escriben `ledger_entries`. El **unique index** hace el doble-venta físicamente imposible.
6. **Sweeper (BullMQ repeat):** libera holds expirados y reconcilia filas `reserved` huérfanas.
7. **General admission** (sin asientos): contador atómico Redis por localidad + `capacity` guardada con `FOR UPDATE` en commit.

Para on-sales masivos: **sala de espera virtual** con tokens Redis para controlar la tasa de llegada al checkout.

---

## 6. Pagos (proveedores intercambiables)

Puerto de dominio:
```ts
interface PaymentProvider {
  name: 'simulator' | 'pagalo' | 'stripe' | 'paypal' | 'googlepay';
  createCharge(i: {orderId; amount; currency; customer; idempotencyKey; returnUrl?; method?}): Promise<ChargeResult>;
  capture?(ref): Promise<ChargeResult>;
  refund(ref, amount, idempotencyKey): Promise<RefundResult>;
  verifyWebhook(req): WebhookEvent;   // verifica firma + normaliza
  getStatus(ref): Promise<ChargeStatus>;
}
```
- Estado normalizado: `requires_action | pending | authorized | captured | failed | refunded`.
- **El webhook verificado es la fuente de verdad** del pago; recién ahí se emiten boletos (job en cola). Nunca marcar pagado por el redirect del cliente.
- **Idempotencia** por `idempotency_key` en cada checkout.
- Registro por config: `PAYMENT_PROVIDER=simulator|pagalo|…`.
- **Pago mixto:** si `total > saldo_interno`, se debita el saldo y el remanente va al proveedor externo (obligatorio). Todo se refleja en `ledger` y `wallet_movements`.
- **v1:** adaptador **simulador** (aprueba/rechaza en sandbox local) + esqueleto Pagalo listo para credenciales.

---

## 7. Boletos: emisión, wallet y validación offline

- **Emisión:** por evento, un **master secret**; por ticket se deriva un secreto (HKDF con `ticketId`). El QR codifica `{ticketId, totp(now), ed25519_sig(payload)}`.
- **Dinámico/anti-screenshot:** el TOTP rota (~cada 30-60 s); un screenshot caduca.
- **Offline:** el validador lleva (antes de puertas) el **manifest del evento**: lista de tickets, master secret del evento, **set de revocación**, y **clave pública Ed25519**. Verifica firma + ventana TOTP + revocación **sin red**.
- **Wallet:**
  - **Google Wallet:** `rotatingBarcode` + `totpDetails` nativos; objeto creado server-side, secreto nunca en el JWT, sin fallback estático.
  - **Apple Wallet:** `.pkpass` firmado con **push-refresh** del barcode; NFC/Smart Tap como vía premium (el cert Apple NFC tarda ~4 semanas — iniciar temprano si se quiere tap).
- **Generación** (PDF + QR + passes) en jobs BullMQ, subida a GCS, entrega por email + enlaces "Add to Wallet".

## 8. Validación masiva en puerta

- App validadora **offline-first** (la PWA en modo staff o app dedicada): precarga el manifest en IndexedDB, valida 100% local (< 100 ms), set de dedup local.
- **Sync** por lotes idempotentes (uuid cliente = idempotencia; `device_seq` = cursor reanudable) cuando hay conexión: sube escaneos, baja revocaciones/otros gates.
- **Ingest** vía RabbitMQ (fan-in) → workers → `validation_events` (append-only, particionado). Reportes/tableros leen contadores Redis.
- Doble-scan entre gates offline: mitigado por sync frecuente + zonas por gate + flag de revisión; el caso perfecto no es posible sin conexión (los grandes viven con lo mismo).

---

## 9. Transferencia de boletos

- **Regalo interno** con **handshake de doble confirmación** (código común entre las 2 cuentas).
- Límite **mín. 1 / máx. definido por el promotor** por evento.
- **Chain-of-custody** (`ticket_events` hash-chain) inborrable de cada movimiento origen→destino.
- Al transferir: **re-emitir firma/QR** al nuevo dueño e invalidar el anterior.
- **Diseñado (sin implementar)** para reventa: mismo backend, frontend aparte; el revendedor setea precio como promotor; al revender se abona al **saldo interno** el valor actual menos %pasarela y %plataforma.

## 10. Contabilidad (ledger blockchain) + saldo interno

- **Libro contable doble-entrada con hash-chain**: cada `ledger_entry` encadena `prev_hash → hash` (SHA-256). Huella inborrable.
- **Payouts:** admin y promotor ven cuánto se les ha pagado; el usuario ve lo pagado por boletos (evento/total) y lo ganado por reventas.
- **Saldo interno (wallet):** método de pago más; recibe devoluciones y ganancias de reventa; **retiro cuesta el doble** al usuario que al promotor; **pago mixto obligatorio** cuando la compra supera el saldo.

---

## 11. Mapa de asientos (SVG)

- **Esquema compartido versionado** (geometría `x,y` + identidad lógica `section/row/label/localidad`).
- **Editor (promotor):** basado en **Konva** (canvas), parte de **plantillas** (teatro, arena, GA, mesas) y edita/clona; genera/asigna asientos, localidad, precio.
- **Selector (comprador):** SVG para mapas chicos; **canvas/WebGL + índice espacial (rbush) + niveles de detalle** para arenas de miles de asientos; estado en vivo desde Redis.
- Backend v1: modelo de datos + endpoints CRUD de `seat_maps` versionados; el editor/selector visual son de la fase de frontend.

---

## 12. Colas y jobs

- **BullMQ:** `email`, `tickets` (PDF/QR con flows → hijos), `wallet`, `sweeper-holds`, `sweeper-deposits`, `expire-temp-users`.
- **RabbitMQ:** exchange `validation.*` para ingest masivo (cuando crezcan las puertas; v1 puede arrancar con BullMQ y graduar a Rabbit).

## 13. Seguridad

- **Secretos** → capa de abstracción `SecretsProvider`: `.env` (local, en Docker), **GCP Secret Manager** en prod (nativo de Cloud Run, con IAM y rotación — más eficiente que operar Vault), y gancho opcional para **HashiCorp Vault** si a futuro hay multi-cloud/secretos dinámicos. Nota: `.env` y `gcp-service-account.json` **nunca estuvieron versionados** (siempre en `.gitignore`; verificado sobre todo el historial), así que no hubo que reescribir el historial. Las credenciales viejas del `.env` local ya fueron eliminadas de sus servicios; en prod se emiten nuevas vía Secret Manager (`.env.prod` como fuente — ver `docs/DESPLIEGUE.md`).
- **Auth:** JWT access corto (~15 min) + refresh rotativo (httpOnly, detección de reuso). Audiencias separadas: buyer / promoter / gate-device (credencial de gate ligada al evento, expira tras el evento).
- **RBAC** en guard + a nivel de datos (un promotor solo ve/gestiona sus eventos).
- Rate-limit (Redis store, no memoria) + reCAPTCHA/Turnstile en auth/on-sale/pago. PCI minimizado (nunca tocamos PAN crudo).

## 14. Observabilidad y multi-entorno

- Logs JSON estructurados (pino) → Cloud Logging, con `traceId/orderId/eventId`.
- Tracing OpenTelemetry → Cloud Trace en el camino de checkout.
- Métricas/alertas: 429 en on-sale, contención de holds, lag de webhook, profundidad de colas, violaciones del constraint anti-doble-venta (debe ser 0 → alerta).
- Entornos `local / dev / staging / prod`, mismo binario, config por env.

## 15. Infra

**Local (docker-compose):** Postgres, Redis, RabbitMQ, MailHog, **LocalStack** (GCS/S3), **pgAdmin** (o Adminer; phpMyAdmin era para MySQL) + api + frontend. Makefile con targets para todo (basado en el actual de pasaeventos/ticketera). **Nunca correr comandos fuera del contenedor.**

**GCP (Cloud Run):** API con concurrency 150-250, **min-instances programados** antes de on-sales, max alto tras la sala de espera Redis; **workers como servicios separados** (concurrency baja). GCS + Cloud CDN + V4 signed URLs. Cloud SQL Postgres, Memorystore Redis, (CloudAMQP), Secret Manager. CI/CD GitHub Actions (actual, endurecido).

## 16. Testing

- **Unit (Jest):** PricingEngine (gross-up, redondeo), firma/TOTP, holds, adaptadores de pago (gateway mockeado).
- **Integration (Testcontainers):** Postgres+Redis reales; **prueba de concurrencia que demuestra 0 doble-venta** bajo carga paralela.
- **E2E por endpoint (Supertest):** contrato de cada endpoint; Playwright para funnel y validador offline (con throttling de red).
- **Carga (k6/Artillery):** camino de on-sale contra sala de espera + holds.

---

## 17. Plan de ejecución por fases

Aunque el alcance es "todo de una vez", se ejecuta en olas para mantener calidad y permitir tu validación entre hitos:

- **Ola 0 — Fundaciones:** NestJS + Prisma + Postgres, config/env, logger, health ampliado, docker-compose (postgres/redis/rabbit/mailhog/localstack/pgadmin), Makefile, quitar secretos del tracking. *(sin lógica de negocio aún)*
- **Ola 1 — Identidad y catálogo:** auth+refresh+RBAC, users, categories, events, localities, seat_maps (CRUD), media GCS. E2E de cada endpoint.
- **Ola 2 — Precios e inventario:** PricingEngine + fee_schedules + price_quote + panel admin; holds Redis + reserva + commit anti-doble-venta.
- **Ola 3 — Órdenes y pagos:** carts/orders, PaymentProvider + simulador (+esqueleto Pagalo), pago mixto con saldo interno, webhooks, ledger hash-chain, payouts.
- **Ola 4 — Boletos y wallet:** emisión Ed25519+TOTP, QR/PDF, Google/Apple wallet, emails.
- **Ola 5 — Transferencias y validación:** transferencia con handshake + chain-of-custody; manifest offline + ingest + validation_events + reportes.
- **Ola 6 — Colas, observabilidad, endurecimiento:** BullMQ/RabbitMQ, pino+OTel, rate-limit Redis, Secret Manager, optimización Cloud Run.
- **QA transversal:** agentes de QA validan flujos, endpoints y despliegue en cada ola.

## 18. Decisiones abiertas / a validar

1. **NestJS** vs mantener Express plano (recomiendo NestJS; objétalo si no).
2. **Prisma** vs TypeORM (recomiendo Prisma).
3. Base exacta de aplicación del **IVA** frente al gross-up (documentaré el supuesto).
4. **Pagalo**: confirmar API/auth/webhook cuando haya credenciales (docs son SPA).
5. Cert **Apple NFC** (si se quiere tap-to-enter, iniciar el trámite temprano).
6. Herramienta DB local: **pgAdmin/Adminer** (phpMyAdmin era de MySQL).
