#pragma once

#include <stdint.h>
#include <stddef.h>

#ifndef DEBUG_AGENT_ENABLED
#define DEBUG_AGENT_ENABLED 1
#endif

// Timing and budget definitions
#define DEBUG_UPDATE_BUDGET_US    200
#define DEBUG_MAX_UPDATE_US       1000
#define DEBUG_MAX_CHUNK_WRITE     512
#define DEBUG_BUFFER_SIZE         8192
#define DEBUG_MAX_MESSAGE_SIZE    512
#define DEBUG_METRIC_INTERVAL     1000
#define DEBUG_RECONNECT_MS        3000
#define DEBUG_CONNECT_TIMEOUT_MS  3000

// Version
#define DEBUG_AGENT_VERSION       "0.1.0.1"

// Log levels
enum DebugLogLevel : uint8_t {
    DEBUG_LEVEL_TRACE = 0,
    DEBUG_LEVEL_DEBUG = 1,
    DEBUG_LEVEL_INFO  = 2,
    DEBUG_LEVEL_WARN  = 3,
    DEBUG_LEVEL_ERROR = 4,
    DEBUG_LEVEL_NONE  = 5
};

// Transport state machine
enum DebugTransportState : uint8_t {
    DEBUG_STATE_DISABLED = 0,
    DEBUG_STATE_WAIT_WIFI,
    DEBUG_STATE_DISCONNECTED,
    DEBUG_STATE_CONNECTING,
    DEBUG_STATE_CONNECTED,
    DEBUG_STATE_BACKOFF
};

// Handshake substate
enum DebugHandshakeState : uint8_t {
    DEBUG_HANDSHAKE_IDLE = 0,
    DEBUG_HANDSHAKE_SEND_HELLO,
    DEBUG_HANDSHAKE_STREAMING
};

// Configuration struct
struct DebugConfig {
    const char* host;
    uint16_t port;
    const char* deviceName;
    const char* appName;
    const char* appVersion;
    char bootId[17];
    uint8_t minLevel;
    uint32_t metricIntervalMs;
    uint32_t reconnectIntervalMs;
    uint32_t connectTimeoutMs;
    size_t bufferSize;
    bool usePsram;
    bool allowSramFallback;

    DebugConfig()
        : host("192.168.1.10"),
          port(9000),
          deviceName("CoreS3-01"),
          appName("BasicDiagnostics"),
          appVersion(DEBUG_AGENT_VERSION),
          minLevel(DEBUG_LEVEL_TRACE),
          metricIntervalMs(DEBUG_METRIC_INTERVAL),
          reconnectIntervalMs(DEBUG_RECONNECT_MS),
          connectTimeoutMs(DEBUG_CONNECT_TIMEOUT_MS),
          bufferSize(DEBUG_BUFFER_SIZE),
          usePsram(true),
          allowSramFallback(false) {
        bootId[0] = '\0';
    }
};

// Comprehensive statistics struct
struct DebugStats {
    // Message counters
    uint32_t messagesAttempted;
    uint32_t messagesEnqueued;
    uint32_t messagesSent;
    uint32_t messagesDropped;
    uint32_t messagesTruncated;
    uint32_t bytesSent;

    // Buffer counters
    uint32_t bufferUsed;
    uint32_t bufferCapacity;
    uint32_t bufferHighWatermark;
    uint32_t pendingMessages;

    // Transport counters
    uint32_t connectAttempts;
    uint32_t successfulConnections;
    uint32_t reconnects;
    uint32_t socketErrors;

    // Performance & cooperative budget counters
    uint32_t updateCalls;
    uint32_t avgUpdateUs;
    uint32_t maxUpdateUs;
    uint32_t minUpdateUs;
    uint32_t budgetOverruns;      // > 200 µs
    uint32_t updateOverruns1ms;   // > 1000 µs

    // Memory counters
    size_t sramUsed;
    size_t psramUsed;

    // Compatibility aliases matching v0.1.0 fields
    uint32_t queued;
    uint32_t sent;
    uint32_t dropped;
    uint32_t truncated;

    DebugStats()
        : messagesAttempted(0),
          messagesEnqueued(0),
          messagesSent(0),
          messagesDropped(0),
          messagesTruncated(0),
          bytesSent(0),
          bufferUsed(0),
          bufferCapacity(DEBUG_BUFFER_SIZE),
          bufferHighWatermark(0),
          pendingMessages(0),
          connectAttempts(0),
          successfulConnections(0),
          reconnects(0),
          socketErrors(0),
          updateCalls(0),
          avgUpdateUs(0),
          maxUpdateUs(0),
          minUpdateUs(0),
          budgetOverruns(0),
          updateOverruns1ms(0),
          sramUsed(0),
          psramUsed(0),
          queued(0),
          sent(0),
          dropped(0),
          truncated(0) {}

    void syncAliases() {
        queued = messagesEnqueued;
        sent = bytesSent;
        dropped = messagesDropped;
        truncated = messagesTruncated;
    }
};
