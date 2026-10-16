# Awake — common tasks. Run `make` or `make help` for the list.
# Recipes must work in sh and cmd.exe: no inline VAR=x, no rm/cp/mkdir -p (use node scripts).

AGENT_DIR := agents/go
AGENT_CONFIG := awake-agent.toml

.DEFAULT_GOAL := help
.PHONY: help install dev build start test check reset-password \
        up down logs \
        agent agent-dry agent-test agent-build clean

help:
	@echo "Server"
	@echo "  make install         install dependencies"
	@echo "  make dev             backend with reload on :8080 (reads .env)"
	@echo "  make build           bundle the backend into backend/dist"
	@echo "  make start           run the bundle (reads .env)"
	@echo "  make test            backend and agent tests"
	@echo "  make check           typecheck, go vet, gofmt (must pass before declaring work done)"
	@echo "  make reset-password ACCOUNT=admin   print a new temporary password for a user"
	@echo ""
	@echo "Server with Docker"
	@echo "  make up / down / logs"
	@echo ""
	@echo "Go agent ($(AGENT_DIR), configured by $(AGENT_DIR)/$(AGENT_CONFIG))"
	@echo "  make agent           run it (simulated outputs, console on stdin)"
	@echo "  make agent-dry       run it without sending magic packets"
	@echo "  make agent-test      go test"
	@echo "  make agent-build     cross-compile into $(AGENT_DIR)/bin"
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

build: node_modules
	npm run build

start: build
	npm start

test: node_modules
	npm test
	cd $(AGENT_DIR) && go test ./...

check: node_modules
	npm run check
	node scripts/check-go.mjs $(AGENT_DIR)

reset-password: node_modules
	@node -e "if (!process.argv[1]) { console.error('usage: make reset-password ACCOUNT=<username>'); process.exit(1) }" "$(ACCOUNT)"
	npm run cli -w backend -- reset-password $(ACCOUNT)

# ---------- Docker ----------

up:
	docker compose up -d --build

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
	cd $(AGENT_DIR) && go test ./...

agent-build:
	node scripts/build-agent.mjs $(AGENT_DIR)

clean:
	node -e "for (const d of ['backend/dist', '$(AGENT_DIR)/bin']) require('fs').rmSync(d, { recursive: true, force: true })"
