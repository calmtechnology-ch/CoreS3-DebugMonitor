#include "DebugAgent.h"

#if DEBUG_AGENT_ENABLED

#include <esp_timer.h>
#include <esp_heap_caps.h>

DebugAgent debug;

DebugAgent::DebugAgent()
    : _seq(0),
      _lastMetricMs(0),
      _lastStatsMs(0),
      _initialized(false),
      _updateCount(0),
      _updateTotalUs(0),
      _maxUpdateUs(0) {}

DebugAgent::~DebugAgent() {
    end();
}

bool DebugAgent::begin(const DebugConfig& config) {
    _config = config;
    _seq = 0;
    _lastMetricMs = millis();
    _lastStatsMs = millis();
    _updateCount = 0;
    _updateTotalUs = 0;
    _maxUpdateUs = 0;
    _stats = DebugStats();

    if (!_buffer.init(_config.bufferSize, _config.usePsram)) {
        return false;
    }

    if (_buffer.isPsram()) {
        _stats.psramUsed = _config.bufferSize;
        _stats.sramUsed = sizeof(DebugAgent);
    } else {
        _stats.psramUsed = 0;
        _stats.sramUsed = sizeof(DebugAgent) + _config.bufferSize;
    }

    if (!_transport.begin(_config, &_buffer, &_stats, &_seq)) {
        _buffer.cleanup();
        return false;
    }

    _initialized = true;
    return true;
}

void DebugAgent::end() {
    if (!_initialized) return;
    _transport.end();
    _buffer.cleanup();
    _initialized = false;
    _stats.sramUsed = 0;
    _stats.psramUsed = 0;
}

void DebugAgent::enqueueLine(const char* line, size_t len) {
    if (!_initialized || len == 0) return;
    _stats.queued++;
    _buffer.push(line, len, _stats.dropped);
}

void DebugAgent::update() {
    if (!_initialized) return;

    int64_t startUs = esp_timer_get_time();

    _transport.update(DEBUG_UPDATE_BUDGET_US);

    sendPeriodicMetrics();

    int64_t elapsedUs = esp_timer_get_time() - startUs;
    if (elapsedUs > 0) {
        _updateTotalUs += (uint64_t)elapsedUs;
        _updateCount++;
        uint32_t us32 = (uint32_t)elapsedUs;
        if (us32 > _maxUpdateUs) {
            _maxUpdateUs = us32;
        }
        _stats.avgUpdateUs = (uint32_t)(_updateTotalUs / _updateCount);
        _stats.maxUpdateUs = _maxUpdateUs;
    }
}

void DebugAgent::sendPeriodicMetrics() {
    uint32_t now = millis();
    if (now - _lastMetricMs >= _config.metricIntervalMs) {
        _lastMetricMs = now;

        if (_transport.isConnected()) {
            char metricBuf[256];
            uint32_t freeHeap = ESP.getFreeHeap();
            uint32_t minHeap = ESP.getMinFreeHeap();
            uint32_t maxAlloc = ESP.getMaxAllocHeap();
            uint32_t freePsram = ESP.getFreePsram();
            int32_t rssi = (WiFi.status() == WL_CONNECTED) ? (int32_t)WiFi.RSSI() : 0;

            int len = DebugProtocol::formatMetrics(metricBuf, sizeof(metricBuf),
                ++_seq, now, freeHeap, minHeap, maxAlloc, freePsram, rssi,
                _stats.avgUpdateUs, _stats.maxUpdateUs);

            if (len > 0) {
                enqueueLine(metricBuf, (size_t)len);
            }

            // Periodic internal stats
            if (now - _lastStatsMs >= 2000) {
                _lastStatsMs = now;
                char statsBuf[192];
                int slen = DebugProtocol::formatStats(statsBuf, sizeof(statsBuf),
                    _stats.queued, _stats.dropped, _stats.truncated, _stats.reconnects);
                if (slen > 0) {
                    enqueueLine(statsBuf, (size_t)slen);
                }
            }
        }
    }
}

void DebugAgent::log(uint8_t level, const char* tag, const char* message) {
    if (!_initialized || level < _config.minLevel) return;

    char lineBuf[DEBUG_MAX_MESSAGE_SIZE + 128];
    int len = DebugProtocol::formatLog(lineBuf, sizeof(lineBuf),
        ++_seq, millis(), level, tag, message);

    if (len > 0) {
        if ((size_t)len >= sizeof(lineBuf) - 1) {
            _stats.truncated++;
        }
        enqueueLine(lineBuf, (size_t)len);
    }
}

void DebugAgent::logf(uint8_t level, const char* tag, const char* format, ...) {
    if (!_initialized || level < _config.minLevel) return;

    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);

    if (written >= (int)sizeof(msgBuf)) {
        _stats.truncated++;
    }

    log(level, tag, msgBuf);
}

void DebugAgent::trace(const char* tag, const char* message) {
    log(DEBUG_LEVEL_TRACE, tag, message);
}

void DebugAgent::tracef(const char* tag, const char* format, ...) {
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written >= (int)sizeof(msgBuf)) _stats.truncated++;
    log(DEBUG_LEVEL_TRACE, tag, msgBuf);
}

void DebugAgent::debug(const char* tag, const char* message) {
    log(DEBUG_LEVEL_DEBUG, tag, message);
}

void DebugAgent::debugf(const char* tag, const char* format, ...) {
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written >= (int)sizeof(msgBuf)) _stats.truncated++;
    log(DEBUG_LEVEL_DEBUG, tag, msgBuf);
}

void DebugAgent::info(const char* tag, const char* message) {
    log(DEBUG_LEVEL_INFO, tag, message);
}

void DebugAgent::infof(const char* tag, const char* format, ...) {
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written >= (int)sizeof(msgBuf)) _stats.truncated++;
    log(DEBUG_LEVEL_INFO, tag, msgBuf);
}

void DebugAgent::warn(const char* tag, const char* message) {
    log(DEBUG_LEVEL_WARN, tag, message);
}

void DebugAgent::warnf(const char* tag, const char* format, ...) {
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written >= (int)sizeof(msgBuf)) _stats.truncated++;
    log(DEBUG_LEVEL_WARN, tag, msgBuf);
}

void DebugAgent::error(const char* tag, const char* message) {
    log(DEBUG_LEVEL_ERROR, tag, message);
}

void DebugAgent::errorf(const char* tag, const char* format, ...) {
    char msgBuf[DEBUG_MAX_MESSAGE_SIZE];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(msgBuf, sizeof(msgBuf), format, args);
    va_end(args);
    if (written >= (int)sizeof(msgBuf)) _stats.truncated++;
    log(DEBUG_LEVEL_ERROR, tag, msgBuf);
}

void DebugAgent::metric(const char* name, double value) {
    if (!_initialized) return;
    char lineBuf[128];
    int len = DebugProtocol::formatCustomMetric(lineBuf, sizeof(lineBuf), ++_seq, millis(), name, value);
    if (len > 0) enqueueLine(lineBuf, (size_t)len);
}

void DebugAgent::metric(const char* name, int32_t value) {
    metric(name, (double)value);
}

void DebugAgent::metric(const char* name, uint32_t value) {
    metric(name, (double)value);
}

void DebugAgent::state(const char* name, const char* value) {
    if (!_initialized) return;
    char lineBuf[160];
    int len = DebugProtocol::formatState(lineBuf, sizeof(lineBuf), ++_seq, millis(), name, value);
    if (len > 0) enqueueLine(lineBuf, (size_t)len);
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

#else

DebugAgent debug;

#endif
