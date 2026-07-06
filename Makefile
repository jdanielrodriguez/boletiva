# =====================================================================
# Pasa Eventos — Makefile
# Regla de oro: los comandos de la app SIEMPRE corren dentro del contenedor.
# =====================================================================
COMPOSE      = docker compose -f docker-compose.local.yml
COMPOSE_TEST = docker compose -f docker-compose.local.yml -f docker-compose.test.yml
API          = pasaeventos_api

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
	gcloud config set project pasa-eventos
	gcloud builds submit --tag us-central1-docker.pkg.dev/pasa-eventos/pasaeventos-backend/api:latest .
	gcloud run deploy pasaeventos-api \
		--image us-central1-docker.pkg.dev/pasa-eventos/pasaeventos-backend/api:latest \
		--region us-central1 --platform managed --allow-unauthenticated
