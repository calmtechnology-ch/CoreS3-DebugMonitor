import { EventEmitter } from 'events';

export class DeviceManager extends EventEmitter {
    constructor(maxHistory = 5000, maxTimeSeries = 120) {
        super();
        this.maxHistory = maxHistory;
        this.maxTimeSeries = maxTimeSeries;
        this.devices = new Map(); // socket -> deviceData
        this.activeDeviceId = null;
    }

    registerDevice(socket, remoteAddress, remotePort) {
        const id = `${remoteAddress}:${remotePort}`;
        const deviceData = {
            id,
            ip: remoteAddress,
            port: remotePort,
            connectedAt: Date.now(),
            lastSeenAt: Date.now(),
            connected: true,
            info: {
                device: 'Unknown',
                app: 'Unknown',
                version: '0.0.0',
                protocol: 1
            },
            stats: {
                received: 0,
                droppedByDevice: 0,
                lostInTransit: 0,
                truncated: 0,
                reconnects: 0,
                invalidCount: 0,
                lastSeq: 0
            },
            currentMetrics: {
                heap: 0,
                min_heap: 0,
                max_alloc: 0,
                psram: 0,
                rssi: 0,
                avg_update_us: 0,
                max_update_us: 0,
                sramUsed: 0,
                psramUsed: 0
            },
            customMetrics: {}, // name -> { value, updatedAt }
            states: {},        // name -> { value, updatedAt }
            logHistory: [],
            timeSeries: {
                timestamps: [],
                heap: [],
                psram: [],
                rssi: [],
                avgUpdateUs: []
            }
        };

        this.devices.set(socket, deviceData);
        this.activeDeviceId = id;
        this.emit('device_connected', deviceData);
        return deviceData;
    }

    unregisterDevice(socket) {
        const deviceData = this.devices.get(socket);
        if (deviceData) {
            deviceData.connected = false;
            deviceData.disconnectedAt = Date.now();
            this.emit('device_disconnected', deviceData);
            this.devices.delete(socket);
        }
    }

    handleMessage(socket, msg) {
        const dev = this.devices.get(socket);
        if (!dev) return;

        dev.lastSeenAt = Date.now();
        dev.stats.received++;

        // Track sequence numbers and detect dropped / lost packets
        if (typeof msg.seq === 'number') {
            if (dev.stats.lastSeq > 0 && msg.seq > dev.stats.lastSeq + 1) {
                const gap = msg.seq - (dev.stats.lastSeq + 1);
                dev.stats.lostInTransit += gap;
            }
            dev.stats.lastSeq = msg.seq;
        }

        switch (msg.type) {
            case 'hello':
                dev.info = {
                    device: msg.device || dev.info.device,
                    app: msg.app || dev.info.app,
                    version: msg.version || dev.info.version,
                    protocol: msg.protocol || 1
                };
                this.emit('device_hello', { device: dev, msg });
                break;

            case 'log':
                dev.logHistory.push(msg);
                if (dev.logHistory.length > this.maxHistory) {
                    dev.logHistory.shift();
                }
                this.emit('log', { device: dev, msg });
                break;

            case 'metrics':
                dev.currentMetrics = {
                    heap: msg.heap ?? dev.currentMetrics.heap,
                    min_heap: msg.min_heap ?? dev.currentMetrics.min_heap,
                    max_alloc: msg.max_alloc ?? dev.currentMetrics.max_alloc,
                    psram: msg.psram ?? dev.currentMetrics.psram,
                    rssi: msg.rssi ?? dev.currentMetrics.rssi,
                    avg_update_us: msg.avg_update_us ?? dev.currentMetrics.avg_update_us,
                    max_update_us: msg.max_update_us ?? dev.currentMetrics.max_update_us
                };

                // Update time series
                dev.timeSeries.timestamps.push(new Date(msg.rxMs).toLocaleTimeString());
                dev.timeSeries.heap.push(Math.round((msg.heap || 0) / 1024));
                dev.timeSeries.psram.push(Math.round((msg.psram || 0) / 1024));
                dev.timeSeries.rssi.push(msg.rssi || 0);
                dev.timeSeries.avgUpdateUs.push(msg.avg_update_us || 0);

                if (dev.timeSeries.timestamps.length > this.maxTimeSeries) {
                    dev.timeSeries.timestamps.shift();
                    dev.timeSeries.heap.shift();
                    dev.timeSeries.psram.shift();
                    dev.timeSeries.rssi.shift();
                    dev.timeSeries.avgUpdateUs.shift();
                }

                this.emit('metrics', { device: dev, msg });
                break;

            case 'metric':
                if (msg.name) {
                    dev.customMetrics[msg.name] = {
                        value: msg.value,
                        updatedAt: msg.rxTime
                    };
                    this.emit('custom_metric', { device: dev, msg });
                }
                break;

            case 'state':
                if (msg.name) {
                    dev.states[msg.name] = {
                        value: msg.value,
                        updatedAt: msg.rxTime
                    };
                    this.emit('state', { device: dev, msg });
                }
                break;

            case 'stats':
                if (typeof msg.dropped === 'number') dev.stats.droppedByDevice = msg.dropped;
                if (typeof msg.truncated === 'number') dev.stats.truncated = msg.truncated;
                if (typeof msg.reconnects === 'number') dev.stats.reconnects = msg.reconnects;
                this.emit('stats', { device: dev, msg });
                break;

            default:
                this.emit('other_message', { device: dev, msg });
                break;
        }

        this.emit('message', { device: dev, msg });
    }

    recordInvalid(socket, error) {
        const dev = this.devices.get(socket);
        if (dev) {
            dev.stats.invalidCount++;
            this.emit('invalid_message', { device: dev, error });
        }
    }

    getActiveDevice() {
        for (const dev of this.devices.values()) {
            if (dev.connected) return dev;
        }
        // Return latest registered device even if currently disconnected
        const all = Array.from(this.devices.values());
        return all.length > 0 ? all[all.length - 1] : null;
    }

    getSummaryReport() {
        const dev = this.getActiveDevice();
        if (!dev) return { error: 'NO_DEVICE_CONNECTED' };

        return {
            timestamp: new Date().toISOString(),
            device: dev.info,
            connection: {
                ip: dev.ip,
                port: dev.port,
                connected: dev.connected,
                connectedAt: new Date(dev.connectedAt).toISOString(),
                uptimeSec: Math.floor((Date.now() - dev.connectedAt) / 1000)
            },
            stats: dev.stats,
            currentMetrics: dev.currentMetrics,
            customMetrics: dev.customMetrics,
            states: dev.states,
            recentLogsCount: dev.logHistory.length
        };
    }
}
