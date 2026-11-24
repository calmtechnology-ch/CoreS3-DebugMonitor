#pragma once

#include "DebugConfig.h"
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <string.h>

class DebugBuffer {
public:
    DebugBuffer()
        : _buffer(nullptr),
          _capacity(0),
          _head(0),
          _tail(0),
          _usedBytes(0),
          _msgCount(0),
          _isPsram(false) {}

    ~DebugBuffer() {
        cleanup();
    }

    bool init(size_t capacity, bool preferPsram = true, bool allowSramFallback = false) {
        cleanup();
        _capacity = (capacity + 1) & ~1; // Ensure even capacity
        _head = 0;
        _tail = 0;
        _usedBytes = 0;
        _msgCount = 0;
        _isPsram = false;

        if (preferPsram && psramFound()) {
            _buffer = (uint8_t*)heap_caps_malloc(_capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            if (_buffer) {
                _isPsram = true;
                return true;
            }
        }

        if (allowSramFallback) {
            _buffer = (uint8_t*)heap_caps_malloc(_capacity, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
            if (!_buffer) {
                _buffer = (uint8_t*)malloc(_capacity);
            }
            if (_buffer) {
                _isPsram = false;
                return true;
            }
        }

        // PSRAM failed and SRAM fallback disabled by default on CoreS3
        return false;
    }

    void cleanup() {
        portENTER_CRITICAL(&_mux);
        if (_buffer) {
            free(_buffer);
            _buffer = nullptr;
        }
        _capacity = 0;
        _head = 0;
        _tail = 0;
        _usedBytes = 0;
        _msgCount = 0;
        _isPsram = false;
        portEXIT_CRITICAL(&_mux);
    }

    /**
     * Push a complete NDJSON message into the buffer.
     * Thread-safe across multiple FreeRTOS tasks.
     */
    bool push(const char* data, size_t len, DebugStats* stats) {
        if (!_buffer || len == 0 || len > DEBUG_MAX_MESSAGE_SIZE) {
            if (stats) {
                stats->messagesDropped++;
                stats->dropped = stats->messagesDropped;
            }
            return false;
        }

        // Each message is stored as [uint16_t len][char data[len]], aligned to 2 bytes
        const size_t recordSize = (sizeof(uint16_t) + len + 1) & ~1;
        if (recordSize > _capacity) {
            if (stats) {
                stats->messagesDropped++;
                stats->dropped = stats->messagesDropped;
            }
            return false;
        }

        portENTER_CRITICAL(&_mux);

        if (_msgCount == 0) {
            _head = 0;
            _tail = 0;
            _usedBytes = 0;
        }

        bool pushed = false;

        if (_head >= _tail && _msgCount > 0) {
            size_t spaceToEnd = _capacity - _head;
            if (spaceToEnd >= recordSize) {
                // Write message at _head
                *(uint16_t*)(_buffer + _head) = (uint16_t)len;
                memcpy(_buffer + _head + sizeof(uint16_t), data, len);
                _head += recordSize;
                if (_head >= _capacity) _head = 0;
                _usedBytes += recordSize;
                _msgCount++;
                pushed = true;
            } else if (_tail > recordSize && spaceToEnd >= sizeof(uint16_t)) {
                // Wrap to index 0: put WRAP marker at end
                *(uint16_t*)(_buffer + _head) = RECORD_WRAP;
                *(uint16_t*)(_buffer) = (uint16_t)len;
                memcpy(_buffer + sizeof(uint16_t), data, len);
                _head = recordSize;
                _usedBytes += (spaceToEnd + recordSize);
                _msgCount++;
                pushed = true;
            }
        } else if (_msgCount == 0) {
            // Empty buffer
            *(uint16_t*)(_buffer) = (uint16_t)len;
            memcpy(_buffer + sizeof(uint16_t), data, len);
            _head = recordSize;
            if (_head >= _capacity) _head = 0;
            _usedBytes = recordSize;
            _msgCount = 1;
            pushed = true;
        } else {
            // _head < _tail
            size_t freeSpace = (_tail > _head + 1) ? (_tail - 1 - _head) : 0;
            if (freeSpace >= recordSize) {
                *(uint16_t*)(_buffer + _head) = (uint16_t)len;
                memcpy(_buffer + _head + sizeof(uint16_t), data, len);
                _head += recordSize;
                if (_head >= _capacity) _head = 0;
                _usedBytes += recordSize;
                _msgCount++;
                pushed = true;
            }
        }

        if (pushed) {
            if (stats) {
                stats->messagesEnqueued++;
                stats->queued = stats->messagesEnqueued;
                stats->bufferUsed = _usedBytes;
                stats->pendingMessages = _msgCount;
                if (_usedBytes > stats->bufferHighWatermark) {
                    stats->bufferHighWatermark = _usedBytes;
                }
            }
        } else {
            if (stats) {
                stats->messagesDropped++;
                stats->dropped = stats->messagesDropped;
            }
        }

        portEXIT_CRITICAL(&_mux);
        return pushed;
    }

    /**
     * Inspect the message currently at the head of the queue.
     * Returns a contiguous pointer to the message starting at 'offset'.
     * Does NOT remove the message from the queue.
     */
    bool peek(const uint8_t** outPtr, size_t* outLen, size_t offset) {
        if (!_buffer) {
            *outPtr = nullptr;
            *outLen = 0;
            return false;
        }

        portENTER_CRITICAL(&_mux);

        if (_msgCount == 0) {
            *outPtr = nullptr;
            *outLen = 0;
            portEXIT_CRITICAL(&_mux);
            return false;
        }

        // Handle wrap marker at tail
        uint16_t len = *(uint16_t*)(_buffer + _tail);
        if (len == RECORD_WRAP) {
            size_t spaceToEnd = _capacity - _tail;
            _usedBytes = (_usedBytes >= spaceToEnd) ? (_usedBytes - spaceToEnd) : 0;
            _tail = 0;
            len = *(uint16_t*)(_buffer + _tail);
        }

        if (offset >= len) {
            *outPtr = nullptr;
            *outLen = 0;
            portEXIT_CRITICAL(&_mux);
            return false;
        }

        *outPtr = _buffer + _tail + sizeof(uint16_t) + offset;
        *outLen = len - offset;

        portEXIT_CRITICAL(&_mux);
        return (*outLen > 0);
    }

    /**
     * Remove the current message from the queue after it has been fully sent.
     */
    void popCurrentMessage(DebugStats* stats = nullptr) {
        if (!_buffer) return;

        portENTER_CRITICAL(&_mux);

        if (_msgCount == 0) {
            portEXIT_CRITICAL(&_mux);
            return;
        }

        uint16_t len = *(uint16_t*)(_buffer + _tail);
        if (len == RECORD_WRAP) {
            size_t spaceToEnd = _capacity - _tail;
            _usedBytes = (_usedBytes >= spaceToEnd) ? (_usedBytes - spaceToEnd) : 0;
            _tail = 0;
            len = *(uint16_t*)(_buffer + _tail);
        }

        size_t recordSize = (sizeof(uint16_t) + len + 1) & ~1;
        _tail += recordSize;
        if (_tail >= _capacity) _tail = 0;
        _msgCount--;
        _usedBytes = (_usedBytes >= recordSize) ? (_usedBytes - recordSize) : 0;

        if (_msgCount == 0) {
            _head = 0;
            _tail = 0;
            _usedBytes = 0;
        }

        if (stats) {
            stats->bufferUsed = _usedBytes;
            stats->pendingMessages = _msgCount;
        }

        portEXIT_CRITICAL(&_mux);
    }

    size_t getCount() const {
        return _msgCount;
    }

    size_t getUsedBytes() const {
        return _usedBytes;
    }

    size_t getCapacity() const {
        return _capacity;
    }

    bool isPsram() const {
        return _isPsram;
    }

private:
    static const uint16_t RECORD_WRAP = 0xFFFF;

    uint8_t* _buffer;
    size_t _capacity;
    size_t _head;
    size_t _tail;
    size_t _usedBytes;
    size_t _msgCount;
    bool _isPsram;
    portMUX_TYPE _mux = portMUX_INITIALIZER_UNLOCKED;
};
