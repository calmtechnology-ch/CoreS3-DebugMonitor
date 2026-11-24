import { WebSocketServer } from 'ws';

export function createWebSocketServer(httpServer, deviceManager) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    function broadcast(data) {
        const json = JSON.stringify(data);
        for (const client of wss.clients) {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(json);
            }
        }
    }

    wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS] Web client connected from ${clientIp} (active clients: ${wss.clients.size})`);

        // Send initial state synchronization
        const activeDevice = deviceManager.getActiveDevice();
        const initPayload = {
            type: 'init',
            serverTime: new Date().toISOString(),
            device: activeDevice ? {
                id: activeDevice.id,
                ip: activeDevice.ip,
                connected: activeDevice.connected,
                info: activeDevice.info,
                stats: activeDevice.stats,
                currentMetrics: activeDevice.currentMetrics,
                customMetrics: activeDevice.customMetrics,
                states: activeDevice.states,
                timeSeries: activeDevice.timeSeries
            } : null,
            recentLogs: activeDevice ? activeDevice.logHistory.slice(-500) : []
        };

        ws.send(JSON.stringify(initPayload));

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'get_report') {
                    ws.send(JSON.stringify({
                        type: 'report_data',
                        report: deviceManager.getSummaryReport()
                    }));
                }
            } catch (e) {
                // Ignore malformed client queries
            }
        });

        ws.on('close', () => {
            console.log(`[WS] Web client disconnected (active clients: ${wss.clients.size})`);
        });
    });

    // Device Manager event forwarders
    deviceManager.on('device_connected', (dev) => {
        broadcast({ type: 'device_connected', device: dev });
    });

    deviceManager.on('device_disconnected', (dev) => {
        broadcast({ type: 'device_disconnected', device: dev });
    });

    deviceManager.on('device_hello', ({ device, msg }) => {
        broadcast({ type: 'device_hello', deviceId: device.id, info: device.info, msg });
    });

    deviceManager.on('log', ({ device, msg }) => {
        broadcast({ type: 'log', deviceId: device.id, log: msg, stats: device.stats });
    });

    deviceManager.on('metrics', ({ device, msg }) => {
        broadcast({
            type: 'metrics',
            deviceId: device.id,
            metrics: device.currentMetrics,
            timeSeries: device.timeSeries,
            stats: device.stats
        });
    });

    deviceManager.on('custom_metric', ({ device, msg }) => {
        broadcast({
            type: 'custom_metric',
            deviceId: device.id,
            name: msg.name,
            value: msg.value,
            updatedAt: msg.rxTime
        });
    });

    deviceManager.on('state', ({ device, msg }) => {
        broadcast({
            type: 'state',
            deviceId: device.id,
            name: msg.name,
            value: msg.value,
            updatedAt: msg.rxTime
        });
    });

    deviceManager.on('stats', ({ device, msg }) => {
        broadcast({ type: 'stats', deviceId: device.id, stats: device.stats });
    });

    deviceManager.on('invalid_message', ({ device, error }) => {
        broadcast({ type: 'invalid_message', deviceId: device.id, error, stats: device.stats });
    });

    return {
        wss,
        broadcast,
        close: () => new Promise((resolve) => wss.close(resolve))
    };
}
