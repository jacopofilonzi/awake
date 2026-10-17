#include "watchdog.h"

#include <Arduino.h>

void watchdogEnable() {
  // Generic clock 2 = internal ultra-low-power 32.768 kHz oscillator / 32 = 1024 Hz.
  GCLK->GENDIV.reg = GCLK_GENDIV_ID(2) | GCLK_GENDIV_DIV(4);  // DIVSEL: divide by 2^(4+1)
  GCLK->GENCTRL.reg = GCLK_GENCTRL_ID(2) | GCLK_GENCTRL_GENEN | GCLK_GENCTRL_SRC_OSCULP32K | GCLK_GENCTRL_DIVSEL;
  while (GCLK->STATUS.bit.SYNCBUSY) {
  }
  GCLK->CLKCTRL.reg = GCLK_CLKCTRL_ID_WDT | GCLK_CLKCTRL_CLKEN | GCLK_CLKCTRL_GEN_GCLK2;

  WDT->CTRL.reg = 0;
  while (WDT->STATUS.bit.SYNCBUSY) {
  }
  WDT->CONFIG.reg = WDT_CONFIG_PER_16K;  // 16384 cycles at 1024 Hz = 16 s
  WDT->CTRL.reg = WDT_CTRL_ENABLE;
  while (WDT->STATUS.bit.SYNCBUSY) {
  }
}

void watchdogFeed() {
  // Writing CLEAR while a previous write is still synchronizing would stall the CPU: skip that round.
  if (!WDT->STATUS.bit.SYNCBUSY) WDT->CLEAR.reg = WDT_CLEAR_CLEAR_KEY;
}
