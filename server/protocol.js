// NDJSON Protocol parser and validator for CoreS3-DebugMonitor

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_LENGTH = 16384; // 16 KB max per message line

export class ProtocolParser {
    constructor() {
        this.buffer = '';
    }

    /**
     * Push incoming TCP chunk and extract complete NDJSON lines
     * @param {Buffer|string} chunk 
     * @returns {string[]} complete lines
     */
    push(chunk) {
        this.buffer += chunk.toString('utf-8');
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
    }
}

/**
 * Validate and parse a JSON message
 * @param {string} rawLine 
 * @returns {{ valid: boolean, message?: any, error?: string }}
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

    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
        return { valid: false, error: 'MISSING_TYPE' };
    }

    // Add reception timestamp
    parsed.rxTime = new Date().toISOString();
    parsed.rxMs = Date.now();

    return { valid: true, message: parsed };
}
