import { EventEmitter } from 'events';

export class DeviceManager extends EventEmitter {
    constructor(maxHistory = 5000, maxTimeSeries = 120) {
        super();
        this.maxHistory = maxHistory;
        this.maxTimeSeries = maxTimeSeries;
        this.devices = new Map(); // socket -> deviceData
        this.devicesByBootId = new Map(); // bootId -> deviceData
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
            bootId: null,
            info: {
                device: 'Unknown',
                app: 'Unknown',
                version: '0.0.0',
                bootId: null,
                protocol: 1
            },
            stats: {
                received: 0,
                messagesAttempted: 0,
                messagesEnqueued: 0,
                messagesSent: 0,
                droppedByDevice: 0,
                lostInTransit: 0,
                duplicatesCount: 0,
                sequenceGaps: 0,
                truncated: 0,
                reconnects: 0,
                socketErrors: 0,
                invalidCount: 0,
                lastSeq: 0,
                bytesSent: 0,
                bufferUsed: 0,
                bufferCapacity: 8192,
                bufferHighWatermark: 0,
                budgetOverruns: 0,
                updateOverruns1ms: 0
            },
            currentMetrics: {
                heap: 0,
                min_heap: 0,
                max_alloc: 0,
                psram: 0,
                rssi: 0,
                avg_update_us: 0,
                max_update_us: 0,
                min_update_us: 0,
                budget_overruns: 0,
                overruns_1ms: 0,
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

        // Handle Hello Message & distinguish Reconnect vs Hardware Reboot
        if (msg.type === 'hello') {
            const bootId = msg.bootId || null;

            if (bootId && this.devicesByBootId.has(bootId)) {
                // Reconnection of an existing session: restore history & stats
                const existingDev = this.devicesByBootId.get(bootId);
                existingDev.connected = true;
                existingDev.ip = dev.ip;
                existingDev.port = dev.port;
                existingDev.lastSeenAt = Date.now();
                existingDev.stats.reconnects++;
                existingDev.info = {
                    device: msg.device || existingDev.info.device,
                    app: msg.app || existingDev.info.app,
                    version: msg.version || existingDev.info.version,
                    bootId,
                    protocol: msg.protocol || 1
                };

                this.devices.set(socket, existingDev);
                this.activeDeviceId = existingDev.id;
                this.emit('device_hello', { device: existingDev, msg });
                this.emit('message', { device: existingDev, msg });
                return;
            }

            if (bootId) {
                this.devicesByBootId.set(bootId, dev);
                dev.bootId = bootId;
            }

            dev.info = {
                device: msg.device || dev.info.device,
                app: msg.app || dev.info.app,
                version: msg.version || dev.info.version,
                bootId: msg.bootId || dev.info.bootId,
                protocol: msg.protocol || 1
            };

            this.emit('device_hello', { device: dev, msg });
            this.emit('message', { device: dev, msg });
            return;
        }

        // Sequence Number Tracking & Duplicate / Loss Detection
        if (typeof msg.seq === 'number') {
            if (dev.stats.lastSeq > 0 && msg.seq <= dev.stats.lastSeq) {
                // Duplicate packet detected!
                dev.stats.duplicatesCount++;
                this.emit('duplicate_message', { device: dev, msg });
                if (msg.type === 'log') {
                    // Drop duplicate log to prevent pollutive replay in history
                    return;
                }
            } else if (dev.stats.lastSeq > 0 && msg.seq > dev.stats.lastSeq + 1) {
                const gap = msg.seq - (dev.stats.lastSeq + 1);
                dev.stats.lostInTransit += gap;
                dev.stats.sequenceGaps++;
                dev.stats.lastSeq = msg.seq;
            } else {
                dev.stats.lastSeq = msg.seq;
            }
        }

        switch (msg.type) {
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
                    max_update_us: msg.max_update_us ?? dev.currentMetrics.max_update_us,
                    min_update_us: msg.min_update_us ?? dev.currentMetrics.min_update_us,
                    budget_overruns: msg.budget_overruns ?? dev.currentMetrics.budget_overruns,
                    overruns_1ms: msg.overruns_1ms ?? dev.currentMetrics.overruns_1ms,
                    sramUsed: dev.currentMetrics.sramUsed,
                    psramUsed: dev.currentMetrics.psramUsed
                };

                // Track timing in stats
                if (typeof msg.budget_overruns === 'number') {
                    dev.stats.budgetOverruns = msg.budget_overruns;
                }
                if (typeof msg.overruns_1ms === 'number') {
                    dev.stats.updateOverruns1ms = msg.overruns_1ms;
                }

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
                if (typeof msg.attempted === 'number') dev.stats.messagesAttempted = msg.attempted;
                if (typeof msg.enqueued === 'number') dev.stats.messagesEnqueued = msg.enqueued;
                if (typeof msg.sent === 'number') dev.stats.messagesSent = msg.sent;
                if (typeof msg.dropped === 'number') dev.stats.droppedByDevice = msg.dropped;
                if (typeof msg.truncated === 'number') dev.stats.truncated = msg.truncated;
                if (typeof msg.bytes_sent === 'number') dev.stats.bytesSent = msg.bytes_sent;
                if (typeof msg.buf_used === 'number') dev.stats.bufferUsed = msg.buf_used;
                if (typeof msg.buf_cap === 'number') dev.stats.bufferCapacity = msg.buf_cap;
                if (typeof msg.buf_hwm === 'number') dev.stats.bufferHighWatermark = msg.buf_hwm;
                if (typeof msg.reconnects === 'number') dev.stats.reconnects = msg.reconnects;
                if (typeof msg.sock_errors === 'number') dev.stats.socketErrors = msg.sock_errors;
                if (typeof msg.overruns === 'number') dev.stats.budgetOverruns = msg.overruns;
                if (typeof msg.overruns_1ms === 'number') dev.stats.updateOverruns1ms = msg.overruns_1ms;

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
        const all = Array.from(this.devices.values());
        return all.length > 0 ? all[all.length - 1] : null;
    }

    getSummaryReport() {
        const dev = this.getActiveDevice();
        if (!dev) return { error: 'NO_DEVICE_CONNECTED' };

        const stats = dev.stats;
        const metrics = dev.currentMetrics;

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
            stats,
            currentMetrics: metrics,
            customMetrics: dev.customMetrics,
            states: dev.states,
            recentLogsCount: dev.logHistory.length,
            standardReportText: [
                "========================================================",
                " CoreS3-DebugMonitor v0.1.0.1",
                " NON-BLOCKING & MEMORY RELIABILITY REPORT",
                "========================================================",
                "",
                "[DEVICE]",
                `Firmware: ${dev.info.app} (${dev.info.version})`,
                `BootId: ${dev.info.bootId || 'N/A'}`,
                `Uptime: ${Math.floor((Date.now() - dev.connectedAt) / 1000)} s`,
                `Wi-Fi RSSI: ${metrics.rssi} dBm`,
                `Transport state: ${dev.connected ? 'CONNECTED' : 'DISCONNECTED'}`,
                "",
                "[MEMORY]",
                `SRAM current: ${metrics.heap} bytes (${Math.round(metrics.heap / 1024)} KB)`,
                `SRAM minimum: ${metrics.min_heap} bytes (${Math.round(metrics.min_heap / 1024)} KB)`,
                `Largest free SRAM block: ${metrics.max_alloc} bytes (${Math.round(metrics.max_alloc / 1024)} KB)`,
                `PSRAM available: ${metrics.psram} bytes (${Math.round(metrics.psram / 1024)} KB)`,
                `PSRAM allocated: 8192 bytes (8.0 KB)`,
                `Static footprint: ~1520 bytes (BSS/Data)`,
                "",
                "[BUFFER]",
                `Capacity: ${stats.bufferCapacity || 8192} bytes`,
                `Current usage: ${stats.bufferUsed} bytes`,
                `High watermark: ${stats.bufferHighWatermark} bytes`,
                `Pending messages: ${stats.messagesEnqueued - stats.messagesSent}`,
                `Dropped messages: ${stats.droppedByDevice}`,
                `Truncated messages: ${stats.truncated}`,
                "",
                "[TRANSPORT]",
                `Successful connections: ${dev.connected ? 1 : 0}`,
                `Reconnects: ${stats.reconnects}`,
                `Socket errors: ${stats.socketErrors}`,
                `Messages sent: ${stats.messagesSent || stats.received}`,
                `Bytes sent: ${stats.bytesSent}`,
                "",
                "[PERFORMANCE]",
                `Average update: ${metrics.avg_update_us} us`,
                `Maximum update: ${metrics.max_update_us} us`,
                `Budget overruns (> 200 us): ${stats.budgetOverruns}`,
                `Overruns above 1 ms: ${stats.updateOverruns1ms}`,
                "",
                "[PROTOCOL]",
                `Invalid JSON: ${stats.invalidCount}`,
                `Duplicate messages: ${stats.duplicatesCount}`,
                `Sequence gaps: ${stats.sequenceGaps}`,
                `Lost in transit: ${stats.lostInTransit}`,
                "",
                "========================================================"
            ].join('\n')
        };
    }
}
