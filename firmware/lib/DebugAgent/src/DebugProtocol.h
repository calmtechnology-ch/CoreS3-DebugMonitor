#pragma once

#include "DebugConfig.h"
#include <stdio.h>
#include <string.h>

class DebugProtocol {
public:
    static size_t escapeJson(const char* src, char* dst, size_t dstMax) {
        if (!src || !dst || dstMax < 1) return 0;
        size_t outIdx = 0;
        while (*src && outIdx + 2 < dstMax) {
            unsigned char c = (unsigned char)*src;
            if (c == '"') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = '"';
            } else if (c == '\\') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = '\\';
            } else if (c == '\b') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'b';
            } else if (c == '\f') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'f';
            } else if (c == '\n') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'n';
            } else if (c == '\r') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'r';
            } else if (c == '\t') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 't';
            } else if (c < 32) {
                if (outIdx + 6 >= dstMax) break;
                int written = snprintf(dst + outIdx, dstMax - outIdx, "\\u%04x", c);
                if (written > 0) outIdx += (size_t)written;
            } else {
                // Pass valid UTF-8 multibyte characters (code >= 128) and normal ASCII directly
                dst[outIdx++] = (char)c;
            }
            src++;
        }
        dst[outIdx] = '\0';
        return outIdx;
    }

    static const char* levelToString(uint8_t level) {
        switch (level) {
            case DEBUG_LEVEL_TRACE: return "TRACE";
            case DEBUG_LEVEL_DEBUG: return "DEBUG";
            case DEBUG_LEVEL_INFO:  return "INFO";
            case DEBUG_LEVEL_WARN:  return "WARN";
            case DEBUG_LEVEL_ERROR: return "ERROR";
            default: return "INFO";
        }
    }

    static int formatHello(char* out, size_t maxLen, const char* device, const char* app, const char* version) {
        char escDev[64];
        char escApp[64];
        char escVer[32];
        escapeJson(device ? device : "CoreS3", escDev, sizeof(escDev));
        escapeJson(app ? app : "App", escApp, sizeof(escApp));
        escapeJson(version ? version : "0.1.0", escVer, sizeof(escVer));

        return snprintf(out, maxLen,
            "{\"type\":\"hello\",\"protocol\":1,\"device\":\"%s\",\"app\":\"%s\",\"version\":\"%s\"}\n",
            escDev, escApp, escVer);
    }

    static int formatLog(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                         uint8_t level, const char* tag, const char* message) {
        char escTag[64];
        char escMsg[DEBUG_MAX_MESSAGE_SIZE];
        escapeJson(tag ? tag : "APP", escTag, sizeof(escTag));
        escapeJson(message ? message : "", escMsg, sizeof(escMsg));

        return snprintf(out, maxLen,
            "{\"type\":\"log\",\"seq\":%lu,\"ms\":%lu,\"level\":\"%s\",\"tag\":\"%s\",\"message\":\"%s\"}\n",
            (unsigned long)seq, (unsigned long)ms, levelToString(level), escTag, escMsg);
    }

    static int formatMetrics(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                             uint32_t heap, uint32_t minHeap, uint32_t maxAlloc,
                             uint32_t psram, int32_t rssi,
                             uint32_t avgUs, uint32_t maxUs) {
        return snprintf(out, maxLen,
            "{\"type\":\"metrics\",\"seq\":%lu,\"ms\":%lu,\"heap\":%lu,\"min_heap\":%lu,\"max_alloc\":%lu,\"psram\":%lu,\"rssi\":%ld,\"avg_update_us\":%lu,\"max_update_us\":%lu}\n",
            (unsigned long)seq, (unsigned long)ms,
            (unsigned long)heap, (unsigned long)minHeap, (unsigned long)maxAlloc,
            (unsigned long)psram, (long)rssi,
            (unsigned long)avgUs, (unsigned long)maxUs);
    }

    static int formatCustomMetric(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                                  const char* name, double value) {
        char escName[64];
        escapeJson(name ? name : "metric", escName, sizeof(escName));
        return snprintf(out, maxLen,
            "{\"type\":\"metric\",\"seq\":%lu,\"ms\":%lu,\"name\":\"%s\",\"value\":%.2f}\n",
            (unsigned long)seq, (unsigned long)ms, escName, value);
    }

    static int formatState(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                           const char* name, const char* value) {
        char escName[64];
        char escVal[128];
        escapeJson(name ? name : "state", escName, sizeof(escName));
        escapeJson(value ? value : "", escVal, sizeof(escVal));
        return snprintf(out, maxLen,
            "{\"type\":\"state\",\"seq\":%lu,\"ms\":%lu,\"name\":\"%s\",\"value\":\"%s\"}\n",
            (unsigned long)seq, (unsigned long)ms, escName, escVal);
    }

    static int formatStats(char* out, size_t maxLen, uint32_t queued,
                           uint32_t dropped, uint32_t truncated, uint32_t reconnects) {
        return snprintf(out, maxLen,
            "{\"type\":\"stats\",\"queued\":%lu,\"dropped\":%lu,\"truncated\":%lu,\"reconnects\":%lu}\n",
            (unsigned long)queued, (unsigned long)dropped, (unsigned long)truncated, (unsigned long)reconnects);
    }
};
