# Awake — common tasks. Run `make` or `make help` for the list.
# Recipes must work in sh and cmd.exe: no inline VAR=x, no rm/cp/mkdir -p (use node -e).
# Each agent has its own build (agents/go/Makefile): these targets delegate to it.

AGENT_DIR := agents/go
AGENT_CONFIG := awake-agent.toml

.DEFAULT_GOAL := help
.PHONY: help install dev dev-backend dev-frontend build start test check reset-password \
        up down logs \
        agent agent-dry agent-test agent-build clean

help:
	@echo "Server"
	@echo "  make install         install dependencies"
	@echo "  make dev             backend (:8080) + web UI with hot reload (http://localhost:5173)"
	@echo "  make dev-backend     backend only"
	@echo "  make dev-frontend    web UI only (proxies /api and /agent to :8080)"
	@echo "  make build           build the web UI (frontend/dist) and the backend bundle"
	@echo "  make start           run the bundle (reads .env)"
	@echo "  make test            backend and agent tests"
	@echo "  make check           typecheck backend + web UI, gofmt, go vet, go test (must pass)"
	@echo "  make reset-password ACCOUNT=admin   print a new temporary password for a user"
	@echo ""
	@echo "Server with Docker"
	@echo "  make up / down / logs     up = pull the published image and start it"
	@echo ""
	@echo "Go agent ($(AGENT_DIR), configured by $(AGENT_DIR)/$(AGENT_CONFIG))"
	@echo "  make agent           run it (simulated outputs, console on stdin)"
	@echo "  make agent-dry       run it without sending magic packets"
	@echo "  make agent-test      go test"
	@echo "  make agent-build     cross-compile into $(AGENT_DIR)/dist"
	@echo ""
	@echo "Arduino MKR WiFi 1010 agent (needs arduino-cli; not part of make check)"
	@echo "  make -C agents/arduino-mkr-wifi-1010 config | build | upload PORT=COM8 | monitor PORT=COM8"
	@echo ""
	@echo "  make clean           remove build output"

# ---------- server ----------

node_modules: package.json package-lock.json
	npm install
	@node -e "require('fs').utimesSync('node_modules', new Date(), new Date())"

install:
	npm install
	cd $(AGENT_DIR) && go mod download

dev: node_modules
	npm run dev

dev-backend: node_modules
	npm run dev -w backend

dev-frontend: node_modules
	npm run dev -w frontend

build: node_modules
	npm run build

start: build
	npm start

test: node_modules
	npm test
	$(MAKE) -C $(AGENT_DIR) test

check: node_modules
	npm run check
	$(MAKE) -C $(AGENT_DIR) check

reset-password: node_modules
	@node -e "if (!process.argv[1]) { console.error('usage: make reset-password ACCOUNT=<username>'); process.exit(1) }" "$(ACCOUNT)"
	npm run cli -w backend -- reset-password $(ACCOUNT)

# ---------- Docker ----------

up:
	docker compose pull
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f awake

# ---------- Go agent ----------

$(AGENT_DIR)/$(AGENT_CONFIG):
	node -e "require('fs').copyFileSync('$(AGENT_DIR)/awake-agent.example.toml', '$(AGENT_DIR)/$(AGENT_CONFIG)')"
	@echo "Created $(AGENT_DIR)/$(AGENT_CONFIG): set the token (or AWAKE_TOKEN) and run again."

agent: $(AGENT_DIR)/$(AGENT_CONFIG)
	cd $(AGENT_DIR) && go run ./cmd/awake-agent -config $(AGENT_CONFIG)

agent-dry: $(AGENT_DIR)/$(AGENT_CONFIG)
	cd $(AGENT_DIR) && go run ./cmd/awake-agent -config $(AGENT_CONFIG) -dry-run

agent-test:
	$(MAKE) -C $(AGENT_DIR) test

agent-build:
	$(MAKE) -C $(AGENT_DIR) cross

clean:
	node -e "for (const d of ['backend/dist', 'frontend/dist', '$(AGENT_DIR)/dist']) require('fs').rmSync(d, { recursive: true, force: true })"
