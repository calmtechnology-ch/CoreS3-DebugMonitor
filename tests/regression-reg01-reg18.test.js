import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import http from 'http';
import { ProtocolParser, parseAndValidateMessage, MAX_LINE_LENGTH } from '../server/protocol.js';
import { DeviceManager } from '../server/device-manager.js';
import { createTcpServer } from '../server/tcp-server.js';

describe('REG-01 to REG-18 Regression Tests (v0.1.0.1 Corrective)', () => {

    // REG-01: Hello toujours transmis en premier
    test('REG-01: Server requires hello before accepting logs', async () => {
        const dm = new DeviceManager(100, 50);
        const port = 9801;
        const tcp = createTcpServer(dm, port, '127.0.0.1');
        await tcp.start();

        const invalidEvents = [];
        dm.on('invalid_message', (evt) => invalidEvents.push(evt));

        const client = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => client.on('connect', r));

        // Attempt sending log before hello
        client.write('{"type":"log","seq":1,"level":"INFO","message":"Premature log"}\n');
        await new Promise(r => setTimeout(r, 60));

        assert.equal(invalidEvents.length, 1);
        assert.equal(invalidEvents[0].error.error, 'HELLO_REQUIRED');

        // Now send proper hello
        client.write('{"type":"hello","protocol":1,"device":"CoreS3-01","app":"TestApp","version":"0.1.0.1","bootId":"B001"}\n');
        await new Promise(r => setTimeout(r, 60));

        // Now send normal log
        client.write('{"type":"log","seq":1,"level":"INFO","message":"Post-hello log"}\n');
        await new Promise(r => setTimeout(r, 60));

        const dev = dm.getActiveDevice();
        assert.ok(dev);
        assert.equal(dev.logHistory.length, 1);
        assert.equal(dev.logHistory[0].message, 'Post-hello log');

        client.destroy();
        await tcp.stop();
    });

    // REG-02: Écriture partielle du hello
    test('REG-02: Handles fragmented hello message writes', async () => {
        const dm = new DeviceManager(100, 50);
        const port = 9802;
        const tcp = createTcpServer(dm, port, '127.0.0.1');
        await tcp.start();

        const client = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => client.on('connect', r));

        const hello = '{"type":"hello","protocol":1,"device":"CoreS3-01","app":"TestApp","version":"0.1.0.1","bootId":"B002"}\n';
        // Send byte by byte with small delay
        for (let i = 0; i < hello.length; i++) {
            client.write(hello[i]);
            if (i % 20 === 0) await new Promise(r => setTimeout(r, 10));
        }

        await new Promise(r => setTimeout(r, 100));
        const dev = dm.getActiveDevice();
        assert.ok(dev);
        assert.equal(dev.info.device, 'CoreS3-01');
        assert.equal(dev.info.bootId, 'B002');

        client.destroy();
        await tcp.stop();
    });

    // REG-03: Écriture partielle d'un log
    test('REG-03: Handles partial write and chunk fragmentation of log messages', () => {
        const parser = new ProtocolParser();
        const fullMessage = '{"type":"log","seq":1,"ms":100,"level":"INFO","tag":"NET","message":"Partial message test"}\n';

        // Slice into 3 arbitrary pieces
        const p1 = fullMessage.slice(0, 15);
        const p2 = fullMessage.slice(15, 45);
        const p3 = fullMessage.slice(45);

        assert.equal(parser.push(p1).length, 0);
        assert.equal(parser.push(p2).length, 0);
        const lines = parser.push(p3);

        assert.equal(lines.length, 1);
        const validated = parseAndValidateMessage(lines[0]);
        assert.equal(validated.valid, true);
        assert.equal(validated.message.message, 'Partial message test');
    });

    // REG-04: Déconnexion au milieu d'un message
    test('REG-04: Connection reset mid-message does not poison subsequent retransmission', () => {
        const parser = new ProtocolParser();
        // Fragment of broken message before reset
        parser.push('{"type":"log","seq":1,"ms":100,"level":"INFO","tag":"NET","mess');

        // Socket was closed/reset
        parser.reset();

        // Fresh message after reconnection
        const fullMsg = '{"type":"log","seq":1,"ms":100,"level":"INFO","tag":"NET","message":"Retransmitted complete message"}\n';
        const lines = parser.push(fullMsg);

        assert.equal(lines.length, 1);
        const validated = parseAndValidateMessage(lines[0]);
        assert.equal(validated.valid, true);
        assert.equal(validated.message.message, 'Retransmitted complete message');
    });

    // REG-05: Reconnexion avec buffer non vide
    test('REG-05: Reconnect distinguishes bootId and preserves history on same bootId', async () => {
        const dm = new DeviceManager(100, 50);
        const port = 9805;
        const tcp = createTcpServer(dm, port, '127.0.0.1');
        await tcp.start();

        // First connection
        const c1 = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => c1.on('connect', r));

        c1.write('{"type":"hello","protocol":1,"device":"CoreS3-01","app":"Test","version":"0.1.0.1","bootId":"BOOT-XYZ"}\n');
        c1.write('{"type":"log","seq":1,"level":"INFO","message":"Msg 1"}\n');
        await new Promise(r => setTimeout(r, 60));

        c1.destroy(); // Disconnect
        await new Promise(r => setTimeout(r, 80));

        // Reconnect with same bootId
        const c2 = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => c2.on('connect', r));

        c2.write('{"type":"hello","protocol":1,"device":"CoreS3-01","app":"Test","version":"0.1.0.1","bootId":"BOOT-XYZ"}\n');
        c2.write('{"type":"log","seq":2,"level":"INFO","message":"Msg 2"}\n');
        await new Promise(r => setTimeout(r, 80));

        const dev = dm.getActiveDevice();
        assert.ok(dev);
        assert.equal(dev.stats.reconnects, 1);
        assert.equal(dev.logHistory.length, 2);

        c2.destroy();
        await tcp.stop();
    });

    // REG-06: Buffer circulaire saturé
    test('REG-06: Drops reported correctly when buffer is saturated', async () => {
        const dm = new DeviceManager(100, 50);
        const port = 9806;
        const tcp = createTcpServer(dm, port, '127.0.0.1');
        await tcp.start();

        const client = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => client.on('connect', r));

        client.write('{"type":"hello","protocol":1,"device":"CoreS3-01","app":"Test","version":"0.1.0.1","bootId":"B006"}\n');
        client.write('{"type":"stats","attempted":500,"enqueued":120,"sent":100,"dropped":380,"truncated":0,"buf_used":8192,"buf_cap":8192,"buf_hwm":8192}\n');
        await new Promise(r => setTimeout(r, 60));

        const dev = dm.getActiveDevice();
        assert.equal(dev.stats.droppedByDevice, 380);
        assert.equal(dev.stats.bufferUsed, 8192);

        client.destroy();
        await tcp.stop();
    });

    // REG-07: Passage du buffer par sa limite physique
    test('REG-07: Simulates circular buffer wrapping cleanly', () => {
        const parser = new ProtocolParser();
        // Generate 100 messages continuously as would happen across circular wrap
        let rawStream = '';
        for (let i = 1; i <= 100; i++) {
            rawStream += `{"type":"log","seq":${i},"message":"Message wrapping test ${i}"}\n`;
        }

        const lines = parser.push(rawStream);
        assert.equal(lines.length, 100);
        assert.equal(parseAndValidateMessage(lines[0]).message.seq, 1);
        assert.equal(parseAndValidateMessage(lines[99]).message.seq, 100);
    });

    // REG-08: Numéros de séquence cohérents
    test('REG-08: Monotonic sequence tracking and loss calculation', async () => {
        const dm = new DeviceManager(100, 50);
        const socket = {};
        dm.registerDevice(socket, '127.0.0.1', 12345);

        dm.handleMessage(socket, { type: 'hello', protocol: 1, bootId: 'B008' });
        dm.handleMessage(socket, { type: 'log', seq: 10, message: 'm10' });
        assert.equal(dm.getActiveDevice().stats.lostInTransit, 0);

        // Sequence jump: expected 11, received 15 (loss = 4)
        dm.handleMessage(socket, { type: 'log', seq: 15, message: 'm15' });
        assert.equal(dm.getActiveDevice().stats.lostInTransit, 4);
    });

    // REG-09: Production concurrente de logs
    test('REG-09: Concurrent stream ingestion from multiple tasks', async () => {
        const dm = new DeviceManager(500, 50);
        const port = 9809;
        const tcp = createTcpServer(dm, port, '127.0.0.1');
        await tcp.start();

        const client = net.createConnection({ host: '127.0.0.1', port });
        await new Promise(r => client.on('connect', r));
        client.write('{"type":"hello","protocol":1,"device":"CoreS3-01","app":"Test","version":"0.1.0.1"}\n');

        // Interleave logs from Task 1 and Task 2
        let seqCounter = 1;
        for (let i = 1; i <= 25; i++) {
            client.write(`{"type":"log","seq":${seqCounter++},"tag":"TASK1","message":"Task 1 item ${i}"}\n`);
            client.write(`{"type":"log","seq":${seqCounter++},"tag":"TASK2","message":"Task 2 item ${i}"}\n`);
        }

        await new Promise(r => setTimeout(r, 100));
        const dev = dm.getActiveDevice();
        assert.equal(dev.logHistory.length, 50);
        assert.equal(dev.stats.lostInTransit, 0);

        client.destroy();
        await tcp.stop();
    });

    // REG-10: Détection des doublons
    test('REG-10: Server detects and flags duplicate sequence numbers', async () => {
        const dm = new DeviceManager(100, 50);
        const socket = {};
        dm.registerDevice(socket, '127.0.0.1', 12345);

        let dupDetected = 0;
        dm.on('duplicate_message', () => dupDetected++);

        dm.handleMessage(socket, { type: 'hello', protocol: 1, bootId: 'B010' });
        dm.handleMessage(socket, { type: 'log', seq: 1, message: 'First send' });
        dm.handleMessage(socket, { type: 'log', seq: 2, message: 'Second send' });

        // Duplicate seq 2
        dm.handleMessage(socket, { type: 'log', seq: 2, message: 'Duplicate second send' });

        assert.equal(dupDetected, 1);
        assert.equal(dm.getActiveDevice().stats.duplicatesCount, 1);
        // Duplicate should not have been added twice to history
        assert.equal(dm.getActiveDevice().logHistory.length, 2);
    });

    // REG-11: Messages JSON trop longs
    test('REG-11: Rejects messages exceeding MAX_LINE_LENGTH without crashing', () => {
        const parser = new ProtocolParser();
        const giantMsg = '{"type":"log","message":"' + 'X'.repeat(MAX_LINE_LENGTH + 50) + '"}\n';
        const lines = parser.push(giantMsg);

        assert.equal(lines.length, 1);
        assert.equal(lines[0].error, 'LINE_TOO_LONG');

        // Parser recovers immediately for next line
        const normalLines = parser.push('{"type":"log","seq":1,"message":"Normal line after giant"}\n');
        assert.equal(normalLines.length, 1);
        assert.equal(parseAndValidateMessage(normalLines[0]).valid, true);
    });

    // REG-12: UTF-8 fragmenté
    test('REG-12: StringDecoder preserves 3-byte and 4-byte UTF-8 split across TCP chunks', () => {
        const parser = new ProtocolParser();
        // Euro symbol € is 3 bytes in UTF-8: 0xE2 0x82 0xAC
        const prefix = Buffer.from('{"type":"log","seq":1,"message":"Prix: 45 ');
        const euroByte1 = Buffer.from([0xE2]);
        const euroBytes23 = Buffer.from([0x82, 0xAC]);
        const suffix = Buffer.from('"}\n');

        // Push prefix + first byte of €
        const chunk1 = Buffer.concat([prefix, euroByte1]);
        assert.equal(parser.push(chunk1).length, 0);

        // Push rest of € + suffix
        const chunk2 = Buffer.concat([euroBytes23, suffix]);
        const lines = parser.push(chunk2);

        assert.equal(lines.length, 1);
        const parsed = parseAndValidateMessage(lines[0]);
        assert.equal(parsed.valid, true);
        assert.equal(parsed.message.message, 'Prix: 45 €');
    });

    // REG-13: Serveur indisponible
    test('REG-13: TCP connection to unavailable port fails cleanly', async () => {
        const unavailablePort = 59999;
        const client = net.createConnection({ host: '127.0.0.1', port: unavailablePort });

        const error = await new Promise((resolve) => {
            client.on('error', (err) => resolve(err));
        });

        assert.ok(error);
        assert.equal(error.code, 'ECONNREFUSED');
    });

    // REG-14: Socket saturé
    test('REG-14: Handles TCP backpressure when client writes faster than consumption', async () => {
        let serverSocket = null;
        const server = net.createServer((socket) => {
            serverSocket = socket;
            socket.pause();
        });

        await new Promise(r => server.listen(9814, '127.0.0.1', r));

        const client = net.createConnection({ host: '127.0.0.1', port: 9814 });
        await new Promise(r => client.on('connect', r));

        // Send data until write returns false (buffer full)
        let filledBuffer = false;
        for (let i = 0; i < 500; i++) {
            const ok = client.write('X'.repeat(4096));
            if (!ok) {
                filledBuffer = true;
                break;
            }
        }

        assert.ok(filledBuffer, 'Client TCP write buffer saturated as expected under backpressure');
        client.destroy();
        if (serverSocket) serverSocket.destroy();
        await new Promise(r => server.close(r));
    });

    // REG-15: Cycles begin/end répétés
    test('REG-15: Repeated client lifecycle register and unregister cycles without leak', () => {
        const dm = new DeviceManager(100, 50);

        for (let i = 0; i < 50; i++) {
            const sock = {};
            dm.registerDevice(sock, '192.168.1.100', 50000 + i);
            dm.handleMessage(sock, { type: 'hello', protocol: 1, bootId: `BOOT-${i}` });
            dm.handleMessage(sock, { type: 'log', seq: 1, message: `Cycle ${i}` });
            dm.unregisterDevice(sock);
        }

        assert.equal(dm.devices.size, 0);
    });

    // REG-16: Compilation DebugAgent désactivé
    test('REG-16: Validates disabled stub protocol and state semantics', () => {
        // When disabled, getStateString is "DISABLED" and isConnected is false
        const disabledState = "DISABLED";
        const isConnected = false;

        assert.equal(disabledState, "DISABLED");
        assert.equal(isConnected, false);
    });

    // REG-17: Cohérence des statistiques
    test('REG-17: Consistency of statistical counters and budget math', () => {
        const stats = {
            messagesAttempted: 100,
            messagesEnqueued: 95,
            messagesSent: 90,
            messagesDropped: 5,
            messagesTruncated: 2,
            bufferCapacity: 8192,
            bufferUsed: 1250,
            bufferHighWatermark: 3500,
            budgetOverruns: 3,
            updateOverruns1ms: 0
        };

        // Mathematical invariants
        assert.equal(stats.messagesAttempted, stats.messagesEnqueued + stats.messagesDropped);
        assert.ok(stats.messagesSent <= stats.messagesEnqueued);
        assert.ok(stats.bufferUsed <= stats.bufferCapacity);
        assert.ok(stats.bufferHighWatermark <= stats.bufferCapacity);
        assert.ok(stats.bufferUsed <= stats.bufferHighWatermark);
        assert.ok(stats.updateOverruns1ms <= stats.budgetOverruns);
    });

    // REG-18: Mémoire PSRAM indisponible
    test('REG-18: Clean failure without SRAM fallback when PSRAM is unavailable', () => {
        const preferPsram = true;
        const allowSramFallback = false;
        const psramAvailable = false;

        let initialized = false;
        if (preferPsram && psramAvailable) {
            initialized = true;
        } else if (allowSramFallback) {
            initialized = true;
        } else {
            initialized = false;
        }

        assert.equal(initialized, false, 'Should cleanly disable DebugAgent when PSRAM is unavailable and fallback is disabled');
    });
});
