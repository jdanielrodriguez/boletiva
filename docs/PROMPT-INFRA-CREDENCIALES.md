# Prompt para Claude web — crear infraestructura y obtener credenciales reales (Boletiva)

> Pega TODO el bloque de abajo en claude.ai. Está escrito para que Claude actúe como
> operador de infraestructura: valida lo que ya existe, crea lo que falta y te entrega
> los valores reales listos para pegar. **Excluye FEL, Recurrente, Pagalo y Apple Wallet**
> (esos van después; los pagos siguen en el simulador y FEL apagado).
>
> Dale a Claude web acceso a una terminal (computer use / conector con `gcloud` y `aws`
> instalados y autenticados) para que ejecute. Si no puede ejecutar, el prompt lo obliga
> a darte los comandos exactos y pedirte que pegues las salidas, y luego arma el resultado.

---

```
Actúa como mi ingeniero DevOps para lanzar la primera versión ALPHA de "Boletiva"
(boletera de eventos, GTQ, zona horaria America/Guatemala). Backend NestJS en Cloud Run,
frontend Angular SSR, Postgres, Redis, GCS. Vamos a crear/obtener TODAS las credenciales
reales de GCP y AWS necesarias para desplegar, EXCEPTO pagos y facturación.

## Datos fijos
- GCP project id: boletera-502405
- Región GCP: us-central1
- Dominio: boletiva.com (DNS gestionado en Hostinger)
- Repo GitHub: jdanielrodriguez/boletiva  (ramas master/develop)
- Región AWS SES sugerida: us-east-1

## Reglas
1. IDEMPOTENTE: antes de crear algo, VERIFICA si ya existe (gcloud/aws describe/list).
   Si existe, reúsalo y dímelo; no dupliques ni sobrescribas sin avisar.
2. NO crear ni tocar nada de: FEL, Recurrente, Pagalo, Apple Wallet. Los pagos quedan
   en simulador (PAYMENT_PROVIDER=simulator) y FEL apagado (variables vacías).
3. Antes de cualquier acción que genere COSTO recurrente (Cloud SQL, Memorystore) o
   que sea difícil de revertir, muéstrame el comando y PÍDEME confirmación.
4. Si tienes terminal: ejecuta y pega las salidas. Si NO: dame el comando exacto,
   pídeme que lo corra y pegue la salida, y sigue.
5. Trata los secretos con cuidado: los valores finales van a GCP Secret Manager y a un
   archivo .env.prod local; no los repitas innecesariamente en el chat.
6. Al final entrégame: (a) un .env.prod COMPLETO con los valores reales, (b) los comandos
   `gcloud secrets create` para cada secreto, (c) las variables/secrets a registrar en
   GitHub, y (d) un checklist de validación post-deploy.

## Estado que debes VALIDAR primero (dime qué hay y qué falta)
- ¿El proyecto boletera-502405 existe y tiene billing enabled?
- ¿Qué APIs están habilitadas? (run, sqladmin, redis, secretmanager, storage,
  iamcredentials, artifactregistry, walletobjects, cloudresourcemanager, compute)
- ¿Existen ya: Artifact Registry repo, Cloud SQL, Memorystore, bucket GCS, secretos en
  Secret Manager, pool/proveedor WIF, service accounts?
- En AWS: ¿el dominio boletiva.com ya está verificado en SES? ¿la cuenta está en sandbox?

## Recursos a CREAR/OBTENER (con el nombre EXACTO de variable de la app)

### A. GCP — base
1. Habilitar APIs faltantes (lista de arriba).
2. Artifact Registry (Docker) repo `pasaeventos-backend` en us-central1.

### B. GCP — datos y colas
3. Cloud SQL PostgreSQL 16 (tier pequeño p/alpha, p.ej. db-custom-1-3840 o db-f1-micro):
   instancia `pasaeventos-pg`, base `pasaeventos`, usuario `pasaeventos` con password fuerte.
   → Entrega DATABASE_URL = postgresql://USER:PASS@/pasaeventos?host=/cloudsql/CONN o vía
     IP privada; usa el formato que aplique a Cloud Run (socket unix del Cloud SQL connector).
4. Memorystore for Redis (tier Basic, 1GB): instancia `pasaeventos-redis`.
   → Entrega REDIS_URL = redis://HOST:6379
5. RabbitMQ: NO montar en GCP. Crea una cuenta gratuita en CloudAMQP (plan free
   "Little Lemur") y entrega AMQP_URL. (La app lo exige al arrancar aunque el ingest de
   validación no se use aún; el free tier basta.)

### C. GCP — almacenamiento
6. Bucket GCS privado `pasaeventos-prod-media` (uniform access, region us-central1).
7. Service Account `pasaeventos-storage` con rol roles/storage.objectAdmin SOLO en ese
   bucket; genera su llave JSON.
   → GCS_SERVICE_ACCOUNT_JSON = (contenido del JSON en UNA línea)
   → GCLOUD_PROJECT_ID = boletera-502405 ; GCS_BUCKET = pasaeventos-prod-media ;
     STORAGE_PROVIDER = gcs

### D. GCP — Google Wallet (sin costo ni comisión por transacción)
8. Habilitar Google Wallet API (walletobjects). Crear/confirmar Issuer ID en Google Pay &
   Wallet Console. Service Account con acceso al emisor + llave JSON.
   → GOOGLE_WALLET_ISSUER_ID = ... ; GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = (JSON 1 línea)
   (Ver docs/GUIA-GCP.md §2. Apple Wallet se OMITE: requiere Apple Developer $99/año.)

### E. GCP — reCAPTCHA v3 (clásico) y (opcional) login con Google
9. reCAPTCHA v3 para boletiva.com → RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY.
10. (Opcional) OAuth Client ID web para "login con Google" → GOOGLE_CLIENT_ID +
    GOOGLE_CLIENT_SECRET. Si no lo quieres ahora, déjalos vacíos.

### F. AWS SES (correo transaccional; dev seguirá en MailHog)
11. En SES región us-east-1: verificar el DOMINIO boletiva.com (Easy DKIM → 3 CNAME en
    Hostinger) + SPF (TXT) + DMARC (TXT en _dmarc). Dame los registros DNS exactos a crear.
12. Solicitar "production access" (salir del sandbox) con caso de uso transaccional.
13. Crear credenciales SMTP de SES.
    → MAIL_HOST = email-smtp.us-east-1.amazonaws.com ; MAIL_PORT = 587 ; MAIL_SECURE = false ;
      MAIL_FROM = "Boletiva <no-reply@boletiva.com>" ; MAIL_USER = <SMTP username> ;
      MAIL_PASS = <SMTP password>

### G. Secretos que se GENERAN (no vienen de un proveedor) — créalos fuertes al azar
- JWT_ACCESS_SECRET, JWT_REFRESH_SECRET  → 2 cadenas aleatorias de 48+ bytes base64.
- APP_ENCRYPTION_KEY  → 32 bytes en HEX (64 chars): `openssl rand -hex 32`
- TICKET_SIGNING_SEED → 32 bytes en HEX (64 chars): `openssl rand -hex 32`
  (TICKET_SIGNING_KEY_ID = prod-ed25519-1)
- PAYMENT_WEBHOOK_SECRET → cadena aleatoria (aunque el simulador; el webhook la valida).

### H. CI/CD — Workload Identity Federation (deploy sin llaves)
14. Crear WIF: pool + proveedor OIDC de GitHub con la CONDICIÓN entre comillas
    `assertion.repository == 'jdanielrodriguez/boletiva'` (el error común es ponerla sin
    comillas). Service Account de deploy con roles mínimos (run.admin, sqladmin.client,
    artifactregistry.writer, secretmanager.secretAccessor, iam.serviceAccountUser) y
    binding para que el repo la impersone. (Ver docs/GUIA-GCP.md §7.)
    → Registrar en GitHub → Settings → Secrets and variables → Actions:
      variables: WIF_PROVIDER, WIF_SERVICE_ACCOUNT, PROD_API_URL (https://<url de Cloud Run o api.boletiva.com>)
      secret:    DEPLOY_ADMIN_TOKEN (un JWT de acceso de un usuario admin; se obtiene tras
                 sembrar la BD y loguear al admin — te doy el paso cuando la API esté arriba)

## Entregables finales (arma esto al terminar)
1) `.env.prod` con TODAS las variables reales rellenadas (deja vacías FEL_*, RECURRENTE_*,
   PAGALO_*, APPLE_* ; PAYMENT_PROVIDER=simulator ; NODE_ENV=production ; CORS_ORIGINS=
   https://boletiva.com ; TRUST_PROXY=1).
2) Los comandos `gcloud secrets create` para: database-url, redis-url, amqp-url, mail-user,
   mail-pass, jwt-access-secret, jwt-refresh-secret, gcs-sa-json, app-encryption-key,
   ticket-signing-seed, payment-webhook-secret, google-wallet-sa-json (y recaptcha-secret
   si aplica). Prefijo de nombre: `pasaeventos-...`.
3) La lista de registros DNS (CNAME/TXT) que debo crear en Hostinger para SES.
4) Checklist de validación: desplegar, abrir /api/v1/health y confirmar
   integrations.googleWallet=true, recaptcha según lo configurado, y que un signup dispara
   un correo real por SES.

Empieza VALIDANDO el estado actual (sección "Estado que debes validar") y dame un
resumen de qué existe y qué vas a crear ANTES de crear nada que cueste.
```
