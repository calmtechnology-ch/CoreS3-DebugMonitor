// NDJSON Protocol parser and validator for CoreS3-DebugMonitor v0.1.0.1
import { StringDecoder } from 'string_decoder';

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_LENGTH = 16384; // 16 KB max per message line

export class ProtocolParser {
    constructor() {
        this.buffer = '';
        this.decoder = new StringDecoder('utf-8');
    }

    /**
     * Push incoming TCP chunk and extract complete NDJSON lines.
     * Uses StringDecoder to safely preserve UTF-8 multi-byte characters
     * split across TCP chunk boundaries.
     * @param {Buffer|string} chunk 
     * @returns {(string|{error: string, length?: number})[]} complete lines or errors
     */
    push(chunk) {
        if (typeof chunk === 'string') {
            this.buffer += chunk;
        } else if (Buffer.isBuffer(chunk)) {
            this.buffer += this.decoder.write(chunk);
        }

        const lines = [];
        let newlineIndex;

        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            let line = this.buffer.slice(0, newlineIndex);
            this.buffer = this.buffer.slice(newlineIndex + 1);

            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }

            line = line.trim();
            if (line.length > 0) {
                if (line.length > MAX_LINE_LENGTH) {
                    lines.push({ error: 'LINE_TOO_LONG', length: line.length });
                } else {
                    lines.push(line);
                }
            }
        }

        // Buffer overflow protection against missing newlines
        if (this.buffer.length > MAX_LINE_LENGTH * 2) {
            this.buffer = '';
            lines.push({ error: 'BUFFER_OVERFLOW' });
        }

        return lines;
    }

    reset() {
        this.buffer = '';
        this.decoder = new StringDecoder('utf-8');
    }
}

/**
 * Validate and parse an NDJSON message line
 * @param {string|object} rawLine 
 * @returns {{ valid: boolean, message?: any, error?: string, details?: string }}
 */
export function parseAndValidateMessage(rawLine) {
    if (typeof rawLine === 'object' && rawLine.error) {
        return { valid: false, error: rawLine.error };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawLine);
    } catch (err) {
        return { valid: false, error: 'INVALID_JSON', details: err.message };
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.type || typeof parsed.type !== 'string') {
        return { valid: false, error: 'MISSING_TYPE' };
    }

    // Type-specific field validations
    switch (parsed.type) {
        case 'hello':
            // Must have protocol, device, and app
            if (typeof parsed.protocol !== 'number') parsed.protocol = 1;
            break;

        case 'log':
            if (typeof parsed.message !== 'string') {
                return { valid: false, error: 'INVALID_LOG_MESSAGE' };
            }
            break;

        case 'metrics':
            // Must contain numeric memory fields
            break;

        case 'metric':
            if (typeof parsed.name !== 'string') {
                return { valid: false, error: 'INVALID_METRIC_NAME' };
            }
            if (typeof parsed.value !== 'number' || !Number.isFinite(parsed.value)) {
                return { valid: false, error: 'INVALID_METRIC_VALUE' };
            }
            break;

        case 'state':
            if (typeof parsed.name !== 'string') {
                return { valid: false, error: 'INVALID_STATE_NAME' };
            }
            break;

        case 'stats':
            break;

        default:
            // Allow forward compatibility
            break;
    }

    // Add reception timestamp
    parsed.rxTime = new Date().toISOString();
    parsed.rxMs = Date.now();

    return { valid: true, message: parsed };
}
