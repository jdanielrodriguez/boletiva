# Integraciones reales — cómo obtener credenciales y sandbox

Guía práctica para cada integración de la fase final (orden aprobado por el arquitecto:
**Recurrente → FEL SAT → Wallets → Pagalo → pipeline**). Cada sección dice **qué credenciales
se necesitan, cómo conseguirlas y cómo obtener el ambiente de pruebas (sandbox)**.

> ⚠️ Los portales y requisitos de cada proveedor cambian. Antes de integrar, confirmar contra la
> documentación vigente del proveedor. Aquí se marca lo que hay que **pedir/generar** y dónde.

## Cómo funciona el gating (implementado)

Todas las integraciones se **activan por variables de entorno**. El registro central
`IntegrationsService` (`api/src/infra/integrations/`) decide si cada servicio está DISPONIBLE:

- **Variable vacía → el servicio se IGNORA** (no se activa; no rompe nada).
- **Se intenta usar un servicio no configurado → 503 "Servicio no disponible"** (`assertAvailable`).
- `GET /api/v1/public/config` expone `capabilities` (qué está disponible) + `recaptchaSiteKey`,
  para que el **frontend** habilite/oculte UI según lo configurado.

Estado por integración (a hoy): **Pagalo, Google Wallet y reCAPTCHA = value-ready** (solo poner
valores). **Recurrente, FEL y Apple Wallet = env-only** (variables definidas; responden 503 hasta
completar la integración compleja). El **simulador** de pagos y el **stub** de wallet siguen siendo
el default (sin credenciales; sostienen dev/test/E2E). Todas las variables viven en `.env.example`.

---

## 1. Recurrente (pasarela principal — GTQ)

**Qué es:** pasarela de pagos guatemalteca (tarjetas Visa/Mastercard, cuotas Visacuotas/Mastercuotas,
transferencias). Liquida en quetzales a cuenta bancaria local.

### Credenciales que se necesitan
- `Public Key` y `Secret Key` de API (una pareja para **test** y otra para **producción**).
- `Webhook signing secret` (para verificar la firma de los webhooks — HMAC).

### Cómo obtenerlas
1. Crear cuenta de negocio en el panel de Recurrente (`app.recurrente.com`).
2. Completar el **KYC de negocio**: patente de comercio, NIT de la empresa, DPI del representante
   legal, y **cuenta bancaria GT** donde recibir las liquidaciones en Q.
3. En el panel, sección **Desarrolladores / API keys**: copiar las llaves. El panel separa
   **modo test** y **modo producción** — arrancar SIEMPRE en test.
4. En **Webhooks**: registrar la URL pública del backend (`https://<api>/api/v1/payments/webhook`)
   y copiar el **signing secret**. En local, exponer con un túnel (ngrok/cloudflared) o usar el
   simulador in-process que ya tenemos.

### Sandbox / pruebas
- El **modo test** del panel entrega llaves de prueba y acepta **tarjetas de prueba** (números de
  test que Recurrente documenta) sin cobro real.
- Nuestro backend ya tiene un **simulador webhook-first** detrás del puerto `PaymentProvider`
  (`SimulatorPaymentProvider`) que reproduce el flujo de Recurrente en local sin llaves. La
  integración real se conecta detrás del mismo puerto → sandbox de Recurrente para staging,
  simulador para tests automatizados.

### Requisitos innegociables del arquitecto (recordatorio)
- **Sweeper de reconciliación** de órdenes `pending` (polling `GET /transactions/:id`).
- **Tokenización PCI vía SDK de Recurrente en el frontend** (el backend solo ve el token opaco).
- **Correlation IDs** (`order.id` / hash del price_quote) en `metadata`/`reference` del cargo.

---

## 2. FEL — Factura Electrónica en Línea (SAT Guatemala)

**Qué es:** régimen obligatorio de facturación electrónica de la SAT. **No se factura directo
contra la SAT**: se emite el documento (DTE, un XML firmado) a través de un **Certificador
autorizado** que lo certifica y devuelve el **UUID de autorización + Serie + Número**.

### Credenciales que se necesitan
- **Adhesión al régimen FEL** en la SAT (por cada emisor: la plataforma y, para la doble factura,
  el promotor o un esquema de facturación por cuenta del promotor — definir con contador/abogado).
- **Contrato con un Certificador** autorizado por SAT. Ejemplos de certificadores en el mercado:
  Infile, Digifact, Guatefacturas, Megaprint, entre otros.
- Del certificador: **credenciales de API** (usuario/llave/token según el proveedor) para el
  ambiente de **certificación (pruebas)** y para **producción**.

### Cómo obtenerlas
1. La empresa se **adhiere a FEL** en la **Agencia Virtual de la SAT** (requiere NIT, usuario SAT).
2. **Contratar un certificador** y firmar el contrato de servicio.
3. El certificador entrega el **kit de integración**: credenciales, endpoints, XSD del DTE y un
   **ambiente de pruebas/certificación** con **NITs de prueba**.

### Sandbox / pruebas
- Cada certificador ofrece su **ambiente de certificación (pruebas)** con NITs y series de prueba;
  se certifican DTEs sin validez fiscal para validar el flujo end-to-end.
- Para tests automatizados: **stub del certificador** detrás de un puerto `FelCertifier` (a crear,
  igual que `PaymentProvider`), que en test devuelve UUID/serie/número simulados.

### Requisitos innegociables del arquitecto (recordatorio)
- **Emisión ASÍNCRONA** por BullMQ — la factura NUNCA bloquea la entrega del boleto (DLQ + reintentos).
- **Doble factura**: plataforma factura su comisión, promotor factura el neto → **2 DTEs por orden**;
  el schema de la orden guarda **DOS** juegos de (UUID + Serie + Número).
- **Fallback NIT→CF**: NIT inválido/cancelado → atrapar el rechazo y recertificar como **CF**
  (Consumidor Final), para no atascar la cola.
- **Correlation ID** en las **observaciones del XML**.

---

## 3. Wallets — Apple Wallet (.pkpass) + Google Wallet

**Qué es:** pases del boleto en la billetera del teléfono, con **código de barras rotativo**
(modelo SafeTix — el screenshot no sirve). Ya existe `WalletProvider` con **stub sandbox**;
las credenciales reales se conectan detrás del mismo puerto.

### Apple Wallet (.pkpass)
Credenciales:
- **Apple Developer Program** (USD $99/año) — cuenta de la empresa.
- **Pass Type ID** + **certificado de firma** del pase.
- Certificado **WWDR** de Apple (cadena de confianza).

Cómo obtenerlas:
1. Inscribir la empresa en el **Apple Developer Program** (`developer.apple.com`).
2. En **Certificates, Identifiers & Profiles → Identifiers → Pass Type IDs**: crear un Pass Type ID
   (`pass.com.pasaeventos.ticket`).
3. Generar el **Pass Type ID Certificate** (CSR desde Keychain) y descargar el `.cer`; exportar el
   `.p12` para firmar los `.pkpass` en el backend.
4. Descargar el **Apple WWDR certificate**.

Sandbox/pruebas: Apple **no tiene un sandbox formal** de Wallet; se prueba generando `.pkpass`
firmados e instalándolos en un iPhone/simulador real. El **push de actualización** del código
rotativo usa APNs (requiere el mismo certificado/clave).

### Google Wallet
Credenciales:
- **Proyecto en Google Cloud** con la **Google Wallet API** habilitada.
- **Cuenta de Emisor (Issuer ID)** en la **Google Pay & Wallet Console**.
- **Service Account** (clave JSON) para firmar los JWT de "Save to Google Wallet".

Cómo obtenerlas:
1. En Google Cloud: crear proyecto y **habilitar la Google Wallet API**.
2. En la **Google Pay & Wallet Console** (`pay.google.com/business/console`): solicitar una
   **cuenta de emisor** (Issuer ID) y **solicitar acceso de producción** (aprobación de Google).
3. Crear un **Service Account** con clave JSON; con esa clave el backend firma el JWT del botón
   "Guardar en Google Wallet" y crea las clases/objetos de pase vía la API.

Sandbox/pruebas: la cuenta de emisor arranca en **modo demo/test** (los pases muestran una marca
"[TEST]") hasta que Google **aprueba producción**. Suficiente para probar todo el flujo.

> Gestión en paralelo (no bloquea): mientras llegan certificados Apple y la aprobación de Google,
> el `WalletProvider` sigue con stub/sandbox y la PWA de validación offline cubre el caso.

---

## 4. Pagalo / PagaloCard (pasarela alternativa / failover — GT) — VALUE-READY

**Qué es:** pasarela guatemalteca (PagaloCard). Integrada como **failover** detrás del puerto
`PaymentProvider` (`PagaloPaymentProvider`), seleccionable por config `PAYMENT_PROVIDER=pagalo`
(default sigue siendo el simulador). Contrato real extraído del legacy `ticketera`/`tiketera` y
validado contra `https://docs.pagalo.co/`.

### Contrato real (implementado)
- Endpoint: `POST https://{DOMINIO}/api/v1/integracion/{CREDENCIAL}` (sandbox `DOMINIO=sandbox.pagalocard.com`).
- Body (form) con campos JSON-string: `empresa` = `{ key_public, key_secret, idenEmpresa }`;
  `cliente` = `{ codigo, firstName, lastName, street1, country:'GT', city, state, email, ipAddress,
  Total, currency:'GTQ', postalCode, phone, deviceFingerprintID }`; `tarjetaPagalo` = **token opaco
  del SDK cliente** (PCI) o datos de tarjeta; `detalle` = `{ id_producto, cantidad, nombre, precio,
  Subtotal }`. Como el flujo es **webhook-first**, al aprobar sincrónicamente el provider entrega un
  webhook `payment.succeeded` firmado in-process → dispara el fulfillment sin cambios (en prod
  PagaloCard puede además notificar a `/payments/webhook`).

### Variables (`.env`) — vacío = NO DISPONIBLE (503)
- `PAGALO_CREDENCIAL` (segmento de la URL), `PAGALO_DOMINIO` (host), `PAGALO_ESTADO` (sandbox|produccion)
  → **los tiene el usuario** para sandbox.
- `PAGALO_KEY_PUBLIC`, `PAGALO_KEY_SECRET`, `PAGALO_IDEN_EMPRESA` → llaves de empresa, **desde GCP
  Secret Manager**. `PAGALO_WEBHOOK_SECRET` opcional.

### Cómo obtenerlas
1. Cuenta de comercio PagaloCard + KYC (NIT, patente, cuenta bancaria GT); el proveedor entrega la
   **Credencial**, el **dominio** y el **estado** (sandbox/prod), y las **llaves de empresa**.
2. Guardar las llaves de empresa en GCP Secret Manager; poner credencial/dominio/estado en el `.env`.

### Sandbox / pruebas
- `PAGALO_DOMINIO=sandbox.pagalocard.com` + credencial de sandbox + tarjetas de prueba de PagaloCard.
- Tests automatizados: siguen con el **simulador** (default); el `PagaloPaymentProvider` se cubre con
  unit tests mockeando `fetch`.

---

## 5b. Captcha — Google reCAPTCHA (anti-abuso)

**Qué es:** protección anti-bots en endpoints sensibles (registro, login, recuperar
contraseña, solicitud de promotor, checkout). El frontend obtiene un **token** del
widget/SDK de Google y el backend lo **verifica** contra Google antes de procesar.

### Credenciales que se necesitan
- **Site key** (pública, va en el frontend).
- **Secret key** (privada, va en el backend para la verificación server-side).
- Alternativa **reCAPTCHA Enterprise**: se administra dentro de un **proyecto de Google
  Cloud** (una *API key* + el ID del proyecto), no con el par site/secret clásico.

### Cómo obtenerlas
1. Ir a la **consola de administración de reCAPTCHA** (`google.com/recaptcha/admin`) con la
   cuenta Google del proyecto.
2. Registrar el sitio: elegir **reCAPTCHA v3** (score, sin fricción; recomendado) o **v2**
   ("no soy un robot"); agregar los **dominios** (incluir `localhost` para dev).
3. Copiar la **site key** y la **secret key**. Para Enterprise: habilitar la **reCAPTCHA
   Enterprise API** en el proyecto GCP y crear la **key** ahí (es "el token del proyecto de
   Google" que se usa como site key).
4. Backend: guardar la **secret** en Secret Manager; verificar cada token contra
   `https://www.google.com/recaptcha/api/siteverify` (v3: exigir `success` + `score` mínimo +
   `action` esperada).

### Sandbox / pruebas
- Google publica **llaves de prueba de reCAPTCHA v2** que **siempre pasan** (site/secret de
  test), ideales para dev/CI sin fricción.
- Para tests automatizados: puerto `CaptchaVerifier` con un **stub** que aprueba en `test`
  (igual que `PaymentProvider`/`WalletProvider`), y el verificador real detrás en staging/prod.

### Dónde aplicarlo
- Endpoints de abuso: `signup`, `login`, `forgot-password`, `promoters/apply`, y opcionalmente
  el inicio de checkout. El frontend adjunta el token; el backend lo exige y verifica.

---

## 5. Pipeline — GitHub Actions + Cloud Run (deploy)

No son "credenciales de proveedor de negocio" sino accesos de infraestructura.

### Qué se necesita
- **Proyecto GCP** (staging y prod) con **Cloud Run**, **Artifact Registry** y **Cloud Build**
  habilitados.
- **Workload Identity Federation** entre GitHub Actions y GCP (evita llaves estáticas — GitHub se
  autentica con OIDC contra un pool de identidad de GCP).
- **Service Account de deploy** con roles mínimos (Cloud Run Admin, Artifact Registry Writer,
  Service Account User).
- **GCP Secret Manager** con los secretos de runtime (todas las llaves de arriba: Recurrente, FEL,
  wallets, JWT, etc.) inyectados a Cloud Run con `--set-secrets` (12-factor).

### Cómo obtenerlas
1. Crear los proyectos GCP y habilitar las APIs.
2. Crear el **Workload Identity Pool + Provider** para el repo de GitHub y el **Service Account**
   de deploy; darle los roles mínimos.
3. En GitHub: guardar el `workload_identity_provider` y el `service_account` como **secrets del repo**
   (no llaves JSON).
4. Cargar los secretos de runtime en **Secret Manager**; el workflow despliega con path-filtering
   (solo si cambió `api/` o `frontend/`), tras `test → build → tag`.

### Sandbox / pruebas
- El **entorno de staging** (proyecto GCP aparte) ES el "sandbox" del pipeline: se despliega ahí
  primero, se corre el smoke/E2E, y solo con OK se promociona a prod.
- Requisito del arquitecto: **los tests deben auto-limpiarse** (hoy el E2E de puppeteer deja el
  evento demo suspendido → resembrar; esto se cierra antes del pipeline).
