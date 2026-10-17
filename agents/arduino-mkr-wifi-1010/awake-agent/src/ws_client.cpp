#include "ws_client.h"

#include <Arduino.h>
#include <string.h>

#include "log.h"

namespace {

const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 of 16 bytes: 24 chars + NUL.
void base64Key(const uint8_t in[16], char out[25]) {
  size_t o = 0;
  for (size_t i = 0; i < 16; i += 3) {
    uint32_t v = (uint32_t)in[i] << 16;
    if (i + 1 < 16) v |= (uint32_t)in[i + 1] << 8;
    if (i + 2 < 16) v |= in[i + 2];
    out[o++] = B64[(v >> 18) & 63];
    out[o++] = B64[(v >> 12) & 63];
    out[o++] = i + 1 < 16 ? B64[(v >> 6) & 63] : '=';
    out[o++] = i + 2 < 16 ? B64[v & 63] : '=';
  }
  out[o] = '\0';
}

}  // namespace

bool WsClient::connect(Client& client, const char* host, uint16_t port, const char* path, uint32_t timeoutMs) {
  if (client_) drop(1000);
  if (!client.connect(host, port)) return false;
  client_ = &client;
  rxLen_ = pending_ = 0;
  closeCode_ = 0;

  uint8_t keyBytes[16];
  for (uint8_t& b : keyBytes) b = random(256);
  char key[25];
  base64Key(keyBytes, key);

  char req[320];
  int n = snprintf(req, sizeof req,
                   "GET %s HTTP/1.1\r\nHost: %s:%u\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n",
                   path, host, port, key);
  if (n <= 0 || (size_t)n >= sizeof req || client.write((const uint8_t*)req, n) != (size_t)n) {
    LOGW("ws", "could not send the upgrade request");
    drop(1006);
    return false;
  }

  const uint32_t deadline = millis() + timeoutMs;
  char line[128];
  if (!readLine(line, sizeof line, deadline)) {
    LOGW("ws", "no answer to the upgrade request");
    drop(1006);
    return false;
  }
  if (strncmp(line, "HTTP/1.1 101", 12) != 0) {
    LOGW("ws", "upgrade refused: %s", line);
    drop(1006);
    return false;
  }
  while (readLine(line, sizeof line, deadline)) {
    if (line[0] == '\0') return true;  // end of the response headers
  }
  LOGW("ws", "incomplete upgrade response");
  drop(1006);
  return false;
}

bool WsClient::readLine(char* buf, size_t size, uint32_t deadline) {
  size_t len = 0;
  while ((int32_t)(deadline - millis()) > 0) {
    if (!client_->available()) {
      if (!client_->connected()) return false;
      delay(1);
      continue;
    }
    const int c = client_->read();
    if (c < 0) continue;
    if (c == '\n') {
      if (len > 0 && buf[len - 1] == '\r') len--;
      buf[len] = '\0';
      return true;
    }
    if (len + 1 < size) buf[len++] = (char)c;  // overlong lines are truncated
  }
  return false;
}

WsClient::Event WsClient::poll() {
  if (!client_) return NONE;
  consume(pending_);
  pending_ = 0;

  while (rxLen_ < sizeof rx_) {
    const int avail = client_->available();
    if (avail <= 0) break;
    size_t want = sizeof rx_ - rxLen_;
    if ((size_t)avail < want) want = avail;
    const int got = client_->read(rx_ + rxLen_, want);
    if (got <= 0) break;
    rxLen_ += got;
  }

  while (rxLen_ >= 2) {
    const bool fin = rx_[0] & 0x80;
    const uint8_t opcode = rx_[0] & 0x0f;
    const bool masked = rx_[1] & 0x80;
    uint64_t len = rx_[1] & 0x7f;
    size_t header = 2;
    if (len == 126) {
      if (rxLen_ < 4) break;
      len = ((uint16_t)rx_[2] << 8) | rx_[3];
      header = 4;
    } else if (len == 127) {
      if (rxLen_ < 10) break;
      len = 0;
      for (int i = 2; i < 10; i++) len = (len << 8) | rx_[i];
      header = 10;
    }
    if (masked) header += 4;  // servers don't mask, but it costs nothing to accept it
    if (len > WS_MAX_MESSAGE) {
      LOGW("ws", "message over %u bytes, closing", (unsigned)WS_MAX_MESSAGE);
      close(1009);
      return CLOSED;
    }
    const size_t frame = header + (size_t)len;
    if (rxLen_ < frame) break;  // wait for the rest

    uint8_t* payload = rx_ + header;
    if (masked) {
      const uint8_t* mask = rx_ + header - 4;
      for (size_t i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    }

    switch (opcode) {
      case 0x1:  // text
        if (!fin) {
          LOGW("ws", "fragmented message dropped");
          break;
        }
        text_ = (const char*)payload;
        textLen_ = len;
        pending_ = frame;
        return TEXT;
      case 0x8: {  // close: echo the code, then drop
        const uint16_t code = len >= 2 ? ((uint16_t)payload[0] << 8) | payload[1] : 1005;
        sendFrame(0x8, payload, len >= 2 ? 2 : 0);
        drop(code);
        return CLOSED;
      }
      case 0x9:  // ping
        sendFrame(0xA, payload, len);
        break;
      case 0x2:
        LOGW("ws", "binary frame ignored");
        break;
      default:  // pong, continuation, reserved
        break;
    }
    consume(frame);
  }

  if (!client_->connected() && client_->available() <= 0) {
    drop(1006);
    return CLOSED;
  }
  return NONE;
}

void WsClient::consume(size_t n) {
  if (n == 0) return;
  memmove(rx_, rx_ + n, rxLen_ - n);
  rxLen_ -= n;
}

bool WsClient::sendText(const char* data, size_t len) {
  if (!sendFrame(0x1, (const uint8_t*)data, len)) {
    drop(1006);
    return false;
  }
  return true;
}

bool WsClient::sendFrame(uint8_t opcode, const uint8_t* data, size_t len) {
  if (!client_ || len > 0xffff) return false;
  // Header and payload go out in chunks of one buffer: few SPI transfers to the Wi-Fi module.
  uint8_t buf[512];
  size_t n = 0;
  buf[n++] = 0x80 | opcode;
  if (len < 126) {
    buf[n++] = 0x80 | len;
  } else {
    buf[n++] = 0x80 | 126;
    buf[n++] = len >> 8;
    buf[n++] = len & 0xff;
  }
  uint8_t mask[4];
  for (uint8_t& b : mask) b = random(256);
  memcpy(buf + n, mask, 4);
  n += 4;

  size_t off = 0;
  do {
    while (n < sizeof buf && off < len) {
      buf[n++] = data[off] ^ mask[off & 3];
      off++;
    }
    if (client_->write(buf, n) != n) return false;
    n = 0;
  } while (off < len);
  return true;
}

void WsClient::close(uint16_t code) {
  if (!client_) return;
  const uint8_t payload[2] = {(uint8_t)(code >> 8), (uint8_t)(code & 0xff)};
  sendFrame(0x8, payload, 2);
  drop(code);
}

void WsClient::drop(uint16_t code) {
  if (client_) client_->stop();
  client_ = nullptr;
  closeCode_ = code;
  rxLen_ = pending_ = 0;
}
