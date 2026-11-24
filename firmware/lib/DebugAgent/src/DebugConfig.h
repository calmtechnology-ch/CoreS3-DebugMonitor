#pragma once

#include <stdint.h>
#include <stddef.h>

#ifndef DEBUG_AGENT_ENABLED
#define DEBUG_AGENT_ENABLED 1
#endif

// Initial buffer and timing configuration
#define DEBUG_BUFFER_SIZE         8192
#define DEBUG_MAX_MESSAGE_SIZE    512
#define DEBUG_METRIC_INTERVAL     1000
#define DEBUG_RECONNECT_MS        3000
#define DEBUG_MAX_CHUNK_WRITE     1024
#define DEBUG_UPDATE_BUDGET_US    200

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

// Configuration struct
struct DebugConfig {
    const char* host;
    uint16_t port;
    const char* deviceName;
    const char* appName;
    const char* appVersion;
    uint8_t minLevel;
    uint32_t metricIntervalMs;
    uint32_t reconnectIntervalMs;
    size_t bufferSize;
    bool usePsram;

    DebugConfig()
        : host("192.168.1.10"),
          port(9000),
          deviceName("CoreS3-01"),
          appName("BasicDiagnostics"),
          appVersion("0.1.0"),
          minLevel(DEBUG_LEVEL_TRACE),
          metricIntervalMs(DEBUG_METRIC_INTERVAL),
          reconnectIntervalMs(DEBUG_RECONNECT_MS),
          bufferSize(DEBUG_BUFFER_SIZE),
          usePsram(true) {}
};

// Statistics struct
struct DebugStats {
    uint32_t queued;
    uint32_t sent;
    uint32_t dropped;
    uint32_t truncated;
    uint32_t reconnects;
    uint32_t avgUpdateUs;
    uint32_t maxUpdateUs;
    size_t sramUsed;
    size_t psramUsed;

    DebugStats()
        : queued(0),
          sent(0),
          dropped(0),
          truncated(0),
          reconnects(0),
          avgUpdateUs(0),
          maxUpdateUs(0),
          sramUsed(0),
          psramUsed(0) {}
};
