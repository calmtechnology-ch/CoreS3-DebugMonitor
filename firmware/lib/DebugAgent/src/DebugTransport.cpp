#include "DebugTransport.h"
#include "DebugProtocol.h"
#include <esp_timer.h>

DebugTransport::DebugTransport()
    : _buffer(nullptr),
      _stats(nullptr),
      _seqCounter(nullptr),
      _state(DEBUG_STATE_DISABLED),
      _lastBackoffMs(0),
      _lastConnectAttemptMs(0),
      _isConnected(false),
      _helloSent(false) {}

DebugTransport::~DebugTransport() {
    end();
}

bool DebugTransport::begin(const DebugConfig& config, DebugBuffer* buffer, DebugStats* stats, uint32_t* seqCounter) {
    _config = config;
    _buffer = buffer;
    _stats = stats;
    _seqCounter = seqCounter;
    _helloSent = false;
    _isConnected = false;
    _lastBackoffMs = 0;
    _lastConnectAttemptMs = 0;

    _client.setTimeout(10); // 10 ms max timeout to keep non-blocking
    _state = (WiFi.status() == WL_CONNECTED) ? DEBUG_STATE_DISCONNECTED : DEBUG_STATE_WAIT_WIFI;
    return true;
}

void DebugTransport::end() {
    if (_client.connected()) {
        _client.stop();
    }
    _isConnected = false;
    _state = DEBUG_STATE_DISABLED;
    _helloSent = false;
}

bool DebugTransport::isConnected() const {
    return (_state == DEBUG_STATE_CONNECTED && _isConnected);
}

DebugTransportState DebugTransport::getState() const {
    return _state;
}

const char* DebugTransport::getStateString() const {
    switch (_state) {
        case DEBUG_STATE_DISABLED:     return "DISABLED";
        case DEBUG_STATE_WAIT_WIFI:    return "WAIT_WIFI";
        case DEBUG_STATE_DISCONNECTED: return "DISCONNECTED";
        case DEBUG_STATE_CONNECTING:   return "CONNECTING";
        case DEBUG_STATE_CONNECTED:    return "CONNECTED";
        case DEBUG_STATE_BACKOFF:      return "BACKOFF";
        default:                       return "UNKNOWN";
    }
}

void DebugTransport::sendHello() {
    if (!_buffer || !_stats) return;

    char helloMsg[256];
    int len = DebugProtocol::formatHello(helloMsg, sizeof(helloMsg),
                                         _config.deviceName, _config.appName, _config.appVersion);
    if (len > 0) {
        _buffer->push(helloMsg, (size_t)len, _stats->dropped);
    }
}

void DebugTransport::processConnectedState(uint32_t budgetUs, int64_t startUs) {
    if (!_client.connected()) {
        _client.stop();
        _isConnected = false;
        _state = DEBUG_STATE_BACKOFF;
        _lastBackoffMs = millis();
        _helloSent = false;
        if (_stats) _stats->reconnects++;
        return;
    }

    _isConnected = true;

    if (!_helloSent) {
        sendHello();
        _helloSent = true;
    }

    // Drain buffer within budget
    while (_buffer && _buffer->getCount() > 0) {
        // Enforce time budget
        int64_t elapsedUs = esp_timer_get_time() - startUs;
        if (elapsedUs >= (int64_t)budgetUs) {
            break;
        }

        const uint8_t* ptr = nullptr;
        size_t avail = 0;
        if (!_buffer->peek(&ptr, &avail) || avail == 0) {
            break;
        }

        size_t toWrite = (avail > DEBUG_MAX_CHUNK_WRITE) ? DEBUG_MAX_CHUNK_WRITE : avail;
        size_t written = _client.write(ptr, toWrite);

        if (written > 0) {
            _buffer->consume(written);
            if (_stats) _stats->sent += written;
        } else {
            // Socket write buffer full or connection broken
            if (!_client.connected()) {
                _client.stop();
                _isConnected = false;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = millis();
                _helloSent = false;
                if (_stats) _stats->reconnects++;
            }
            break;
        }
    }
}

void DebugTransport::update(uint32_t budgetUs) {
    if (_state == DEBUG_STATE_DISABLED) return;

    int64_t startUs = esp_timer_get_time();

    // Check Wi-Fi status
    if (WiFi.status() != WL_CONNECTED) {
        if (_client.connected()) {
            _client.stop();
        }
        _isConnected = false;
        _state = DEBUG_STATE_WAIT_WIFI;
        _helloSent = false;
        return;
    }

    switch (_state) {
        case DEBUG_STATE_WAIT_WIFI:
            if (WiFi.status() == WL_CONNECTED) {
                _state = DEBUG_STATE_DISCONNECTED;
            }
            break;

        case DEBUG_STATE_DISCONNECTED: {
            uint32_t now = millis();
            // Connect attempt with non-blocking check
            _lastConnectAttemptMs = now;
            _state = DEBUG_STATE_CONNECTING;
            
            // Connect with 50 ms timeout so loop is never held up
            int res = _client.connect(_config.host, _config.port, 50);
            if (res == 1) {
                _client.setNoDelay(true);
                _state = DEBUG_STATE_CONNECTED;
                _isConnected = true;
                _helloSent = false;
                processConnectedState(budgetUs, startUs);
            } else {
                _client.stop();
                _isConnected = false;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
            }
            break;
        }

        case DEBUG_STATE_CONNECTING:
            if (_client.connected()) {
                _client.setNoDelay(true);
                _state = DEBUG_STATE_CONNECTED;
                _isConnected = true;
                _helloSent = false;
                processConnectedState(budgetUs, startUs);
            } else {
                _client.stop();
                _isConnected = false;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = millis();
            }
            break;

        case DEBUG_STATE_CONNECTED:
            processConnectedState(budgetUs, startUs);
            break;

        case DEBUG_STATE_BACKOFF:
            if (millis() - _lastBackoffMs >= _config.reconnectIntervalMs) {
                _state = DEBUG_STATE_DISCONNECTED;
            }
            break;

        default:
            _state = DEBUG_STATE_DISCONNECTED;
            break;
    }
}
