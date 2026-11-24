#pragma once

#include "DebugConfig.h"
#include "DebugBuffer.h"
#include <Network.h>
#include <WiFi.h>

class DebugTransport {
public:
    DebugTransport();
    ~DebugTransport();

    bool begin(const DebugConfig& config, DebugBuffer* buffer, DebugStats* stats, uint32_t* seqCounter);
    void update(uint32_t budgetUs, int64_t startUs);
    void end();

    bool isConnected() const;
    DebugTransportState getState() const;
    DebugHandshakeState getHandshakeState() const;
    const char* getStateString() const;

private:
    void closeSocket();
    void onConnected();
    void handleDisconnect();
    void processConnected(uint32_t budgetUs, int64_t startUs);

    DebugConfig _config;
    DebugBuffer* _buffer;
    DebugStats* _stats;
    uint32_t* _seqCounter;

    int _sock;
    DebugTransportState _state;
    DebugHandshakeState _handshakeState;

    uint32_t _lastBackoffMs;
    uint32_t _lastConnectAttemptMs;

    // Dedicated Hello Buffer (does not use circular buffer)
    char _helloBuf[256];
    size_t _helloLen;
    size_t _helloOffset;

    // Offset in the current in-flight NDJSON log message
    size_t _currentMsgOffset;
};
