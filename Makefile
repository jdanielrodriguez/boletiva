# =====================================================================
# Pasa Eventos — Makefile
# Regla de oro: los comandos de la app SIEMPRE corren dentro del contenedor.
# =====================================================================
COMPOSE      = docker compose -f docker-compose.local.yml
COMPOSE_TEST = docker compose -f docker-compose.local.yml -f docker-compose.test.yml
API          = pasaeventos_api
FRONT        = pasaeventos_frontend
DB           = pasaeventos_db
NETWORK      = pasaeventos_network
K6_IMAGE     = grafana/k6:latest

.PHONY: network-create
network-create:
	docker network inspect pasaeventos_network >/dev/null 2>&1 || \
		docker network create --gateway 172.16.0.1 --subnet 172.16.0.0/24 pasaeventos_network

.PHONY: volumes-create
volumes-create:
	docker volume inspect pasaeventos_pg_data >/dev/null 2>&1        || docker volume create pasaeventos_pg_data
	docker volume inspect pasaeventos_redis_data >/dev/null 2>&1     || docker volume create pasaeventos_redis_data
	docker volume inspect pasaeventos_localstack_data >/dev/null 2>&1 || docker volume create pasaeventos_localstack_data

.PHONY: init
init: network-create volumes-create
	$(COMPOSE) build
	$(COMPOSE) up -d

.PHONY: init-test
init-test: network-create volumes-create
	$(COMPOSE_TEST) build
	$(COMPOSE_TEST) up -d

.PHONY: start
start:
	$(COMPOSE) up -d

.PHONY: stop
stop:
	$(COMPOSE) stop

.PHONY: down
down:
	$(COMPOSE) down

.PHONY: rebuild
rebuild:
	$(COMPOSE) up -d --build --force-recreate --renew-anon-volumes

.PHONY: logs
logs:
	$(COMPOSE) logs -f --tail=120 $(API)

.PHONY: ps
ps:
	$(COMPOSE) ps

# --- Prisma / base de datos (dentro del contenedor) ---
.PHONY: prisma-generate
prisma-generate:
	docker exec $(API) npx prisma generate

.PHONY: migrate
migrate:
	docker exec $(API) npx prisma migrate dev

.PHONY: db-push
db-push:
	docker exec $(API) npx prisma db push

.PHONY: seed
seed:
	docker exec $(API) npm run db:seed

# --- Tests y validación ---
.PHONY: test
test:
	docker exec $(API) npx nx test api --coverage

.PHONY: test-all
test-all:
	docker exec $(API) npx nx run-many -t test

.PHONY: smoke
smoke:
	docker exec $(API) npm run smoke

# --- Frontend Angular (dentro del contenedor pasaeventos_frontend) ---
.PHONY: front-logs
front-logs:
	$(COMPOSE) logs -f --tail=120 $(FRONT)

.PHONY: front-shell
front-shell:
	docker exec -it $(FRONT) /bin/bash

.PHONY: front-test
front-test:
	docker exec $(FRONT) npm test -- --watch=false

.PHONY: front-lint
front-lint:
	docker exec $(FRONT) npm run lint

# Regenera el SDK tipado del backend a partir de docs/openapi.json.
.PHONY: gen-api
gen-api:
	docker exec $(FRONT) npm run gen:api

# E2E de cara al usuario (Puppeteer) contra el stack real: catálogo, detalle/SEO,
# 404, login con 2FA (OTP de MailHog) y compra completa hasta el pago por SSE.
# Requiere PAYMENT_SIMULATOR_AUTO_CONFIRM=true en .env (dev).
.PHONY: e2e
e2e:
	docker exec $(API) node /app/tools/e2e/e2e.mjs

# --- Pruebas de carga (K6) del on-sale ---
# make load                      # ciclo completo: seed 10k + spike + verificación
# VUS=10000 DURATION=5s make load-test   # spike real (staging)
.PHONY: load-seed
load-seed:
	docker exec $(API) npm run db:seed:stadium

.PHONY: load-test
load-test:
	docker run --rm --network $(NETWORK) -v $(PWD)/load:/load \
		-e VUS=$${VUS:-200} -e DURATION=$${DURATION:-20s} -e HOT=$${HOT:-500} \
		$(K6_IMAGE) run /load/checkout-spike.js

.PHONY: load-verify
load-verify:
	docker exec -i -e PGPASSWORD=pasaeventos $(DB) \
		psql -U pasaeventos -d pasaeventos < load/verify.sql

.PHONY: load
load: load-seed load-test load-verify

# --- Shells ---
.PHONY: node-shell
node-shell:
	docker exec -it $(API) /bin/bash

.PHONY: db-shell
db-shell:
	docker exec -it pasaeventos_db psql -U pasaeventos -d pasaeventos

.PHONY: redis-shell
redis-shell:
	docker exec -it pasaeventos_redis redis-cli

.PHONY: rabbit-shell
rabbit-shell:
	docker exec -it pasaeventos_rabbitmq /bin/sh

.PHONY: localstack-shell
localstack-shell:
	docker exec -it pasaeventos_localstack /bin/bash

# --- Deploy (Cloud Run). La key debe venir de un secreto del CI, no del repo. ---
.PHONY: deploy
deploy:
	@echo "Autenticando y desplegando a Google Cloud Run..."
	gcloud config set project $(PROD_PROJECT)
	gcloud builds submit --tag us-central1-docker.pkg.dev/$(PROD_PROJECT)/pasaeventos-backend/api:latest .
	gcloud run deploy pasaeventos-api \
		--image us-central1-docker.pkg.dev/$(PROD_PROJECT)/pasaeventos-backend/api:latest \
		--region us-central1 --platform managed --allow-unauthenticated

# ============================================================================
# Operaciones de PRODUCCIÓN (requieren `gcloud` autenticado en el proyecto y
# acceso de red a la BD — vía Cloud SQL Auth Proxy o IP autorizada). Ver docs/GUIA-GCP.md §10-11.
# ============================================================================
PROD_PROJECT ?= boletera-502405
PROD_DB_SECRET ?= pasaeventos-database-url

# Lee el DATABASE_URL de prod desde Secret Manager (falla si no hay acceso).
define _prod_db_url
$$(gcloud secrets versions access latest --secret=$(PROD_DB_SECRET) --project=$(PROD_PROJECT) 2>/dev/null)
endef

# Siembra/actualiza la baseline en PROD (NO borra). Para el 1er arranque.
.PHONY: prod-db-seed
prod-db-seed:
	@URL="$(call _prod_db_url)"; [ -n "$$URL" ] || { echo '❌ No pude leer $(PROD_DB_SECRET) (¿gcloud autenticado?)'; exit 1; }; \
	echo "→ Sembrando baseline en PROD ($(PROD_PROJECT))…"; \
	docker exec -e DATABASE_URL="$$URL" -w /app $(API) sh -lc 'npx prisma db push --accept-data-loss && npm run db:seed'

# ⚠️ DESTRUCTIVO: borra TODA la data de PROD y re-siembra la baseline (pruebas alpha).
.PHONY: prod-db-reset
prod-db-reset:
	@printf '⚠️  Esto BORRA TODA la data de PROD ($(PROD_PROJECT)) y re-siembra la baseline.\n   Escribe RESET para continuar: '; \
	read ans; [ "$$ans" = "RESET" ] || { echo 'Cancelado.'; exit 1; }; \
	URL="$(call _prod_db_url)"; [ -n "$$URL" ] || { echo '❌ No pude leer $(PROD_DB_SECRET)'; exit 1; }; \
	echo "→ Truncando + resembrando PROD…"; \
	docker exec -e DATABASE_URL="$$URL" -w /app $(API) sh -lc 'npx prisma db push --accept-data-loss && npx ts-node --project tsconfig.tools.json prisma/truncate.ts && npm run db:seed'

# --- Logs de PROD limpios (sin ruido) ---
.PHONY: prod-logs
prod-logs:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=pasaeventos-api AND severity>=INFO AND NOT jsonPayload.req.url:"/health"' \
		--project=$(PROD_PROJECT) --limit=100 --freshness=1h \
		--format='value(timestamp, severity, jsonPayload.msg, jsonPayload.err.message)'

.PHONY: prod-logs-follow
prod-logs-follow:
	gcloud beta logging tail 'resource.type=cloud_run_revision AND resource.labels.service_name=pasaeventos-api AND NOT jsonPayload.req.url:"/health"' \
		--project=$(PROD_PROJECT) --format='value(timestamp, severity, jsonPayload.msg)'

.PHONY: prod-logs-errors
prod-logs-errors:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=pasaeventos-api AND severity>=ERROR' \
		--project=$(PROD_PROJECT) --limit=50 --freshness=6h \
		--format='value(timestamp, jsonPayload.msg, jsonPayload.err.stack)'

# ============================================================================
# Costos GCP: poda de Artifact Registry (driver #1 del gasto idle) + dormir/
# despertar la BD de PROD (en alpha es válido apagarla cuando nadie prueba).
# Requieren `gcloud` autenticado en el proyecto.
# ============================================================================
AR_REPO      ?= us-central1-docker.pkg.dev/$(PROD_PROJECT)/pasaeventos-backend
KEEP_IMAGES  ?= 3
# Instancia de Cloud SQL de PROD (defínela: PROD_SQL_INSTANCE=<nombre> make gcp-prod-sleep).
PROD_SQL_INSTANCE ?=

# Borra imágenes VIEJAS de Artifact Registry (api + frontend), conservando las
# KEEP_IMAGES más recientes de cada una. Artifact Registry cobra por almacenamiento:
# acumular cada build sin podar es lo que engorda la factura idle.
.PHONY: gcp-clean-images
gcp-clean-images:
	@echo "🧹 Podando Artifact Registry en $(AR_REPO) (conservar $(KEEP_IMAGES) por imagen)…"
	@for img in api frontend; do \
	  echo "→ $$img:"; \
	  gcloud artifacts docker images list "$(AR_REPO)/$$img" \
	    --project=$(PROD_PROJECT) --sort-by=~CREATE_TIME --format='value(version)' 2>/dev/null \
	    | tail -n +$$(( $(KEEP_IMAGES) + 1 )) \
	    | while read -r digest; do \
	        [ -n "$$digest" ] || continue; \
	        echo "   borrando $$img@$$digest"; \
	        gcloud artifacts docker images delete "$(AR_REPO)/$$img@$$digest" \
	          --project=$(PROD_PROJECT) --delete-tags --quiet || true; \
	      done; \
	done
	@echo "✅ Poda terminada."

# Muestra cuánto ocupa cada imagen (para ver el ahorro antes/después).
.PHONY: gcp-images-list
gcp-images-list:
	@for img in api frontend; do \
	  echo "=== $$img ==="; \
	  gcloud artifacts docker images list "$(AR_REPO)/$$img" \
	    --project=$(PROD_PROJECT) --sort-by=~CREATE_TIME \
	    --format='table(version.slice(7:19), createTime.date(), sizeBytes.size())' 2>/dev/null; \
	done

# Duerme la BD de PROD (solo paga disco). En alpha es válido apagarla cuando nadie prueba.
# Despierta con gcp-prod-wake (levanta en segundos con los datos intactos).
.PHONY: gcp-prod-sleep
gcp-prod-sleep:
	@[ -n "$(PROD_SQL_INSTANCE)" ] || { echo '❌ Define PROD_SQL_INSTANCE=<instancia Cloud SQL>'; exit 1; }
	gcloud sql instances patch $(PROD_SQL_INSTANCE) --activation-policy NEVER --project=$(PROD_PROJECT)
	@echo "💤 Cloud SQL PROD '$(PROD_SQL_INSTANCE)' detenida (solo se cobra el disco)."

.PHONY: gcp-prod-wake
gcp-prod-wake:
	@[ -n "$(PROD_SQL_INSTANCE)" ] || { echo '❌ Define PROD_SQL_INSTANCE=<instancia Cloud SQL>'; exit 1; }
	gcloud sql instances patch $(PROD_SQL_INSTANCE) --activation-policy ALWAYS --project=$(PROD_PROJECT)
	@echo "☀️  Cloud SQL PROD '$(PROD_SQL_INSTANCE)' encendida."
