import net from 'net';
import { ProtocolParser, parseAndValidateMessage } from './protocol.js';

export function createTcpServer(deviceManager, port = 9000, host = '0.0.0.0') {
    const server = net.createServer((socket) => {
        const remoteIp = socket.remoteAddress?.replace(/^.*:/, '') || '127.0.0.1';
        const remotePort = socket.remotePort || 0;
        console.log(`[TCP] CoreS3 device connected from ${remoteIp}:${remotePort}`);

        deviceManager.registerDevice(socket, remoteIp, remotePort);
        const parser = new ProtocolParser();
        let helloReceived = false;

        socket.on('data', (chunk) => {
            const lines = parser.push(chunk);
            for (const item of lines) {
                if (typeof item === 'object' && item.error) {
                    console.log(`[TCP DEBUG ${remoteIp}] parser error:`, JSON.stringify(item));
                    deviceManager.recordInvalid(socket, item);
                    continue;
                }

                const result = parseAndValidateMessage(item);
                if (!result.valid) {
                    console.log(`[TCP DEBUG ${remoteIp}] validate error:`, JSON.stringify(result), 'item was:', JSON.stringify(item));
                    deviceManager.recordInvalid(socket, result);
                    continue;
                }

                const msg = result.message;

                // Enforce: 'hello' must be the first message accepted on each connection
                if (!helloReceived) {
                    if (msg.type === 'hello') {
                        helloReceived = true;
                        deviceManager.handleMessage(socket, msg);
                    } else {
                        console.log(`[TCP DEBUG ${remoteIp}] HELLO_REQUIRED: received type:`, msg.type);
                        deviceManager.recordInvalid(socket, {
                            error: 'HELLO_REQUIRED',
                            message: `First message on connection must be 'hello', received '${msg.type}'`,
                            rejectedMessage: msg
                        });
                    }
                } else {
                    deviceManager.handleMessage(socket, msg);
                }
            }
        });

        socket.on('error', (err) => {
            console.warn(`[TCP] Socket error from ${remoteIp}:${remotePort}:`, err.message);
        });

        socket.on('close', (hadError) => {
            console.log(`[TCP] Connection closed from ${remoteIp}:${remotePort} (hadError=${hadError})`);
            deviceManager.unregisterDevice(socket);
        });
    });

    server.on('error', (err) => {
        console.error('[TCP] Server error:', err);
    });

    return {
        start: () => new Promise((resolve, reject) => {
            server.listen(port, host, () => {
                console.log(`[TCP] Listening for CoreS3 clients on ${host}:${port}`);
                resolve(server);
            });
            server.once('error', reject);
        }),
        stop: () => new Promise((resolve) => server.close(resolve)),
        server
    };
}
