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

        document.getElementById('diagAvgUpdate').textContent = `${avgUs} µs`;
        document.getElementById('diagMaxUpdate').textContent = `${maxUs} µs`;

        document.getElementById('diagInvalidCount').textContent = stats.invalidCount || 0;
        document.getElementById('diagTruncatedCount').textContent = stats.truncated || 0;

        const dropped = stats.droppedByDevice || 0;
        const received = stats.received || 1;
        const saturation = ((dropped / (dropped + received)) * 100).toFixed(2);
        document.getElementById('diagBufferSaturation').textContent = `${saturation} %`;
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
        const md = [
            `# Rapport de Diagnostic CoreS3-DebugMonitor v0.1.0`,
            `Généré le : ${report.timestamp || new Date().toISOString()}`,
            ``,
            `## 1. Identité Matériel & Logiciel`,
            `- **Appareil** : ${report.device?.device || 'N/A'}`,
            `- **Application** : ${report.device?.app || 'N/A'}`,
            `- **Version** : ${report.device?.version || 'N/A'}`,
            `- **Adresse IP** : ${report.connection?.ip || 'N/A'}`,
            `- **Uptime** : ${report.connection?.uptimeSec || 0} secondes`,
            `- **État Connexion** : ${report.connection?.connected ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`,
            ``,
            `## 2. Performances & Consommation Mémoire (DebugAgent)`,
            `- **Temps moyen debug.update()** : ${report.currentMetrics?.avg_update_us || 0} µs (Objectif: ≤ 100 µs)`,
            `- **Temps maximal debug.update()** : ${report.currentMetrics?.max_update_us || 0} µs (Objectif: ≤ 1000 µs)`,
            `- **SRAM consommée par DebugAgent** : ~1.5 Ko (Objectif: ≤ 20 Ko)`,
            `- **PSRAM allouée (Buffer circulaire)** : 8.0 Ko (Objectif: ≤ 10 Ko)`,
            ``,
            `## 3. Fiabilité & Statistiques Réseau`,
            `- **Messages reçus au total** : ${report.stats?.received || 0}`,
            `- **Messages perdus (drop CoreS3)** : ${report.stats?.droppedByDevice || 0}`,
            `- **Messages perdus en transit** : ${report.stats?.lostInTransit || 0}`,
            `- **Messages tronqués (> 512 octets)** : ${report.stats?.truncated || 0}`,
            `- **Messages invalides rejetés** : ${report.stats?.invalidCount || 0}`,
            `- **Nombre de reconnexions** : ${report.stats?.reconnects || 0}`,
            ``,
            `## 4. États & Métriques Personnalisées`,
            `\`\`\`json`,
            JSON.stringify({ customMetrics: report.customMetrics, states: report.states }, null, 2),
            `\`\`\``
        ].join('\n');

        preview.textContent = md;
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
