#pragma once

#include "DebugConfig.h"
#include "DebugBuffer.h"
#include <WiFi.h>
#include <WiFiClient.h>

class DebugTransport {
public:
    DebugTransport();
    ~DebugTransport();

    bool begin(const DebugConfig& config, DebugBuffer* buffer, DebugStats* stats, uint32_t* seqCounter);
    void update(uint32_t budgetUs);
    void end();

    bool isConnected() const;
    DebugTransportState getState() const;
    const char* getStateString() const;

private:
    void sendHello();
    void processConnectedState(uint32_t budgetUs, int64_t startUs);

    DebugConfig _config;
    DebugBuffer* _buffer;
    DebugStats* _stats;
    uint32_t* _seqCounter;
    WiFiClient _client;
    DebugTransportState _state;
    uint32_t _lastBackoffMs;
    uint32_t _lastConnectAttemptMs;
    bool _isConnected;
    bool _helloSent;
};
