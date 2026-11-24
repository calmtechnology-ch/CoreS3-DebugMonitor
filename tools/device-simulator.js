import net from 'net';
import readline from 'readline';

const args = process.argv.slice(2);
const host = args.find((a, i) => args[i - 1] === '--host') || '127.0.0.1';
const port = parseInt(args.find((a, i) => args[i - 1] === '--port') || '9000', 10);
const burstMode = args.includes('--burst');
const errorMode = args.includes('--errors');
const malformedMode = args.includes('--malformed');
const fragmentedMode = args.includes('--fragmented');
const reconnectMode = args.includes('--reconnect');

let seq = 0;
let client = null;
let isConnected = false;
let metricTimer = null;
let stateTimer = null;
let logTimer = null;
let angle = 0;

const stateSequence = ['IDLE', 'RUNNING', 'PROCESSING'];
let stateIdx = 0;

function sendNdjson(obj) {
    if (!client || !isConnected) return;
    const jsonStr = JSON.stringify(obj) + '\n';

    if (fragmentedMode) {
        // Send in small fragmented chunks
        const half = Math.floor(jsonStr.length / 2);
        client.write(jsonStr.slice(0, half));
        setTimeout(() => {
            if (client && isConnected) client.write(jsonStr.slice(half));
        }, 30);
    } else {
        client.write(jsonStr);
    }
}

function sendHello() {
    sendNdjson({
        type: 'hello',
        protocol: 1,
        device: 'CoreS3-Sim',
        app: 'BasicDiagnostics',
        version: '0.1.0.1',
        bootId: 'SIM-BOOT-001'
    });
    console.log('[SIM] Sent HELLO');
}

function sendLog(level, tag, message) {
    seq++;
    sendNdjson({
        type: 'log',
        seq,
        ms: Date.now() % 100000000,
        level,
        tag,
        message
    });
}

function sendMetrics() {
    seq++;
    angle += 0.2;
    const heap = Math.round(145000 + 15000 * Math.sin(angle));
    const psram = Math.round(8050000 + 20000 * Math.cos(angle));
    const rssi = Math.round(-55 + 10 * Math.sin(angle * 0.5));
    const avgUs = Math.round(45 + 15 * Math.sin(angle));
    const maxUs = Math.round(120 + 30 * Math.cos(angle));

    sendNdjson({
        type: 'metrics',
        seq,
        ms: Date.now() % 100000000,
        heap,
        min_heap: 130000,
        max_alloc: heap - 20000,
        psram,
        rssi,
        avg_update_us: avgUs,
        max_update_us: maxUs
    });

    // Custom metrics
    sendNdjson({
        type: 'metric',
        seq: ++seq,
        ms: Date.now() % 100000000,
        name: 'temperature',
        value: +(25.0 + 4.5 * Math.sin(angle)).toFixed(2)
    });

    sendNdjson({
        type: 'metric',
        seq: ++seq,
        ms: Date.now() % 100000000,
        name: 'cpu_load',
        value: +(20.0 + 12.0 * Math.cos(angle)).toFixed(2)
    });
}

function sendStateTransition() {
    stateIdx = (stateIdx + 1) % stateSequence.length;
    const currentState = stateSequence[stateIdx];
    seq++;
    sendNdjson({
        type: 'state',
        seq,
        ms: Date.now() % 100000000,
        name: 'PTT',
        value: currentState
    });
    sendLog('INFO', 'STATE', `Transition d'état: vers ${currentState}`);
}

function sendBurst(count = 50) {
    console.log(`[SIM] Sending burst of ${count} messages...`);
    for (let i = 0; i < count; i++) {
        sendLog('INFO', 'BURST', `Message de rafale #${i + 1}/${count} (test de charge)`);
    }
}

function startTimers() {
    metricTimer = setInterval(sendMetrics, 1000);
    stateTimer = setInterval(sendStateTransition, 3500);

    const logSamples = [
        { level: 'INFO', tag: 'SYSTEM', msg: 'Vérification périodique du système réseau' },
        { level: 'DEBUG', tag: 'AUDIO', msg: 'Taille du tampon audio: 4096 octets' },
        { level: 'TRACE', tag: 'PTT', msg: 'Événement bouton tactile capturé' },
        { level: 'WARN', tag: 'WIFI', msg: 'Fluctuation du signal RSSI détectée' },
        { level: 'INFO', tag: 'SENSOR', msg: 'Température du boîtier stable (28.4 °C)' }
    ];

    let sampleIdx = 0;
    logTimer = setInterval(() => {
        const sample = logSamples[sampleIdx % logSamples.length];
        sampleIdx++;
        sendLog(sample.level, sample.tag, sample.msg);
    }, 2000);

    if (errorMode) {
        setInterval(() => {
            sendLog('ERROR', 'SYSTEM', 'Erreur simulée: socket timeout temporaire réessayé');
        }, 5000);
    }

    if (malformedMode) {
        setTimeout(() => {
            console.log('[SIM] Injecting malformed NDJSON line...');
            if (client && isConnected) client.write('{"type":"log", malformed json line\n');
        }, 3000);
    }

    if (burstMode) {
        setTimeout(() => sendBurst(100), 2000);
    }
}

function stopTimers() {
    clearInterval(metricTimer);
    clearInterval(stateTimer);
    clearInterval(logTimer);
}

function connect() {
    console.log(`[SIM] Connecting to CoreS3-DebugMonitor at ${host}:${port}...`);
    client = net.createConnection({ host, port }, () => {
        console.log('[SIM] Connected to server successfully!');
        isConnected = true;
        sendHello();
        sendLog('INFO', 'SYSTEM', 'CoreS3 Simulator démarré (UTF-8 avec accents: é, è, ê, à, ç)');
        startTimers();
    });

    client.on('error', (err) => {
        console.warn(`[SIM] Socket error: ${err.message}`);
    });

    client.on('close', () => {
        console.log('[SIM] Disconnected from server.');
        isConnected = false;
        stopTimers();

        if (reconnectMode) {
            console.log('[SIM] Reconnecting in 3 seconds...');
            setTimeout(connect, 3000);
        } else {
            console.log('[SIM] Reconnecting in 2 seconds...');
            setTimeout(connect, 2000);
        }
    });
}

// Start simulator connection
connect();

// Interactive keyboard controls if running in TTY
if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    console.log('\n[SIM Controls]');
    console.log('  l: Send INFO log      w: Send WARN log     e: Send ERROR log');
    console.log('  b: Send 50-log burst  r: Disconnect socket q: Quit\n');

    process.stdin.on('keypress', (str, key) => {
        if (key.ctrl && key.name === 'c' || key.name === 'q') {
            console.log('\n[SIM] Exiting...');
            process.exit(0);
        }
        if (key.name === 'l') {
            sendLog('INFO', 'USER', 'Manuel: Journalisation INFO déclenchée');
            console.log('[SIM] Sent INFO log');
        } else if (key.name === 'w') {
            sendLog('WARN', 'AUDIO', 'Manuel: Avertissement seuil mémoire');
            console.log('[SIM] Sent WARN log');
        } else if (key.name === 'e') {
            sendLog('ERROR', 'SYSTEM', 'Manuel: Erreur de test simulée');
            console.log('[SIM] Sent ERROR log');
        } else if (key.name === 'b') {
            sendBurst(50);
        } else if (key.name === 'r') {
            console.log('[SIM] Simulating abrupt disconnect...');
            if (client) client.destroy();
        }
    });
}
