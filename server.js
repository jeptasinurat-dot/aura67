const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// If you deploy to Render, PORT is provided.
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game constraints
const MAX_PLAYERS = 10;

// In-memory state
// Map<socketId, { name: string, x: number, y: number }>
const players = new Map();

function getSpawnCenter() {
  // All players spawn exactly in the middle of the world.
  // Client uses the same world sizing (canvas size), but we store world coords in pixels.
  // To keep it consistent, spawn at (0,0) in server coords and client will translate
  // relative to canvas center. However, our spec asks spawn in the middle of screen.
  // We'll treat world coords as screen coords; client will apply the same centering.
  return { x: 0, y: 0 };
}

io.on('connection', (socket) => {
  // Enforce max players
  if (players.size >= MAX_PLAYERS) {
    socket.emit('game:error', { message: 'Game penuh (maksimal 10 pemain). Coba lagi nanti.' });
    socket.disconnect(true);
    return;
  }

  socket.emit('game:welcome', { ok: true });

  socket.on('player:join', ({ name }) => {
    if (!name || typeof name !== 'string') name = 'Player';
    name = name.trim().slice(0, 24) || 'Player';

    if (players.size >= MAX_PLAYERS && !players.has(socket.id)) {
      socket.emit('game:error', { message: 'Game penuh (maksimal 10 pemain).' });
      socket.disconnect(true);
      return;
    }

    // Spawn all players at the center
    const { x, y } = getSpawnCenter();

    players.set(socket.id, { name, x, y });

    // Send current snapshot to the new player
    const snapshot = {
      selfId: socket.id,
      players: Array.from(players.entries()).map(([id, p]) => ({ id, ...p }))
    };
    socket.emit('player:state', snapshot);

    // Broadcast join to others
    socket.broadcast.emit('player:joined', { id: socket.id, ...players.get(socket.id) });

    // Optionally broadcast player count
    io.emit('player:count', { count: players.size, max: MAX_PLAYERS });
  });

  socket.on('player:move', ({ x, y }) => {
    const p = players.get(socket.id);
    if (!p) return;

    // Basic sanitation
    if (typeof x !== 'number' || typeof y !== 'number') return;

    // Update server state
    p.x = x;
    p.y = y;

    // Broadcast movement to others (excluding sender)
    socket.broadcast.emit('player:moved', { id: socket.id, x: p.x, y: p.y });
  });

  socket.on('player:rename', ({ name }) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (!name || typeof name !== 'string') return;

    const newName = name.trim().slice(0, 24);
    if (!newName) return;

    p.name = newName;
    socket.broadcast.emit('player:renamed', { id: socket.id, name: p.name });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (!p) return;

    players.delete(socket.id);
    socket.broadcast.emit('player:disconnected', { id: socket.id });
    io.emit('player:count', { count: players.size, max: MAX_PLAYERS });
  });
});

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});

