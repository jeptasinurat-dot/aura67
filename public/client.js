(() => {
  const overlay = document.getElementById('overlay');
  const nameInput = document.getElementById('nameInput');
  const okBtn = document.getElementById('okBtn');
  const errorBox = document.getElementById('errorBox');
  const countText = document.getElementById('countText');

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const joystick = document.getElementById('joystick');
  const joyBase = document.getElementById('joyBase');
  const joyKnob = document.getElementById('joyKnob');

  const socket = io({ autoConnect: false });

  // World coordinates are centered at canvas center.
  // Server keeps x,y in a centered coordinate system too.
  // We move in world space; rendering converts world->screen.

  let selfId = null;
  const players = new Map(); // id => {name,x,y}

  // Movement state
  const keys = new Set();
  let joyActive = false;
  let joyVec = { x: 0, y: 0 }; // -1..1

  // Tunables
  const SPEED = 220; // pixels per second in world coords

  function resizeCanvas() {
    // Match canvas resolution to devicePixelRatio
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function isTouchDevice() {
    return (
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      'ontouchstart' in window ||
      navigator.userAgent.toLowerCase().includes('mobi')
    );
  }

  function showJoystickIfNeeded() {
    if (isTouchDevice()) {
      joystick.style.display = 'block';
    } else {
      joystick.style.display = 'none';
    }
  }

  showJoystickIfNeeded();

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function setJoyKnob(nx, ny) {
    // nx, ny in pixels relative to center
    const baseRadius = 46; // visual radius
    const mag = Math.hypot(nx, ny);
    if (mag > baseRadius) {
      const s = baseRadius / mag;
      nx *= s;
      ny *= s;
    }

    joyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  }

  function resetJoy() {
    joyActive = false;
    joyVec.x = 0;
    joyVec.y = 0;
    setJoyKnob(0, 0);
  }

  // Joystick pointer events
  if (isTouchDevice()) {
    joystick.addEventListener('pointerdown', (e) => {
      joyActive = true;
      joystick.setPointerCapture(e.pointerId);
    });

    joystick.addEventListener('pointermove', (e) => {
      if (!joyActive) return;
      const rect = joyBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;

      const baseRadius = 46;
      const mag = Math.hypot(dx, dy);
      const clampedMag = clamp(mag, 0, baseRadius);
      const scale = mag === 0 ? 0 : clampedMag / mag;

      const ddx = dx * scale;
      const ddy = dy * scale;
      setJoyKnob(ddx, ddy);

      joyVec.x = clampedMag === 0 ? 0 : ddx / baseRadius;
      joyVec.y = clampedMag === 0 ? 0 : ddy / baseRadius;
    });

    joystick.addEventListener('pointerup', () => resetJoy());
    joystick.addEventListener('pointercancel', () => resetJoy());
    joystick.addEventListener('pointerleave', () => resetJoy());
  }

  // Keyboard controls
  function keyToVec() {
    const left = keys.has('ArrowLeft') || keys.has('a') || keys.has('A');
    const right = keys.has('ArrowRight') || keys.has('d') || keys.has('D');
    const up = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
    const down = keys.has('ArrowDown') || keys.has('s') || keys.has('S');

    let x = 0;
    let y = 0;
    if (left) x -= 1;
    if (right) x += 1;
    if (up) y -= 1;
    if (down) y += 1;

    // Normalize diagonal
    if (x !== 0 || y !== 0) {
      const m = Math.hypot(x, y);
      x /= m;
      y /= m;
    }

    return { x, y };
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    keys.delete(k);
  });

  // Rendering
  function worldToScreen(x, y) {
    // world coords centered at canvas center
    return { sx: window.innerWidth / 2 + x, sy: window.innerHeight / 2 + y };
  }

  function drawBackground() {
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // subtle grid
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#ffffff';
    const step = 40;
    for (let x = (window.innerWidth / 2) % step; x < window.innerWidth; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, window.innerHeight);
      ctx.stroke();
    }
    for (let y = (window.innerHeight / 2) % step; y < window.innerHeight; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(window.innerWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTriangle(x, y, name, isSelf) {
    const { sx, sy } = worldToScreen(x, y);

    const size = 10; // triangle size
    const dir = (isSelf ? 1 : 1);

    // Use direction based on movement vector is not tracked server-side.
    // We'll draw a small triangle pointing up-right by default.
    ctx.save();
    ctx.translate(sx, sy);

    // Color
    ctx.fillStyle = isSelf ? 'rgba(108,240,255,0.95)' : 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = isSelf ? 'rgba(108,240,255,0.65)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;

    // Triangle vertices
    // Pointing up
    const h = size * 0.9;
    const w = size * 0.95;

    ctx.beginPath();
    ctx.moveTo(0, -h); // top
    ctx.lineTo(w * 0.8, h * 0.6);
    ctx.lineTo(-w * 0.8, h * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Name
    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // background for readability
    const label = name || '';
    const padX = 6;
    const padY = 4;
    const metrics = ctx.measureText(label);
    const textW = metrics.width;
    const boxW = textW + padX * 2;
    const boxH = 18;
    const bx = -boxW / 2;
    const by = -h - 16;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.fillStyle = isSelf ? 'rgba(108,240,255,1)' : 'rgba(255,255,255,0.95)';
    ctx.fillText(label, 0, by + boxH - 5);

    ctx.restore();
  }

  function draw() {
    drawBackground();
    for (const [id, p] of players.entries()) {
      drawTriangle(p.x, p.y, p.name, id === selfId);
    }
  }

  // Game loop with requestAnimationFrame
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // Move self locally (client-side prediction) and sync to server
    const self = selfId ? players.get(selfId) : null;
    if (self) {
      let vx = 0;
      let vy = 0;

      // Use joystick on touch; keyboard on PC.
      const kvec = keyToVec();
      if (isTouchDevice() && joyActive) {
        vx = joyVec.x;
        vy = joyVec.y;
      } else {
        vx = kvec.x;
        vy = kvec.y;
      }

      const mag = Math.hypot(vx, vy);
      if (mag > 0) {
        self.x += vx * SPEED * dt;
        self.y += vy * SPEED * dt;

        // Throttle network a bit using rAF cadence + simple condition.
        // We'll send at most ~20 updates/sec.
        const nowMs = performance.now();
        if (!self._lastSent || nowMs - self._lastSent > 50) {
          self._lastSent = nowMs;
          socket.emit('player:move', { x: self.x, y: self.y });
        }
      }
    }

    draw();
    requestAnimationFrame(tick);
  }

  // UI Join
  function hideOverlay() {
    overlay.style.display = 'none';
  }

  function setError(msg) {
    errorBox.textContent = msg || '';
  }

  okBtn.addEventListener('click', () => {
    const name = (nameInput.value || '').trim();
    if (!name) {
      setError('Nama tidak boleh kosong.');
      return;
    }

    if (socket.connected === false) socket.connect();

    // Join once
    socket.once('player:state', (snapshot) => {
      selfId = snapshot.selfId;
      players.clear();
      for (const p of snapshot.players) {
        players.set(p.id, { name: p.name, x: p.x, y: p.y, _lastSent: 0 });
      }
      hideOverlay();
      setError('');

      if (!selfId) selfId = snapshot.selfId;

      requestAnimationFrame(tick);
    });

    socket.emit('player:join', { name });
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
  });

  // Socket listeners
  socket.on('game:error', ({ message }) => {
    setError(message || 'Terjadi error.');
    overlay.style.display = 'flex';
    try { socket.disconnect(); } catch {}
  });

  socket.on('player:count', ({ count, max }) => {
    countText.textContent = `Pemain: ${count}/${max}`;
  });

  socket.on('player:joined', ({ id, name, x, y }) => {
    players.set(id, { name, x, y, _lastSent: 0 });
  });

  socket.on('player:moved', ({ id, x, y }) => {
    const p = players.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
  });

  socket.on('player:renamed', ({ id, name }) => {
    const p = players.get(id);
    if (!p) return;
    p.name = name;
  });

  socket.on('player:disconnected', ({ id }) => {
    players.delete(id);
  });

  // Start with overlay focus
  setTimeout(() => nameInput.focus(), 0);
})();

