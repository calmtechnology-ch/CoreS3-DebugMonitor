// Console view with real-time streaming, filtering, search, and export

const MAX_DOM_ROWS = 1000;

export class ConsoleView {
    constructor() {
        this.tbody = document.getElementById('consoleLogsBody');
        this.scrollContainer = document.getElementById('consoleScrollContainer');
        this.levelFilter = document.getElementById('logLevelFilter');
        this.tagFilter = document.getElementById('logTagFilter');
        this.searchInput = document.getElementById('logSearchInput');
        this.autoScrollToggle = document.getElementById('autoScrollToggle');
        this.statusText = document.getElementById('consoleStatusText');
        this.countBadge = document.getElementById('logCountBadge');

        this.allLogs = []; // In-memory log buffer
        this.isPaused = false;
        this.knownTags = new Set();
        this.displayedCount = 0;

        this.initControls();
    }

    initControls() {
        this.levelFilter.addEventListener('change', () => this.refilterAll());
        this.tagFilter.addEventListener('change', () => this.refilterAll());
        this.searchInput.addEventListener('input', () => this.refilterAll());

        // Pause toggle
        const btnPause = document.getElementById('btnPauseConsole');
        const pauseText = document.getElementById('pauseText');
        const pauseIcon = document.getElementById('pauseIcon');

        btnPause.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            if (this.isPaused) {
                pauseText.textContent = 'Reprendre';
                pauseIcon.textContent = '▶️';
                btnPause.classList.add('btn-primary');
            } else {
                pauseText.textContent = 'Pause';
                pauseIcon.textContent = '⏸️';
                btnPause.classList.remove('btn-primary');
                this.refilterAll();
            }
        });

        // Clear console
        document.getElementById('btnClearConsole').addEventListener('click', () => {
            this.allLogs = [];
            this.tbody.innerHTML = '';
            this.displayedCount = 0;
            this.updateStatus();
        });

        // Copy visible to clipboard
        document.getElementById('btnCopyConsole').addEventListener('click', () => {
            const visibleLogs = this.getFilteredLogs();
            const text = visibleLogs.map(l =>
                `[${l.rxTime || ''}] (+${l.ms}ms) [${l.level}] [${l.tag}]: ${l.message}`
            ).join('\n');
            navigator.clipboard.writeText(text).then(() => {
                alert(`${visibleLogs.length} messages copiés dans le presse-papiers.`);
            });
        });

        // Export TXT
        document.getElementById('btnExportTxt').addEventListener('click', () => {
            const visibleLogs = this.getFilteredLogs();
            const text = visibleLogs.map(l =>
                `[${l.rxTime || ''}] (+${l.ms}ms) [${l.level}] [${l.tag}]: ${l.message}`
            ).join('\n');
            this.downloadFile(text, `cores3-logs-${Date.now()}.txt`, 'text/plain');
        });

        // Export JSON
        document.getElementById('btnExportJson').addEventListener('click', () => {
            const visibleLogs = this.getFilteredLogs();
            const json = JSON.stringify(visibleLogs, null, 2);
            this.downloadFile(json, `cores3-logs-${Date.now()}.json`, 'application/json');
        });

        // Scroll listener to detect manual scroll up
        this.scrollContainer.addEventListener('scroll', () => {
            const atBottom = this.scrollContainer.scrollHeight - this.scrollContainer.scrollTop - this.scrollContainer.clientHeight < 40;
            if (!atBottom && this.autoScrollToggle.checked) {
                // User scrolled up: keep toggle checked or leave as user preference
            }
        });
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    addLog(log) {
        this.allLogs.push(log);
        if (this.allLogs.length > 5000) {
            this.allLogs.shift();
        }

        // Add tag to filter dropdown if new
        if (log.tag && !this.knownTags.has(log.tag)) {
            this.knownTags.add(log.tag);
            const opt = document.createElement('option');
            opt.value = log.tag;
            opt.textContent = log.tag;
            this.tagFilter.appendChild(opt);
        }

        if (this.isPaused) return;

        if (this.matchesFilter(log)) {
            this.appendRow(log);
            this.displayedCount++;

            // Prune old DOM rows if limit exceeded
            while (this.tbody.children.length > MAX_DOM_ROWS) {
                this.tbody.removeChild(this.tbody.firstElementChild);
            }

            if (this.autoScrollToggle.checked) {
                this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
            }
        }

        this.updateStatus();
    }

    appendRow(log) {
        const tr = document.createElement('tr');
        const rxTime = log.rxTime ? new Date(log.rxTime).toLocaleTimeString() : '-';
        const ms = log.ms ?? 0;
        const level = log.level || 'INFO';
        const tag = log.tag || 'APP';
        const msg = log.message || '';

        tr.innerHTML = `
            <td>${rxTime}</td>
            <td>+${ms}ms</td>
            <td><span class="level-badge level-${level}">${level}</span></td>
            <td><span class="tag-badge">[${tag}]</span></td>
            <td>${this.escapeHtml(msg)}</td>
        `;
        this.tbody.appendChild(tr);
    }

    matchesFilter(log) {
        const selectedLevel = this.levelFilter.value;
        const selectedTag = this.tagFilter.value;
        const search = this.searchInput.value.trim().toLowerCase();

        // Level hierarchy
        const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];
        if (selectedLevel === 'INFO') {
            const idx = levels.indexOf(log.level);
            if (idx < 2) return false; // Hide TRACE and DEBUG
        } else if (selectedLevel === 'WARN') {
            const idx = levels.indexOf(log.level);
            if (idx < 3) return false;
        } else if (selectedLevel !== 'ALL' && log.level !== selectedLevel) {
            return false;
        }

        // Tag filter
        if (selectedTag !== 'ALL' && log.tag !== selectedTag) {
            return false;
        }

        // Search text
        if (search) {
            const tagMatch = log.tag && log.tag.toLowerCase().includes(search);
            const msgMatch = log.message && log.message.toLowerCase().includes(search);
            if (!tagMatch && !msgMatch) return false;
        }

        return true;
    }

    getFilteredLogs() {
        return this.allLogs.filter(l => this.matchesFilter(l));
    }

    refilterAll() {
        this.tbody.innerHTML = '';
        const filtered = this.getFilteredLogs();
        const slice = filtered.slice(-MAX_DOM_ROWS);
        for (const log of slice) {
            this.appendRow(log);
        }
        this.displayedCount = slice.length;
        if (this.autoScrollToggle.checked) {
            this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
        }
        this.updateStatus();
    }

    updateStatus() {
        this.statusText.textContent = `Lignes affichées: ${this.displayedCount} (total en mémoire: ${this.allLogs.length})`;
        if (this.countBadge) {
            this.countBadge.textContent = this.allLogs.length;
        }
    }

    escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
