# Awake Go agent. Recipes work with both sh and cmd.exe (GNU make on Windows): no inline VAR=x, no
# rm/cp; cross-compilation variables are set with target-specific exports instead.

VERSION ?= 0.1.0-dev
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: help check fmt vet test build cross cross-linux-arm64 cross-linux-armv7 cross-linux-armv6 cross-linux-amd64 cross-darwin-arm64 cross-windows-amd64

help:
	@echo "make check   gofmt check, go vet, go test"
	@echo "make fmt     format the code"
	@echo "make build   build awake-agent for this machine (VERSION=x.y.z to stamp it)"
	@echo "make cross   build for linux/arm64, linux/armv7, linux/armv6 (Raspberry Pi), linux/amd64, darwin/arm64, windows/amd64 into dist/"

check:
	$(if $(strip $(shell gofmt -l .)),$(error gofmt needed on: $(shell gofmt -l .)))
	go vet ./...
	go test ./...

fmt:
	gofmt -w .

vet:
	go vet ./...

test:
	go test ./...

build:
	go build -ldflags "$(LDFLAGS)" ./cmd/awake-agent

cross: cross-linux-arm64 cross-linux-armv7 cross-linux-armv6 cross-linux-amd64 cross-darwin-arm64 cross-windows-amd64

cross-linux-arm64: export GOOS=linux
cross-linux-arm64: export GOARCH=arm64
cross-linux-arm64:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-linux-arm64 ./cmd/awake-agent

cross-linux-armv7: export GOOS=linux
cross-linux-armv7: export GOARCH=arm
cross-linux-armv7: export GOARM=7
cross-linux-armv7:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-linux-armv7 ./cmd/awake-agent

cross-linux-amd64: export GOOS=linux
cross-linux-amd64: export GOARCH=amd64
cross-linux-amd64:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-linux-amd64 ./cmd/awake-agent

cross-darwin-arm64: export GOOS=darwin
cross-darwin-arm64: export GOARCH=arm64
cross-darwin-arm64:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-darwin-arm64 ./cmd/awake-agent

cross-linux-armv6: export GOOS=linux
cross-linux-armv6: export GOARCH=arm
cross-linux-armv6: export GOARM=6
cross-linux-armv6:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-linux-armv6 ./cmd/awake-agent

cross-windows-amd64: export GOOS=windows
cross-windows-amd64: export GOARCH=amd64
cross-windows-amd64:
	go build -ldflags "$(LDFLAGS)" -o dist/awake-agent-windows-amd64.exe ./cmd/awake-agent
