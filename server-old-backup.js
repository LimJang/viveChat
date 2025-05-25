const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const session = require('express-session');
const sharedSession = require('express-socket.io-session');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// 메모리 내 메시지 저장
let messages = [];
let userSockets = {};
let recentRounds = [];

// 데이터베이스 테이블 생성
async function initializeDatabase() {
  try {
    // Users 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        is_admin INTEGER DEFAULT 0,
        money_balance INTEGER DEFAULT 0,
        money_lost INTEGER DEFAULT 0,
        money_won INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_token VARCHAR(255)
      )
    `);

    // Messages 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        nickname VARCHAR(255),
        text TEXT,
        sender VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      )
    `);

    // Graph games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_games (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        crash_multiplier REAL,
        status VARCHAR(50)
      )
    `);

    // Graph bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_bets (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES graph_games(id),
        user_id INTEGER REFERENCES users(id),
        bet_amount INTEGER,
        stop_multiplier REAL,
        result VARCHAR(50),
        win_amount INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Baccarat games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS baccarat_games (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        player_card1 VARCHAR(10),
        player_card2 VARCHAR(10),
        player_card3 VARCHAR(10),
        banker_card1 VARCHAR(10),
        banker_card2 VARCHAR(10),
        banker_card3 VARCHAR(10),
        result VARCHAR(50),
        player_point INTEGER,
        banker_point INTEGER
      )
    `);

    // Baccarat bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS baccarat_bets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        game_id INTEGER REFERENCES baccarat_games(id),
        bet_type VARCHAR(50),
        bet_amount INTEGER,
        win_amount INTEGER,
        result VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Slot games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slot_games (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        bet_amount INTEGER,
        result TEXT,
        win_amount INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Horse race rounds 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS horse_race_rounds (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        horses TEXT,
        result TEXT
      )
    `);

    // Horse race bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS horse_race_bets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        round_id INTEGER REFERENCES horse_race_rounds(id),
        horse_id INTEGER,
        amount INTEGER,
        odds REAL,
        paid_rank INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// 서버 시작 시 데이터베이스 초기화
initializeDatabase();

// 서버 시작 시 ogf2002 계정의 is_admin을 1로 업데이트
setTimeout(async () => {
  try {
    await pool.query("UPDATE users SET is_admin = 1 WHERE username = 'ogf2002'");
  } catch (error) {
    console.error('Error updating admin status:', error);
  }
}, 1000);

// 서버 시작 시 DB에서 최근 5개 라운드 불러오기
setTimeout(async () => {
  try {
    const result = await pool.query(`
      SELECT id as round, crash_multiplier as crashMultiplier, 
             EXTRACT(EPOCH FROM (end_time - start_time)) as elapsedSeconds 
      FROM graph_games 
      WHERE end_time IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 5
    `);
    
    if (result.rows) {
      recentRounds = result.rows.reverse().map(r => ({
        round: r.round,
        crashMultiplier: r.crashmultiplier,
        elapsedSeconds: +r.elapsedseconds
      }));
    }
  } catch (error) {
    console.error('Error loading recent rounds:', error);
  }
}, 2000);

// 세션 미들웨어를 변수로 분리
const sessionMiddleware = session({
  secret: 'vivegame-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production' ? false : false // Railway uses HTTPS proxy
  }
});
app.use(sessionMiddleware);

// 어드민 데이터 삭제 API rate limit: 1분 1회
const adminDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  message: { error: '1분에 1회만 시도할 수 있습니다.' }
});

// 세션 토큰 검증 미들웨어
async function checkSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  try {
    const result = await pool.query('SELECT session_token FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows[0] || result.rows[0].session_token !== req.session.sessionToken) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '중복 로그인 감지, 다시 로그인하세요.' });
    }
    next();
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

// 회원가입 API
app.post('/api/register', express.json(), async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  
  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existingUser.rows.length > 0) return res.status(409).json({ error: '이미 존재하는 닉네임 또는 이메일' });
    
    const hash = await bcrypt.hash(password, 10);
    const isAdmin = username === 'ogf2002' ? 1 : 0;
    
    const result = await pool.query(
      'INSERT INTO users (username, password, email, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, email, isAdmin]
    );
    
    res.json({ success: true, userId: result.rows[0].id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그인 API
app.post('/api/login', express.json(), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    
    const sessionToken = uuidv4();
    await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [sessionToken, user.id]);
    
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.is_admin = user.is_admin;
    req.session.sessionToken = sessionToken;
    
    res.json({ success: true, username: user.username, is_admin: user.is_admin });
    setTimeout(broadcastOnlineUsers, 100);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그인 상태 확인 및 사용자 정보 반환
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  try {
    const result = await pool.query('SELECT id, username, email, is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(401).json({ error: '사용자 정보 없음' });
    
    const user = result.rows[0];
    res.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin });
  } catch (error) {
    console.error('User info error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그아웃 API
app.post('/api/logout', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      await pool.query('UPDATE users SET session_token = NULL WHERE id = $1', [req.session.userId]);
      setTimeout(broadcastOnlineUsers, 100);
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// 사용자 목록 갱신 함수
function broadcastUserCount() {
  const count = Object.keys(userSockets).length;
  io.emit('user count', count);
}

io.use(sharedSession(sessionMiddleware));

// [그래프게임] 실시간 라운드/배당률/터짐 관리 및 socket.io 통신
const GRAPH_MIN_BET = 1000;
const GRAPH_MAX_BET = 100000;
const GRAPH_ROUND_INTERVAL = 10000; // 10초(그래프 최대 진행)
const GRAPH_TICK_MS = 100; // 0.1초마다 배당률 갱신
const GRAPH_MAX_MULTIPLIER = 10.0;
let currentGraphGame = null;
let currentMultiplier = 1.0;
let currentCrash = null;
let graphGameTimer = null;
let pendingBets = {}; // userId: { amount }
let nextGameId = 1;
let bettingPhase = false;
let bettingCountdown = 0;
let bettingTimer = null;

// 서버 시작 시 DB에서 MAX(id)로 nextGameId 동기화
setTimeout(async () => {
  try {
    const result = await pool.query('SELECT MAX(id) as maxId FROM graph_games');
    if (result.rows[0] && result.rows[0].maxid) {
      nextGameId = result.rows[0].maxid + 1;
    }
  } catch (error) {
    console.error('Error syncing nextGameId:', error);
  }
}, 1500);

function getRandomCrashMultiplier() {
  // 실제 서비스 분포: 1.01~2.0x(55%), 2.01~4.0x(25%), 4.01~7.0x(15%), 7.01~10.0x(5%)
  const r = Math.random();
  if (r < 0.55) return +(1.01 + Math.random() * 0.99).toFixed(2); // 1.01~2.00 (55%)
  if (r < 0.80) return +(2.01 + Math.random() * 1.99).toFixed(2); // 2.01~4.00 (25%)
  if (r < 0.95) return +(4.01 + Math.random() * 2.99).toFixed(2); // 4.01~7.00 (15%)
  return +(7.01 + Math.random() * 2.99).toFixed(2); // 7.01~10.00 (5%)
}

function startBettingPhase() {
  if (bettingPhase || (currentGraphGame && !currentGraphGame.end_time)) {
    return;
  }
  bettingPhase = true;
  bettingCountdown = 30;
  io.emit('betting_phase', { seconds: bettingCountdown });
  bettingTimer = setInterval(() => {
    bettingCountdown--;
    io.emit('betting_phase', { seconds: bettingCountdown });
    if (bettingCountdown <= 0) {
      clearInterval(bettingTimer);
      bettingPhase = false;
      startGraphGameRound();
    }
  }, 1000);
}

async function startGraphGameRound() {
  currentMultiplier = 1.0;
  currentCrash = getRandomCrashMultiplier();
  const startTime = Date.now();
  
  try {
    const result = await pool.query(
      'INSERT INTO graph_games (start_time, status, crash_multiplier) VALUES ($1, $2, $3) RETURNING id',
      [new Date(startTime).toISOString(), 'playing', currentCrash]
    );
    
    currentGraphGame = { 
      id: result.rows[0].id, 
      start_time: startTime, 
      status: 'playing', 
      crash_multiplier: currentCrash, 
      gameId: result.rows[0].id 
    };
    
    io.emit('graph_round_start', {
      gameId: currentGraphGame.id,
      startTime,
      crashMultiplier: currentCrash,
      minBet: GRAPH_MIN_BET,
      maxBet: GRAPH_MAX_BET
    });
    
    // 예약된 베팅 자동 반영
    for (const [userId, bet] of Object.entries(pendingBets)) {
      try {
        const userResult = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
        if (!userResult.rows[0] || userResult.rows[0].money_balance < bet.amount) continue;
        
        await pool.query('UPDATE users SET money_balance = money_balance - $1 WHERE id = $2', [bet.amount, userId]);
        await pool.query(
          'INSERT INTO graph_bets (game_id, user_id, bet_amount, result) VALUES ($1, $2, $3, $4)',
          [currentGraphGame.id, userId, bet.amount, 'playing']
        );
      } catch (error) {
        console.error('Error processing pending bet:', error);
      }
      delete pendingBets[userId];
    }
    
    runGraphGameTick();
  } catch (error) {
    console.error('Error starting graph game round:', error);
  }
}

function runGraphGameTick() {
  if (!currentGraphGame) return;
  graphGameTimer = setInterval(() => {
    let delta;
    if (Math.random() < 0.7) {
      delta = 0.05 + Math.random() * 0.10; // 상승 0.05~0.15
    } else {
      delta = -(0.10 + Math.random() * 0.15); // 하락 -0.10~-0.25
    }
    let nextMultiplier = +(currentMultiplier + delta).toFixed(2);
    if (nextMultiplier < 0.2) nextMultiplier = 0.2;
    currentMultiplier = nextMultiplier;
    if (currentMultiplier >= currentCrash || currentMultiplier >= GRAPH_MAX_MULTIPLIER || currentMultiplier <= 0.2) {
      currentMultiplier = Math.min(currentCrash, GRAPH_MAX_MULTIPLIER);
      io.emit('graph_multiplier', { multiplier: currentMultiplier, crashed: true });
      endGraphGameRound();
      clearInterval(graphGameTimer);
    } else {
      io.emit('graph_multiplier', { multiplier: currentMultiplier, crashed: false });
    }
  }, GRAPH_TICK_MS);
}

async function endGraphGameRound() {
  if (!currentGraphGame) return;
  
  try {
    await pool.query(
      'UPDATE graph_games SET end_time = $1, status = $2 WHERE id = $3',
      [new Date().toISOString(), 'ended', currentGraphGame.id]
    );
    
    const elapsedMs = Date.now() - currentGraphGame.start_time;
    recentRounds.push({
      round: currentGraphGame.gameId,
      crashMultiplier: currentGraphGame.crash_multiplier,
      elapsedSeconds: +(elapsedMs/1000).toFixed(2)
    });
    if (recentRounds.length > 5) recentRounds.shift();
    io.emit('recent_rounds', recentRounds);
    
    setTimeout(() => {
      currentGraphGame = null;
      startBettingPhase();
    }, 2000);
  } catch (error) {
    console.error('Error ending graph game round:', error);
  }
}

// 서버 시작 시 라운드 자동 시작
setTimeout(() => {
  if (!currentGraphGame) startBettingPhase();
}, 3000);

// 온라인 유저 목록 브로드캐스트 함수
async function broadcastOnlineUsers() {
  const userIds = Object.keys(userSockets);
  if (!userIds.length) {
    io.emit('online users', []);
    return;
  }
  
  try {
    const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',');
    const result = await pool.query(
      `SELECT id, username FROM users WHERE id IN (${placeholders})`,
      userIds
    );
    
    const usernames = result.rows.map(r => r.username);
    io.emit('online users', usernames);
  } catch (error) {
    console.error('Error broadcasting online users:', error);
    io.emit('online users', []);
  }
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  const sess = socket.handshake.session;
  const username = sess && sess.username ? sess.username : '익명';
  let currentRoom = null;

  const userId = sess && sess.userId;
  if (userId) {
    if (!userSockets[userId]) userSockets[userId] = new Set();
    userSockets[userId].add(socket.id);
    broadcastOnlineUsers();
    broadcastUserCount();
  }

  socket.on('join room', ({ room }) => {
    if (currentRoom) socket.leave(currentRoom);
    currentRoom = room;
    socket.join(room);
    updateRoomUsers(room);
  });

  socket.on('disconnect', () => {
    if (currentRoom) updateRoomUsers(currentRoom);
    const userId = sess && sess.userId;
    if (userId && userSockets[userId]) {
      userSockets[userId].delete(socket.id);
      if (userSockets[userId].size === 0) {
        delete userSockets[userId];
      }
      broadcastOnlineUsers();
    }
    broadcastUserCount();
  });

  function updateRoomUsers(room) {
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const usernames = clients.map(id => {
      const s = io.sockets.sockets.get(id);
      return s && s.handshake.session && s.handshake.session.username;
    }).filter(Boolean);
    io.to(room).emit('room users', usernames);
  }

  // 소켓 연결 시 최근 라운드 정보 전송
  socket.emit('recent_rounds', recentRounds);

  // 소켓 연결 시 현재 라운드/베팅 타임 정보 전송
  if (bettingPhase) {
    socket.emit('betting_phase', { seconds: bettingCountdown });
  } else if (currentGraphGame) {
    socket.emit('graph_round_start', {
      gameId: currentGraphGame.id,
      startTime: currentGraphGame.start_time,
      crashMultiplier: currentGraphGame.crash_multiplier,
      minBet: GRAPH_MIN_BET,
      maxBet: GRAPH_MAX_BET
    });
    socket.emit('graph_multiplier', { multiplier: currentMultiplier, crashed: false });
  }

  // 접속 시 DB에서 메시지 불러와 전송
  loadAndSendMessages(socket);
  broadcastUserCount();

  // 메시지 수신
  socket.on('chat message', async (msg) => {
    if (!sess || !sess.userId) return;
    
    try {
      const result = await pool.query('SELECT id, username, is_admin FROM users WHERE id = $1', [sess.userId]);
      if (result.rows.length === 0) return;
      
      const user = result.rows[0];
      const senderType = user.is_admin ? 'admin' : 'user';
      const nickname = user.username;
      const messageObj = {
        text: msg,
        sender: senderType,
        nickname,
        timestamp: new Date().toISOString(),
      };
      
      await pool.query(
        'INSERT INTO messages (user_id, nickname, text, sender) VALUES ($1, $2, $3, $4)',
        [user.id, nickname, msg, senderType]
      );
      
      messages.push({ ...messageObj });
      io.emit('chat message', messageObj);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // admin이 채팅 삭제 요청 (soft delete)
  socket.on('clear messages', async () => {
    if (!!(sess && sess.is_admin)) {
      try {
        await pool.query("UPDATE messages SET status = 'deleted' WHERE status IS NULL OR status != 'deleted'");
        messages = [];
        io.emit('init', messages);
      } catch (error) {
        console.error('Error clearing messages:', error);
      }
    }
  });
});

// 메시지 로드 및 전송 함수
async function loadAndSendMessages(socket) {
  try {
    const result = await pool.query("SELECT * FROM messages WHERE status IS NULL OR status != 'deleted' ORDER BY created_at ASC");
    messages = result.rows.map(row => ({
      text: row.text,
      sender: row.sender,
      nickname: row.nickname,
      timestamp: row.created_at
    }));
    socket.emit('init', messages);
  } catch (error) {
    console.error('Error loading messages:', error);
    socket.emit('init', []);
  }
}

// 게임머니 관련 API들
app.get('/api/users', checkSession, async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  
  try {
    const result = await pool.query('SELECT id, username, email, money_balance FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.post('/api/users/:id/add-money', checkSession, express.json(), async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  
  const userId = parseInt(req.params.id, 10);
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'userId, amount 필요/유효성 오류' });
  }
  
  try {
    await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [amount, userId]);
    const result = await pool.query('SELECT id, username, money_balance FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: '사용자 없음' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error adding money:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.get('/api/users/me', checkSession, async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  try {
    const result = await pool.query('SELECT money_balance FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: '사용자 없음' });
    
    res.json({ money_balance: result.rows[0].money_balance });
  } catch (error) {
    console.error('Error fetching user money:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 그래프게임 베팅 API
app.post('/api/graph/bet', checkSession, express.json(), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  const userId = req.session.userId;
  const amount = parseInt(req.body.amount, 10);
  if (!bettingPhase) return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다. 라운드 종료 후 베팅 가능합니다.' });
  if (!amount || amount < GRAPH_MIN_BET || amount > GRAPH_MAX_BET) {
    return res.status(400).json({ error: `베팅금액은 ${GRAPH_MIN_BET}~${GRAPH_MAX_BET}원` });
  }
  if (pendingBets[userId]) return res.status(400).json({ error: '이미 베팅 예약함' });
  
  try {
    const result = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0 || result.rows[0].money_balance < amount) {
      return res.status(400).json({ error: '머니 부족' });
    }
    
    pendingBets[userId] = { amount };
    res.json({ reserved: true });
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.post('/api/graph/stop', checkSession, express.json(), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  const userId = req.session.userId;
  if (!currentGraphGame || !currentGraphGame.id) return res.status(400).json({ error: '진행 중인 라운드 없음' });
  
  try {
    const result = await pool.query('SELECT * FROM graph_bets WHERE game_id = $1 AND user_id = $2', [currentGraphGame.id, userId]);
    if (result.rows.length === 0 || result.rows[0].result !== 'playing') {
      return res.status(400).json({ error: '베팅 없음 또는 이미 스톱/종료' });
    }
    if (currentMultiplier >= currentCrash) return res.status(400).json({ error: '이미 터짐' });
    
    const bet = result.rows[0];
    const winAmount = Math.floor(bet.bet_amount * currentMultiplier);
    
    await pool.query(
      'UPDATE graph_bets SET stop_multiplier = $1, result = $2, win_amount = $3 WHERE id = $4',
      [currentMultiplier, 'win', winAmount, bet.id]
    );
    await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [winAmount, userId]);
    
    res.json({ success: true, winAmount, stopMultiplier: currentMultiplier });
  } catch (error) {
    console.error('Error stopping bet:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.get('/api/graph/my-bet', checkSession, async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  if (!currentGraphGame || !currentGraphGame.id) return res.json({});
  
  try {
    const result = await pool.query('SELECT * FROM graph_bets WHERE game_id = $1 AND user_id = $2', [currentGraphGame.id, req.session.userId]);
    if (result.rows.length === 0) return res.json({});
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching my bet:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('PostgreSQL connection configured');
});
