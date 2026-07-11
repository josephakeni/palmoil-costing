REGISTRY      ?= jakeni
TAG           ?= latest
NETWORK        = palmoil-net
HOST_IP       ?= 192.168.0.10
FRONTEND      ?= http://$(HOST_IP):3000
FRONTEND_DIR  ?= ../palmoil-costing-frontend

IMAGE_PROD     = $(REGISTRY)/palmoil-production-service:$(TAG)
IMAGE_COST     = $(REGISTRY)/palmoil-cost-service:$(TAG)
IMAGE_AUDIT    = $(REGISTRY)/palmoil-audit-service:$(TAG)
IMAGE_FRONTEND = $(REGISTRY)/palmoil-frontend:$(TAG)

.PHONY: network
network:
	docker network inspect $(NETWORK) >/dev/null 2>&1 || \
	  docker network create $(NETWORK)

.PHONY: postgres
postgres: network
	docker run -d \
	  --name palmoil-postgres \
	  --network $(NETWORK) \
	  -e POSTGRES_DB=palmoildb \
	  -e POSTGRES_USER=palmoiluser \
	  -e POSTGRES_PASSWORD=palmoilpass \
	  -v palmoil_postgres_data:/var/lib/postgresql/data \
	  -v $(PWD)/db-init/init.sql:/docker-entrypoint-initdb.d/init.sql \
	  -p 5432:5432 \
	  postgres:15

.PHONY: redis
redis: network
	docker run -d \
	  --name palmoil-redis \
	  --network $(NETWORK) \
	  -p 6379:6379 \
	  redis:7

.PHONY: kafka
kafka: network
	docker run -d \
	  --name palmoil-kafka \
	  --hostname kafka \
	  --network $(NETWORK) \
	  -e KAFKA_NODE_ID=1 \
	  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT \
	  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092 \
	  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
	  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
	  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
	  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
	  -e KAFKA_PROCESS_ROLES=broker,controller \
	  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:29093 \
	  -e KAFKA_LISTENERS=PLAINTEXT://kafka:29092,CONTROLLER://kafka:29093,PLAINTEXT_HOST://0.0.0.0:9092 \
	  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
	  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
	  -e KAFKA_LOG_DIRS=/tmp/kraft-combined-logs \
	  -e CLUSTER_ID=PaLmOiLcLuStErIdXxXxXx \
	  -p 9092:9092 \
	  confluentinc/cp-kafka:7.4.6

.PHONY: infra
infra: postgres redis kafka

.PHONY: build-production
build-production:
	docker build -t $(IMAGE_PROD) ./production-service

.PHONY: build-cost
build-cost:
	docker build -t $(IMAGE_COST) ./cost-service

.PHONY: build-audit
build-audit:
	docker build -t $(IMAGE_AUDIT) ./audit-service

.PHONY: build
build: build-production build-cost build-audit

.PHONY: run-production
run-production: network
	docker run -d \
	  --name production-service \
	  --network $(NETWORK) \
	  -e DATABASE_URL=postgresql://palmoiluser:palmoilpass@palmoil-postgres:5432/palmoildb \
	  -e FRONTEND_ORIGIN=$(FRONTEND) \
	  -p 8000:8000 \
	  $(IMAGE_PROD)

.PHONY: run-cost
run-cost: network
	docker run -d \
	  --name cost-service \
	  --network $(NETWORK) \
	  -e SPRING_DATASOURCE_URL=jdbc:postgresql://palmoil-postgres:5432/palmoildb \
	  -e SPRING_DATASOURCE_USERNAME=palmoiluser \
	  -e SPRING_DATASOURCE_PASSWORD=palmoilpass \
	  -e SPRING_JPA_HIBERNATE_DDL_AUTO=update \
	  -e KAFKA_BOOTSTRAP_SERVERS=kafka:29092 \
	  -e REDIS_HOST=palmoil-redis \
	  -e REDIS_PORT=6379 \
	  -e SERVER_PORT=8080 \
	  -e FRONTEND_ORIGIN=$(FRONTEND) \
	  -p 8080:8080 \
	  $(IMAGE_COST)

.PHONY: run-audit
run-audit: network
	docker run -d \
	  --name audit-service \
	  --network $(NETWORK) \
	  -e DATABASE_URL=postgresql://palmoiluser:palmoilpass@palmoil-postgres:5432/palmoildb \
	  -e KAFKA_BOOTSTRAP_SERVERS=kafka:29092 \
	  -e FRONTEND_ORIGIN=$(FRONTEND) \
	  -p 8001:8001 \
	  $(IMAGE_AUDIT)

.PHONY: run
run: run-production run-cost run-audit

.PHONY: build-frontend
build-frontend:
	docker build \
	  --build-arg VITE_PRODUCTION_API=http://$(HOST_IP):8000 \
	  --build-arg VITE_COST_API=http://$(HOST_IP):8080 \
	  --build-arg VITE_AUDIT_API=http://$(HOST_IP):8001 \
	  -t $(IMAGE_FRONTEND) $(FRONTEND_DIR)

.PHONY: run-frontend
run-frontend: network
	docker run -d \
	  --name palmoil-frontend \
	  --network $(NETWORK) \
	  -p 3000:80 \
	  $(IMAGE_FRONTEND)

.PHONY: build-all
build-all: build build-frontend

.PHONY: deploy
deploy: infra run run-frontend

.PHONY: stop
stop:
	docker rm -f production-service cost-service audit-service 2>/dev/null || true

.PHONY: stop-frontend
stop-frontend:
	docker rm -f palmoil-frontend 2>/dev/null || true

.PHONY: stop-infra
stop-infra:
	docker rm -f palmoil-postgres palmoil-redis palmoil-kafka 2>/dev/null || true

.PHONY: stop-all
stop-all: stop stop-frontend stop-infra
	docker network rm $(NETWORK) 2>/dev/null || true

.PHONY: restart
restart: stop run

.PHONY: logs-production
logs-production:
	docker logs -f production-service

.PHONY: logs-cost
logs-cost:
	docker logs -f cost-service

.PHONY: logs-audit
logs-audit:
	docker logs -f audit-service

.PHONY: push
push:
	docker push $(IMAGE_PROD)
	docker push $(IMAGE_COST)
	docker push $(IMAGE_AUDIT)
