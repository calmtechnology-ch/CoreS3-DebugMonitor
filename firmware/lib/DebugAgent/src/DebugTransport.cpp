#include "DebugTransport.h"
#include "DebugProtocol.h"
#include <esp_timer.h>
#include <lwip/sockets.h>
#include <lwip/netdb.h>
#include <fcntl.h>
#include <errno.h>
#include <arpa/inet.h>

DebugTransport::DebugTransport()
    : _buffer(nullptr),
      _stats(nullptr),
      _seqCounter(nullptr),
      _sock(-1),
      _state(DEBUG_STATE_DISABLED),
      _handshakeState(DEBUG_HANDSHAKE_IDLE),
      _lastBackoffMs(0),
      _lastConnectAttemptMs(0),
      _helloLen(0),
      _helloOffset(0),
      _currentMsgOffset(0) {
    _helloBuf[0] = '\0';
}

DebugTransport::~DebugTransport() {
    end();
}

bool DebugTransport::begin(const DebugConfig& config, DebugBuffer* buffer, DebugStats* stats, uint32_t* seqCounter) {
    _config = config;
    _buffer = buffer;
    _stats = stats;
    _seqCounter = seqCounter;

    _sock = -1;
    _handshakeState = DEBUG_HANDSHAKE_IDLE;
    _helloLen = 0;
    _helloOffset = 0;
    _currentMsgOffset = 0;
    _lastBackoffMs = 0;
    _lastConnectAttemptMs = 0;

    _state = (WiFi.status() == WL_CONNECTED) ? DEBUG_STATE_DISCONNECTED : DEBUG_STATE_WAIT_WIFI;
    return true;
}

void DebugTransport::end() {
    closeSocket();
    _state = DEBUG_STATE_DISABLED;
    _handshakeState = DEBUG_HANDSHAKE_IDLE;
    _helloOffset = 0;
    _currentMsgOffset = 0;
}

void DebugTransport::closeSocket() {
    if (_sock >= 0) {
        lwip_close(_sock);
        _sock = -1;
    }
    _handshakeState = DEBUG_HANDSHAKE_IDLE;
    _helloOffset = 0;
}

bool DebugTransport::isConnected() const {
    return (_state == DEBUG_STATE_CONNECTED && _sock >= 0);
}

DebugTransportState DebugTransport::getState() const {
    return _state;
}

DebugHandshakeState DebugTransport::getHandshakeState() const {
    return _handshakeState;
}

const char* DebugTransport::getStateString() const {
    switch (_state) {
        case DEBUG_STATE_DISABLED:     return "DISABLED";
        case DEBUG_STATE_WAIT_WIFI:    return "WAIT_WIFI";
        case DEBUG_STATE_DISCONNECTED: return "DISCONNECTED";
        case DEBUG_STATE_CONNECTING:   return "CONNECTING";
        case DEBUG_STATE_CONNECTED:
            if (_handshakeState == DEBUG_HANDSHAKE_SEND_HELLO) return "SEND_HELLO";
            return "CONNECTED";
        case DEBUG_STATE_BACKOFF:      return "BACKOFF";
        default:                       return "UNKNOWN";
    }
}

void DebugTransport::onConnected() {
    _state = DEBUG_STATE_CONNECTED;
    _handshakeState = DEBUG_HANDSHAKE_SEND_HELLO;
    _helloOffset = 0;
    _currentMsgOffset = 0;

    // Prepare hello message in dedicated buffer
    int len = DebugProtocol::formatHello(_helloBuf, sizeof(_helloBuf),
                                         _config.deviceName, _config.appName,
                                         _config.appVersion, _config.bootId);
    _helloLen = (len > 0) ? (size_t)len : 0;

    if (_stats) {
        _stats->successfulConnections++;
        if (_stats->successfulConnections > 1) {
            _stats->reconnects++;
        }
    }
}

void DebugTransport::handleDisconnect() {
    closeSocket();
    _currentMsgOffset = 0; // Reset in-flight offset to retransmit full message cleanly next time
    _state = DEBUG_STATE_BACKOFF;
    _lastBackoffMs = millis();
    if (_stats) {
        _stats->socketErrors++;
        _stats->reconnects++;
    }
}

void DebugTransport::processConnected(uint32_t budgetUs, int64_t startUs) {
    if (_sock < 0) {
        handleDisconnect();
        return;
    }

    // Step 1: Send handshake hello first with dedicated buffer and partial write handling
    if (_handshakeState == DEBUG_HANDSHAKE_SEND_HELLO) {
        while (_helloOffset < _helloLen) {
            int64_t elapsedUs = esp_timer_get_time() - startUs;
            if (elapsedUs >= (int64_t)budgetUs) {
                // Cooperative budget reached, resume hello on next update
                return;
            }

            size_t remaining = _helloLen - _helloOffset;
            int written = lwip_send(_sock, _helloBuf + _helloOffset, remaining, MSG_DONTWAIT);

            if (written > 0) {
                _helloOffset += (size_t)written;
                if (_stats) {
                    _stats->bytesSent += (size_t)written;
                    _stats->sent = _stats->bytesSent;
                }
            } else {
                if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                    // Socket output buffer full; yield until next update
                    return;
                } else {
                    // Socket error or connection lost
                    handleDisconnect();
                    return;
                }
            }
        }

        // Hello message fully sent! Handshake complete.
        _handshakeState = DEBUG_HANDSHAKE_STREAMING;
    }

    // Step 2: Stream queued logs and metrics from circular buffer within cooperative budget
    if (_handshakeState == DEBUG_HANDSHAKE_STREAMING) {
        size_t bytesSentThisTurn = 0;

        while (_buffer && _buffer->getCount() > 0) {
            int64_t elapsedUs = esp_timer_get_time() - startUs;
            if (elapsedUs >= (int64_t)budgetUs) {
                break;
            }
            if (bytesSentThisTurn >= DEBUG_MAX_CHUNK_WRITE) {
                break;
            }

            const uint8_t* ptr = nullptr;
            size_t avail = 0;
            if (!_buffer->peek(&ptr, &avail, _currentMsgOffset) || avail == 0) {
                break;
            }

            size_t toWrite = avail;
            size_t remainingAllowance = DEBUG_MAX_CHUNK_WRITE - bytesSentThisTurn;
            if (toWrite > remainingAllowance) {
                toWrite = remainingAllowance;
            }

            int written = lwip_send(_sock, ptr, toWrite, MSG_DONTWAIT);
            if (written > 0) {
                _currentMsgOffset += (size_t)written;
                bytesSentThisTurn += (size_t)written;
                if (_stats) {
                    _stats->bytesSent += (size_t)written;
                    _stats->sent = _stats->bytesSent;
                }

                // Check if this entire message was accepted by the socket
                if (written == (int)avail) {
                    _buffer->popCurrentMessage(_stats);
                    if (_stats) {
                        _stats->messagesSent++;
                    }
                    _currentMsgOffset = 0;
                }
            } else {
                if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                    // Socket buffer saturated; yield to next update
                    break;
                } else {
                    // Connection reset, pipe broken, or socket error
                    handleDisconnect();
                    break;
                }
            }
        }
    }
}

void DebugTransport::update(uint32_t budgetUs, int64_t startUs) {
    if (_state == DEBUG_STATE_DISABLED) return;

    // Monitor host application's Wi-Fi status without altering it
    if (WiFi.status() != WL_CONNECTED) {
        if (_sock >= 0) {
            closeSocket();
        }
        _state = DEBUG_STATE_WAIT_WIFI;
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
            _lastConnectAttemptMs = now;

            // Create native TCP socket
            _sock = lwip_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
            if (_sock < 0) {
                if (_stats) _stats->socketErrors++;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
                break;
            }

            // Set socket strictly non-blocking
            int flags = lwip_fcntl(_sock, F_GETFL, 0);
            if (flags >= 0) {
                lwip_fcntl(_sock, F_SETFL, flags | O_NONBLOCK);
            }

            // Disable Nagle algorithm for low latency
            int nodelay = 1;
            lwip_setsockopt(_sock, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));

            // Parse numeric IPv4 without blocking DNS
            struct sockaddr_in servAddr;
            memset(&servAddr, 0, sizeof(servAddr));
            servAddr.sin_family = AF_INET;
            servAddr.sin_port = htons(_config.port);

            if (inet_pton(AF_INET, _config.host, &servAddr.sin_addr) <= 0) {
                // Non-numeric host or invalid IPv4: fail immediately without blocking
                closeSocket();
                if (_stats) _stats->socketErrors++;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
                break;
            }

            if (_stats) _stats->connectAttempts++;

            int res = lwip_connect(_sock, (struct sockaddr*)&servAddr, sizeof(servAddr));
            if (res == 0) {
                // Immediate connection (rare on TCP, but handled)
                onConnected();
                processConnected(budgetUs, startUs);
            } else if (errno == EINPROGRESS) {
                // Connection in progress as expected for non-blocking connect
                _state = DEBUG_STATE_CONNECTING;
            } else {
                // Immediate error (e.g. ECONNREFUSED)
                closeSocket();
                if (_stats) _stats->socketErrors++;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
            }
            break;
        }

        case DEBUG_STATE_CONNECTING: {
            uint32_t now = millis();
            if (now - _lastConnectAttemptMs >= _config.connectTimeoutMs) {
                // Connection timeout via timestamp without busy waiting
                closeSocket();
                if (_stats) _stats->socketErrors++;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
                break;
            }

            // Non-blocking readiness check with zero timeout
            fd_set writeFds, errFds;
            FD_ZERO(&writeFds);
            FD_ZERO(&errFds);
            FD_SET(_sock, &writeFds);
            FD_SET(_sock, &errFds);

            struct timeval tv = {0, 0}; // 0 µs: non-blocking check
            int sel = lwip_select(_sock + 1, NULL, &writeFds, &errFds, &tv);

            if (sel > 0) {
                if (FD_ISSET(_sock, &errFds)) {
                    closeSocket();
                    if (_stats) _stats->socketErrors++;
                    _state = DEBUG_STATE_BACKOFF;
                    _lastBackoffMs = now;
                } else if (FD_ISSET(_sock, &writeFds)) {
                    int so_error = 0;
                    socklen_t len = sizeof(so_error);
                    if (lwip_getsockopt(_sock, SOL_SOCKET, SO_ERROR, &so_error, &len) < 0 || so_error != 0) {
                        // Connection failed
                        closeSocket();
                        if (_stats) _stats->socketErrors++;
                        _state = DEBUG_STATE_BACKOFF;
                        _lastBackoffMs = now;
                    } else {
                        // Connection successfully established!
                        onConnected();
                        processConnected(budgetUs, startUs);
                    }
                }
            } else if (sel < 0) {
                // Select error
                closeSocket();
                if (_stats) _stats->socketErrors++;
                _state = DEBUG_STATE_BACKOFF;
                _lastBackoffMs = now;
            }
            // sel == 0: still connecting, check again on next update()
            break;
        }

        case DEBUG_STATE_CONNECTED:
            processConnected(budgetUs, startUs);
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
