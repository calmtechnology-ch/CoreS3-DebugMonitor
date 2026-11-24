import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeviceManager } from '../server/device-manager.js';
import { createTcpServer } from '../server/tcp-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Device Simulator Execution Test', () => {
    test('simulator connects to TCP server and streams valid NDJSON', async () => {
        const TEST_PORT = 9977;
        const dm = new DeviceManager(100, 50);
        const tcp = createTcpServer(dm, TEST_PORT, '127.0.0.1');
        await tcp.start();

        const receivedMessages = [];
        dm.on('message', ({ msg }) => {
            receivedMessages.push(msg);
        });

        // Launch simulator
        const simPath = path.resolve(__dirname, '../tools/device-simulator.js');
        const simProc = spawn(process.execPath, [simPath, '--port', String(TEST_PORT), '--burst'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Wait 3.5 seconds for simulator to send hello, metrics, and logs
        await new Promise((resolve) => setTimeout(resolve, 3500));

        simProc.kill('SIGTERM');
        await tcp.stop();

        assert.ok(receivedMessages.length >= 3, `Expected at least 3 messages, got ${receivedMessages.length}`);
        const hello = receivedMessages.find(m => m.type === 'hello');
        assert.ok(hello, 'Expected hello packet from simulator');
        assert.equal(hello.device, 'CoreS3-Sim');

        const metrics = receivedMessages.find(m => m.type === 'metrics');
        assert.ok(metrics, 'Expected metrics packet from simulator');
        assert.ok(metrics.heap > 0, 'Expected valid heap metric');
    });
});
