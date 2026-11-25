#pragma once

#include "DebugConfig.h"
#include <Arduino.h>
#include <Print.h>

#if DEBUG_AGENT_ENABLED

#include "DebugBuffer.h"
#include "DebugProtocol.h"
#include "DebugTransport.h"
#include <stdarg.h>
#include <Print.h>

class DebugAgent {
public:
    DebugAgent();
    ~DebugAgent();

    bool begin(const DebugConfig& config = DebugConfig());
    void update();
    void end();

    void log(uint8_t level, const char* tag, const char* message);
    void logf(uint8_t level, const char* tag, const char* format, ...) __attribute__((format(printf, 4, 5)));

    void trace(const char* tag, const char* message);
    void tracef(const char* tag, const char* format, ...) __attribute__((format(printf, 3, 4)));

    void debug(const char* tag, const char* message);
    void debugf(const char* tag, const char* format, ...) __attribute__((format(printf, 3, 4)));

    void info(const char* tag, const char* message);
    void infof(const char* tag, const char* format, ...) __attribute__((format(printf, 3, 4)));

    void warn(const char* tag, const char* message);
    void warnf(const char* tag, const char* format, ...) __attribute__((format(printf, 3, 4)));

    void error(const char* tag, const char* message);
    void errorf(const char* tag, const char* format, ...) __attribute__((format(printf, 3, 4)));

    void metric(const char* name, double value);
    void metric(const char* name, int32_t value);
    void metric(const char* name, uint32_t value);

    void state(const char* name, const char* value);

    bool isConnected() const;
    DebugStats getStats() const;
    const char* getStateString() const;
    const char* getBootId() const;

    // Diagnostic reporting to Serial / Print
    void printReport(Print& out = Serial);

private:
    void enqueueWithSeq(const char* type, const char* body, size_t bodyLen);
    void sendPeriodicMetrics(int64_t startUs);

    DebugConfig _config;
    DebugBuffer _buffer;
    DebugTransport _transport;
    DebugStats _stats;

    uint32_t _seq;
    uint32_t _lastMetricMs;
    uint32_t _lastStatsMs;
    bool _initialized;

    // Performance tracking
    uint64_t _updateTotalUs;
    portMUX_TYPE _mux = portMUX_INITIALIZER_UNLOCKED;

    // Memory benchmarks at boot
    size_t _memBeforeAgentSram;
    size_t _memAfterBeginSram;
    size_t _memAfterTcpSram;
};

extern DebugAgent debug;

#else

// Zero-overhead stub when DEBUG_AGENT_ENABLED is 0
class DebugAgent {
public:
    inline bool begin(const DebugConfig& = DebugConfig()) { return true; }
    inline void update() {}
    inline void end() {}

    inline void log(uint8_t, const char*, const char*) {}
    inline void logf(uint8_t, const char*, const char*, ...) {}

    inline void trace(const char*, const char*) {}
    inline void tracef(const char*, const char*, ...) {}

    inline void debug(const char*, const char*) {}
    inline void debugf(const char*, const char*, ...) {}

    inline void info(const char*, const char*) {}
    inline void infof(const char*, const char*, ...) {}

    inline void warn(const char*, const char*) {}
    inline void warnf(const char*, const char*, ...) {}

    inline void error(const char*, const char*) {}
    inline void errorf(const char*, const char*, ...) {}

    inline void metric(const char*, double) {}
    inline void metric(const char*, int32_t) {}
    inline void metric(const char*, uint32_t) {}

    inline void state(const char*, const char*) {}

    inline bool isConnected() const { return false; }
    inline DebugStats getStats() const { return DebugStats(); }
    inline const char* getStateString() const { return "DISABLED"; }
    inline const char* getBootId() const { return ""; }
    inline void printReport(Print& = Serial) {}
};

extern DebugAgent debug;

#endif
