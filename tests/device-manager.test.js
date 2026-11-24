import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../server/device-manager.js';

describe('DeviceManager & Loss Tracking Tests', () => {
    test('registers and unregisters devices correctly', () => {
        const dm = new DeviceManager(100, 50);
        const dummySocket = {};
        const dev = dm.registerDevice(dummySocket, '192.168.1.50', 54321);

        assert.equal(dev.ip, '192.168.1.50');
        assert.equal(dev.port, 54321);
        assert.equal(dev.connected, true);
        assert.equal(dm.getActiveDevice().id, dev.id);

        dm.unregisterDevice(dummySocket);
        assert.equal(dev.connected, false);
    });

    test('detects lost packets via sequence gap detection', () => {
        const dm = new DeviceManager(100, 50);
        const socket = {};
        const dev = dm.registerDevice(socket, '192.168.1.50', 54321);

        dm.handleMessage(socket, { type: 'log', seq: 1, message: 'm1' });
        assert.equal(dev.stats.lostInTransit, 0);

        dm.handleMessage(socket, { type: 'log', seq: 2, message: 'm2' });
        assert.equal(dev.stats.lostInTransit, 0);

        // Sequence jump: expected 3, received 7 (4 messages lost)
        dm.handleMessage(socket, { type: 'log', seq: 7, message: 'm7' });
        assert.equal(dev.stats.lostInTransit, 4);
    });

    test('enforces circular buffer cap on log history', () => {
        const maxLogs = 5;
        const dm = new DeviceManager(maxLogs, 10);
        const socket = {};
        const dev = dm.registerDevice(socket, '192.168.1.50', 54321);

        for (let i = 1; i <= 15; i++) {
            dm.handleMessage(socket, { type: 'log', seq: i, message: `msg ${i}` });
        }

        assert.equal(dev.logHistory.length, maxLogs);
        assert.equal(dev.logHistory[0].seq, 11);
        assert.equal(dev.logHistory[maxLogs - 1].seq, 15);
    });

    test('tracks custom metrics and dynamic states', () => {
        const dm = new DeviceManager(100, 50);
        const socket = {};
        const dev = dm.registerDevice(socket, '192.168.1.50', 54321);

        dm.handleMessage(socket, { type: 'state', name: 'PTT', value: 'LISTENING', rxTime: '2026-11-24T10:00:00Z' });
        dm.handleMessage(socket, { type: 'metric', name: 'temperature', value: 27.5, rxTime: '2026-11-24T10:00:01Z' });

        assert.equal(dev.states['PTT'].value, 'LISTENING');
        assert.equal(dev.customMetrics['temperature'].value, 27.5);
    });

    test('generates Antigravity summary report', () => {
        const dm = new DeviceManager(100, 50);
        const socket = {};
        dm.registerDevice(socket, '192.168.1.50', 54321);

        dm.handleMessage(socket, {
            type: 'hello',
            protocol: 1,
            device: 'CoreS3-Test',
            app: 'BasicDiagnostics',
            version: '0.1.0'
        });
        dm.handleMessage(socket, {
            type: 'metrics',
            seq: 1,
            heap: 140000,
            psram: 8000000,
            avg_update_us: 65,
            max_update_us: 210
        });

        const report = dm.getSummaryReport();
        assert.equal(report.device.device, 'CoreS3-Test');
        assert.equal(report.currentMetrics.heap, 140000);
        assert.equal(report.currentMetrics.avg_update_us, 65);
    });
});
