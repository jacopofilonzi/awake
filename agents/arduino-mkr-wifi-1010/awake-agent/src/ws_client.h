#pragma once

#include <Arduino.h>  // `using namespace arduino`
#include <api/Client.h>
#include <stddef.h>
#include <stdint.h>

// Minimal WebSocket client (RFC 6455) over an Arduino Client (WiFiClient or WiFiSSLClient), limited to
// what the Awake protocol needs:
// - unfragmented text frames up to WS_MAX_MESSAGE bytes (the protocol's limit; the server never fragments);
// - close frames keep their status code, which drives the agent's backoff (PROTOCOL.md §7);
// - pings are answered, pongs and binary frames dropped.
// Written instead of ArduinoHttpClient's WebSocketClient, which truncates outgoing messages at 128 bytes
// and discards the close code. The Sec-WebSocket-Accept header is not verified (it needs SHA-1 and only
// guards against non-WebSocket servers): the server is authenticated by TLS, the agent by its token.

constexpr size_t WS_MAX_MESSAGE = 8192;

class WsClient {
 public:
  enum Event : uint8_t { NONE, TEXT, CLOSED };

  // Opens the TCP/TLS connection and performs the HTTP upgrade. Blocks up to timeoutMs for the answer.
  bool connect(Client& client, const char* host, uint16_t port, const char* path, uint32_t timeoutMs);

  // Non-blocking. TEXT: text()/textLength() hold the message until the next poll(). CLOSED: the
  // connection is gone, closeCode() says why (1006 when it dropped without a close frame).
  Event poll();
  const char* text() const { return text_; }
  size_t textLength() const { return textLen_; }
  uint16_t closeCode() const { return closeCode_; }

  bool sendText(const char* data, size_t len);
  // Sends a close frame with this code and drops the connection.
  void close(uint16_t code);
  bool isOpen() const { return client_ != nullptr; }

 private:
  bool sendFrame(uint8_t opcode, const uint8_t* data, size_t len);
  bool readLine(char* buf, size_t size, uint32_t deadline);
  void consume(size_t n);
  void drop(uint16_t code);

  Client* client_ = nullptr;
  uint8_t rx_[WS_MAX_MESSAGE + 16];
  size_t rxLen_ = 0;
  size_t pending_ = 0;  // bytes of the frame returned by the last poll(), removed at the next one
  const char* text_ = nullptr;
  size_t textLen_ = 0;
  uint16_t closeCode_ = 0;
};
