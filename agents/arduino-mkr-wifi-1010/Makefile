# Awake agent for the Arduino MKR WiFi 1010. Recipes work with both sh and cmd.exe (GNU make on Windows).
# Needs arduino-cli on the PATH (or ARDUINO_CLI=<path>); the board core and libraries are pinned in
# awake-agent/sketch.yaml and installed by arduino-cli on the first build.

ARDUINO_CLI ?= arduino-cli
SKETCH := awake-agent
PORT ?=

.PHONY: help config build upload monitor

help:
	@echo "make config              create awake-agent/config.h from the example (Wi-Fi, server, token, outputs)"
	@echo "make build               compile"
	@echo "make upload PORT=COM8    compile and flash (PORT=/dev/ttyACM0 on Linux)"
	@echo "make monitor PORT=COM8   serial logs (115200 baud)"

config: $(SKETCH)/config.h

$(SKETCH)/config.h:
	node -e "require('fs').copyFileSync('$(SKETCH)/config.example.h', '$(SKETCH)/config.h')"
	@echo "Created $(SKETCH)/config.h: fill in Wi-Fi, server and token, then build."

build: $(SKETCH)/config.h
	$(ARDUINO_CLI) compile --warnings all $(SKETCH)

upload: build
	$(if $(PORT),,$(error set PORT, e.g. make upload PORT=COM8))
	$(ARDUINO_CLI) upload -p $(PORT) $(SKETCH)

monitor:
	$(if $(PORT),,$(error set PORT, e.g. make monitor PORT=COM8))
	$(ARDUINO_CLI) monitor -p $(PORT) -c baudrate=115200
