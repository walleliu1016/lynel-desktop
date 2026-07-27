// 本地 mock cloud server
// 端口：3099（与 desktop CloudTab 配置的 url 对应）
//
// 协议：HTTP + Socket.IO（端口共用）
//   POST /api/auth/login              HTTP，换 JWT
//   socket.io /                        Socket.IO 事件通道
//     desktop -> cloud:  desktop:auth / desktop:session:sync / desktop:envelope:push
//                       desktop:hook:batch / desktop:hook:permission / desktop:hook:abort
//     cloud  -> desktop: auth:success / auth:failed / desktop:hook:result / desktop:chat
//
// 使用：
//   1. node scripts/mock-cloud-server.cjs
//   2. desktop CloudTab 配置 url=http://localhost:3099，启用 cloud
//   3. 在 desktop 解锁（密码任意非空），mock 会签发 JWT
//   4. 终端输入 chat <sid> <question> 模拟 mobile 发消息给 desktop
//   5. 终端输入 allow / deny 处理最新的 PermissionRequest

const http = require('node:http');
const { Server } = require('socket.io');

const PORT = 3099;

// user_id -> JWT（mock 用 raw userID，30 天有效期内复用）
const userJwts = new Map();
// user_id -> Set<socket>：用于广播 desktop:chat
const userSockets = new Map();
// 待处理 PermissionRequest：req_id -> { socket, userId, data, timer }
const pendingPermissions = new Map();
// 历史 PermissionRequest 队列（用于 allow/deny 命令处理最新的）
const permissionQueue = [];

function signJwt(userId) {
  // mock：直接用 userId 当 JWT，加个前缀方便辨认
  return `mock-jwt-${userId}-${Date.now()}`;
}

function parseAuthPayload(payload) {
  // payload: { user_id, token?, user_password? }
  if (!payload || typeof payload.user_id !== 'string') return null;
  return payload;
}

// ---- HTTP server ----
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/auth/login') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid json' }));
        return;
      }
      const payload = parseAuthPayload(parsed);
      if (!payload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'user_id is required' }));
        return;
      }
      // 有 token 且匹配 -> 复用
      if (payload.token && userJwts.get(payload.user_id) === payload.token) {
        console.log(`[auth] reuse jwt user=${payload.user_id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token: payload.token }));
        return;
      }
      // 有 token 但不匹配 -> 401
      if (payload.token && userJwts.get(payload.user_id) !== payload.token) {
        console.log(`[auth] invalid token user=${payload.user_id}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid token' }));
        return;
      }
      // 无 token -> 需要 user_password（mock 接受任意非空）
      if (!payload.user_password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'user_password is required' }));
        return;
      }
      const jwt = signJwt(payload.user_id);
      userJwts.set(payload.user_id, jwt);
      console.log(`[auth] issue jwt user=${payload.user_id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token: jwt }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// ---- Socket.IO server ----
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // 允许 polling + websocket，让 transport 协商更稳；desktop 客户端可只走 websocket
  transports: ['polling', 'websocket'],
});

io.on('connection', (socket) => {
  console.log(`[io] connected socket=${socket.id}`);

  // desktop:auth { user_id, token }
  socket.on('desktop:auth', (data, ack) => {
    const payload = parseAuthPayload(data);
    if (!payload) {
      socket.emit('auth:failed', { reason: 'invalid payload' });
      if (ack) ack({ ok: false });
      return;
    }
    // mock：token 与记录匹配即成功
    const expected = userJwts.get(payload.user_id);
    if (!payload.token || payload.token !== expected) {
      console.log(`[auth:failed] user=${payload.user_id} token mismatch`);
      socket.emit('auth:failed', { reason: 'invalid token, please re-login' });
      if (ack) ack({ ok: false });
      return;
    }
    // 认证成功：登记 socket
    socket.data.userId = payload.user_id;
    if (!userSockets.has(payload.user_id)) userSockets.set(payload.user_id, new Set());
    userSockets.get(payload.user_id).add(socket);
    console.log(`[auth:success] user=${payload.user_id} socket=${socket.id}`);
    socket.emit('auth:success', { user_id: payload.user_id });
    if (ack) ack({ ok: true });
  });

  // desktop:session:sync { sessions: [] }
  socket.on('desktop:session:sync', (data) => {
    const sessions = data?.sessions ?? [];
    console.log(`\n[session:sync] user=${socket.data.userId ?? '?'} ${sessions.length} sessions`);
    for (const s of sessions) {
      console.log(`  sid: ${(s.session_id || '').slice(0, 8)}  project: ${s.project_name || '-'}  title: ${s.title || '-'}`);
    }
  });

  // desktop:envelope:push { envelopes: [] }
  let envelopeCount = 0;
  socket.on('desktop:envelope:push', (data) => {
    const envelopes = data?.envelopes ?? [];
    envelopeCount++;
    console.log(`\n[envelope:push] #${envelopeCount} user=${socket.data.userId ?? '?'} ${envelopes.length} envelopes`);
    for (const env of envelopes) {
      console.log(`  seq: ${env.seq}  role: ${env.role}  type: ${env.ev?.t}  sid: ${(env.sessionId || '').slice(0, 8)}`);
    }
  });

  // desktop:hook:batch { hooks: [] }
  let hookBatchCount = 0;
  socket.on('desktop:hook:batch', (data) => {
    const hooks = data?.hooks ?? [];
    hookBatchCount++;
    console.log(`\n[hook:batch] #${hookBatchCount} user=${socket.data.userId ?? '?'} ${hooks.length} hooks`);
    for (const h of hooks) {
      const name = h.hook_event_name || h.type || '?';
      const sid = (h.session_id || '').slice(0, 8);
      const tool = h.tool_name || h.tool || '';
      console.log(`  ${name}  sid=${sid}  tool=${tool}`);
    }
  });

  // desktop:hook:permission { request_id, data }
  // mock：入队等待命令行 allow/deny 处理；同时启动 2h 超时兜底
  socket.on('desktop:hook:permission', (data) => {
    const reqId = data?.request_id;
    if (!reqId) {
      console.log('[hook:permission] missing request_id, ignore');
      return;
    }
    const inner = data.data || {};
    const tool = inner.tool_name || inner.tool || 'unknown';
    const sid = (inner.session_id || '').slice(0, 8);
    console.log(`\n[hook:permission] req=${reqId.slice(0, 8)} user=${socket.data.userId ?? '?'} sid=${sid} tool=${tool}`);

    const entry = { reqId, socket, userId: socket.data.userId, data: inner, tool, sid, createdAt: Date.now() };
    pendingPermissions.set(reqId, entry);
    permissionQueue.push(reqId);

    // 2h 超时：自动 deny
    const timer = setTimeout(() => {
      if (pendingPermissions.has(reqId)) {
        console.log(`[hook:permission] timeout req=${reqId.slice(0, 8)} auto-deny`);
        sendPermissionResult(reqId, 'deny', { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'mock timeout' } } });
      }
    }, 2 * 60 * 60 * 1000);
    entry.timer = timer;
  });

  // desktop:hook:abort { request_id, decision?, data? }
  socket.on('desktop:hook:abort', (data) => {
    const reqId = data?.request_id;
    if (!reqId) return;
    const entry = pendingPermissions.get(reqId);
    if (!entry) {
      console.log(`[hook:abort] req=${reqId.slice(0, 8)} not found`);
      return;
    }
    clearTimeout(entry.timer);
    pendingPermissions.delete(reqId);
    const idx = permissionQueue.indexOf(reqId);
    if (idx >= 0) permissionQueue.splice(idx, 1);
    console.log(`[hook:abort] req=${reqId.slice(0, 8)} decision=${data.decision || '-'} cleared`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[io] disconnected socket=${socket.id} reason=${reason}`);
    const userId = socket.data.userId;
    if (userId) {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) userSockets.delete(userId);
      }
    }
    // 清理该 socket 的待处理 permission（防止内存泄漏）
    for (const [reqId, entry] of pendingPermissions) {
      if (entry.socket === socket) {
        clearTimeout(entry.timer);
        pendingPermissions.delete(reqId);
        const idx = permissionQueue.indexOf(reqId);
        if (idx >= 0) permissionQueue.splice(idx, 1);
      }
    }
  });
});

// 发送 PermissionRequest 决策结果给 desktop
function sendPermissionResult(reqId, decision, output) {
  const entry = pendingPermissions.get(reqId);
  if (!entry) {
    console.log(`[hook:result] req=${reqId.slice(0, 8)} not found, skip`);
    return false;
  }
  clearTimeout(entry.timer);
  pendingPermissions.delete(reqId);
  const idx = permissionQueue.indexOf(reqId);
  if (idx >= 0) permissionQueue.splice(idx, 1);

  entry.socket.emit('desktop:hook:result', {
    request_id: reqId,
    decision,
    output,
  });
  console.log(`[hook:result] req=${reqId.slice(0, 8)} decision=${decision} sent`);
  return true;
}

// 向某用户的所有 desktop 实例广播 desktop:chat
function broadcastChat(userId, sessionId, question) {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) {
    console.log(`[chat] no desktop online for user=${userId}`);
    return false;
  }
  for (const sock of set) {
    sock.emit('desktop:chat', { session_id: sessionId, question, user_id: userId });
  }
  console.log(`[chat] -> user=${userId} sid=${sessionId.slice(0, 8)} q="${question}" ${set.size} sockets`);
  return true;
}

// ---- 命令行交互 ----
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function printHelp() {
  console.log('\n命令：');
  console.log('  allow [decision=allow]              批准最早的 PermissionRequest');
  console.log('  deny                                拒绝最早的 PermissionRequest');
  console.log('  list                                列出待处理 PermissionRequest');
  console.log('  chat <user_id> <sid> <question>     模拟 mobile 发消息给 desktop');
  console.log('  help                                显示帮助');
  console.log('  exit                                退出\n');
}

rl.setPrompt('mock-cloud> ');
rl.prompt();

rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  if (!cmd) { rl.prompt(); return; }

  if (cmd === 'help' || cmd === '?') {
    printHelp();
  } else if (cmd === 'allow') {
    if (permissionQueue.length === 0) {
      console.log('  no pending permission');
    } else {
      const reqId = permissionQueue[0];
      sendPermissionResult(reqId, 'allow', {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
      });
    }
  } else if (cmd === 'deny') {
    if (permissionQueue.length === 0) {
      console.log('  no pending permission');
    } else {
      const reqId = permissionQueue[0];
      sendPermissionResult(reqId, 'deny', {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'mock denied' } },
      });
    }
  } else if (cmd === 'list') {
    if (permissionQueue.length === 0) {
      console.log('  no pending permission');
    } else {
      console.log(`  ${permissionQueue.length} pending:`);
      for (const reqId of permissionQueue) {
        const e = pendingPermissions.get(reqId);
        console.log(`    req=${reqId.slice(0, 8)} user=${e.userId} sid=${e.sid} tool=${e.tool}`);
      }
    }
  } else if (cmd === 'chat') {
    // chat <user_id> <sid> <question...>
    const userId = parts[1];
    const sid = parts[2];
    const question = parts.slice(3).join(' ');
    if (!userId || !sid || !question) {
      console.log('  usage: chat <user_id> <sid> <question>');
    } else {
      broadcastChat(userId, sid, question);
    }
  } else if (cmd === 'exit' || cmd === 'quit') {
    console.log('shutting down...');
    process.exit(0);
  } else {
    console.log(`  unknown command: ${cmd} (try help)`);
  }
  rl.prompt();
});

httpServer.listen(PORT, () => {
  console.log(`mock cloud server listening on http://localhost:${PORT}`);
  console.log(`  POST /api/auth/login`);
  console.log(`  socket.io events:`);
  console.log(`    desktop:auth / desktop:session:sync / desktop:envelope:push`);
  console.log(`    desktop:hook:batch / desktop:hook:permission / desktop:hook:abort`);
  console.log(`    auth:success / auth:failed / desktop:hook:result / desktop:chat`);
  printHelp();
});
