# Guía GCP — crear el proyecto, habilitar APIs y obtener credenciales de Google

Guía **paso a paso** para dejar operativas las integraciones de Google que el software ya sabe
leer: **Google Wallet**, **reCAPTCHA**, **OAuth "Login con Google"** y los accesos base de **GCP**
(proyecto, región, deploy). Complementa a [INTEGRACIONES-CREDENCIALES.md](INTEGRACIONES-CREDENCIALES.md)
(el "qué es cada integración"); aquí está el **click a click** y **qué valor va en qué variable**.

> Recordatorio del gating: **variable vacía → el servicio se ignora**; usarlo sin configurar →
> `503 "Servicio no disponible"`. Al rellenar las variables de abajo, el servicio queda disponible
> automáticamente (lo decide `IntegrationsService`, sin tocar código).

> ⚠️ Las consolas de Google cambian de nombre/ubicación seguido. Los pasos reflejan la estructura
> vigente; si un menú no coincide, búscalo por el nombre en negrita.

---

## 0. Crear el proyecto en Google Cloud

1. Entra a la **Google Cloud Console** → `https://console.cloud.google.com/` con la cuenta Google
   de la empresa (idealmente una cuenta corporativa, no personal).
2. Barra superior → selector de proyecto → **Proyecto nuevo**.
   - **Nombre:** `pasa-eventos` (o el que uses). Anota el **Project ID** que genera (p.ej.
     `pasa-eventos` o `pasa-eventos-4711`) → es el valor de `GCLOUD_PROJECT_ID`.
3. **Habilitar facturación** (Billing): menú **Facturación** → vincula una cuenta de facturación.
   Wallet, reCAPTCHA clásico y OAuth **no cobran**, pero Cloud Run / Artifact Registry / Cloud SQL sí
   requieren billing activo cuando llegues al deploy.
4. Región de trabajo: usamos **`us-central1`** por defecto (`GCP_REGION`). Cámbiala solo si tienes
   una razón (latencia/residencia de datos).

**Variables base (`.env` y `.env.prod`):**

| Variable | Valor | Dónde sale |
|---|---|---|
| `GCLOUD_PROJECT_ID` | Project ID | Consola → selector de proyecto |
| `GCP_REGION` | `us-central1` (default) | tú lo eliges |

---

## 1. Habilitar las APIs necesarias

Menú **APIs y servicios → Biblioteca** (`APIs & Services → Library`). Busca cada una y pulsa
**Habilitar**. Para lo que vamos a probar **ahora** (Wallet + reCAPTCHA + OAuth) basta con:

| API a habilitar | Para qué | ¿Ahora? |
|---|---|---|
| **Google Wallet API** | emitir el pase "Guardar en Google Wallet" | ✅ sí |
| **reCAPTCHA** *(ver nota)* | anti-abuso en formularios | ✅ sí (flujo clásico, sin habilitar API) |
| *(OAuth no es una API)* | login con Google | ✅ sí (solo pantalla de consentimiento + credencial) |
| **Secret Manager API** | guardar secretos en prod | ⏳ al hacer deploy |
| **Cloud Run Admin API** | desplegar el backend/SSR | ⏳ al hacer deploy |
| **Artifact Registry API** | guardar las imágenes docker | ⏳ al hacer deploy |
| **Cloud Build API** | construir en CI | ⏳ al hacer deploy |

> **Nota reCAPTCHA (importante):** el backend usa el **reCAPTCHA clásico** (verifica el token contra
> `https://www.google.com/recaptcha/api/siteverify` con un **par site key + secret key**). Ese flujo
> se administra en la **consola de reCAPTCHA** (`https://www.google.com/recaptcha/admin`), **NO** hace
> falta habilitar la "reCAPTCHA Enterprise API" en GCP. Si en el futuro migramos a Enterprise, cambia
> la implementación del `CaptchaService` (hoy no es Enterprise). Ver §3.

---

## 2. Google Wallet — Issuer ID + Service Account

El software (`GoogleWalletProvider`) firma con una **cuenta de servicio** el JWT de "Guardar en
Google Wallet". Necesita **dos** valores: el **Issuer ID** y el **JSON de la cuenta de servicio**.

### 2.1 Habilitar la API
- **APIs y servicios → Biblioteca** → busca **Google Wallet API** → **Habilitar** (§1).

### 2.2 Cuenta de emisor (Issuer ID)
1. Ve a la **Google Wallet / Pay & Wallet Console** → `https://pay.google.com/business/console/`.
2. Registra la **cuenta de emisor** (Issuer): nombre del emisor (p.ej. "Pasa Eventos").
3. Copia el **Issuer ID** (un número largo, p.ej. `3388000000022xxxxxx`).
   → valor de `GOOGLE_WALLET_ISSUER_ID`.
4. La cuenta arranca en **modo demo/test**: los pases muestran una marca **[TEST]** y solo los
   pueden guardar las cuentas que agregues como **testers**. Es suficiente para probar todo el
   flujo. Cuando quieras pases reales, solicita **acceso de producción** (lo aprueba Google).

### 2.3 Service Account (JSON) y vincularla al emisor
1. En **GCP → APIs y servicios → Credenciales** (o **IAM y administración → Cuentas de servicio**):
   **Crear cuenta de servicio**.
   - Nombre: `wallet-signer`. No necesita roles de IAM del proyecto para firmar el JWT.
2. Abre la cuenta creada → pestaña **Claves → Agregar clave → Crear clave nueva → JSON**. Se
   descarga un archivo `*.json` con `client_email` y `private_key`.
   → su contenido es el valor de `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`.
3. **Vincula la cuenta de servicio al emisor**: en la **Pay & Wallet Console → Users/Cuenta →
   Administrar usuarios**, agrega el **email de la cuenta de servicio** (`client_email` del JSON,
   termina en `...gserviceaccount.com`) con permiso de **Desarrollador/Editor**. Sin este paso,
   Google rechaza los objetos de pase aunque el JWT esté bien firmado.

### 2.4 Cómo poner el JSON en la variable
El proveedor acepta **el JSON crudo o en base64** (parsea ambos). En un `.env` de una sola línea, el
JSON crudo con saltos de línea se rompe → **usa base64** (recomendado):

```bash
# genera el valor de una sola línea (dentro del contenedor o en el host):
base64 -w0 wallet-signer-xxxx.json
```

Pega el resultado en la variable. En prod ese mismo string va a **Secret Manager**.

**Variables (`.env` local sandbox / `.env.prod`):**

| Variable | Valor |
|---|---|
| `WALLET_PROVIDER` | `google` para probar solo Google, o `auto` (Google si hay pase Google; Apple si estuviera) |
| `GOOGLE_WALLET_ISSUER_ID` | Issuer ID de la Wallet Console |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | JSON de la SA (crudo o **base64**) |

> Disponible cuando **ambos** (`issuerId` + `serviceAccountJson`) están presentes. Con eso,
> `capabilities.googleWallet = true` y el endpoint de pase deja de responder 503.

---

## 3. reCAPTCHA (clásico v3) — Site key + Secret key

1. Entra a la **consola de administración de reCAPTCHA**:
   `https://www.google.com/recaptcha/admin/create` (misma cuenta Google).
2. Registra un sitio:
   - **Etiqueta:** `pasaeventos`.
   - **Tipo:** **reCAPTCHA v3** (score, sin fricción; es lo que espera el backend).
   - **Dominios:** agrega `localhost` (para dev), tu dominio de staging y `pasaeventos.com` /
     `www.pasaeventos.com` (prod). reCAPTCHA v3 no distingue "sandbox"; `localhost` en la lista
     basta para probar en local.
   - Acepta términos → **Enviar**.
3. Copia las dos llaves:
   - **Clave del sitio (Site key)** → `RECAPTCHA_SITE_KEY` (pública, va al frontend vía
     `GET /public/config`).
   - **Clave secreta (Secret key)** → `RECAPTCHA_SECRET_KEY` (privada, verificación server-side).
4. Activa la verificación poniendo `RECAPTCHA_DISABLED=false`.

**Variables:**

| Variable | Valor | Notas |
|---|---|---|
| `RECAPTCHA_SITE_KEY` | site key | pública; el frontend la lee de `/public/config` |
| `RECAPTCHA_SECRET_KEY` | secret key | privada; solo backend |
| `RECAPTCHA_MIN_SCORE` | `0.5` (default) | rechaza si el score de Google < este umbral |
| `RECAPTCHA_DISABLED` | `false` para activar | en **dev/test** déjalo `true` para no bloquear pruebas/E2E |

> Comportamiento del gating: disponible = **hay `secretKey` Y `disabled=false`**. Si falta el secret
> o `disabled=true`, la verificación se **OMITE** (devuelve OK, no bloquea) — por eso los tests/E2E
> no se rompen. Solo cuando está activo se llama a Google y se exige `success && score ≥ minScore`.
>
> **Cuidado con el E2E:** si activas reCAPTCHA en el mismo `.env` que corre el E2E de Puppeteer, el
> login/registro automatizado empezará a exigir token real y fallará. Para probar reCAPTCHA en vivo,
> hazlo manualmente en el navegador; deja `RECAPTCHA_DISABLED=true` cuando corras la suite E2E.

---

## 4. (Opcional) Login con Google — OAuth Client ID

Solo si vas a habilitar el botón "Iniciar sesión con Google" (el backend ya tiene la estructura;
se activa con `GOOGLE_CLIENT_ID`).

1. **APIs y servicios → Pantalla de consentimiento de OAuth** (`OAuth consent screen`): configura
   tipo **Externo**, nombre de la app, correo de soporte y dominios autorizados. Publícala (o deja
   en "testing" agregando tus correos de prueba).
2. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **Orígenes autorizados de JavaScript:** `http://localhost:4200`, tu dominio de staging/prod.
   - **URIs de redirección:** las que use el flujo del frontend.
3. Copia el **Client ID** y el **Client Secret** que genera la consola → `GOOGLE_CLIENT_ID` y
   `GOOGLE_CLIENT_SECRET`. El login con Google queda **disponible** cuando **ambos** están presentes
   (el backend valida el ID token; el secret se guarda para el flujo server-side/refresh).

| Variable | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID de OAuth (aplicación web) |
| `GOOGLE_CLIENT_SECRET` | Client Secret de OAuth (lo emite la misma consola) |

---

## 5. Resumen — qué rellenar para las pruebas de AHORA

Pagalo queda **en pausa** (la llave de sandbox no respondía). Para esta ronda de pruebas en vivo,
rellena en el **`.env` local** (dejando el resto vacío):

```dotenv
# --- Google Wallet (sandbox: emisor en modo demo) ---
WALLET_PROVIDER=google
GOOGLE_WALLET_ISSUER_ID=<issuer id de la Wallet Console>
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=<base64 del JSON de la service account>

# --- reCAPTCHA (v3 clásico) — actívalo SOLO cuando pruebes a mano en el navegador ---
RECAPTCHA_SITE_KEY=<site key>
RECAPTCHA_SECRET_KEY=<secret key>
RECAPTCHA_DISABLED=false

# --- (Opcional) Login con Google ---
GOOGLE_CLIENT_ID=<client id de OAuth web>

# --- Base GCP ---
GCLOUD_PROJECT_ID=<project id>
GCP_REGION=us-central1
```

Tras editar el `.env`, **reinicia el backend** para que reciba las variables:

```bash
docker restart pasaeventos_api
# verifica que las capacidades quedaron en true:
curl -s http://localhost:8080/api/v1/public/config | python3 -m json.tool
```

Debe verse `capabilities.googleWallet: true` y `capabilities.recaptcha: true` (y
`recaptchaSiteKey` con tu site key). Si sigue en `false`, revisa que la variable no quedó vacía y
que reiniciaste el contenedor.

> `recaptcha` solo aparece en `true` si además pusiste `RECAPTCHA_DISABLED=false`. En dev conviene
> dejarlo en `true` mientras corres el E2E de Puppeteer (el login automatizado no envía token real).

### Verlo también en `/health`

`GET /api/v1/health` ahora incluye un bloque **`integrations`** con el mismo mapa de capacidades
(qué servicio está levantado). A diferencia de `checks` (postgres/redis/…), una integración
apagada **no** baja el `status` a error — es un estado válido:

```bash
curl -s http://localhost:8080/api/v1/health | python3 -m json.tool
# → "integrations": { "googleWallet": true, "googleOAuth": true, "recaptcha": false, ... }
```

### Validación en vivo (sin navegador)

Para comprobar que las llaves realmente sirven (firma de Wallet + secret de reCAPTCHA aceptada por
Google + formato de OAuth), corre:

```bash
docker exec pasaeventos_api node /app/tools/qa/validate-google.mjs
```

Verifica la firma RS256 del pase de Google Wallet, llama a `siteverify` para confirmar que la
secret de reCAPTCHA es válida, y chequea el formato del par OAuth.

---

## 6. Almacenamiento en GCP (el "S3 de GCP" = Google Cloud Storage)

> **Cómo lo consume el software HOY:** el `StorageService` del backend usa el **SDK de S3**
> (`@aws-sdk/client-s3`) y lee SIEMPRE el bloque de variables `S3_*` (`storage.s3`). En local eso
> apunta a LocalStack; en prod se apunta a **GCS por su API compatible con S3**. El SDK **nativo**
> de GCS (con `GCS_SERVICE_ACCOUNT_JSON`) está previsto para una ola futura y **aún NO se consume**
> — o sea, para correr en GCS hoy se usan **claves HMAC de interoperabilidad**, no el JSON de la
> cuenta de servicio. (Las variables `GCS_*`/`STORAGE_PROVIDER` ya existen para esa futura ola.)

### 6.1 Crear el bucket
1. **APIs y servicios → Biblioteca** → habilita **Cloud Storage API**.
2. **Cloud Storage → Buckets → Crear**: nombre único global (p.ej. `pasaeventos-prod`), región
   `us-central1`, acceso **uniforme** (uniform bucket-level access). Anota el nombre → `S3_BUCKET`.

### 6.2 Claves HMAC de interoperabilidad (lo que el código necesita hoy)
GCS habla S3 con **claves HMAC** ligadas a una cuenta de servicio.
1. Crea (o reutiliza) una **cuenta de servicio** de storage, p.ej. `storage-app@boletera-502405.iam.gserviceaccount.com`,
   y dale el rol **Storage Object Admin** (`roles/storage.objectAdmin`) sobre el bucket (o el proyecto).
2. **Cloud Storage → Configuración → Interoperabilidad → Claves de acceso para cuentas de servicio →
   Crear clave para una cuenta de servicio**: elige la SA anterior. Se genera un **Access key** y un
   **Secret**. Cópialos.
3. En prod, estas variables (que el `StorageService` sí lee) apuntan a GCS:

| Variable | Valor |
|---|---|
| `STORAGE_PROVIDER` | `gcs` (informativo; el adaptador activo sigue siendo el S3) |
| `S3_ENDPOINT` | `https://storage.googleapis.com` |
| `S3_PUBLIC_ENDPOINT` | *(vacío — GCS ya es público-firmable)* |
| `S3_REGION` | `us-central1` (o `auto`) |
| `S3_BUCKET` | nombre del bucket |
| `S3_ACCESS_KEY_ID` | **Access key HMAC** |
| `S3_SECRET_ACCESS_KEY` | **Secret HMAC** |
| `S3_FORCE_PATH_STYLE` | `false` (GCS usa virtual-hosted style) |

4. **CORS del bucket** (para que el navegador suba el banner por PUT firmado): aplica una política
   CORS que permita `PUT` desde tu dominio. Con gcloud:
   ```bash
   gcloud storage buckets update gs://<bucket> --cors-file=cors.json
   # cors.json: [{"origin":["https://pasaeventos.com"],"method":["GET","PUT"],
   #             "responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
   ```

> Las llaves HMAC son secretos → van a **Secret Manager**, no al repo.

---

## 7. Workload Identity Federation (WIF) — CI de GitHub sin llaves estáticas

**Qué es:** en vez de exportar una llave JSON de service account a GitHub (antipatrón), WIF deja que
GitHub Actions se autentique en GCP con un **token OIDC efímero** que emite el propio GitHub. GCP
confía en ese token y deja "impersonar" a una cuenta de servicio de deploy por el tiempo del job.

### 7.1 Qué proveedor elegir (tu pregunta)
Al crear el **Workload Identity Pool** y "agregar proveedor", GCP pregunta el tipo:
**AWS · OIDC · SAML**. → **Elige `OIDC`** (GitHub Actions emite tokens **OIDC**; AWS es para roles de
AWS y SAML para IdPs corporativos).

### 7.2 Datos del proveedor OIDC
- **Issuer (URL):** `https://token.actions.githubusercontent.com`
- **Audiencia:** deja la default (o `https://github.com/<TU_ORG>`).
- **Mapeo de atributos** (assertion del token OIDC → atributos de Google):
  - `google.subject` = `assertion.sub`
  - `attribute.repository` = `assertion.repository`
  - `attribute.repository_owner` = `assertion.repository_owner`
  - `attribute.ref` = `assertion.ref`  *(opcional, para restringir por rama)*
- **Condición de atributos** (CLAVE — sin esto, cualquier repo podría impersonar tu SA):
  `assertion.repository == 'TU_ORG/TU_REPO'`  (o `assertion.repository_owner == 'TU_ORG'`).

### 7.3 Pasos gcloud (paso a paso)
```bash
PROJECT=boletera-502405
PROJNUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
REPO=TU_ORG/TU_REPO                       # p.ej. jdanielrodriguez/pasaeventos
SA=deploy@$PROJECT.iam.gserviceaccount.com

# 1) Pool
gcloud iam workload-identity-pools create github-pool \
  --project=$PROJECT --location=global --display-name="GitHub Actions"

# 2) Proveedor OIDC (issuer + mapeo + condición al repo)
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project=$PROJECT --location=global --workload-identity-pool=github-pool \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='$REPO'"

# 3) Service account de deploy + roles mínimos
gcloud iam service-accounts create deploy --project=$PROJECT --display-name="CI Deploy"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser \
            roles/secretmanager.secretAccessor roles/storage.admin; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="$ROLE"
done

# 4) Permitir que el repo (vía el pool) impersone la SA de deploy
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/github-pool/attribute.repository/$REPO"
```
El **provider name** que usarán los workflows es:
`projects/$PROJNUM/locations/global/workloadIdentityPools/github-pool/providers/github-provider`.

### 7.4 Cómo queda el workflow (reemplaza la llave por WIF)
```yaml
permissions:
  contents: read
  id-token: write            # ← necesario para pedir el token OIDC
steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/PROJNUM/locations/global/workloadIdentityPools/github-pool/providers/github-provider
      service_account: deploy@boletera-502405.iam.gserviceaccount.com
  # (ya NO se usa credentials_json / secrets.GCP_SA_KEY)
```

---

## 8. Ligar el proyecto con GCP para poder lanzar (paso a paso)

Orden sugerido (marca lo que ya exista y sáltalo):
1. **Seleccionar proyecto:** `gcloud config set project boletera-502405`.
2. **Habilitar APIs:**
   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
     cloudbuild.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com \
     storage.googleapis.com
   ```
3. **Artifact Registry** (repo docker que usan los workflows):
   ```bash
   gcloud artifacts repositories create pasaeventos-backend \
     --repository-format=docker --location=us-central1
   ```
4. **Secret Manager:** crear los secretos de runtime (uno por variable sensible). Ej.:
   ```bash
   printf '%s' "postgres://..." | gcloud secrets create pasaeventos-database-url --data-file=-
   ```
   (JWT_*, APP_ENCRYPTION_KEY, TICKET_SIGNING_SEED, MAIL_PASS, S3 HMAC, GOOGLE_WALLET_*, RECAPTCHA_*,
   PAGALO_*/RECURRENTE_* cuando existan…). Los workflows los inyectan con `--set-secrets`.
5. **WIF** (§7) — pool + provider OIDC + SA de deploy + binding al repo.
6. **Ajustar los workflows** a `boletera-502405` (`GCP_PROJECT` y la ruta de Artifact Registry) y
   cambiar la auth a WIF (§7.4). Registrar en GitHub la variable `PROD_API_URL` y el secreto
   `DEPLOY_ADMIN_TOKEN` (JWT de un admin, para la página de mantenimiento del release de prod).
7. **Cloud Run:** el primer deploy lo hacen los workflows (`staging.yml` en `develop`,
   `release-prod.yml` en `master`) creando los servicios `pasaeventos-api-staging` y
   `pasaeventos-api`. Topología objetivo: **api** (HTTP) · **worker** (BullMQ) · **ingest**
   (validación masiva RabbitMQ).
8. **Lanzar:** push/merge a `develop` → verifica staging → push/merge a `master` → release a prod.

> Nota: la provisión de infra (pasos 2–5) la coordina el arquitecto/DevOps (gcloud/Terraform).
> Esta guía es para entender y reproducir el "cableado". Detalle adicional en
> [DESPLIEGUE.md](DESPLIEGUE.md) y §5 de [INTEGRACIONES-CREDENCIALES.md](INTEGRACIONES-CREDENCIALES.md).
