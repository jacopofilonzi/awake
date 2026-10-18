# Awake agent for the ESP32 D1 mini. Recipes work with both sh and cmd.exe (GNU make on Windows).
# Needs arduino-cli on the PATH (or ARDUINO_CLI=<path>); the board core and libraries are pinned in
# awake-agent/sketch.yaml and installed by arduino-cli on the first build. No configuration file: Wi-Fi,
# server, token and outputs are entered on the board's setup page.

ARDUINO_CLI ?= arduino-cli
SKETCH := awake-agent
PORT ?=

.PHONY: help build bin upload monitor

help:
	@echo "make build               compile (build/ holds the binaries)"
	@echo "make bin                 compile and write dist/: <name>-install.bin (flash at 0x0, wipes the setup)"
	@echo "                         and <name>-update.bin (flash at 0x10000, keeps the setup)"
	@echo "make upload PORT=COM5    compile and flash (PORT=/dev/ttyUSB0 on Linux)"
	@echo "make monitor PORT=COM5   serial logs (115200 baud)"

build:
	$(ARDUINO_CLI) compile --warnings all --export-binaries --output-dir build $(SKETCH)

# install: the merged image (bootloader + partitions + app), flashed at 0x0. It covers the whole flash, the
# saved setup (NVS at 0x9000) included, which it wipes. update: the app alone, flashed at 0x10000 (app0 in
# the min_spiffs partition table): the setup is kept.
bin: build
	node -e "const fs=require('fs');const v=/AWAKE_FIRMWARE_VERSION \"([^\"]+)\"/.exec(fs.readFileSync('$(SKETCH)/src/version.h','utf8'))[1];const n='dist/awake-agent-esp32-d1-mini-'+v;fs.mkdirSync('dist',{recursive:true});fs.copyFileSync('build/$(SKETCH).ino.merged.bin',n+'-install.bin');fs.copyFileSync('build/$(SKETCH).ino.bin',n+'-update.bin');console.log(n+'-install.bin '+n+'-update.bin')"

upload: build
	$(if $(PORT),,$(error set PORT, e.g. make upload PORT=COM5))
	$(ARDUINO_CLI) upload -p $(PORT) --input-dir build $(SKETCH)

monitor:
	$(if $(PORT),,$(error set PORT, e.g. make monitor PORT=COM5))
	$(ARDUINO_CLI) monitor -p $(PORT) -c baudrate=115200
