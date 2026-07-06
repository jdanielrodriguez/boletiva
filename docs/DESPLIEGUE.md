# Despliegue y manejo de secretos — Pasa Eventos

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
  with: { project_id: pasa-eventos }
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
# Requiere: gcloud auth login && gcloud config set project pasa-eventos
set -a; source .env.prod; set +a

create_secret() {   # $1 = nombre del secreto, $2 = valor
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret pasaeventos-database-url        "$DATABASE_URL"
create_secret pasaeventos-redis-url           "$REDIS_URL"
create_secret pasaeventos-amqp-url            "$AMQP_URL"
create_secret pasaeventos-mail-pass           "$MAIL_PASS"
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
  --image us-central1-docker.pkg.dev/pasa-eventos/pasaeventos-backend/api:TAG \
  --region us-central1 --platform managed --allow-unauthenticated \
  --memory=2Gi --cpu=2 --concurrency=200 --min-instances=1 --max-instances=20 \
  --set-env-vars=NODE_ENV=production,STORAGE_PROVIDER=gcs,GCLOUD_PROJECT_ID=pasa-eventos,GCS_BUCKET=pasaeventos-prod-media,CORS_ORIGINS=https://pasaeventos.com \
  --set-secrets=DATABASE_URL=pasaeventos-database-url:latest,REDIS_URL=pasaeventos-redis-url:latest,AMQP_URL=pasaeventos-amqp-url:latest,MAIL_PASS=pasaeventos-mail-pass:latest,JWT_ACCESS_SECRET=pasaeventos-jwt-access-secret:latest,JWT_REFRESH_SECRET=pasaeventos-jwt-refresh-secret:latest,GCS_SERVICE_ACCOUNT_JSON=pasaeventos-gcs-sa-json:latest
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

> **Nota histórica:** el repo tuvo credenciales de prod versionadas (MySQL,
> Redis Cloud, Gmail, llave GCP). Fueron **eliminadas de sus servicios** y el
> historial de git fue **reescrito** para purgarlas. Las nuevas credenciales se
> emiten al aprovisionar prod y viven solo en Secret Manager.
