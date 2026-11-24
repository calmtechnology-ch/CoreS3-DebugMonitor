// Dashboard view & real-time canvas charts

class SimpleChart {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.options = {
            series: options.series || [], // [{ key, color, label, scale }]
            minY: options.minY ?? null,
            maxY: options.maxY ?? null,
            unit: options.unit || '',
            ...options
        };
        this.data = [];
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = 180 * window.devicePixelRatio;
        this.render();
    }

    update(timeSeries) {
        if (!timeSeries || !timeSeries.timestamps) return;
        this.timeSeries = timeSeries;
        this.render();
    }

    render() {
        if (!this.ctx || !this.timeSeries || this.timeSeries.timestamps.length === 0) {
            this.renderEmpty();
            return;
        }

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = { top: 20, right: 30, bottom: 30, left: 55 };

        ctx.clearRect(0, 0, w, h);

        const n = this.timeSeries.timestamps.length;
        if (n < 2) {
            this.renderEmpty();
            return;
        }

        // Determine min and max Y across series
        let minY = this.options.minY !== null ? this.options.minY : Infinity;
        let maxY = this.options.maxY !== null ? this.options.maxY : -Infinity;

        for (const s of this.options.series) {
            const arr = this.timeSeries[s.key] || [];
            for (const val of arr) {
                if (val < minY) minY = val;
                if (val > maxY) maxY = val;
            }
        }

        if (!isFinite(minY)) minY = 0;
        if (!isFinite(maxY) || maxY <= minY) maxY = minY + 10;

        // Add 10% breathing room
        const yRange = maxY - minY;
        const adjMinY = Math.floor(minY - yRange * 0.05);
        const adjMaxY = Math.ceil(maxY + yRange * 0.05);
        const effectiveRange = (adjMaxY - adjMinY) || 1;

        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        // Draw horizontal grid lines & labels
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#64748b';
        ctx.font = `${Math.round(11 * window.devicePixelRatio)}px sans-serif`;
        ctx.textAlign = 'right';

        const gridSteps = 4;
        for (let i = 0; i <= gridSteps; i++) {
            const yVal = Math.round(adjMinY + (i / gridSteps) * effectiveRange);
            const yPos = padding.top + chartH - (i / gridSteps) * chartH;

            ctx.beginPath();
            ctx.moveTo(padding.left, yPos);
            ctx.lineTo(w - padding.right, yPos);
            ctx.stroke();

            ctx.fillText(`${yVal} ${this.options.unit}`, padding.left - 8, yPos + 4);
        }

        // Draw series lines
        for (const s of this.options.series) {
            const arr = this.timeSeries[s.key] || [];
            if (arr.length === 0) continue;

            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2 * window.devicePixelRatio;
            ctx.beginPath();

            for (let i = 0; i < arr.length; i++) {
                const x = padding.left + (i / (n - 1)) * chartW;
                const normalized = (arr[i] - adjMinY) / effectiveRange;
                const y = padding.top + chartH - (normalized * chartH);

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Draw bottom time labels
        ctx.textAlign = 'center';
        const tFirst = this.timeSeries.timestamps[0];
        const tLast = this.timeSeries.timestamps[n - 1];
        ctx.fillText(tFirst, padding.left + 20, h - 8);
        ctx.fillText(tLast, w - padding.right - 20, h - 8);
    }

    renderEmpty() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = '#475569';
        ctx.font = `${Math.round(12 * window.devicePixelRatio)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('En attente de données métriques...', this.canvas.width / 2, this.canvas.height / 2);
    }
}

export class DashboardView {
    constructor() {
        this.memChart = new SimpleChart('chartMemory', {
            series: [
                { key: 'heap', color: '#38bdf8', label: 'SRAM' },
                { key: 'psram', color: '#10b981', label: 'PSRAM' }
            ],
            unit: 'Ko'
        });

        this.rssiChart = new SimpleChart('chartRssi', {
            series: [
                { key: 'rssi', color: '#f59e0b', label: 'RSSI' }
            ],
            minY: -100,
            maxY: -20,
            unit: 'dBm'
        });
    }

    update(device) {
        if (!device) return;

        // Device Info
        const isConnected = !!device.connected;
        const badge = document.getElementById('dashDeviceStatus');
        if (badge) {
            badge.textContent = isConnected ? 'En ligne' : 'Hors ligne';
            badge.style.backgroundColor = isConnected ? '#065f46' : '#7f1d1d';
            badge.style.color = isConnected ? '#6ee7b7' : '#fca5a5';
        }

        document.getElementById('dashDeviceName').textContent = device.info?.device || '-';
        document.getElementById('dashAppName').textContent = `${device.info?.app || '-'} (${device.info?.version || '-'})`;
        document.getElementById('dashDeviceIp').textContent = device.ip || '-';

        // Uptime format
        if (device.connectedAt) {
            const uptimeSec = Math.floor((Date.now() - device.connectedAt) / 1000);
            const hrs = Math.floor(uptimeSec / 3600);
            const mins = Math.floor((uptimeSec % 3600) / 60);
            const secs = uptimeSec % 60;
            document.getElementById('dashUptime').textContent = `${hrs}h ${mins}m ${secs}s`;
        }

        const metrics = device.currentMetrics || {};
        const rssi = metrics.rssi ?? -100;
        document.getElementById('dashRssi').textContent = `${rssi} dBm`;

        // Memory Info
        document.getElementById('dashSram').textContent = `${Math.round((metrics.heap || 0) / 1024)} Ko`;
        document.getElementById('dashMinSram').textContent = `${Math.round((metrics.min_heap || 0) / 1024)} Ko`;
        document.getElementById('dashMaxAllocSram').textContent = `${Math.round((metrics.max_alloc || 0) / 1024)} Ko`;
        document.getElementById('dashPsram').textContent = `${Math.round((metrics.psram || 0) / 1024)} Ko`;

        // Traffic & Health
        const stats = device.stats || {};
        document.getElementById('dashReceived').textContent = stats.received ?? 0;
        document.getElementById('dashDropped').textContent = stats.droppedByDevice ?? 0;
        document.getElementById('dashLost').textContent = stats.lostInTransit ?? 0;
        document.getElementById('dashReconnects').textContent = stats.reconnects ?? 0;

        // Update Charts
        if (device.timeSeries) {
            this.memChart.update(device.timeSeries);
            this.rssiChart.update(device.timeSeries);
        }
    }
}
