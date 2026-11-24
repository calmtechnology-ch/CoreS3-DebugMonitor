/**
 * Unresponsive TCP Server Simulator for CoreS3-DebugMonitor v0.1.0.1
 * 
 * Simulates network degradation scenarios:
 * - Accepts incoming TCP connection from CoreS3.
 * - Receives the 'hello' handshake.
 * - Pauses all socket reads to induce socket buffer saturation on CoreS3.
 * - Tests whether CoreS3 firmware handles EWOULDBLOCK/EAGAIN without freezing.
 * 
 * Usage:
 *   node tools/unresponsive-server.js --port 9000
 */

import net from 'net';

const args = process.argv.slice(2);
const port = parseInt(args.find((a, i) => args[i - 1] === '--port') || '9000', 10);
const pauseAfterHello = !args.includes('--immediate-freeze');

console.log('='.repeat(65));
console.log('   Unresponsive TCP Server Simulation (Degraded Network)');
console.log('='.repeat(65));
console.log(` Listening on 0.0.0.0:${port}`);
console.log(` Mode: ${pauseAfterHello ? 'Pause reading after hello handshake' : 'Immediate freeze on connect'}`);
console.log('='.repeat(65) + '\n');

const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[UNRESPONSIVE-SRV] CoreS3 connected from ${remote}`);

    let helloSeen = false;

    socket.on('data', (chunk) => {
        const text = chunk.toString('utf-8');
        console.log(`[UNRESPONSIVE-SRV] Received ${chunk.length} bytes: ${text.slice(0, 80).trim()}...`);

        if (!helloSeen && text.includes('"type":"hello"')) {
            helloSeen = true;
            console.log('[UNRESPONSIVE-SRV] Hello handshake acknowledged.');
            if (pauseAfterHello) {
                console.warn('[UNRESPONSIVE-SRV] FREEZING READS NOW! Socket will cease consuming incoming data.');
                socket.pause(); // Stop reading from TCP stream!
            }
        }
    });

    if (!pauseAfterHello) {
        console.warn('[UNRESPONSIVE-SRV] IMMEDIATE FREEZE! Ceasing reads on socket.');
        socket.pause();
    }

    socket.on('error', (err) => {
        console.warn(`[UNRESPONSIVE-SRV] Socket error: ${err.message}`);
    });

    socket.on('close', () => {
        console.log(`[UNRESPONSIVE-SRV] Connection closed from ${remote}`);
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log(`[UNRESPONSIVE-SRV] Ready for CoreS3 MAT-15 / MAT-19 stress tests.`);
});

process.on('SIGINT', () => {
    console.log('\n[UNRESPONSIVE-SRV] Shutting down.');
    server.close(() => process.exit(0));
});
