# Despliegue y manejo de secretos — Boletiva

Estrategia 12-factor: el mismo binario corre en local y en GCP; **solo cambia la
configuración por entorno**. Local usa `.env` (Docker). Prod NO usa archivos de
credenciales en el repo: usa **GCP Secret Manager**, y la fuente para crearlos es
`.env.prod` (local, git-ignorado; plantilla en `.env.prod.example`).

---

## 1. Capas de secretos

| Dónde | Para qué | Cómo se cargan |
|---|---|---|
| `.env` (local) | Desarrollo | Docker Compose lo lee (`env_file`) |
| `.env.prod` (local, git-ignorado) | Fuente única de credenciales de prod | Script las sube a Secret Manager |
| **GCP Secret Manager** | Runtime en Cloud Run | Cloud Run inyecta con `--set-secrets` |
| **GitHub Actions Secrets** | CI/CD (build + deploy) | El workflow los lee como `${{ secrets.* }}` |

Nunca se commitea un secreto. El repo solo contiene plantillas `*.example`.

---

## 2. GitHub Actions — cómo se conectan los secrets

En **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Contenido | Usado por |
|---|---|---|
| `GCP_SA_KEY` | JSON completo del service account de despliegue (`github-actions-deployer@…`) con roles: Cloud Run Admin, Cloud Build Editor, Artifact Registry Writer, Service Account User, Secret Manager Accessor | `.github/workflows/deploy.yml` (auth a GCP) |

El workflow de deploy (`deploy.yml`) hace:
```yaml
- uses: google-github-actions/auth@v2
  with:
    credentials_json: '${{ secrets.GCP_SA_KEY }}'   # <- aquí se conecta
- uses: google-github-actions/setup-gcloud@v2
  with: { project_id: boletera-502405 }
```
A partir de ahí, `gcloud` ya está autenticado y NO necesita más secretos en el
YAML: las credenciales de la app (DB, Redis, etc.) viven en Secret Manager y
Cloud Run las inyecta en tiempo de ejecución (ver §4). Así el pipeline nunca
"ve" las credenciales de la aplicación.

> **Recomendado a futuro:** reemplazar `GCP_SA_KEY` por **Workload Identity
> Federation** (OIDC de GitHub → GCP) para no almacenar ninguna llave de
> service account. Es la práctica actual de GCP.

---

## 3. Crear los secretos en GCP Secret Manager desde `.env.prod`

Con `.env.prod` lleno (credenciales reales, recién emitidas), subir cada valor
como un secreto (una sola vez; luego `versions add` para rotar):

```bash
# Requiere: gcloud auth login && gcloud config set project boletera-502405
set -a; source .env.prod; set +a

create_secret() {   # $1 = nombre del secreto, $2 = valor
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret pasaeventos-database-url        "$DATABASE_URL"
create_secret pasaeventos-redis-url           "$REDIS_URL"
create_secret pasaeventos-amqp-url            "$AMQP_URL"
create_secret pasaeventos-mail-user           "$MAIL_USER"   # SES SMTP username
create_secret pasaeventos-mail-pass           "$MAIL_PASS"   # SES SMTP password
create_secret pasaeventos-jwt-access-secret   "$JWT_ACCESS_SECRET"
create_secret pasaeventos-jwt-refresh-secret  "$JWT_REFRESH_SECRET"
create_secret pasaeventos-gcs-sa-json         "$GCS_SERVICE_ACCOUNT_JSON"
# (agregar PAGALO_*, TICKET_SIGNING_* cuando existan)
```

---

## 4. Cloud Run — inyección de secretos y env

El deploy inyecta los secretos como variables de entorno (referencia a Secret
Manager, no el valor en claro) y las no-sensibles como env vars:

```bash
gcloud run deploy pasaeventos-api \
  --image us-central1-docker.pkg.dev/boletera-502405/pasaeventos-backend/api:TAG \
  --region us-central1 --platform managed --allow-unauthenticated \
  --memory=2Gi --cpu=2 --concurrency=200 --min-instances=1 --max-instances=20 \
  --set-env-vars=NODE_ENV=production,STORAGE_PROVIDER=gcs,GCLOUD_PROJECT_ID=boletera-502405,GCS_BUCKET=pasaeventos-prod-media,CORS_ORIGINS=https://boletiva.com,MAIL_HOST=email-smtp.us-east-1.amazonaws.com,MAIL_PORT=587,MAIL_SECURE=false,MAIL_FROM=no-reply@boletiva.com \
  --set-secrets=DATABASE_URL=pasaeventos-database-url:latest,REDIS_URL=pasaeventos-redis-url:latest,AMQP_URL=pasaeventos-amqp-url:latest,MAIL_USER=pasaeventos-mail-user:latest,MAIL_PASS=pasaeventos-mail-pass:latest,JWT_ACCESS_SECRET=pasaeventos-jwt-access-secret:latest,JWT_REFRESH_SECRET=pasaeventos-jwt-refresh-secret:latest,GCS_SERVICE_ACCOUNT_JSON=pasaeventos-gcs-sa-json:latest
```

Parámetros de autoescala pensados para picos de venta (on-sale): concurrencia
alta (I/O-bound), `min-instances ≥ 1` para evitar cold starts, `max-instances`
amplio detrás de la sala de espera Redis. Los workers (PDF/QR/wallet) irán como
servicios Cloud Run separados con concurrencia baja.

---

## 5. Migraciones de base de datos en prod

Las migraciones NO se aplican al arrancar el contenedor. Se ejecutan como paso
del pipeline **antes** de enrutar tráfico a la nueva revisión:

```bash
# En el pipeline, con DATABASE_URL de prod disponible como secreto:
npx prisma migrate deploy
```
(o como Cloud Run Job dedicado). El Dockerfile de prod NO corre `db push`.

---

## 6. Rotación de credenciales

Rotar = `gcloud secrets versions add <nombre> --data-file=-` con el nuevo valor y
redeploy (o `--set-secrets` con `:latest`). Las llaves de firma de boletos
(`TICKET_SIGNING_*`) y las de Pagalo se rotan en calendario.

> **Nota histórica:** el `.env` del disco local tuvo credenciales de prod
> (MySQL, Redis Cloud, Gmail, llave GCP), pero **nunca se versionaron** (`.env`
> y `gcp-service-account.json` siempre estuvieron en `.gitignore`; verificado
> sobre todo el historial por nombre y por valor → 0 coincidencias). No fue
> necesario reescribir el historial. Esas credenciales ya fueron **eliminadas
> de sus servicios**; las nuevas se emiten al aprovisionar prod y viven solo en
> Secret Manager.

---

## 7. Endurecimiento y topología de servicios (Ola 6)

La app es **12-factor**: mismo binario local↔prod, todo por variables de entorno.
En Cloud Run conviene separar responsabilidades en **tres roles** del mismo
contenedor (misma imagen, distinto escalado):

| Rol | Qué corre | Escala |
|---|---|---|
| `api` | HTTP (Nest) | por request, concurrency 150–250 |
| `worker` | consumidores **BullMQ** (emisión de boletos, QR/PDF, correos) | por profundidad de cola |
| `ingest` | consumidor **RabbitMQ** de validación masiva (`validation.ingest`) | según afluencia de puertas |

En un solo servicio también funciona (todo en el proceso `api`): los consumidores se
levantan en el arranque. Para escalar se separan sin cambiar código.

### Secret Manager
Los secretos van a **GCP Secret Manager** y se inyectan a Cloud Run con
`--set-secrets` (nunca en la imagen ni en el repo):

```
gcloud run deploy pasaeventos-api \
  --set-secrets=DATABASE_URL=pe-database-url:latest,\
JWT_ACCESS_SECRET=pe-jwt-access:latest,JWT_REFRESH_SECRET=pe-jwt-refresh:latest,\
APP_ENCRYPTION_KEY=pe-encryption-key:latest,\
TICKET_SIGNING_SEED=pe-ticket-seed:latest,PAYMENT_WEBHOOK_SECRET=pe-webhook:latest
```

Cloud Run materializa los secretos como variables de entorno, por lo que la carga
12-factor por `process.env` **no requiere código de cliente de Secret Manager**
(queda como opción futura si se prefiere pull en runtime).

### Variables nuevas (Olas 4–6)
- `TICKET_SIGNING_SEED` / `TICKET_SIGNING_KEY_ID` — firma Ed25519 de boletos; rotar por calendario (el `KEY_ID` permite convivencia de llaves durante la rotación).
- `QUEUE_INLINE` / `RABBIT_INLINE` — dejar **sin definir** en prod (async real); solo `true` en test.
- `WALLET_PROVIDER` — `stub` hasta tener certificados Apple/Google; luego `google`/`apple` detrás del mismo puerto.
- `RETENTION_ENABLED` / `RETENTION_DAYS` — job de anonimización. En Cloud Run (instancias que escalan a cero) es preferible **Cloud Scheduler → `POST /admin/retention/run`** en vez del `setInterval` interno.

### Wallet passes (Apple/Google)
Los certificados Apple Developer (`.pkpass`) y la aprobación de la Google Wallet API
tienen tiempos de terceros; su gestión corre **en paralelo**. El `WalletProvider` usa
un **stub sandbox** entre tanto, así el backend no queda bloqueado.

### OpenTelemetry
`OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` (colector/Cloud Trace). Spans
manuales de negocio: `checkout.commit`, `seat.hold` y `validation.ingest`, más
auto-instrumentación de HTTP/Nest/Prisma/Redis.
