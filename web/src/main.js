// Main entry point for Web UI: WebSocket client, navigation, and tabs

import { DashboardView } from './dashboard.js';
import { ConsoleView } from './console.js';

class App {
    constructor() {
        this.dashboard = new DashboardView();
        this.console = new ConsoleView();

        this.activeTab = 'dashboard';
        this.ws = null;
        this.currentDevice = null;
        this.customMetrics = {};
        this.states = {};
        this.rxCount = 0;
        this.rxRate = 0;

        this.initTabs();
        this.initDiagnosticsExport();
        this.connectWebSocket();
        this.startRxRateMeter();
    }

    initTabs() {
        const navBtns = document.querySelectorAll('.nav-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        document.querySelectorAll('.nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        if (tabName === 'dashboard') {
            document.getElementById('tabDashboard').classList.add('active');
            this.dashboard.memChart.resize();
            this.dashboard.rssiChart.resize();
        } else if (tabName === 'console') {
            document.getElementById('tabConsole').classList.add('active');
        } else if (tabName === 'variables') {
            document.getElementById('tabVariables').classList.add('active');
            this.renderVariables();
        } else if (tabName === 'diagnostics') {
            document.getElementById('tabDiagnostics').classList.add('active');
            this.updateDiagnosticsTab();
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const statusDot = document.querySelector('.status-dot');
        const statusText = document.getElementById('wsStatusText');

        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Connexion WS...';

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connecté (WS)';
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWsMessage(data);
            } catch (err) {
                console.warn('WS JSON parse error:', err);
            }
        };

        this.ws.onclose = () => {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Reconnexion WS...';
            setTimeout(() => this.connectWebSocket(), 2000);
        };

        this.ws.onerror = (err) => {
            console.warn('WS error:', err);
        };
    }

    handleWsMessage(msg) {
        this.rxCount++;

        switch (msg.type) {
            case 'init':
                if (msg.device) {
                    this.currentDevice = msg.device;
                    this.customMetrics = msg.device.customMetrics || {};
                    this.states = msg.device.states || {};
                    this.updateHeaderPill(msg.device);
                    this.dashboard.update(msg.device);
                    this.renderVariables();
                }
                if (msg.recentLogs) {
                    for (const l of msg.recentLogs) {
                        this.console.addLog(l);
                    }
                }
                break;

            case 'device_connected':
                this.currentDevice = msg.device;
                this.updateHeaderPill(msg.device);
                this.dashboard.update(msg.device);
                break;

            case 'device_disconnected':
                if (this.currentDevice) this.currentDevice.connected = false;
                this.dashboard.update(this.currentDevice);
                this.updateHeaderPill(this.currentDevice);
                break;

            case 'device_hello':
                if (this.currentDevice) {
                    this.currentDevice.info = msg.info;
                    this.updateHeaderPill(this.currentDevice);
                    this.dashboard.update(this.currentDevice);
                }
                break;

            case 'log':
                this.console.addLog(msg.log);
                if (this.currentDevice && msg.stats) {
                    this.currentDevice.stats = msg.stats;
                    this.dashboard.update(this.currentDevice);
                }
                break;

            case 'metrics':
                if (this.currentDevice) {
                    this.currentDevice.currentMetrics = msg.metrics;
                    this.currentDevice.timeSeries = msg.timeSeries;
                    this.currentDevice.stats = msg.stats;
                    this.dashboard.update(this.currentDevice);
                    this.updateDiagnosticsTab();
                }
                break;

            case 'custom_metric':
                this.customMetrics[msg.name] = {
                    value: msg.value,
                    updatedAt: msg.updatedAt
                };
                this.renderVariables();
                break;

            case 'state':
                this.states[msg.name] = {
                    value: msg.value,
                    updatedAt: msg.updatedAt
                };
                this.renderVariables();
                break;

            case 'stats':
                if (this.currentDevice) {
                    this.currentDevice.stats = msg.stats;
                    this.dashboard.update(this.currentDevice);
                    this.updateDiagnosticsTab();
                }
                break;

            case 'report_data':
                this.displayReport(msg.report);
                break;
        }
    }

    updateHeaderPill(device) {
        const nameEl = document.getElementById('pillDeviceName');
        const ipEl = document.getElementById('pillDeviceIp');
        if (!device) {
            nameEl.textContent = 'Non détecté';
            ipEl.textContent = '-';
            return;
        }

        nameEl.textContent = `${device.info?.device || 'CoreS3'} (${device.connected ? 'ONLINE' : 'OFFLINE'})`;
        nameEl.style.color = device.connected ? 'var(--accent-green)' : 'var(--accent-red)';
        ipEl.textContent = device.ip || '-';
    }

    renderVariables() {
        const grid = document.getElementById('variablesGrid');
        const countBadge = document.getElementById('varCountBadge');

        const metricKeys = Object.keys(this.customMetrics);
        const stateKeys = Object.keys(this.states);
        const total = metricKeys.length + stateKeys.length;

        if (countBadge) countBadge.textContent = total;

        if (total === 0) {
            grid.innerHTML = '<div class="empty-state">Aucune variable personnalisée ou état reçu pour le moment.</div>';
            return;
        }

        grid.innerHTML = '';

        // Render States first
        for (const key of stateKeys) {
            const item = this.states[key];
            const card = document.createElement('div');
            card.className = 'var-card';
            card.innerHTML = `
                <div class="var-header">
                    <span class="var-name">${key}</span>
                    <span class="var-type">ÉTAT (State)</span>
                </div>
                <div class="var-value" style="color: var(--accent-blue)">${item.value}</div>
                <div class="var-time">Màj: ${new Date(item.updatedAt).toLocaleTimeString()}</div>
            `;
            grid.appendChild(card);
        }

        // Render Metrics
        for (const key of metricKeys) {
            const item = this.customMetrics[key];
            const card = document.createElement('div');
            card.className = 'var-card';
            card.innerHTML = `
                <div class="var-header">
                    <span class="var-name">${key}</span>
                    <span class="var-type">MÉTRIQUE</span>
                </div>
                <div class="var-value" style="color: var(--accent-green)">${item.value}</div>
                <div class="var-time">Màj: ${new Date(item.updatedAt).toLocaleTimeString()}</div>
            `;
            grid.appendChild(card);
        }
    }

    startRxRateMeter() {
        setInterval(() => {
            this.rxRate = this.rxCount;
            this.rxCount = 0;
            const rxEl = document.getElementById('diagRxRate');
            if (rxEl) rxEl.textContent = `${this.rxRate} msg/s`;
        }, 1000);
    }

    updateDiagnosticsTab() {
        const metrics = this.currentDevice?.currentMetrics || {};
        const stats = this.currentDevice?.stats || {};

        const avgUs = metrics.avg_update_us || 0;
        const maxUs = metrics.max_update_us || 0;
        const budgetOverruns = stats.budgetOverruns || metrics.budget_overruns || 0;
        const overruns1ms = stats.updateOverruns1ms || metrics.overruns_1ms || 0;

        const elAvg = document.getElementById('diagAvgUpdate');
        const elMax = document.getElementById('diagMaxUpdate');
        const elOverruns = document.getElementById('diagBudgetOverruns');
        const elOver1ms = document.getElementById('diagOverruns1ms');

        if (elAvg) elAvg.textContent = `${avgUs} µs`;
        if (elMax) elMax.textContent = `${maxUs} µs`;
        if (elOverruns) elOverruns.textContent = `${budgetOverruns}`;
        if (elOver1ms) elOver1ms.textContent = `${overruns1ms}`;

        // Memory elements
        const elDynSram = document.getElementById('diagDynamicSram');
        const elDynPsram = document.getElementById('diagDynamicPsram');
        if (elDynSram) elDynSram.textContent = `${Math.round((metrics.heap || 0) / 1024)} Ko`;
        if (elDynPsram) elDynPsram.textContent = `${Math.round((metrics.psram || 0) / 1024)} Ko`;

        // Buffer & Reliability elements
        const bufUsed = stats.bufferUsed || 0;
        const bufCap = stats.bufferCapacity || 8192;
        const bufHwm = stats.bufferHighWatermark || 0;

        const elBufUsed = document.getElementById('diagBufferUsed');
        const elBufHwm = document.getElementById('diagBufferHwm');
        const elDropped = document.getElementById('diagDroppedCount');
        const elDuplicate = document.getElementById('diagDuplicateCount');
        const elSocketErrors = document.getElementById('diagSocketErrors');
        const elTruncated = document.getElementById('diagTruncatedCount');

        if (elBufUsed) elBufUsed.textContent = `${bufUsed} / ${bufCap} octets`;
        if (elBufHwm) elBufHwm.textContent = `${bufHwm} octets`;
        if (elDropped) elDropped.textContent = stats.droppedByDevice ?? 0;
        if (elDuplicate) elDuplicate.textContent = stats.duplicatesCount ?? 0;
        if (elSocketErrors) elSocketErrors.textContent = stats.socketErrors ?? 0;
        if (elTruncated) elTruncated.textContent = stats.truncated ?? 0;
    }

    initDiagnosticsExport() {
        const btnExport = document.getElementById('btnExportReport');
        btnExport.addEventListener('click', () => {
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: 'get_report' }));
            } else {
                fetch('/api/report')
                    .then(r => r.json())
                    .then(report => this.displayReport(report))
                    .catch(e => alert('Erreur génération rapport: ' + e.message));
            }
        });

        document.getElementById('btnCopyReport').addEventListener('click', () => {
            const content = document.getElementById('reportPreviewContent').textContent;
            navigator.clipboard.writeText(content).then(() => {
                alert('Rapport de diagnostic copié dans le presse-papiers.');
            });
        });
    }

    displayReport(report) {
        const preview = document.getElementById('reportPreviewContent');
        if (report.standardReportText) {
            preview.textContent = report.standardReportText;
            return;
        }

        const metrics = report.currentMetrics || {};
        const stats = report.stats || {};
        const conn = report.connection || {};
        const dev = report.device || {};

        const md = [
            `========================================================`,
            ` CoreS3-DebugMonitor v0.1.0.1`,
            ` NON-BLOCKING & MEMORY RELIABILITY REPORT`,
            `========================================================`,
            ``,
            `[DEVICE]`,
            `Firmware: ${dev.app || 'N/A'} (${dev.version || '0.1.0.1'})`,
            `BootId: ${dev.bootId || 'N/A'}`,
            `Uptime: ${conn.uptimeSec || 0} s`,
            `Wi-Fi RSSI: ${metrics.rssi || 0} dBm`,
            `Transport state: ${conn.connected ? 'CONNECTED' : 'DISCONNECTED'}`,
            ``,
            `[MEMORY]`,
            `SRAM current: ${metrics.heap || 0} bytes (${Math.round((metrics.heap || 0) / 1024)} KB)`,
            `SRAM minimum: ${metrics.min_heap || 0} bytes (${Math.round((metrics.min_heap || 0) / 1024)} KB)`,
            `Largest free SRAM block: ${metrics.max_alloc || 0} bytes (${Math.round((metrics.max_alloc || 0) / 1024)} KB)`,
            `PSRAM available: ${metrics.psram || 0} bytes (${Math.round((metrics.psram || 0) / 1024)} KB)`,
            `PSRAM allocated: 8192 bytes (8.0 KB)`,
            `Static footprint: ~1520 bytes (BSS/Data)`,
            ``,
            `[BUFFER]`,
            `Capacity: ${stats.bufferCapacity || 8192} bytes`,
            `Current usage: ${stats.bufferUsed || 0} bytes`,
            `High watermark: ${stats.bufferHighWatermark || 0} bytes`,
            `Pending messages: ${(stats.messagesEnqueued || 0) - (stats.messagesSent || 0)}`,
            `Dropped messages: ${stats.droppedByDevice || 0}`,
            `Truncated messages: ${stats.truncated || 0}`,
            ``,
            `[TRANSPORT]`,
            `Successful connections: ${conn.connected ? 1 : 0}`,
            `Reconnects: ${stats.reconnects || 0}`,
            `Socket errors: ${stats.socketErrors || 0}`,
            `Messages sent: ${stats.messagesSent || stats.received || 0}`,
            `Bytes sent: ${stats.bytesSent || 0}`,
            ``,
            `[PERFORMANCE]`,
            `Average update: ${metrics.avg_update_us || 0} us`,
            `Maximum update: ${metrics.max_update_us || 0} us`,
            `Budget overruns (> 200 us): ${stats.budgetOverruns || 0}`,
            `Overruns above 1 ms: ${stats.updateOverruns1ms || 0}`,
            ``,
            `[PROTOCOL]`,
            `Invalid JSON: ${stats.invalidCount || 0}`,
            `Duplicate messages: ${stats.duplicatesCount || 0}`,
            `Sequence gaps: ${stats.sequenceGaps || 0}`,
            `Lost in transit: ${stats.lostInTransit || 0}`,
            ``,
            `========================================================`
        ].join('\n');

        preview.textContent = md;
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
