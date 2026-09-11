/**
 * WebSocket surface. Parses every inbound frame with the protocol schemas and
 * hands intents to the matchmaker/room. No game logic lives here.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { decode, encode, PROTOCOL_VERSION } from './protocol';
import { dequeue, enqueue } from './matchmaker';

let nextId = 1;

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    const playerId = `p${nextId++}`;
    socket.send(encode({ type: 'WELCOME', version: PROTOCOL_VERSION, playerId }));

    socket.on('message', (raw) => {
      const message = decode(raw.toString());
      if (!message) {
        socket.send(encode({ type: 'ERROR', code: 'BAD_MESSAGE', message: 'unparseable frame' }));
        return;
      }

      switch (message.type) {
        case 'PING':
          socket.send(encode({ type: 'PONG' }));
          break;
        case 'QUEUE': {
          const room = enqueue(message.mode, playerId, socket, Date.now());
          if (!room) {
            socket.send(encode({ type: 'QUEUED', position: 1 }));
          } else {
            // TODO(P12): create the match state and start the placing phase.
            room.broadcast({
              type: 'MATCH_FOUND',
              matchId: room.id,
              opponent: { name: 'Opponent', avatar: 1 },
            });
          }
          break;
        }
        case 'CANCEL_QUEUE':
          dequeue(playerId);
          break;
        default:
          // TODO(P12): SUBMIT_LAYOUT / FIRE / USE_ARSENAL / RESIGN -> engine.reduce()
          socket.send(encode({ type: 'ERROR', code: 'NOT_IMPLEMENTED', message: message.type }));
      }
    });

    socket.on('close', () => dequeue(playerId));
  });

  return wss;
}
