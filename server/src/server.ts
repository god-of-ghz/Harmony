import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as baseDb from './database';
import { createApp } from './app';

const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    clients.add(ws);

    ws.on('close', () => {
        console.log('Connection closed');
        clients.delete(ws);
    });
});

export const broadcastMessage = (data: any) => {
    const payload = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
};

const app = createApp(baseDb, broadcastMessage);
server.on('request', app);

const PORT = process.env.PORT || 3001;
server.listen(PORT as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
