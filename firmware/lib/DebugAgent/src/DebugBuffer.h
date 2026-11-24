#pragma once

#include "DebugConfig.h"
#include <Arduino.h>
#include <esp_heap_caps.h>

class DebugBuffer {
public:
    DebugBuffer()
        : _buffer(nullptr),
          _capacity(0),
          _head(0),
          _tail(0),
          _count(0),
          _isPsram(false) {
    }

    ~DebugBuffer() {
        cleanup();
    }

    bool init(size_t capacity, bool preferPsram = true) {
        cleanup();
        _capacity = capacity;
        _head = 0;
        _tail = 0;
        _count = 0;

        if (preferPsram && psramFound()) {
            _buffer = (uint8_t*)heap_caps_malloc(capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            if (_buffer) {
                _isPsram = true;
                return true;
            }
        }

        // Fallback to internal SRAM
        _buffer = (uint8_t*)heap_caps_malloc(capacity, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
        if (!_buffer) {
            _buffer = (uint8_t*)malloc(capacity);
        }
        _isPsram = false;
        return (_buffer != nullptr);
    }

    void cleanup() {
        if (_buffer) {
            free(_buffer);
            _buffer = nullptr;
        }
        _capacity = 0;
        _head = 0;
        _tail = 0;
        _count = 0;
        _isPsram = false;
    }

    bool push(const char* data, size_t len, uint32_t& droppedCounter) {
        if (!_buffer || len == 0 || len > _capacity) {
            droppedCounter++;
            return false;
        }

        portENTER_CRITICAL(&_mux);
        if (_capacity - _count < len) {
            // Buffer full: drop message to preserve non-blocking behavior and stream integrity
            portEXIT_CRITICAL(&_mux);
            droppedCounter++;
            return false;
        }

        size_t firstChunk = _capacity - _head;
        if (firstChunk > len) {
            firstChunk = len;
        }

        memcpy(_buffer + _head, data, firstChunk);
        if (len > firstChunk) {
            memcpy(_buffer, data + firstChunk, len - firstChunk);
        }

        _head = (_head + len) % _capacity;
        _count += len;
        portEXIT_CRITICAL(&_mux);
        return true;
    }

    bool peek(const uint8_t** outPtr, size_t* outLen) {
        if (!_buffer || _count == 0) {
            *outPtr = nullptr;
            *outLen = 0;
            return false;
        }

        portENTER_CRITICAL(&_mux);
        *outPtr = _buffer + _tail;
        size_t contiguous = _capacity - _tail;
        if (contiguous > _count) {
            contiguous = _count;
        }
        *outLen = contiguous;
        portEXIT_CRITICAL(&_mux);
        return (*outLen > 0);
    }

    void consume(size_t len) {
        if (len == 0 || !_buffer) return;

        portENTER_CRITICAL(&_mux);
        if (len > _count) {
            len = _count;
        }
        _tail = (_tail + len) % _capacity;
        _count -= len;
        portEXIT_CRITICAL(&_mux);
    }

    size_t getCount() const {
        return _count;
    }

    size_t getCapacity() const {
        return _capacity;
    }

    bool isPsram() const {
        return _isPsram;
    }

private:
    uint8_t* _buffer;
    size_t _capacity;
    size_t _head;
    size_t _tail;
    size_t _count;
    bool _isPsram;
    portMUX_TYPE _mux = portMUX_INITIALIZER_UNLOCKED;
};
