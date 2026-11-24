import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolParser, parseAndValidateMessage, MAX_LINE_LENGTH } from '../server/protocol.js';

describe('NDJSON Protocol & Parser Tests', () => {
    test('parses a single standard NDJSON line', () => {
        const parser = new ProtocolParser();
        const raw = '{"type":"hello","protocol":1,"device":"CoreS3-01","app":"BasicDiagnostics","version":"0.1.0"}\n';
        const lines = parser.push(Buffer.from(raw));

        assert.equal(lines.length, 1);
        const result = parseAndValidateMessage(lines[0]);
        assert.equal(result.valid, true);
        assert.equal(result.message.type, 'hello');
        assert.equal(result.message.device, 'CoreS3-01');
    });

    test('handles TCP packet coalescing (multiple NDJSON lines in one packet)', () => {
        const parser = new ProtocolParser();
        const raw = '{"type":"log","seq":1,"level":"INFO","message":"msg1"}\n' +
                    '{"type":"log","seq":2,"level":"WARN","message":"msg2"}\n' +
                    '{"type":"metrics","seq":3,"heap":145000}\n';

        const lines = parser.push(Buffer.from(raw));
        assert.equal(lines.length, 3);

        const m1 = parseAndValidateMessage(lines[0]);
        const m2 = parseAndValidateMessage(lines[1]);
        const m3 = parseAndValidateMessage(lines[2]);

        assert.equal(m1.valid, true);
        assert.equal(m1.message.seq, 1);
        assert.equal(m2.valid, true);
        assert.equal(m2.message.seq, 2);
        assert.equal(m3.valid, true);
        assert.equal(m3.message.seq, 3);
    });

    test('handles TCP fragmentation across multiple chunks', () => {
        const parser = new ProtocolParser();
        const part1 = '{"type":"log","seq":1,"level":"';
        const part2 = 'INFO","tag":"SYSTEM","message":"Applic';
        const part3 = 'ation started"}\n';

        let lines = parser.push(Buffer.from(part1));
        assert.equal(lines.length, 0);

        lines = parser.push(Buffer.from(part2));
        assert.equal(lines.length, 0);

        lines = parser.push(Buffer.from(part3));
        assert.equal(lines.length, 1);

        const result = parseAndValidateMessage(lines[0]);
        assert.equal(result.valid, true);
        assert.equal(result.message.level, 'INFO');
        assert.equal(result.message.tag, 'SYSTEM');
        assert.equal(result.message.message, 'Application started');
    });

    test('rejects malformed JSON without crashing', () => {
        const parser = new ProtocolParser();
        const raw = '{"type":"log", broken json line\n';
        const lines = parser.push(Buffer.from(raw));
        assert.equal(lines.length, 1);

        const result = parseAndValidateMessage(lines[0]);
        assert.equal(result.valid, false);
        assert.equal(result.error, 'INVALID_JSON');
    });

    test('rejects messages lacking a type attribute', () => {
        const raw = '{"seq":10,"message":"hello"}';
        const result = parseAndValidateMessage(raw);
        assert.equal(result.valid, false);
        assert.equal(result.error, 'MISSING_TYPE');
    });

    test('detects and rejects messages exceeding MAX_LINE_LENGTH', () => {
        const parser = new ProtocolParser();
        const hugeMsg = '{"type":"log","message":"' + 'A'.repeat(MAX_LINE_LENGTH + 100) + '"}\n';
        const lines = parser.push(Buffer.from(hugeMsg));

        assert.equal(lines.length, 1);
        assert.equal(lines[0].error, 'LINE_TOO_LONG');
    });

    test('properly preserves UTF-8 French accented characters in strings', () => {
        const parser = new ProtocolParser();
        const raw = '{"type":"log","seq":4,"level":"INFO","tag":"RÉSEAU","message":"Connexion réinitialisée avec succès à l\'antenne Wi-Fi"}\n';
        const lines = parser.push(Buffer.from(raw));
        assert.equal(lines.length, 1);

        const result = parseAndValidateMessage(lines[0]);
        assert.equal(result.valid, true);
        assert.equal(result.message.tag, 'RÉSEAU');
        assert.equal(result.message.message, "Connexion réinitialisée avec succès à l'antenne Wi-Fi");
    });
});
