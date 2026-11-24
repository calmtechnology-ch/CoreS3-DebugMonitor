import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import http from 'http';
import WebSocket from 'ws';
import { DeviceManager } from '../server/device-manager.js';
import { createTcpServer } from '../server/tcp-server.js';
import { createWebSocketServer } from '../server/websocket-server.js';

describe('Server & WebSocket Integration Tests', () => {
    const TEST_TCP_PORT = 9988;
    const TEST_HTTP_PORT = 8877;

    test('handles full cycle: TCP client -> Server -> WebSocket broadcast', async () => {
        const dm = new DeviceManager(100, 50);
        const tcp = createTcpServer(dm, TEST_TCP_PORT, '127.0.0.1');
        await tcp.start();

        const httpServer = http.createServer();
        const wsObj = createWebSocketServer(httpServer, dm);
        await new Promise(resolve => httpServer.listen(TEST_HTTP_PORT, '127.0.0.1', resolve));

        // Connect WebSocket client
        const wsClient = new WebSocket(`ws://127.0.0.1:${TEST_HTTP_PORT}/ws`);
        const wsReceived = [];

        await new Promise((resolve) => {
            wsClient.on('open', resolve);
            wsClient.on('message', (data) => {
                wsReceived.push(JSON.parse(data.toString()));
            });
        });

        // Verify init message sent on connect
        assert.equal(wsReceived.length >= 1, true);
        assert.equal(wsReceived[0].type, 'init');

        // Connect TCP client (simulating CoreS3)
        const tcpClient = net.createConnection({ host: '127.0.0.1', port: TEST_TCP_PORT });
        await new Promise(resolve => tcpClient.on('connect', resolve));

        // Send hello & log via TCP
        const helloMsg = JSON.stringify({
            type: 'hello',
            protocol: 1,
            device: 'CoreS3-E2E',
            app: 'BasicDiagnostics',
            version: '0.1.0'
        }) + '\n';

        const logMsg = JSON.stringify({
            type: 'log',
            seq: 1,
            level: 'INFO',
            tag: 'TEST',
            message: 'Integration test message'
        }) + '\n';

        tcpClient.write(helloMsg);
        tcpClient.write(logMsg);

        // Wait for WebSocket forward
        await new Promise(resolve => setTimeout(resolve, 150));

        const receivedLog = wsReceived.find(m => m.type === 'log');
        assert.ok(receivedLog, 'WebSocket should receive forwarded log');
        assert.equal(receivedLog.log.message, 'Integration test message');
        assert.equal(receivedLog.log.tag, 'TEST');

        // Clean up
        tcpClient.destroy();
        wsClient.close();
        await wsObj.close();
        await new Promise(resolve => httpServer.close(resolve));
        await tcp.stop();
    });
});
