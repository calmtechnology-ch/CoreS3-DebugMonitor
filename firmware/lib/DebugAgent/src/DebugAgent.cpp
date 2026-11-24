#include "DebugAgent.h"

#if DEBUG_AGENT_ENABLED

#include <esp_timer.h>
#include <esp_heap_caps.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

DebugAgent debug;

DebugAgent::DebugAgent()
    : _seq(0),
      _lastMetricMs(0),
      _lastStatsMs(0),
      _initialized(false),
      _updateTotalUs(0),
      _memBeforeAgentSram(0),
      _memAfterBeginSram(0),
      _memAfterTcpSram(0) {}

DebugAgent::~DebugAgent() {
    end();
}

bool DebugAgent::begin(const DebugConfig& config) {
    _memBeforeAgentSram = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    _config = config;
    _seq = 0;
    _lastMetricMs = millis();
    _lastStatsMs = millis();
    _updateTotalUs = 0;
    _stats = DebugStats();

    // Generate unique bootId if not provided
    if (_config.bootId[0] == '\0') {
        uint8_t mac[6] = {0};
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        uint32_t rnd = esp_random();
        snprintf(_config.bootId, sizeof(_config.bootId), "%02X%02X%02X%02X%08X",
                 mac[2], mac[3], mac[4], mac[5], (unsigned int)rnd);
    }

    // Initialize circular buffer in PSRAM
    if (!_buffer.init(_config.bufferSize, _config.usePsram, _config.allowSramFallback)) {
        return false;
    }

    _stats.bufferCapacity = _buffer.getCapacity();
    if (_buffer.isPsram()) {
        _stats.psramUsed = _buffer.getCapacity();
        _stats.sramUsed = sizeof(DebugAgent);
    } else {
        _stats.psramUsed = 0;
        _stats.sramUsed = sizeof(DebugAgent) + _buffer.getCapacity();
    }

    if (!_transport.begin(_config, &_buffer, &_stats, &_seq)) {
        _buffer.cleanup();
        return false;
    }

    _memAfterBeginSram = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    _initialized = true;
    return true;
}

void DebugAgent::end() {
    if (!_initialized) return;

    portENTER_CRITICAL(&_mux);
    _initialized = false;
    portEXIT_CRITICAL(&_mux);

    _transport.end();
    _buffer.cleanup();
    _stats.sramUsed = 0;
    _stats.psramUsed = 0;
}

const char* DebugAgent::getBootId() const {
    return _config.bootId;
}

void DebugAgent::enqueueWithSeq(char* lineBuf, size_t len, size_t seqOffset) {
    if (!_initialized || len == 0) return;

    // Fast, thread-safe sequence number assignment & buffer push under short critical section
    portENTER_CRITICAL(&_mux);
    uint32_t mySeq = ++_seq;
    char* p = lineBuf + seqOffset;
    uint32_t temp = mySeq;
    for (int i = 9; i >= 0; --i) {
        p[i] = '0' + (temp % 10);
        temp /= 10;
    }

    _buffer.push(lineBuf, len, &_stats);
    portEXIT_CRITICAL(&_mux);
}

void DebugAgent::update() {
    if (!_initialized) return;

    int64_t startUs = esp_timer_get_time();

    _transport.update(DEBUG_UPDATE_BUDGET_US, startUs);

    sendPeriodicMetrics(startUs);

    if (_transport.isConnected() && _memAfterTcpSram == 0) {
        _memAfterTcpSram = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }

    int64_t elapsedUs = esp_timer_get_time() - startUs;
    if (elapsedUs >= 0) {
        _stats.updateCalls++;
        _updateTotalUs += (uint64_t)elapsedUs;
        _stats.avgUpdateUs = (uint32_t)(_updateTotalUs / _stats.updateCalls);

        uint32_t us32 = (uint32_t)elapsedUs;
        if (us32 > _stats.maxUpdateUs) {
            _stats.maxUpdateUs = us32;
        }
        if (_stats.updateCalls == 1 || us32 < _stats.minUpdateUs) {
            _stats.minUpdateUs = us32;
        }

        if (us32 > DEBUG_UPDATE_BUDGET_US) {
            _stats.budgetOverruns++;
        }
        if (us32 > DEBUG_MAX_UPDATE_US) {
            _stats.updateOverruns1ms++;
        }
    }

    _stats.syncAliases();
}

void DebugAgent::sendPeriodicMetrics(int64_t startUs) {
    // Check remaining budget before formatting metrics
    int64_t elapsedUs = esp_timer_get_time() - startUs;
    if (elapsedUs >= (int64_t)DEBUG_UPDATE_BUDGET_US) return;

    uint32_t now = millis();
    if (now - _lastMetricMs >= _config.metricIntervalMs) {
        _lastMetricMs = now;

        if (_transport.isConnected()) {
            char metricBuf[320];
            uint32_t freeHeap = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            uint32_t minHeap = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            uint32_t maxAlloc = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            uint32_t freePsram = psramFound() ? heap_caps_get_free_size(MALLOC_CAP_SPIRAM) : 0;
            int32_t rssi = (WiFi.status() == WL_CONNECTED) ? (int32_t)WiFi.RSSI() : 0;

            int len = DebugProtocol::formatMetrics(metricBuf, sizeof(metricBuf),
                0, now, freeHeap, minHeap, maxAlloc, freePsram, rssi,
                _stats.avgUpdateUs, _stats.maxUpdateUs, _stats.minUpdateUs,
                _stats.budgetOverruns, _stats.updateOverruns1ms);

            if (len > 0) {
                // "{\"type\":\"metrics\",\"seq\":0000000000," -> offset 24
                // Let's verify: strlen("{\"type\":\"metrics\",\"seq\":") == 24
                enqueueWithSeq(metricBuf, (size_t)len, 24);
            }

            // Periodic internal stats (every 2 seconds)
            if (now - _lastStatsMs >= 2000) {
                _lastStatsMs = now;
                char statsBuf[384];
                int slen = DebugProtocol::formatStats(statsBuf, sizeof(statsBuf), 0, now, _stats);
                if (slen > 0) {
                    // "{\"type\":\"stats\",\"seq\":0000000000," -> offset 22
                    enqueueWithSeq(statsBuf, (size_t)slen, 22);
                }
            }
        }
    }
}

void DebugAgent::log(uint8_t level, const char* tag, const char* message) {
    if (!_initialized || level < _config.minLevel) return;
    if (xPortInIsrContext()) return; // Logging is strictly prohibited from an ISR

    _stats.messagesAttempted++;

    char lineBuf[DEBUG_MAX_MESSAGE_SIZE + 128];
    bool truncated = false;
    // formatLogWithSeq puts "0000000000" at seq position (offset 20)
    int len = DebugProtocol::formatLogWithSeq(lineBuf, sizeof(lineBuf),
                                             0, millis(), level, tag, message, &truncated);

    if (truncated) {
        _stats.messagesTruncated++;
    }

    if (len > 0) {
        enqueueWithSeq(lineBuf, (size_t)len, 20);
    }
}

void DebugAgent::logf(uint8_t level, const char* tag, const char* format, ...) {
    if (!_initialized || level < _config.minLevel) return;
    if (xPortInIsrContext()) return;

    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);

    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }

    log(level, tag, msgBuf);
}

void DebugAgent::trace(const char* tag, const char* message) {
    log(DEBUG_LEVEL_TRACE, tag, message);
}

void DebugAgent::tracef(const char* tag, const char* format, ...) {
    if (!_initialized || DEBUG_LEVEL_TRACE < _config.minLevel) return;
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }
    log(DEBUG_LEVEL_TRACE, tag, msgBuf);
}

void DebugAgent::debug(const char* tag, const char* message) {
    log(DEBUG_LEVEL_DEBUG, tag, message);
}

void DebugAgent::debugf(const char* tag, const char* format, ...) {
    if (!_initialized || DEBUG_LEVEL_DEBUG < _config.minLevel) return;
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }
    log(DEBUG_LEVEL_DEBUG, tag, msgBuf);
}

void DebugAgent::info(const char* tag, const char* message) {
    log(DEBUG_LEVEL_INFO, tag, message);
}

void DebugAgent::infof(const char* tag, const char* format, ...) {
    if (!_initialized || DEBUG_LEVEL_INFO < _config.minLevel) return;
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }
    log(DEBUG_LEVEL_INFO, tag, msgBuf);
}

void DebugAgent::warn(const char* tag, const char* message) {
    log(DEBUG_LEVEL_WARN, tag, message);
}

void DebugAgent::warnf(const char* tag, const char* format, ...) {
    if (!_initialized || DEBUG_LEVEL_WARN < _config.minLevel) return;
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }
    log(DEBUG_LEVEL_WARN, tag, msgBuf);
}

void DebugAgent::error(const char* tag, const char* message) {
    log(DEBUG_LEVEL_ERROR, tag, message);
}

void DebugAgent::errorf(const char* tag, const char* format, ...) {
    if (!_initialized || DEBUG_LEVEL_ERROR < _config.minLevel) return;
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written < 0 || written >= (int)sizeof(msgBuf)) {
        _stats.messagesTruncated++;
        msgBuf[sizeof(msgBuf) - 1] = '\0';
    }
    log(DEBUG_LEVEL_ERROR, tag, msgBuf);
}

void DebugAgent::metric(const char* name, double value) {
    if (!_initialized) return;
    if (xPortInIsrContext()) return;
    _stats.messagesAttempted++;

    char lineBuf[160];
    int len = DebugProtocol::formatCustomMetric(lineBuf, sizeof(lineBuf), 0, millis(), name, value);
    if (len > 0) {
        // "{\"type\":\"metric\",\"seq\":0000000000," -> offset 23
        enqueueWithSeq(lineBuf, (size_t)len, 23);
    }
}

void DebugAgent::metric(const char* name, int32_t value) {
    metric(name, (double)value);
}

void DebugAgent::metric(const char* name, uint32_t value) {
    metric(name, (double)value);
}

void DebugAgent::state(const char* name, const char* value) {
    if (!_initialized) return;
    if (xPortInIsrContext()) return;
    _stats.messagesAttempted++;

    char lineBuf[192];
    int len = DebugProtocol::formatState(lineBuf, sizeof(lineBuf), 0, millis(), name, value);
    if (len > 0) {
        // "{\"type\":\"state\",\"seq\":0000000000," -> offset 22
        enqueueWithSeq(lineBuf, (size_t)len, 22);
    }
}

bool DebugAgent::isConnected() const {
    return _initialized && _transport.isConnected();
}

DebugStats DebugAgent::getStats() const {
    return _stats;
}

const char* DebugAgent::getStateString() const {
    if (!_initialized) return "DISABLED";
    return _transport.getStateString();
}

void DebugAgent::printReport(Print& out) {
    out.println("========================================================");
    out.println(" CoreS3-DebugMonitor v0.1.0.1");
    out.println(" NON-BLOCKING & MEMORY RELIABILITY REPORT");
    out.println("========================================================");
    out.println("");
    out.println("[DEVICE]");
    out.printf("Firmware: %s (%s)\n", _config.appName, _config.appVersion);
    out.printf("BootId: %s\n", _config.bootId);
    out.printf("Uptime: %lu ms\n", (unsigned long)millis());
    out.printf("Wi-Fi RSSI: %ld dBm\n", (long)(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0));
    out.printf("Transport state: %s\n", getStateString());
    out.println("");
    out.println("[MEMORY]");
    out.printf("SRAM before DebugAgent: %u bytes\n", (unsigned int)_memBeforeAgentSram);
    out.printf("SRAM after begin: %u bytes\n", (unsigned int)_memAfterBeginSram);
    out.printf("SRAM after TCP connection: %u bytes\n", (unsigned int)_memAfterTcpSram);
    out.printf("SRAM current: %u bytes\n", (unsigned int)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    out.printf("SRAM minimum: %u bytes\n", (unsigned int)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    out.printf("Largest free SRAM block: %u bytes\n", (unsigned int)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    out.printf("PSRAM allocated: %u bytes\n", (unsigned int)_stats.psramUsed);
    out.printf("Static footprint: %u bytes (sizeof DebugAgent)\n", (unsigned int)_stats.sramUsed);
    out.println("");
    out.println("[BUFFER]");
    out.printf("Capacity: %lu bytes\n", (unsigned long)_stats.bufferCapacity);
    out.printf("Current usage: %lu bytes\n", (unsigned long)_stats.bufferUsed);
    out.printf("High watermark: %lu bytes\n", (unsigned long)_stats.bufferHighWatermark);
    out.printf("Pending messages: %lu\n", (unsigned long)_stats.pendingMessages);
    out.printf("Dropped messages: %lu\n", (unsigned long)_stats.messagesDropped);
    out.printf("Truncated messages: %lu\n", (unsigned long)_stats.messagesTruncated);
    out.println("");
    out.println("[TRANSPORT]");
    out.printf("Connection attempts: %lu\n", (unsigned long)_stats.connectAttempts);
    out.printf("Successful connections: %lu\n", (unsigned long)_stats.successfulConnections);
    out.printf("Reconnects: %lu\n", (unsigned long)_stats.reconnects);
    out.printf("Socket errors: %lu\n", (unsigned long)_stats.socketErrors);
    out.printf("Messages sent: %lu\n", (unsigned long)_stats.messagesSent);
    out.printf("Bytes sent: %lu\n", (unsigned long)_stats.bytesSent);
    out.println("");
    out.println("[PERFORMANCE]");
    out.printf("Update calls: %lu\n", (unsigned long)_stats.updateCalls);
    out.printf("Average update: %lu us\n", (unsigned long)_stats.avgUpdateUs);
    out.printf("Maximum update: %lu us\n", (unsigned long)_stats.maxUpdateUs);
    out.printf("Minimum update: %lu us\n", (unsigned long)_stats.minUpdateUs);
    out.printf("Budget overruns (> 200 us): %lu\n", (unsigned long)_stats.budgetOverruns);
    out.printf("Overruns above 1 ms: %lu\n", (unsigned long)_stats.updateOverruns1ms);
    out.println("");
    out.println("========================================================");
}

#else

DebugAgent debug;

#endif
