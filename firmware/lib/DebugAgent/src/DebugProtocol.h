#pragma once

#include "DebugConfig.h"
#include <stdio.h>
#include <string.h>
#include <math.h>

class DebugProtocol {
public:
    /**
     * Escape string content safely for JSON representation.
     * Preserves UTF-8 multi-byte characters without slicing them mid-character.
     */
    static size_t escapeJson(const char* src, char* dst, size_t dstMax) {
        if (!src || !dst || dstMax < 1) return 0;
        size_t outIdx = 0;

        while (*src && outIdx + 2 < dstMax) {
            unsigned char c = (unsigned char)*src;

            if (c == '"') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = '"';
                src++;
            } else if (c == '\\') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = '\\';
                src++;
            } else if (c == '\b') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'b';
                src++;
            } else if (c == '\f') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'f';
                src++;
            } else if (c == '\n') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'n';
                src++;
            } else if (c == '\r') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 'r';
                src++;
            } else if (c == '\t') {
                if (outIdx + 2 >= dstMax) break;
                dst[outIdx++] = '\\';
                dst[outIdx++] = 't';
                src++;
            } else if (c < 32) {
                if (outIdx + 6 >= dstMax) break;
                int written = snprintf(dst + outIdx, dstMax - outIdx, "\\u%04x", c);
                if (written > 0 && outIdx + (size_t)written < dstMax) {
                    outIdx += (size_t)written;
                }
                src++;
            } else if (c >= 128) {
                // Determine UTF-8 sequence length
                size_t seqLen = 1;
                if ((c & 0xE0) == 0xC0) seqLen = 2;
                else if ((c & 0xF0) == 0xE0) seqLen = 3;
                else if ((c & 0xF8) == 0xF0) seqLen = 4;

                // Check if full UTF-8 sequence exists in src
                bool fullSeqPresent = true;
                for (size_t k = 1; k < seqLen; ++k) {
                    if ((unsigned char)src[k] == '\0' || ((unsigned char)src[k] & 0xC0) != 0x80) {
                        fullSeqPresent = false;
                        break;
                    }
                }

                if (!fullSeqPresent) {
                    // Invalid/truncated byte: skip to avoid corruption
                    src++;
                    continue;
                }

                // Check if room exists in destination
                if (outIdx + seqLen >= dstMax) {
                    // Stop without cutting mid-character
                    break;
                }

                for (size_t k = 0; k < seqLen; ++k) {
                    dst[outIdx++] = src[k];
                }
                src += seqLen;
            } else {
                // Regular printable ASCII (32 <= c < 128)
                dst[outIdx++] = (char)c;
                src++;
            }
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

    static int formatHello(char* out, size_t maxLen, const char* device, const char* app,
                           const char* version, const char* bootId) {
        if (!out || maxLen < 32) return -1;
        char escDev[64];
        char escApp[64];
        char escVer[32];
        char escBoot[32];
        escapeJson(device ? device : "CoreS3", escDev, sizeof(escDev));
        escapeJson(app ? app : "App", escApp, sizeof(escApp));
        escapeJson(version ? version : DEBUG_AGENT_VERSION, escVer, sizeof(escVer));
        escapeJson(bootId ? bootId : "0", escBoot, sizeof(escBoot));

        int written = snprintf(out, maxLen,
            "{\"type\":\"hello\",\"protocol\":1,\"device\":\"%s\",\"app\":\"%s\",\"version\":\"%s\",\"bootId\":\"%s\"}\n",
            escDev, escApp, escVer, escBoot);

        if (written < 0 || (size_t)written >= maxLen) {
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }

    static int formatLogWithSeq(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                                uint8_t level, const char* tag, const char* message,
                                bool* outTruncated = nullptr) {
        if (!out || maxLen < 32) return -1;
        char escTag[64];
        char escMsg[DEBUG_MAX_MESSAGE_SIZE];
        escapeJson(tag ? tag : "APP", escTag, sizeof(escTag));
        size_t escLen = escapeJson(message ? message : "", escMsg, sizeof(escMsg));

        if (outTruncated && message && escLen < strlen(message)) {
            *outTruncated = true;
        }

        int written = snprintf(out, maxLen,
            "{\"type\":\"log\",\"seq\":%lu,\"ms\":%lu,\"level\":\"%s\",\"tag\":\"%s\",\"message\":\"%s\"}\n",
            (unsigned long)seq, (unsigned long)ms, levelToString(level), escTag, escMsg);

        if (written < 0 || (size_t)written >= maxLen) {
            if (outTruncated) *outTruncated = true;
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }

    static int formatMetrics(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                             uint32_t heap, uint32_t minHeap, uint32_t maxAlloc,
                             uint32_t psram, int32_t rssi,
                             uint32_t avgUs, uint32_t maxUs, uint32_t minUs,
                             uint32_t budgetOverruns, uint32_t overruns1ms) {
        if (!out || maxLen < 32) return -1;
        int written = snprintf(out, maxLen,
            "{\"type\":\"metrics\",\"seq\":%lu,\"ms\":%lu,\"heap\":%lu,\"min_heap\":%lu,\"max_alloc\":%lu,\"psram\":%lu,\"rssi\":%ld,\"avg_update_us\":%lu,\"max_update_us\":%lu,\"min_update_us\":%lu,\"budget_overruns\":%lu,\"overruns_1ms\":%lu}\n",
            (unsigned long)seq, (unsigned long)ms,
            (unsigned long)heap, (unsigned long)minHeap, (unsigned long)maxAlloc,
            (unsigned long)psram, (long)rssi,
            (unsigned long)avgUs, (unsigned long)maxUs, (unsigned long)minUs,
            (unsigned long)budgetOverruns, (unsigned long)overruns1ms);

        if (written < 0 || (size_t)written >= maxLen) {
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }

    static int formatCustomMetric(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                                  const char* name, double value) {
        if (!out || maxLen < 32) return -1;
        char escName[64];
        escapeJson(name ? name : "metric", escName, sizeof(escName));

        // Protect against NaN and Infinity which break JSON validity
        double safeValue = value;
        if (isnan(safeValue) || isinf(safeValue)) {
            safeValue = 0.0;
        }

        int written = snprintf(out, maxLen,
            "{\"type\":\"metric\",\"seq\":%lu,\"ms\":%lu,\"name\":\"%s\",\"value\":%.2f}\n",
            (unsigned long)seq, (unsigned long)ms, escName, safeValue);

        if (written < 0 || (size_t)written >= maxLen) {
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }

    static int formatState(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                           const char* name, const char* value) {
        if (!out || maxLen < 32) return -1;
        char escName[64];
        char escVal[128];
        escapeJson(name ? name : "state", escName, sizeof(escName));
        escapeJson(value ? value : "", escVal, sizeof(escVal));

        int written = snprintf(out, maxLen,
            "{\"type\":\"state\",\"seq\":%lu,\"ms\":%lu,\"name\":\"%s\",\"value\":\"%s\"}\n",
            (unsigned long)seq, (unsigned long)ms, escName, escVal);

        if (written < 0 || (size_t)written >= maxLen) {
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }

    static int formatStats(char* out, size_t maxLen, uint32_t seq, uint32_t ms,
                           const DebugStats& stats) {
        if (!out || maxLen < 32) return -1;
        int written = snprintf(out, maxLen,
            "{\"type\":\"stats\",\"seq\":%lu,\"ms\":%lu,\"attempted\":%lu,\"enqueued\":%lu,\"sent\":%lu,\"dropped\":%lu,\"truncated\":%lu,\"bytes_sent\":%lu,\"buf_used\":%lu,\"buf_cap\":%lu,\"buf_hwm\":%lu,\"connects\":%lu,\"reconnects\":%lu,\"sock_errors\":%lu,\"avg_us\":%lu,\"max_us\":%lu,\"overruns\":%lu,\"overruns_1ms\":%lu}\n",
            (unsigned long)seq, (unsigned long)ms,
            (unsigned long)stats.messagesAttempted,
            (unsigned long)stats.messagesEnqueued,
            (unsigned long)stats.messagesSent,
            (unsigned long)stats.messagesDropped,
            (unsigned long)stats.messagesTruncated,
            (unsigned long)stats.bytesSent,
            (unsigned long)stats.bufferUsed,
            (unsigned long)stats.bufferCapacity,
            (unsigned long)stats.bufferHighWatermark,
            (unsigned long)stats.successfulConnections,
            (unsigned long)stats.reconnects,
            (unsigned long)stats.socketErrors,
            (unsigned long)stats.avgUpdateUs,
            (unsigned long)stats.maxUpdateUs,
            (unsigned long)stats.budgetOverruns,
            (unsigned long)stats.updateOverruns1ms);

        if (written < 0 || (size_t)written >= maxLen) {
            out[maxLen - 2] = '\n';
            out[maxLen - 1] = '\0';
            return (int)(maxLen - 1);
        }
        return written;
    }
};
