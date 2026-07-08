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
- **Ola 0 (Fundaciones) COMPLETADA.** Backend `api/` = **NestJS + Prisma + PostgreSQL**. Infra: config/env, pino, filtro de errores, health, docker (postgres/redis/rabbit/mailhog/localstack/adminer).
- **Ola 1 (Identidad + Catálogo) COMPLETADA y verificada.** 37 tests verdes (unit + e2e). Módulos:
  - **auth**: signup, login, refresh con **rotación + detección de reuso**, logout, forgot/reset password, change-password, `/auth/me`. JWT access + refresh (sha256 en BD).
  - **RBAC**: `JwtAuthGuard` + `RolesGuard` + `VerifiedEmailGuard` globales; `@Public()`, `@Roles()`, `@CurrentUser()`, `@RequireVerifiedEmail()`. Roles: admin/promoter/promoter_staff/gate_operator/buyer.
- **Ola 1.5 (Auth avanzado / login dinámico) COMPLETADA.** 46 tests verdes.
  - **Métodos de acceso**: email+password, **passwordless** (magic link + código OTP), **Google** (estructura lista; se activa con `GOOGLE_CLIENT_ID`).
  - **Verificación de correo** (código 6 dígitos + magic link). Sin verificar: entra y explora, pero **no** puede comprar/crear/transferir (`@RequireVerifiedEmail`). Google llega verificado.
  - **2FA obligatorio** una vez verificado el correo: **email OTP** (default) o **TOTP** (app autenticadora, `otplib`+QR). Se exige en **dispositivos nuevos**; los **confiables** (ya pasaron 2FA) no lo repiten. Login de 2 pasos: `login` → `2fa_required`+preauthToken → `2fa/verify`.
  - **Dispositivos**: se rastrean; correo de **aviso de nuevo dispositivo**; endpoints `GET/DELETE /auth/devices`.
  - Modelo extra (Prisma): `auth_challenges` (OTP+token hasheados), `devices`, `oauth_accounts`; User con `emailVerifiedAt`, `twoFactorMethod`, `totpSecret`.
- **Auditoría del arquitecto aplicada (jul 2026):** `totpSecret` **cifrado en reposo** con `EncryptionService` AES-256-GCM (`infra/crypto`, llave `APP_ENCRYPTION_KEY`); `decimal.js` instalado (regla: **nunca `number` para dinero**, Banker's rounding); **MongoDB descartado** (Postgres jsonb); OTel adelantado a Ola 2. Ver consideraciones transversales abajo (FEL, waiting room edge, contrato API, retención).
  - **users**: perfil propio (`PATCH /users/me`), gestión admin (list, roles, status).
  - **categories**: CRUD (lectura pública, escritura admin).
  - **events**: CRUD con **ownership de promotor**, publish/cancel, listado público de publicados, detalle por slug.
  - **venues**: localidades, **seat_maps versionados** (activo público), **seats** (bulk + generación por cantidad).
  - **media**: presign de subida a S3/GCS, registro, listado con URLs firmadas.
- **Ola 2 (Precios + inventario) COMPLETADA.** 104 tests verdes (suite serial, `maxWorkers:1`; los e2e comparten una BD real → paralelo = flaky). Tickets:
  - **Ticket 1 · PricingEngine** (`modules/pricing/pricing.engine.ts`): gross-up 2 capas + IVA sobre base gravable, `decimal.js` Banker's rounding, snapshot con `hash` anti-manipulación. `PricingService` lee comisiones de `settings` (admin-configurable). 19 tests (129.68 exacto, neto preservado, negativos, hash).
  - **Ticket 2 · Seat Hold Redis** (`modules/inventory`): reserva temporal atómica (Lua todos-o-nada), release solo del dueño, TTL 10 min auto-libera. `POST/DELETE /events/:id/holds`. 10 tests.
  - **Ticket 3 · Commit anti-doble-venta** (`modules/orders`): `POST /events/:id/orders` materializa asientos reservados en una **orden** (`orders` + `order_items` con snapshot inmutable del quote). **0 doble-venta en 3 capas**: hold Redis (rechaza holds ajenos) → `SELECT … FOR UPDATE` (autoritativo, solo vende `available`) → **índice único parcial** `order_items_active_seat_uniq` (creado idempotente en `PrismaService.onModuleInit`, sobrevive a `db push`). Precio **server-authoritative** (cliente no envía montos). `lock_timeout` 5s evita cuelgues; feeParams se leen ANTES de la tx (evita deadlock de pool). `GET /orders`, `GET /orders/:id` (IDOR→404). 17 tests (concurrencia 30 commits→1 vendido, lock_timeout, IDOR, todos los errores).
  - **fee_schedules + FEL** (`modules/pricing`): comisiones **versionadas e inmutables** (`fee_schedules`, una sola activa vía índice parcial `fee_schedules_one_active`; el admin no edita en sitio, crea versión nueva y la activa). `PricingService.resolveFees` prioriza el schedule activo (fallback settings→defaults) y estampa `feeScheduleId/version` en cada orden (auditable). Endpoints: `GET /pricing/schedules` (admin), `GET /pricing/schedules/active`, `POST /pricing/schedules` (admin, crea+activa), `GET /pricing/quote?net=` (preview del desglose). **FEL** en la orden: `billingNit` (default `CF`=consumidor final), `billingName`, `billingAddress` (opcionales en checkout) + `felUuid/felSerie/felNumero/felCertifiedAt` nullable (se llenan al certificar en Ola 3+). Seed crea `fee_schedule` v1. 12 tests (versionado, solo-una-activa, RBAC, validación de %, preview, FEL CF/custom, **inmutabilidad del snapshot al cambiar de versión**).
  - **Seeder estadio 10k + K6 (carga on-sale)**: `prisma/seed-stadium.ts` crea evento "Estadio Load Test" con N asientos (default 10k, **~0.5s**) + pool de compradores verificados con dispositivo confiable (login sin 2FA), y escribe `load/stadium.manifest.json` (ignorado en git). `load/checkout-spike.js` (K6): spike de VUs que reservan+compran de un pool CONTENDIDO. Umbrales: p95 hold<500ms, p95 checkout<2500ms, **0 errores 5xx**. `load/verify.sql` prueba en Postgres que `sold_seats == active_items` y **`double_sold == 0`**. Comandos: `make load` (seed+spike+verify), `VUS=10000 DURATION=5s make load-test` (spike real en staging). **Verificado local (200 VUs, 300 asientos calientes): 300 vendidos exactos, 5257 rechazos 409, 0 doble-venta, 0 5xx, todos los umbrales en verde.**
  - **OTel (observabilidad)** (`infra/observability/tracing.ts`): OpenTelemetry **desactivado por defecto** (se enciende con `OTEL_ENABLED=true` o `OTEL_EXPORTER_OTLP_ENDPOINT`); import con efecto de lado en la 1ª línea de `main.ts` (parchea antes de Nest/Prisma/Express). Auto-instrumentación (HTTP/Nest/Prisma/ioredis) + **spans manuales** `checkout.commit` y `seat.hold` con atributos de negocio (event.id, seat.count, order.total, outcome). Jaeger opcional en el compose (`profile: observability`, UI host 16687). Verificado end-to-end: la traza de compra cuelga los spans de Prisma (`db_query`), Redis (`eval` del Lua) y HTTP bajo los spans de negocio.
- Endpoints salud: `GET /api/v1/health`(completo), `/health/live`, `/health/ready`, `/docs` (Swagger).
- Estructura: `api/src/{config, common/{decorators,filters,utils}, infra/{prisma,redis,queue,mail,storage,messaging,crypto,observability}, health, modules/{auth,users,categories,events,venues,media,pricing,inventory,orders,ledger,payments,wallet,payment-gateways,cost-share,tickets,promoters}}`.
- **Ola 3.5 (Pagos dinámicos) COMPLETADA.** 150 tests verdes. Rework acordado con el usuario: comisión de pasarela **por método** (dinámica en DB), **recotizar por método** (total provisional al crear la orden con la pasarela default del evento, se **congela al pagar**), **IVA sobre el neto del promotor configurable por evento** (default sí; si el promotor ya pagó IVA → IVA solo sobre la comisión de plataforma), y **reparto de gastos EXTRA** (fuera del precio del boleto, p.ej. cargo por pasar a wallet) promotor↔plataforma configurable (default 50%, 0% = plataforma cubre todo, se descuenta del neto del promotor). Reglas de pasarela: default de plataforma + default por evento; cambio de default recalcula precios de eventos futuros y de los actuales sin compras (los que ya tienen compra se congelan); anular una pasarela migra sus eventos a otra; desactivar en uso exige mantenimiento + cerrar compras; **sandbox (simulador) es la default** para alpha/beta, prod exige ≥1 pasarela real.
  - **Ticket A · `payment_gateways` configurables** (`modules/payment-gateways`): modelo con `feePct`, `provider`, `credentialsRef` (referencia al secreto, no el secreto), `status` (active/inactive/maintenance), `isPlatformDefault` (índice parcial `payment_gateways_one_default`), `sandbox`. CRUD admin + `GET /active` + `make-default` (atómico) + `DELETE` (migra eventos a la default) + guardas (no desactivar/eliminar la default; feePct∈[0,1); nombre único). Seed crea **Sandbox** (simulador) como default. 8 tests.
  - **Tickets B+C · Pasarela por evento + PricingEngine v2** (`events` + `pricing`): Event tiene `gatewayId` (elección del promotor), `frozenGatewayId` (se congela en la 1ª compra) e `ivaOnNet` (default true; false = el promotor ya pagó IVA → IVA solo sobre comisión de plataforma). `PricingService.resolveFeesForEvent`/`quoteForEvent`: plataforma+IVA del fee_schedule, **comisión de pasarela del método efectivo** (frozen → elegida → default), IVA según el evento. **Retrocompatible** (Sandbox 0.05 = valor anterior → 129.68 intacto). El checkout resuelve por evento, guarda `order.feeGatewayId` y **congela** la pasarela del evento en la primera compra (precios ya no cambian). Cambiar pasarela/IVA de un evento congelado → 409. Anular una pasarela migra sus eventos a la default. 5 tests.
  - **Ticket D · Selección de método al pagar** (`payments`): `POST /orders/:id/pay { gatewayId?, useWallet? }`. Si se elige otra pasarela, **recotiza** la orden con su comisión (recalcula ítems + totales, actualiza `feeGatewayId`) conservando plataforma+IVA de la versión de comisiones de la orden. Sin `gatewayId` usa la de la orden/evento (o la default). **Validación:** si hay que cobrar por pasarela y no hay una activa (p.ej. saldo parcial sin método) → 400, no completa. Pasarela inactiva elegida → 400. (El enrutamiento por `provider` real llega al integrar Pagalo; hoy cobra el simulador.) 4 tests.
  - **Ticket E · Reparto de gastos EXTRA** (`modules/cost-share`): gastos fuera del precio del boleto (p.ej. cargo por pasar a wallet) se reparten promotor↔plataforma. Config: `costshare.default_pct` global (setting, default 0.5, 0 = plataforma cubre todo) + override por promotor (`User.costSharePct`). Endpoints admin: `GET/PATCH /cost-share/default`, `GET/PATCH/DELETE /cost-share/promoter/:id`. `CostShareService.applyExtraCost` asienta en el ledger (partida doble): `platform_expense +monto`, `promoter_payable -parteProm` (se descuenta de su liquidación), `platform_revenue -partePlat`. 5 tests. **Ola 3.5 completada.**
- **Ola 3 (Órdenes + pagos) COMPLETADA.** 128 tests verdes.
  - **Ticket 1 · Ledger doble-entrada + hash-chain** (`modules/ledger`): `LedgerService.post()` asienta transacciones con ≥2 asientos firmados que **suman 0** (partida doble); **encadenado por hash** (`hash=sha256(prevHash+contenido)`, append-only, `seq` autoincrement) con **advisory lock** que serializa el chain bajo concurrencia; saldos cacheados por cuenta (derivables de los asientos). `walletBalance(userId)`, `verifyChain()` (detecta manipulación: hash roto, tx que no cuadra, o saldo≠suma). Cuentas de sistema con `ownerId` centinela (evita NULL en índice único). 6 tests.
  - **Ticket 2 · PaymentProvider + simulador webhook-first** (`modules/payments`): puerto `PaymentProvider` (token DI, hoy `SimulatorPaymentProvider`) + `PaymentsService`. `POST /orders/:id/pay` crea el intento (pending, IDOR→404, orden no-pending→409); la orden **NO se confirma hasta el webhook**. `POST /payments/webhook` (público): verifica **firma HMAC** (`x-webhook-signature`, timing-safe), es **idempotente** (dedupe por `(provider,eventId)`, replay→duplicate sin reprocesar), y ejecuta fulfillment (`payment.succeeded`→orden `paid` + **asiento contable** en el ledger: gateway_clearing −inflow / promoter_payable +net / platform_revenue +platformFee / tax_payable +iva) o cancelación (`payment.failed`→orden cancelada + **asientos liberados** a `available`, ítems inactivos). Secret: `PAYMENT_WEBHOOK_SECRET`. 9 tests.
  - **Ticket 3 · Wallet + pago mixto** (`modules/wallet` + payments): `GET /wallet` (saldo = cuenta ledger `user_wallet`; se llena por reembolsos/reventas, sin recarga por tarjeta). `POST /orders/:id/pay {useWallet}`: wallet cubre todo → **confirmación inmediata** (sin pasarela); mixto → **reserva** la porción de wallet en `payment_holding` al iniciar (evita doble gasto) y la pasarela cobra el resto (fulfillment por webhook); pago fallido → **reembolsa la reserva** al wallet + libera asiento. **Invariante:** el ledger nunca deja un `user_wallet` negativo (guard race-safe dentro del advisory lock). **Decisión de negocio (marcada para revisión):** la comisión de pasarela se incurre solo sobre la porción cobrada por gateway (proporcional); el ahorro por usar wallet acredita a `platform_revenue`. 5 tests.
  - **Ticket 4 · Reembolsos y contracargos** (payments): webhooks `payment.refunded` / `payment.chargeback` sobre orden **paid**. Revierten la distribución contable (clawback promotor/plataforma/IVA); **refund** acredita el `inflow` (129.68−fee = 123.20) al **wallet** del comprador; **chargeback** saca el `inflow` por `gateway_clearing` (la tarjeta ya recuperó). Ambos: orden `refunded`, ítems inactivos, **asiento liberado** a `available` (reventa). Idempotente (solo procesa órdenes `paid`). Propagación de la revocación a validadores offline = Ola 5. 4 tests.
- **Ola 4 (Boletos + Wallet + Colas + Autorización de promotores) COMPLETADA.** Aprobada por el arquitecto con la condición de adelantar BullMQ (cumplida). Tickets:
  - **Ticket 0 · Fundación BullMQ** (`infra/queue`): `QueueService` sobre el Redis existente. Los módulos registran su handler por cola (`registerHandler`) y los workers se levantan en `onApplicationBootstrap`. Dos modos por config (`queue.inline`): **async** (dev/prod: `enqueue` empuja a BullMQ y retorna ya — no bloquea el event loop ni el webhook de la pasarela) e **inline** (test: jobs síncronos y sin workers dejando handles abiertos; `QUEUE_INLINE=true` forzado por `api/src/test/jest.env.ts`). `enqueue` **nunca lanza** (un fallo al encolar no debe tumbar el flujo disparador, p.ej. un pago ya asentado). Colas: `tickets/media/mail/wallet`. 4 tests.
  - **Tickets 1-4 · Boletos + media + correos + wallet** (`modules/tickets`): tras asentar el pago, el fulfillment **encola** la emisión (no bloquea el webhook). **Emisión** (`TicketsService`): un boleto por línea de orden, **firma Ed25519** de la identidad inmutable (par derivado de `TICKET_SIGNING_SEED` determinista, rotable por `signingKeyId`) + **secreto TOTP por boleto cifrado en reposo** (`EncryptionService`) → **QR rotativo** `PE1.<serial>.<code>` (un screenshot caduca). Idempotente. **Validación en puerta** (`POST /tickets/verify`, `gate_operator`/`admin`): formato → código TOTP vigente → firma Ed25519 → estado, con **check-in atómico** (`updateMany valid→used`, a prueba de doble check-in). **Media async** (`TicketMediaService`, cola MEDIA): QR PNG (`qrcode`) + PDF (`pdfkit`) al storage, URLs firmadas (`GET /tickets/:id/media`). **Correo async** (`TicketMailService`, cola MAIL): confirmación con los seriales. **Wallet** (puerto `WalletProvider` + `StubWalletProvider` sandbox, **sin certificados de terceros** para no bloquear E2E): Google (URL "Save") / Apple (`.pkpass` placeholder firmado); el **cargo EXTRA por wallet** se reparte prom↔plataforma (`CostShareService`, setting `wallet.pass_fee`, default 0). **Payments**: emite al pagar y **revoca** los boletos al reembolsar/contracargar (propagación offline = Ola 5). 18 tests.
  - **Ticket 5 · Autorización de promotores** (`modules/promoters`): cualquier usuario **solicita** ser promotor (`POST /promoters/apply`); un admin **aprueba/rechaza/suspende** (panel: `GET /promoters`, `:id/approve|reject|suspend`, `GET/PATCH /promoters/settings`). Enforcement en `EventsService.create/publish` (`assertCanOperate`: admin o promotor **aprobado**). Botón **"Activar pruebas"** (`PATCH /promoters/settings {requireApproval:false}`) **auto-aprueba** al solicitar (alpha/beta). Schema: `User.promoterStatus/AppliedAt/DecidedAt/Note` + enum `PromoterStatus`; el seed marca al promotor semilla como **aprobado**. Al aprobar se añade el rol `promoter` (re-login para token nuevo); rechazar/suspender lo quita. Ver [[autorizacion-promotores]]. 7 tests.
- **Ola 5 (Transferencias + validación offline + propagación de revocaciones) COMPLETADA.** 265 tests verdes (32 suites), 0 warnings. Todo en `modules/tickets`. Tickets:
  - **Ticket 1 · Chain-of-custody** (`ticket-custody.service.ts`): bitácora **append-only encadenada por hash** (blockchain) por boleto — cada movimiento (`issued`/`transferred`/`checked_in`/`revoked`) enlaza con el anterior vía `prevHash`; **advisory lock por boleto** serializa los append. `record/chain/verifyChain` (detecta manipulación). Integrado en emisión (génesis), check-in (actor = operador) y revocación. `GET /tickets/:id/custody` (dueño/admin, IDOR→404) → cadena + integridad. 4 tests.
  - **Ticket 2 · Transferencia (regalo interno)** (`ticket-transfer.service.ts`): handshake de **código compartido** — `POST /tickets/:id/transfer` (dueño verificado) crea transferencia pendiente y devuelve un código (hasheado, se muestra una vez); el destinatario verificado lo canjea con `POST /tickets/transfers/claim`. Al canjear **re-emite** el boleto (nuevo secreto TOTP + nueva firma Ed25519 sobre el nuevo dueño, en tx con advisory lock) → el QR/pase anterior **queda inservible**; asienta `transferred` en la custodia y regenera media (async). **Límite** por boleto: default 1 (setting) con override por evento (`Event.maxTransfers`). Guardas: no vigente/límite/auto-transferencia→400, código inválido→404, expirado→400, una sola pendiente (índice parcial `ticket_transfers_one_pending`)→409, IDOR→404, cancelar (remitente). `DELETE /tickets/transfers/:id`, `GET /tickets/transfers/outgoing`. Ver [[transferencia-boletos]]. 8 tests.
  - **Tickets 3-4 · Validación offline (SafeTix) + propagación de revocaciones** (`ticket-sync.service.ts`): bitácora `ticket_sync_entries` (seq global monótono) que registra cada movimiento; el dispositivo de puerta hace **pull incremental**. `GET /events/:id/manifest?since=N` (gate_operator/admin) → último estado por boleto cambiado desde N, con su **secreto TOTP descifrado** (modelo SafeTix: el device recomputa el QR rotativo y valida **sin red** → screenshot inútil aunque no haya internet) y **firmado con Ed25519** (verificable offline con la llave pública incluida + `contentHash`). Propagación: emisión→`issued`, transferencia→`transferred` (nuevo secreto), reembolso/contracargo→`revoked`, check-in→`used`. 6 tests. **Reventa: solo diseño** (no implementada), como se acordó.
- **Ola 6 (Observabilidad + endurecimiento) COMPLETADA.** 285 tests verdes (35 suites), 0 warnings. Tickets:
  - **Ticket 1 · Retiros de wallet** (`modules/wallet/wallet-withdrawal.service.ts`): flujo **solicitud→aprobación→pago**. `POST /wallet/withdrawals` valida saldo y **reserva** en el ledger (`user_wallet −amount → payout_pending +net`, `platform_revenue +fee`); la comisión del **usuario (6%) es el doble que la del promotor (3%)**, por rol. Admin: `all/:id/approve/:id/pay` (liquida `payout_pending→payout_settled`)`/:id/reject` (reintegra); usuario `DELETE :id` (cancela pendiente, reintegra). Guardas de estado, RBAC, IDOR, saldo insuficiente, Banker's rounding. Nuevos `LedgerAccountType`: `payout_pending`, `payout_settled` + enum `WithdrawalStatus`. 10 tests.
  - **Ticket 2 · Ingest masivo de validación (RabbitMQ)** (`modules/tickets/validation-ingest.service.ts`): las puertas offline envían check-ins en lote; **RabbitMQ** (amqplib, cola durable `validation.ingest`) desacopla el fan-in. `applyCheckin` **idempotente**: `valid→used` (custody+sync); ya `used` → **doble check-in** (posible otra puerta) → persiste `CheckinConflict`; revocado/transferido→invalid+conflicto; inexistente→not_found. `POST /checkins/batch` (gate_operator/admin) devuelve la reconciliación; `GET /events/:id/checkins/conflicts`. `RabbitService` ahora publica/consume (conexión perezosa). **Inline en test** (`RABBIT_INLINE`). 5 tests.
  - **Ticket 3 · Privacidad/retención** (`modules/retention`): `anonymizeUser` **seudonimiza PII** (email→hash, nombre/teléfono/avatar/credenciales borrados, status inactive, `anonymizedAt`) + borra accesos (devices/refresh/oauth/challenges) + depura facturación, **preservando `user.id` y el ledger/órdenes/boletos** (trazabilidad intacta). Idempotente; no aplica a admins. Disparadores (ambos): `POST /admin/users/:id/anonymize` + `POST /admin/retention/run` + **job programado** (setInterval diario, `RETENTION_ENABLED`, apagado en test) que anonimiza a los elegibles (sin actividad ni eventos que concluyan tras `RETENTION_DAYS`). 5 tests.
  - **Ticket 4 · OTel + endurecimiento**: helper `withSpan()` + span de negocio `validation.ingest` (junto a `checkout.commit`/`seat.hold`). **Secret Manager y Cloud Run documentados** (no código): `docs/DESPLIEGUE.md §7` — topología api/worker/ingest, `--set-secrets` 12-factor, Cloud Scheduler para la retención, variables de Olas 4-6. `.env.example` actualizado.
- Modelo de datos (Prisma): settings, users (+ promotor + `anonymizedAt`), refresh_tokens, password_recoveries, auth_challenges, devices, oauth_accounts, categories, events (+ `maxTransfers` + `absorbInstallmentCost`), event_media, localities, seat_maps, seats (GA materializado), fee_schedules, orders (FEL + feeScheduleVersion), order_items, **payment_gateways** (+ `installmentRates` JSON + `installmentFixedFee`), payments, webhook_events, ledger_accounts, ledger_transactions, ledger_entries, **tickets** (Ed25519 + totpSecret cifrado + media + transferCount), **ticket_custody_events** (hash-chain), **ticket_transfers**, **ticket_sync_entries**, **checkin_conflicts**, **wallet_withdrawals**.
- Credenciales seed: `admin@pasaeventos.com` / `promotor@pasaeventos.com` / `cliente@pasaeventos.com`, todas con password `Password123`.
- Warning benigno conocido: NestJS/path-to-regexp emite "Unsupported route path /api/*" al arrancar; lo auto-convierte, no afecta.

### Mapa de puertos (local) — puertos host NO-default para evitar conflictos
| Servicio | Host | Interno |
|---|---|---|
| API (NestJS) | 8080 | 8080 |
| Adminer (DB UI) | 8082 | 8080 |
| PostgreSQL 16 | 54320 | 5432 |
| Redis 7 | 63790 | 6379 |
| RabbitMQ AMQP / UI | 56720 / 15673 | 5672 / 15672 |
| MailHog SMTP / UI | 10250 / 8026 | 1025 / 8025 |
| LocalStack (S3) | 45660 | 4566 |
| Jaeger UI (OTel, opcional; `profile: observability`) | 16687 | 16686 |

Los puertos INTERNOS (contenedor↔contenedor) son los default; solo cambian los mapeos al host. Credenciales locales: DB/Rabbit user=pass=`pasaeventos`; bucket S3 `pasaeventos-local`. Adminer server: `pasaeventos_db`.

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
| Pagos | Puerto `PaymentProvider` + **simulador** (hoy). **Recurrente** = default (con **cuotas** Visacuotas/Mastercuotas), **Pagalo** alternativa → Stripe/GPay/PayPal; fulfillment por **webhook**. Recargo de cuotas al comprador **prohibido en GT** → lo absorbe plataforma/promotor |
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
make load            # carga K6: seed estadio 10k + spike + verificación 0 doble-venta
make db-shell        # psql ; make redis-shell ; make rabbit-shell ; make node-shell
make deploy          # deploy a Cloud Run (gcloud)
```
Stack local (docker-compose.local.yml): api (NestJS), postgres 16, redis 7, rabbitmq, mailhog, localstack (S3), adminer. El frontend Angular se reintegra en la fase de frontend.
Config **12-factor**: todo por env URIs (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`, storage `S3_*`/`GCS_*`, `MAIL_*`, `PAGALO_*`, `JWT_*`, `TICKET_SIGNING_*`). Mismo binario local↔prod. Ver `.env.example`.

---

## Seguridad — pendiente importante

El `.env` del disco local tuvo secretos de prod (MySQL prod, llave GCP, Redis Cloud, Gmail app password), pero **NUNCA se versionaron**: `.env` y `gcp-service-account.json` siempre estuvieron en `.gitignore`. Verificado sobre TODO el historial por nombre de archivo y por los valores reales de cada secreto → **0 coincidencias; el historial está limpio, no fue necesario reescribirlo**. El `.env` local ya está saneado (Postgres local, sin secretos). Esas credenciales ya fueron **eliminadas de sus servicios**; al ir a prod se emiten nuevas y van a **GCP Secret Manager** (ver `docs/DESPLIEGUE.md`, fuente `.env.prod`).

---

## Cómo trabajar aquí

- Responder **en español**. Comportarse como **ingeniero senior**: seguridad, logging, debug, multi-entorno, tests.
- **Preguntar** dudas de negocio/componentes en vez de suponer.
- Patrón: **controllers finos → services → repositories (Prisma)**. Lógica de dinero **server-authoritative**.
- **Tests EXHAUSTIVOS por endpoint (criterio de aceptación — el usuario confía ciegamente en ellos).** En cada ola cubrir: happy path por rol; validación de entrada; **todos los errores capturados** y su contrato (400/401/403/404/409/422, 500 sin stack en prod); **seguridad / intentos de hacking** (bypass de auth, token manipulado/expirado, escalada de privilegios RBAC, IDOR/ownership, reuso de refresh, rate-limit, inyección, replay de webhooks, manipulación de precios server-authoritative); **concurrencia** que demuestre **0 doble-venta** (K6/carga); bordes de dinero (Banker's rounding). Ninguna ola es "hecha" sin esto. Ver `pref-testing-exhaustivo` en memoria.
- Commitear en `feature/backend-core-v1`, justificar, **no subir** hasta validación del usuario.
- **Commits SIN línea `Co-Authored-By`** (el usuario lo pidió; los commits antiguos que ya la tienen se dejan).
- Usar agentes para explorar/QA cuando ayude (el usuario lo pidió explícitamente).

## Plan de ejecución (olas) — ver detalle en docs/ARQUITECTURA.md §17

0. Fundaciones (NestJS+Prisma+Postgres, docker, quitar secretos) →
1. Identidad+catálogo (auth/RBAC, users, events, localities, seat_maps) →
2. Precios+inventario (PricingEngine, holds, commit) + **pruebas de carga k6/Artillery** del on-sale →
3. Órdenes+pagos (orders, PaymentProvider+simulador, pago mixto, ledger) + **reembolsos y contracargos** (webhook chargeback → invalida boleto → ledger → revocación) →
4. **COMPLETADA** — Boletos+wallet: BullMQ adelantado (condición del arquitecto, cumplida); emisión Ed25519+TOTP (QR rotativo) encolada tras el pago, QR/PDF y correos async, Google/Apple vía `WalletProvider` con stub sandbox, y autorización de promotores (panel + "activar pruebas"). Falta para la Ola 5: **validación offline dinámica con manifiesto** (hoy la validación en puerta es en línea) →
5. **COMPLETADA** — Transferencias (handshake de código compartido + chain-of-custody hash-chain + re-emisión) + validación offline (manifiesto SafeTix firmado con secretos TOTP) + **propagación de revocaciones/transferencias/check-in** a validadores (delta incremental). Falta para Ola 6: **ingest masivo** de validación por RabbitMQ (hoy la puerta hace pull del manifiesto por HTTP). →
6. **COMPLETADA** — Observabilidad+endurecimiento: RabbitMQ ingest masivo de validación, retiros de wallet, privacidad/retención (anonimización preservando el ledger), OTel ampliado; Secret Manager + Cloud Run **documentados** (no código, deploy real aparte).

QA transversal en cada ola.

**Estado (jul 2026): Olas 0–6 COMPLETAS + auditoría QA de Olas 5/6 + Ola 6.5 EN CURSO — 339 tests verdes (37 suites), 0 warnings.** El arquitecto (Boletera) CONGELÓ el núcleo del backend v1 y aprobó el roadmap de frontend + la Ola 6.5. La auditoría QA (+28 tests) cerró huecos de dinero, seguridad, datos y transferencias.

**Ola 6.5 (endurecimiento backend) — progreso:**
- **Ticket 1 · GA por filas COMPLETADO** (`venues` + `inventory`): las localidades `general` con `capacity=N` materializan **N filas `seats`** (`GA-*`, auto-generadas al fijar/ajustar el aforo; reducir el aforo solo borra cupos `available`, nunca bajo lo vendido→409). **Hold POR CANTIDAD** (`POST /events/:id/holds {localityId, quantity}`) asigna cupos concretos con Lua atómico (Redis `SET NX` = autoridad de la reserva) y devuelve `seatIds` → el commit existente `{seatIds}` los vende sin cambios. Reusa el anti-doble-venta probado (FOR UPDATE + índice parcial) **sin fila caliente**. 11 tests (incl. 0-sobreventa: 25 flujos/10 cupos→10 vendidos).
- **Cambio arquitectónico · Pagos en CUOTAS + Recurrente default COMPLETADO** (`pricing` + `payments` + `payment-gateways` + `events`): **Recurrente** = pasarela default (cuotas Visacuotas/Mastercuotas: **3→8% · 6→9% · 12→10% · 18→14% + Q2 fijo**, tarifario real verificado); **Pagalo** = alternativa. `PaymentGateway.installmentRates` (JSON) + `installmentFixedFee`; `Event.absorbInstallmentCost`. El **comprador paga SIEMPRE el precio de 1 pago** (recargo directo por tarjeta/cuotas **ilegal en GT desde 2024**); el costo de financiamiento (gn%+fijo) lo **absorbe la PLATAFORMA** (default, baja su margen — puede quedar negativo sin buffer) o el **PROMOTOR** (flag del evento, baja su neto). `PricingEngine.quote(net, params, plan?)` retrocompatible (sin cuotas = 129.68 intacto; solo cambian `gatewayFee` y quién baja su margen; `net`/`iva`/`taxableBase`/`total` NO varían → **la plataforma no subdeclara IVA y ve su costo real de pasarela**). Desglose de transparencia en el `PriceQuote` (`installments/installmentFeePct/installmentFixedFee/installmentSurcharge/installmentAbsorbedBy/basePrice`). El recálculo ocurre **solo en checkout** (`POST /orders/:id/pay {installments}` recotiza); el catálogo muestra 1 pago. Simulador acepta `installments` (simula Recurrente). OpenAPI exportado a `docs/openapi.json`. 8 e2e + 10 unit del motor.

**PRÓXIMO — Ola 6.5 pendiente:**
- (2) **keyset pagination** en listados de alto volumen (ledger, mis boletos, órdenes, admin) sobre `(createdAt,id)`/`seq`; (3) **jitter** configurable (1–5s) en `SimulatorPaymentProvider` antes del webhook; (4) **endpoint SSE** (`GET /orders/:id/stream` + deltas de mapa + `wallet.updated`) para push sin polling; (5) **SafeTix**: token de operador fresco/corto + manifiesto acotado por evento con expiración.
- **Backlog de endurecimiento:** auditoría de dependencias (supply-chain: `npm audit` + CI; axios 1.10.0 solo-test a bumpear — riesgo nulo).
- **Frontend Angular 20 SSR PWA (F0–F7):** F0 fundaciones (SDK tipado desde OpenAPI, sesión con signals, interceptor plataforma-aware) · F1 catálogo SSR/SEO (anónimo+cacheable en edge, auth hidratada en cliente) · F2 compra (mapa **Konva/Canvas** para >2–3k nodos, hold countdown local, pago por SSE) · F3 cuenta/boletos/wallet/transferencias · F4 panel promotor · F5 panel admin · F6 **PWA de validación offline** (IndexedDB manifiesto SafeTix, ingest por lote, UI verde/roja hiper-evidente) · F7 endurecimiento. Reactividad: SSE + countdown local + snapshots CDN (sin polling agresivo). Hidratación SSR: cookie httpOnly refresh + access en memoria + TransferState solo público + request-scoped.

Todo en `feature/backend-core-v1`, **sin subir**. Se cumplió la condición del arquitecto (BullMQ adelantado: toda tarea pesada se encola tras asentar el pago). Pendientes derivados para próximas olas: (b) el **frontend debe ser hiper-transparente** al recotizar por método (evitar que parezca cargo oculto); (c) la **gestión de certificados Apple Developer (.pkpass) y aprobación de Google Wallet API** corre en paralelo — el `WalletProvider` ya está con **stub/sandbox** para no bloquear (los proveedores reales se conectan detrás del mismo puerto cuando lleguen las credenciales). **Siguiente: Ola 5** (transferencias + chain-of-custody + validación offline con manifiesto + propagación de revocaciones).

## Consideraciones transversales de producción (no olvidar)
- **Reembolsos/contracargos:** al recibir webhook de contracargo/reembolso → invalidar boleto al instante, asentar en el ledger inmutable y **propagar la revocación** a los validadores offline (delta de sincronización). Diseño en Ola 3, propagación en Ola 5.
- **Pruebas de carga (on-sale):** stress test del flujo hold(Redis)+commit(Postgres FOR UPDATE) con **k6/Artillery/Gatling** en local/staging antes de prod; demostrar 0 doble-venta bajo miles de req/s. Empieza en Ola 2, se refuerza en Ola 6.
- **Contrato API backend↔frontend:** generar tipos y servicios de Angular desde el **OpenAPI de NestJS** (`@nestjs/swagger` → `openapi-generator`/`orval`/`ng-openapi-gen`) para no escribir interfaces a mano. Definir el flujo antes de arrancar el frontend.
- **Privacidad/retención (PII + financiero):** política de **anonimización/purga** de datos históricos de usuarios y carteras tras concluir eventos, **manteniendo intacta la trazabilidad del ledger** (seudonimización, no borrado del asiento contable). Diseño en Ola 6.
- **Autorización de promotores — IMPLEMENTADA en Ola 4** (`modules/promoters`): cualquier usuario se da de alta como promotor y un admin lo autoriza (panel aprobar/rechazar/suspender); botón "Activar pruebas" (`promoters.require_approval=false`) auto-aprueba. Enforcement en `EventsService.create/publish`.
