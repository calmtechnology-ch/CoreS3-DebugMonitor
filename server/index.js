import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { DeviceManager } from './device-manager.js';
import { createTcpServer } from './tcp-server.js';
import { createWebSocketServer } from './websocket-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Command line arguments parsing
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const httpPort = parseInt(process.env.PORT || '8080', 10);
const tcpPort = parseInt(process.env.TCP_PORT || '9000', 10);

const deviceManager = new DeviceManager(5000, 120);

// Helper to list network interfaces, prioritizing physical (Wi-Fi, Ethernet) over virtual (WSL, Hyper-V, Docker)
function getAvailableIPv4Addresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    const virtualRegex = /(vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|veth)/i;

    for (const [ifaceName, ifaceList] of Object.entries(interfaces)) {
        if (!ifaceList) continue;
        for (const addr of ifaceList) {
            if (addr.family === 'IPv4' && !addr.internal) {
                const isVirtual = virtualRegex.test(ifaceName);
                addresses.push({ interface: ifaceName, address: addr.address, isVirtual });
            }
        }
    }

    // Sort physical adapters first (Wi-Fi, Ethernet), virtual adapters last
    addresses.sort((a, b) => {
        if (a.isVirtual === b.isVirtual) return 0;
        return a.isVirtual ? 1 : -1;
    });

    return addresses;
}

// Simple static file server for production / fallback
function serveStaticFile(req, res, baseDir) {
    let filePath = path.join(baseDir, req.url.split('?')[0]);
    if (filePath.endsWith(path.sep) || fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    const extMap = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.png': 'image/png'
    };

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = extMap[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return true;
    }
    return false;
}

async function startServer() {
    let vite = null;

    const httpServer = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // REST endpoints
        if (req.url === '/api/status') {
            const activeDev = deviceManager.getActiveDevice();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                status: 'OK',
                serverTime: new Date().toISOString(),
                hasDevice: !!activeDev,
                device: activeDev ? activeDev.info : null,
                stats: activeDev ? activeDev.stats : null
            }));
            return;
        }

        if (req.url === '/api/report') {
            const report = deviceManager.getSummaryReport();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(report, null, 2));
            return;
        }

        // Vite middleware in development mode
        if (vite) {
            vite.middlewares(req, res);
            return;
        }

        // Production static files: serve from dist/ or web/
        const distDir = path.join(projectRoot, 'dist');
        const webDir = path.join(projectRoot, 'web');
        const targetDir = fs.existsSync(distDir) ? distDir : webDir;

        if (serveStaticFile(req, res, targetDir)) {
            return;
        }

        // SPA Fallback: serve index.html
        const indexPath = path.join(targetDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            fs.createReadStream(indexPath).pipe(res);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    });

    if (isDev) {
        try {
            const { createServer: createViteServer } = await import('vite');
            vite = await createViteServer({
                root: path.join(projectRoot, 'web'),
                server: { middlewareMode: true }
            });
            console.log('[DEV] Vite development middleware activated.');
        } catch (err) {
            console.warn('[DEV] Vite not loaded, falling back to static web serving:', err.message);
        }
    }

    // Attach WebSocket server
    createWebSocketServer(httpServer, deviceManager);

    // Start HTTP Web server
    await new Promise((resolve) => httpServer.listen(httpPort, '0.0.0.0', resolve));

    // Start TCP server
    const tcp = createTcpServer(deviceManager, tcpPort, '0.0.0.0');
    await tcp.start();

    // Print setup banner and instructions
    const ips = getAvailableIPv4Addresses();
    console.log('\n' + '='.repeat(68));
    console.log('       CoreS3-DebugMonitor v0.1.0.1 - Technical Server');
    console.log('='.repeat(68));
    console.log(` Web Interface:   http://localhost:${httpPort}`);
    console.log(` TCP Diagnostics: 0.0.0.0:${tcpPort}`);
    console.log('\n Available PC IPv4 addresses for CoreS3:');
    if (ips.length === 0) {
        console.log('   - 127.0.0.1 (Loopback only - connect PC to Wi-Fi/LAN)');
    } else {
        for (const iface of ips) {
            console.log(`   - ${iface.address.padEnd(16)} (${iface.interface})`);
        }
    }

    console.log('\n Configuration for CoreS3 (firmware/include/AppConfig.h):');
    const recommendedIp = ips.length > 0 ? ips[0].address : '192.168.1.X';
    console.log(`   #define DEBUG_HOST      "${recommendedIp}"`);
    console.log(`   #define DEBUG_PORT      ${tcpPort}`);
    console.log('='.repeat(68) + '\n');

    // Graceful exit
    const shutdown = async () => {
        console.log('\n[SERVER] Shutting down...');
        await tcp.stop();
        httpServer.close(() => {
            console.log('[SERVER] Stopped.');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return { httpServer, tcp, deviceManager };
}

// Start if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startServer().catch((err) => {
        console.error('[SERVER] Fatal error starting server:', err);
        process.exit(1);
    });
}
