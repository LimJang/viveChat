const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');
const session = require('express-session');
const sharedSession = require('express-socket.io-session');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// 메모리 내 메시지 저장
let messages = [];
let userSockets = {};
let recentRounds = [];

// 서버 시작 시 users 테이블 없으면 생성
const userTableDDL = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  is_admin INTEGER DEFAULT 0,
  money_balance INTEGER DEFAULT 0,
  money_lost INTEGER DEFAULT 0,
  money_won INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  session_token TEXT
);`;
db.run(userTableDDL);

// messages 테이블 생성
const messageTableDDL = `CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  nickname TEXT,
  text TEXT,
  sender TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  FOREIGN KEY(user_id) REFERENCES users(id)
);`;
db.run(messageTableDDL);

// [그래프게임] graph_games, graph_bets 테이블 생성
const graphGamesDDL = `CREATE TABLE IF NOT EXISTS graph_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME,
  end_time DATETIME,
  crash_multiplier REAL,
  status TEXT
);`;
db.run(graphGamesDDL);
const graphBetsDDL = `CREATE TABLE IF NOT EXISTS graph_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  user_id INTEGER,
  bet_amount INTEGER,
  stop_multiplier REAL,
  result TEXT,
  win_amount INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(game_id) REFERENCES graph_games(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);`;
db.run(graphBetsDDL);

// [바카라] baccarat_games, baccarat_bets 테이블 생성
const baccaratGamesDDL = `CREATE TABLE IF NOT EXISTS baccarat_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME,
  end_time DATETIME,
  player_card1 TEXT,
  player_card2 TEXT,
  player_card3 TEXT,
  banker_card1 TEXT,
  banker_card2 TEXT,
  banker_card3 TEXT,
  result TEXT, -- 'player', 'banker', 'tie'
  player_point INTEGER,
  banker_point INTEGER
);`;
db.run(baccaratGamesDDL);
const baccaratBetsDDL = `CREATE TABLE IF NOT EXISTS baccarat_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  game_id INTEGER,
  bet_type TEXT, -- 'player', 'banker', 'tie'
  bet_amount INTEGER,
  win_amount INTEGER,
  result TEXT, -- 'win', 'lose'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;
db.run(baccaratBetsDDL);

// [슬롯머신] slot_games 테이블 생성
const slotGamesDDL = `CREATE TABLE IF NOT EXISTS slot_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  bet_amount INTEGER,
  result TEXT,
  win_amount INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;
db.run(slotGamesDDL);

// [경마] horse_race_rounds, horse_race_bets 테이블 생성
const horseRaceRoundsDDL = `CREATE TABLE IF NOT EXISTS horse_race_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME,
  end_time DATETIME,
  horses TEXT, -- JSON: [{id,name,condition,odds,speedRange}]
  result TEXT -- JSON: [1등id,2등id,...]
);`;
db.run(horseRaceRoundsDDL);
const horseRaceBetsDDL = `CREATE TABLE IF NOT EXISTS horse_race_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  round_id INTEGER,
  horse_id INTEGER,
  amount INTEGER,
  odds REAL,
  paid_rank INTEGER, -- 1,2,3등 지급시 등수
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;
db.run(horseRaceBetsDDL);

// 서버 시작 시 ogf2002 계정의 is_admin을 1로 업데이트
setTimeout(() => {
  db.run("UPDATE users SET is_admin = 1 WHERE username = 'ogf2002'");
}, 1000);

// 서버 시작 시 DB에서 최근 5개 라운드 불러오기
db.all('SELECT id as round, crash_multiplier as crashMultiplier, (strftime("%s", end_time) - strftime("%s", start_time)) as elapsedSeconds FROM graph_games WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 5', [], (err, rows) => {
  if (!err && rows) {
    recentRounds = rows.reverse().map(r => ({
      round: r.round,
      crashMultiplier: r.crashMultiplier,
      elapsedSeconds: +r.elapsedSeconds
    }));
  }
});

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
function checkSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  db.get('SELECT session_token FROM users WHERE id = ?', [req.session.userId], (err, row) => {
    if (!row || row.session_token !== req.session.sessionToken) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '중복 로그인 감지, 다시 로그인하세요.' });
    }
    next();
  });
}

// 회원가입 API
app.post('/api/register', express.json(), async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, row) => {
    if (row) return res.status(409).json({ error: '이미 존재하는 닉네임 또는 이메일' });
    const hash = await bcrypt.hash(password, 10);
    // ogf2002면 is_admin=1로 저장
    const isAdmin = username === 'ogf2002' ? 1 : 0;
    db.run(
      'INSERT INTO users (username, password, email, is_admin) VALUES (?, ?, ?, ?)',
      [username, hash, email, isAdmin],
      function (err) {
        if (err) return res.status(500).json({ error: 'DB 오류' });
        res.json({ success: true, userId: this.lastID });
      }
    );
  });
});

// 로그인 API
app.post('/api/login', express.json(), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (!user) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    // 세션 토큰 생성 및 저장
    const sessionToken = uuidv4();
    db.run('UPDATE users SET session_token = ? WHERE id = ?', [sessionToken, user.id]);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.is_admin = user.is_admin;
    req.session.sessionToken = sessionToken;
    res.json({ success: true, username: user.username, is_admin: user.is_admin });
    setTimeout(broadcastOnlineUsers, 100);
  });
});

// 로그인 상태 확인 및 사용자 정보 반환
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  db.get('SELECT id, username, email, is_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (!user) return res.status(401).json({ error: '사용자 정보 없음' });
    res.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin });
  });
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  if (req.session && req.session.userId) {
    db.run('UPDATE users SET session_token = NULL WHERE id = ?', [req.session.userId]);
    setTimeout(broadcastOnlineUsers, 100);
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
db.get('SELECT MAX(id) as maxId FROM graph_games', [], (err, row) => {
  if (!err && row && row.maxId) {
    nextGameId = row.maxId + 1;
  }
});

function getRandomCrashMultiplier() {
  // 실제 서비스 분포: 1.01~2.0x(55%), 2.01~4.0x(25%), 4.01~7.0x(15%), 7.01~10.0x(5%)
  const r = Math.random();
  if (r < 0.55) return +(1.01 + Math.random() * 0.99).toFixed(2); // 1.01~2.00 (55%)
  if (r < 0.80) return +(2.01 + Math.random() * 1.99).toFixed(2); // 2.01~4.00 (25%)
  if (r < 0.95) return +(4.01 + Math.random() * 2.99).toFixed(2); // 4.01~7.00 (15%)
  return +(7.01 + Math.random() * 2.99).toFixed(2); // 7.01~10.00 (5%)
}

function startBettingPhase() {
  // 중복 실행 방지: 이미 베팅 타임이거나, 라운드가 진행 중이면 return
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

function startGraphGameRound() {
  currentMultiplier = 1.0;
  currentCrash = getRandomCrashMultiplier();
  const startTime = Date.now();
  const endTime = startTime + GRAPH_ROUND_INTERVAL;
  db.run('INSERT INTO graph_games (start_time, status, crash_multiplier) VALUES (?, ?, ?)',
    [new Date(startTime).toISOString(), 'playing', currentCrash], function (err) {
      if (err) return;
      currentGraphGame = { id: this.lastID, start_time: startTime, status: 'playing', crash_multiplier: currentCrash, gameId: this.lastID };
      io.emit('graph_round_start', {
        gameId: currentGraphGame.id,
        startTime,
        crashMultiplier: currentCrash,
        minBet: GRAPH_MIN_BET,
        maxBet: GRAPH_MAX_BET
      });
      // 예약된 베팅 자동 반영
      for (const [userId, bet] of Object.entries(pendingBets)) {
        db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
          if (!user || user.money_balance < bet.amount) return; // 머니 부족 시 무시
          db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [bet.amount, userId], (err) => {
            if (err) return;
            db.run('INSERT INTO graph_bets (game_id, user_id, bet_amount, result) VALUES (?, ?, ?, ?)',
              [currentGraphGame.id, userId, bet.amount, 'playing']);
          });
        });
        delete pendingBets[userId];
      }
      runGraphGameTick();
    });
}

function runGraphGameTick() {
  if (!currentGraphGame) return;
  graphGameTimer = setInterval(() => {
    // 70% 확률로 상승, 30% 확률로 하락, 등락폭 큼
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

function endGraphGameRound() {
  if (!currentGraphGame) return;
  db.run('UPDATE graph_games SET end_time = ?, status = ? WHERE id = ?',
    [new Date().toISOString(), 'ended', currentGraphGame.id]);
  // 최근 라운드 정보 저장 및 전송
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
  }, 2000); // 2초 후 베팅 타임 시작
}

// 서버 시작 시 라운드 자동 시작
setTimeout(() => {
  if (!currentGraphGame) startBettingPhase();
}, 2000);

// 온라인 유저 목록 브로드캐스트 함수
function broadcastOnlineUsers() {
  // userSockets: { userId: Set(socketId) }
  const userIds = Object.keys(userSockets);
  if (!userIds.length) {
    io.emit('online users', []);
    return;
  }
  db.all('SELECT id, username FROM users WHERE id IN (' + userIds.map(()=>'?').join(',') + ')', userIds, (err, rows) => {
    if (err || !rows) {
      io.emit('online users', []);
      return;
    }
    const usernames = rows.map(r => r.username);
    io.emit('online users', usernames);
  });
}

io.on('connection', (socket) => {
  const sess = socket.handshake.session;
  const username = sess && sess.username ? sess.username : '익명';
  let currentRoom = null;

  // [추가] userSockets에 소켓 등록
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
    // ... 기존 disconnect 처리 ...
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

  // 접속 시 DB에서 status가 deleted가 아닌 메시지만 불러와 전송
  db.all("SELECT * FROM messages WHERE status IS NULL OR status != 'deleted' ORDER BY created_at ASC", [], (err, rows) => {
    messages = rows.map(row => ({
      text: row.text,
      sender: row.sender,
      nickname: row.nickname,
      timestamp: row.created_at
    }));
    socket.emit('init', messages);
  });
  broadcastUserCount();

  // 닉네임 설정 (닉네임 변경은 DB에 반영 X, username 고정)
  socket.on('set nickname', (nickname) => {
    // 무시: 닉네임은 DB username 고정
  });

  // 메시지 수신
  socket.on('chat message', (msg) => {
    if (!sess || !sess.userId) return; // 로그인 안 된 경우 무시
    db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [sess.userId], (err, user) => {
      if (!user) return;
      const senderType = user.is_admin ? 'admin' : 'user';
      const nickname = user.username;
      const messageObj = {
        text: msg,
        sender: senderType,
        nickname,
        timestamp: new Date().toISOString(),
      };
      // DB에 저장 (status 필드 생략)
      db.run(
        'INSERT INTO messages (user_id, nickname, text, sender) VALUES (?, ?, ?, ?)',
        [user.id, nickname, msg, senderType],
        function (err) {
          if (!err) {
            messages.push({ ...messageObj });
            io.emit('chat message', messageObj);
          }
        }
      );
    });
  });

  // admin이 채팅 삭제 요청 (soft delete)
  socket.on('clear messages', () => {
    if (!!(sess && sess.is_admin)) {
      // DB에서 status가 deleted가 아닌 메시지 모두 deleted로 변경
      db.run("UPDATE messages SET status = 'deleted' WHERE status IS NULL OR status != 'deleted'", (err) => {
        if (!err) {
          messages = [];
          io.emit('init', messages);
        }
      });
    }
  });
});

// [게임머니] 어드민: 전체 사용자 리스트 반환
app.get('/api/users', checkSession, (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  db.all('SELECT id, username, email, money_balance FROM users ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    res.json(rows);
  });
});

// [게임머니] 어드민: 특정 사용자에 머니 충전
app.post('/api/users/:id/add-money', checkSession, express.json(), (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  const userId = parseInt(req.params.id, 10);
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'userId, amount 필요/유효성 오류' });
  db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [amount, userId], function (err) {
    if (err) { console.error(err); return res.status(500).json({ error: 'DB 오류' }); }
    db.get('SELECT id, username, money_balance FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) { console.error(err); return res.status(404).json({ error: '사용자 없음' }); }
      res.json({ success: true, user });
    });
  });
});

// [게임머니] 본인 머니 조회 API
app.get('/api/users/me', checkSession, (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  db.get('SELECT money_balance FROM users WHERE id = ?', [req.session.userId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: '사용자 없음' });
    res.json({ money_balance: row.money_balance });
  });
});

// [그래프게임] 베팅/스톱/정산 API
app.post('/api/graph/bet', checkSession, express.json(), (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  const userId = req.session.userId;
  const amount = parseInt(req.body.amount, 10);
  if (!bettingPhase) return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다. 라운드 종료 후 베팅 가능합니다.' });
  if (!amount || amount < GRAPH_MIN_BET || amount > GRAPH_MAX_BET) return res.status(400).json({ error: `베팅금액은 ${GRAPH_MIN_BET}~${GRAPH_MAX_BET}원` });
  // 이미 베팅 예약했는지 확인
  if (pendingBets[userId]) return res.status(400).json({ error: '이미 베팅 예약함' });
  // 베팅 타임에는 무조건 예약만 받고, 라운드 시작 시 일괄 반영
  db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
    if (!user || user.money_balance < amount) return res.status(400).json({ error: '머니 부족' });
    pendingBets[userId] = { amount };
    res.json({ reserved: true });
  });
});

app.post('/api/graph/stop', checkSession, express.json(), (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  const userId = req.session.userId;
  if (!currentGraphGame || !currentGraphGame.id) return res.status(400).json({ error: '진행 중인 라운드 없음' });
  db.get('SELECT * FROM graph_bets WHERE game_id = ? AND user_id = ?', [currentGraphGame.id, userId], (err, bet) => {
    if (!bet || bet.result !== 'playing') return res.status(400).json({ error: '베팅 없음 또는 이미 스톱/종료' });
    if (currentMultiplier >= currentCrash) return res.status(400).json({ error: '이미 터짐' });
    const winAmount = Math.floor(bet.bet_amount * currentMultiplier);
    db.run('UPDATE graph_bets SET stop_multiplier = ?, result = ?, win_amount = ? WHERE id = ?',
      [currentMultiplier, 'win', winAmount, bet.id], (err) => {
        if (err) return res.status(500).json({ error: 'DB 오류' });
        db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [winAmount, userId], (err) => {
          if (err) return res.status(500).json({ error: 'DB 오류' });
          res.json({ success: true, winAmount, stopMultiplier: currentMultiplier });
        });
      });
  });
});

app.get('/api/graph/my-bet', checkSession, (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  if (!currentGraphGame || !currentGraphGame.id) return res.json({});
  db.get('SELECT * FROM graph_bets WHERE game_id = ? AND user_id = ?', [currentGraphGame.id, req.session.userId], (err, row) => {
    if (!row) return res.json({});
    res.json(row);
  });
});

// [바카라] 실시간 라운드/베팅 타임/카드/결과/소켓
const BACCARAT_MIN_BET = 1000;
const BACCARAT_MAX_BET = 1000000;
const BACCARAT_ROUND_INTERVAL = 20000; // 베팅 타임 20초
const BACCARAT_RESULT_DELAY = 3000; // 결과 공개 후 3초 대기
let baccaratHistory = [];

// 현재 바카라 라운드 상태(메모리, 추후 소켓/타이머로 확장)
let currentBaccaratGame = null;
let baccaratBettingPhase = false;
let baccaratBettingCountdown = 0;
let baccaratBettingTimer = null;
let baccaratNextGameId = 1;
let baccaratAnimationDone = false;

// 서버 시작 시 DB에서 MAX(id)로 baccaratNextGameId 동기화
// (그래프게임과 동일 패턴)
db.get('SELECT MAX(id) as maxId FROM baccarat_games', [], (err, row) => {
  if (!err && row && row.maxId) {
    baccaratNextGameId = row.maxId + 1;
  }
});

function getRandomCard(deck) {
  // 카드: 1~13(에이스~킹), 4종류, 점수는 10/J/Q/K=0, 2~9=숫자, A=1
  if (deck.length === 0) return null;
  const idx = Math.floor(Math.random() * deck.length);
  return deck.splice(idx, 1)[0];
}
function getCardPoint(card) {
  if (!card) return 0;
  const v = card.value;
  if (v === 1) return 1;
  if (v >= 10) return 0;
  return v;
}
function getHandPoint(cards) {
  return cards.reduce((sum, c) => sum + getCardPoint(c), 0) % 10;
}
function cardToString(card) {
  // 예: 'A♠', '10♥', 'K♣'
  const v = card.value;
  const suit = ['♠','♥','♣','◆'][card.suit];
  const name = v === 1 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : v;
  return name + suit;
}
function drawBaccaratCards() {
  // 52장 덱 생성 및 안전한 카드 분배(최대 5회 재시도)
  let attempt = 0;
  while (attempt < 5) {
    let deck = [];
    for (let s = 0; s < 4; s++) for (let v = 1; v <= 13; v++) deck.push({ value: v, suit: s });
    // 셔플
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // 카드 분배
    const player = [getRandomCard(deck), getRandomCard(deck)];
    const banker = [getRandomCard(deck), getRandomCard(deck)];
    // null 체크
    if (player.includes(null) || banker.includes(null)) {
      attempt++;
      continue;
    }
    // 3번째 카드 룰(간단화, 실제 룰은 추후 보강)
    let playerPoint = getHandPoint(player);
    let bankerPoint = getHandPoint(banker);
    let player3 = null, banker3 = null;
    if (playerPoint <= 5) {
      player3 = getRandomCard(deck);
      if (player3) player.push(player3);
    }
    if (bankerPoint <= 5) {
      banker3 = getRandomCard(deck);
      if (banker3) banker.push(banker3);
    }
    // null 체크(3번째 카드 포함)
    if (player.includes(null) || banker.includes(null)) {
      attempt++;
      continue;
    }
    playerPoint = getHandPoint(player);
    bankerPoint = getHandPoint(banker);
    return {
      player: player.map(cardToString),
      banker: banker.map(cardToString),
      player_point: playerPoint,
      banker_point: bankerPoint
    };
  }
  // 5회 시도 실패 시 에러 로그 및 기본 카드 반환
  console.error('[ERROR] drawBaccaratCards: 카드 분배 실패, 기본 카드로 대체');
  return {
    player: ['A♠','2♠','3♠'],
    banker: ['A♣','2♣','3♣'],
    player_point: 6,
    banker_point: 6
  };
}
function startBaccaratBettingPhase() {
  if (baccaratBettingPhase || (currentBaccaratGame && !currentBaccaratGame.end_time)) {
    return;
  }
  baccaratBettingPhase = true;
  baccaratBettingCountdown = 20;
  // 새 라운드 생성
  const gameId = baccaratNextGameId++;
  currentBaccaratGame = {
    id: gameId,
    start_time: new Date().toISOString(),
    player: [],
    banker: [],
    player_point: null,
    banker_point: null,
    result: '',
    status: 'betting'
  };
  db.run('INSERT INTO baccarat_games (id, start_time) VALUES (?, ?)', [gameId, currentBaccaratGame.start_time]);
  io.emit('baccarat_round_start', {
    gameId,
    seconds: baccaratBettingCountdown
  });
  baccaratBettingTimer = setInterval(() => {
    baccaratBettingCountdown--;
    io.emit('baccarat_betting_phase', { seconds: baccaratBettingCountdown });
    if (baccaratBettingCountdown <= 0) {
      clearInterval(baccaratBettingTimer);
      baccaratBettingPhase = false;
      revealBaccaratResult();
    }
  }, 1000);
}
function revealBaccaratResult() {
  // 카드 분배 및 결과 계산
  const cards = drawBaccaratCards();
  currentBaccaratGame.player = cards.player;
  currentBaccaratGame.banker = cards.banker;
  currentBaccaratGame.player_point = cards.player_point;
  currentBaccaratGame.banker_point = cards.banker_point;
  let result = '';
  if (cards.player_point > cards.banker_point) result = 'player';
  else if (cards.player_point < cards.banker_point) result = 'banker';
  else result = 'tie';
  currentBaccaratGame.result = result;
  currentBaccaratGame.end_time = new Date().toISOString();
  // DB에 결과 저장
  db.run('UPDATE baccarat_games SET end_time=?, player_card1=?, player_card2=?, player_card3=?, banker_card1=?, banker_card2=?, banker_card3=?, result=?, player_point=?, banker_point=? WHERE id=?',
    [currentBaccaratGame.end_time,
      currentBaccaratGame.player[0]||null, currentBaccaratGame.player[1]||null, currentBaccaratGame.player[2]||null,
      currentBaccaratGame.banker[0]||null, currentBaccaratGame.banker[1]||null, currentBaccaratGame.banker[2]||null,
      result, cards.player_point, cards.banker_point, currentBaccaratGame.id]);
  // 베팅 정산
  settleBaccaratBets(currentBaccaratGame.id, result);
  // 히스토리 갱신
  db.all('SELECT id, start_time, end_time, result, player_point, banker_point FROM baccarat_games WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 20', [], (err, rows) => {
    if (!err && rows) {
      baccaratHistory = rows.reverse();
      io.emit('baccarat_history_update', baccaratHistory);
    }
  });
  // 결과 소켓 전송
  io.emit('baccarat_result', {
    player: currentBaccaratGame.player,
    banker: currentBaccaratGame.banker,
    player_point: currentBaccaratGame.player_point,
    banker_point: currentBaccaratGame.banker_point,
    result: currentBaccaratGame.result
  });
  setTimeout(() => {
    startBaccaratBettingPhase();
  }, 8000);
}
// 서버 시작 시 라운드 자동 시작
setTimeout(() => {
  if (!currentBaccaratGame) startBaccaratBettingPhase();
}, 2000);
// 소켓 연결 시 현재 상태 전송
io.on('connection', (socket) => {
  // ... 기존 세션/유저 처리 ...
  // 바카라 현재 라운드/베팅 타임/카드/결과/히스토리 전송
  if (baccaratBettingPhase && currentBaccaratGame) {
    socket.emit('baccarat_round_start', { gameId: currentBaccaratGame.id, seconds: baccaratBettingCountdown });
    socket.emit('baccarat_betting_phase', { seconds: baccaratBettingCountdown });
  } else if (currentBaccaratGame && currentBaccaratGame.result) {
    socket.emit('baccarat_result', {
      player: currentBaccaratGame.player,
      banker: currentBaccaratGame.banker,
      player_point: currentBaccaratGame.player_point,
      banker_point: currentBaccaratGame.banker_point,
      result: currentBaccaratGame.result
    });
  }
  if (baccaratHistory.length > 0) {
    socket.emit('baccarat_history_update', baccaratHistory);
  }
});

// [바카라] 베팅 정산 및 수익 지급 로직
function settleBaccaratBets(gameId, result) {
  db.all('SELECT * FROM baccarat_bets WHERE game_id = ?', [gameId], (err, bets) => {
    if (err || !bets) return;
    bets.forEach(bet => {
      if (bet.result && bet.result !== '') return; // 이미 정산된 베팅은 건너뜀
      let win = false, winAmount = 0;
      if (bet.bet_type === result) {
        if (result === 'player') winAmount = bet.bet_amount * 2;
        else if (result === 'banker') winAmount = Math.floor(bet.bet_amount * 1.95);
        else if (result === 'tie') winAmount = bet.bet_amount * 8;
        win = true;
      }
      if (win) {
        db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [winAmount, bet.user_id]);
      }
      db.run('UPDATE baccarat_bets SET result = ?, win_amount = ? WHERE id = ?', [win ? 'win' : 'lose', winAmount, bet.id]);
    });
  });
}

// [바카라] 베팅 등록 API
app.post('/api/baccarat/bet', checkSession, express.json(), (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  if (!baccaratBettingPhase || !currentBaccaratGame) return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다.' });
  const userId = req.session.userId;
  const betType = req.body.bet_type;
  const betAmount = parseInt(req.body.bet_amount, 10);
  if (!['player', 'banker', 'tie'].includes(betType)) return res.status(400).json({ error: '잘못된 베팅 타입' });
  if (!Number.isInteger(betAmount) || betAmount < BACCARAT_MIN_BET || betAmount > BACCARAT_MAX_BET) return res.status(400).json({ error: `베팅금액은 ${BACCARAT_MIN_BET}~${BACCARAT_MAX_BET}원` });
  db.get('SELECT id FROM baccarat_bets WHERE game_id = ? AND user_id = ?', [currentBaccaratGame.id, userId], (err, row) => {
    if (row) return res.status(400).json({ error: '이미 베팅하셨습니다.' });
    db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) { console.error(err); return res.status(500).json({ error: 'DB 오류' }); }
      if (!user || user.money_balance < betAmount) return res.status(400).json({ error: '머니 부족' });
      db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [betAmount, userId], (err) => {
        if (err) { console.error(err); return res.status(500).json({ error: 'DB 오류' }); }
        db.run('INSERT INTO baccarat_bets (user_id, game_id, bet_type, bet_amount) VALUES (?, ?, ?, ?)', [userId, currentBaccaratGame.id, betType, betAmount], function (err) {
          if (err) { console.error(err); return res.status(500).json({ error: 'DB 오류' }); }
          res.json({ success: true });
        });
      });
    });
  });
});

// [바카라] 최근 20개 라운드 히스토리 API
app.get('/api/baccarat/history', (req, res) => {
  db.all('SELECT id, start_time, end_time, result, player_point, banker_point FROM baccarat_games WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 20', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    res.json(rows.reverse());
  });
});

// 30초마다 라운드 멈춤 감지 및 복구
setInterval(() => {
  const now = Date.now();
  let lastEnd = 0;
  if (currentBaccaratGame && currentBaccaratGame.end_time) {
    lastEnd = new Date(currentBaccaratGame.end_time).getTime();
  }
  if (!baccaratBettingPhase && (!currentBaccaratGame || currentBaccaratGame.end_time) && now - lastEnd > 40000) {
    startBaccaratBettingPhase();
  }
}, 30000);

// [어드민] 바카라 데이터 전체 삭제 API (트랜잭션 기반, 간결/강력)
app.post('/api/admin/clear-baccarat', adminDeleteLimiter, (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM baccarat_bets');
    db.run('DELETE FROM baccarat_games', (err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'DB 오류' });
      }
      // 메모리 상태 초기화
      baccaratHistory = [];
      currentBaccaratGame = null;
      baccaratNextGameId = 1;
      db.run('COMMIT', (err) => {
        if (err) return res.status(500).json({ error: 'DB 커밋 오류' });
        restoreBaccaratState();
        res.json({ success: true });
      });
    });
  });
});

// [어드민] 그래프 데이터 전체 삭제 API (트랜잭션 기반, 간결/강력)
app.post('/api/admin/clear-graph', adminDeleteLimiter, (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM graph_bets');
    db.run('DELETE FROM graph_games', (err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'DB 오류' });
      }
      // 메모리 상태 초기화
      nextGameId = 1;
      recentRounds = [];
      currentGraphGame = null;
      db.run('COMMIT', (err) => {
        if (err) return res.status(500).json({ error: 'DB 커밋 오류' });
        restoreGraphState();
        res.json({ success: true });
      });
    });
  });
});

// [어드민] 게임 수익 통계 API
app.get('/api/admin/game-stats', checkSession, (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ success: false, error: '어드민 권한 필요' });
  let baccarat = { totalBet: 0, totalWin: 0 };
  let graph = { totalBet: 0, totalWin: 0 };
  let slot = { totalBet: 0, totalWin: 0 };
  let horse = { totalBet: 0, totalWin: 0 };
  db.all('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM baccarat_bets', [], (err, rows) => {
    if (err) return res.json({ success: false, error: 'DB 오류(baccarat)' });
    if (rows && rows[0]) {
      baccarat.totalBet = rows[0].totalBet || 0;
      baccarat.totalWin = rows[0].totalWin || 0;
    }
    db.all('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM graph_bets', [], (err2, rows2) => {
      if (err2) return res.json({ success: false, error: 'DB 오류(graph)' });
      if (rows2 && rows2[0]) {
        graph.totalBet = rows2[0].totalBet || 0;
        graph.totalWin = rows2[0].totalWin || 0;
      }
      db.all('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM slot_games', [], (err3, rows3) => {
        if (err3) return res.json({ success: false, error: 'DB 오류(slot)' });
        if (rows3 && rows3[0]) {
          slot.totalBet = rows3[0].totalBet || 0;
          slot.totalWin = rows3[0].totalWin || 0;
        }
        // horse: 베팅액=amount 합, 당첨금=paid_rank not null인 경우 지급액 합
        db.all('SELECT SUM(amount) as totalBet FROM horse_race_bets', [], (err4, rows4) => {
          if (err4) return res.json({ success: false, error: 'DB 오류(horse)' });
          if (rows4 && rows4[0]) {
            horse.totalBet = rows4[0].totalBet || 0;
          }
          db.all('SELECT SUM(CASE WHEN paid_rank IS NOT NULL THEN (SELECT amount * ? FROM horse_race_bets b2 WHERE b2.id = horse_race_bets.id) ELSE 0 END) as totalWin FROM horse_race_bets', [1], (err5, rows5) => {
            if (rows5 && rows5[0]) {
              // 실제 지급액은 amount * 등수별 배당, 하지만 DB에 odds 필드가 있으므로 odds 사용
              db.all('SELECT SUM(amount * odds) as totalWin FROM horse_race_bets WHERE paid_rank IS NOT NULL', [], (err6, rows6) => {
                if (rows6 && rows6[0]) {
                  horse.totalWin = rows6[0].totalWin || 0;
                }
                res.json({ success: true, baccarat, graph, slot, horse });
              });
            } else {
              res.json({ success: true, baccarat, graph, slot, horse });
            }
          });
        });
      });
    });
  });
});

// [어드민] 플레이어별 게임 통계 API
app.get('/api/admin/player-stats', checkSession, (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ success: false, error: '어드민 권한 필요' });
  const userId = parseInt(req.query.userId, 10);
  if (!userId) return res.status(400).json({ success: false, error: 'userId 필요' });
  const result = { graph: { totalBet: 0, totalWin: 0 }, baccarat: { totalBet: 0, totalWin: 0 }, slot: { totalBet: 0, totalWin: 0 }, horse: { totalBet: 0, totalWin: 0 } };
  let done = 0;
  db.get('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM graph_bets WHERE user_id = ?', [userId], (err, row) => {
    if (row) {
      result.graph.totalBet = row.totalBet || 0;
      result.graph.totalWin = row.totalWin || 0;
    }
    if (++done === 4) send();
  });
  db.get('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM baccarat_bets WHERE user_id = ?', [userId], (err, row) => {
    if (row) {
      result.baccarat.totalBet = row.totalBet || 0;
      result.baccarat.totalWin = row.totalWin || 0;
    }
    if (++done === 4) send();
  });
  db.get('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM slot_games WHERE user_id = ?', [userId], (err, row) => {
    if (row) {
      result.slot.totalBet = row.totalBet || 0;
      result.slot.totalWin = row.totalWin || 0;
    }
    if (++done === 4) send();
  });
  // horse: 베팅액=amount 합, 당첨금=amount*odds paid_rank not null
  db.get('SELECT SUM(amount) as totalBet FROM horse_race_bets WHERE user_id = ?', [userId], (err, row) => {
    if (row) {
      result.horse.totalBet = row.totalBet || 0;
    }
    db.get('SELECT SUM(amount * odds) as totalWin FROM horse_race_bets WHERE user_id = ? AND paid_rank IS NOT NULL', [userId], (err2, row2) => {
      if (row2) {
        result.horse.totalWin = row2.totalWin || 0;
      }
      if (++done === 4) send();
    });
  });
  function send() {
    res.json({ success: true, ...result });
  }
});

// 슬롯머신 스핀 API (실제 로직)
app.post('/api/slot/spin', checkSession, express.json(), (req, res) => {
  const userId = req.session.userId;
  const bet = parseInt(req.body.bet, 10);
  const minBet = 1000, maxBet = 100000;
  if (!Number.isInteger(bet) || bet < minBet || bet > maxBet) {
    return res.status(400).json({ message: `베팅금액은 ${minBet}~${maxBet}원`, win: false });
  }
  db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ message: 'DB 오류', win: false });
    if (user.money_balance < bet) return res.status(400).json({ message: '보유 머니가 부족합니다!', win: false, balance: user.money_balance });
    // 릴 결과 생성
    const symbols = ['🍒', '🍋', '🔔', '🍀', '7️⃣', '💎', '🍉'];
    const result = [
      Math.floor(Math.random() * symbols.length),
      Math.floor(Math.random() * symbols.length),
      Math.floor(Math.random() * symbols.length)
    ];
    // 배당표 적용
    let win = false, winAmount = 0, payout = 0, msg = '';
    const [a, b, c] = result;
    if (a === b && b === c) {
      // 3개 일치
      if (a === 4) { payout = 100; msg = '잭팟! 7️⃣ 3개!'; }
      else if (a === 5) { payout = 50; msg = '축하! 💎 3개!'; }
      else if (a === 0) { payout = 20; msg = '🍒 3개!'; }
      else { payout = 10; msg = `${symbols[a]} 3개!`; }
    } else if (a === b || b === c || a === c) {
      payout = 2; msg = '2개 일치!';
    } else {
      payout = 0; msg = '꽝!';
    }
    if (payout > 0) {
      win = true;
      winAmount = bet * payout;
    }
    // 머니 차감/지급 트랜잭션
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [bet, userId]);
      if (winAmount > 0) {
        db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [winAmount, userId]);
      }
      db.run('INSERT INTO slot_games (user_id, bet_amount, result, win_amount) VALUES (?, ?, ?, ?)', [userId, bet, JSON.stringify(result), winAmount]);
      db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err2, u2) => {
        db.run('COMMIT');
        res.json({
          message: msg + (winAmount > 0 ? ` +${winAmount.toLocaleString()}원` : ''),
          win,
          result,
          balance: u2 ? u2.money_balance : 0
        });
      });
    });
  });
});

// 슬롯머신 획득금액 랭킹 API (최근 50회 중 유저별 최대 1건, 상위 5명)
app.get('/api/slot/rankings', checkSession, (req, res) => {
  db.all(`SELECT sg.user_id, u.username, MAX(sg.win_amount) as win_amount
          FROM (SELECT * FROM slot_games WHERE win_amount > 0 ORDER BY id DESC LIMIT 50) sg
          JOIN users u ON sg.user_id = u.id
          GROUP BY sg.user_id
          HAVING win_amount > 0
          ORDER BY win_amount DESC
          LIMIT 5`, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// ====== [경마 게임: 말/컨디션/배당/라운드 구조] ======

// 1. 말 리스트(고정)
const HORSE_LIST = [
  { id: 1, name: '블랙스타' },
  { id: 2, name: '썬더' },
  { id: 3, name: '레드윈드' },
  { id: 4, name: '골드문' },
  { id: 5, name: '그린라이트' },
  { id: 6, name: '블루웨이브' },
  { id: 7, name: '화이트스톰' },
  { id: 8, name: '핑크드림' },
];

// 등수별 고정 배당 (고정배당 모드)
const HORSE_RANK_ODDS = {
  1: 2.5,   // 1등
  2: 1.5,   // 2등
  3: 0.0,   // 3등
  4: 0.0,   // 4등
  5: 0.0,   // 5등
  6: 0.0,   // 6등
  7: 1.0,   // 7등
  8: 2.0    // 8등
};

// [경마] 라운드/베팅/진행 상태 변수
let currentHorseRaceRound = null;
let horseRaceBettingPhase = false;
let horseRaceBettingCountdown = 0;
let horseRaceBettingTimer = null;
let horseRaceNextRoundId = 1;
let horseRaceProgressTimer = null;
let horseRaceProgressTick = 0;
let horseRaceHorsesState = null; // {id, name, pos, finishedAt, rank}

// [경마] 라운드 생성 (고정배당)
function startHorseRaceBettingPhase() {
  if (horseRaceBettingPhase || (currentHorseRaceRound && !currentHorseRaceRound.end_time)) return;
  horseRaceBettingPhase = true;
  horseRaceBettingCountdown = 30;
  const horses = HORSE_LIST.map(horse => ({
    id: horse.id,
    name: horse.name
  }));
  const startTime = new Date().toISOString();
  db.run('INSERT INTO horse_race_rounds (start_time, horses) VALUES (?, ?)', [startTime, JSON.stringify(horses)], function(err) {
    if (err) return;
    currentHorseRaceRound = {
      id: this.lastID,
      start_time: startTime,
      horses,
      result: null,
      end_time: null
    };
    horseRaceHorsesState = horses.map(h => ({ ...h, pos: 0, finishedAt: null, rank: null }));
    broadcastHorseRaceRoundStart();
    broadcastHorseRaceBettingPhase();
    horseRaceBettingTimer = setInterval(() => {
      horseRaceBettingCountdown--;
      broadcastHorseRaceBettingPhase();
      if (horseRaceBettingCountdown <= 0) {
        clearInterval(horseRaceBettingTimer);
        horseRaceBettingPhase = false;
        startHorseRaceProgress();
      }
    }, 1000);
  });
}

// [경마] 경주 진행(인기마 가속 우위)
function startHorseRaceProgress() {
  horseRaceProgressTick = 0;
  let finishedCount = 0;
  horseRaceHorsesState.forEach(h => { h.pos = 0; h.finishedAt = null; h.rank = null; });
  horseRaceProgressTimer = setInterval(() => {
    horseRaceProgressTick++;
    horseRaceHorsesState.forEach(horse => {
      if (horse.finishedAt) return;
      let add = 0.01;
      // 인기마는 가속 확률/가속량 증가
      if (horse.isPopular) {
        if (Math.random() < 0.18) add += +(Math.random() * 0.18).toFixed(3); // 더 자주, 더 크게 가속
      } else {
        if (Math.random() < 0.10) add += +(Math.random() * 0.15).toFixed(3);
      }
      horse.pos = Math.min(100, +(horse.pos + add).toFixed(3));
      if (horse.pos >= 100 && !horse.finishedAt) {
        horse.finishedAt = horseRaceProgressTick;
        horse.rank = ++finishedCount;
      }
    });
    broadcastHorseRaceProgress();
    if (finishedCount === horseRaceHorsesState.length) {
      clearInterval(horseRaceProgressTimer);
      finishHorseRaceRound();
    }
  }, 10);
}

// [경마] 라운드 종료/정산 (고정배당)
function finishHorseRaceRound() {
  const result = horseRaceHorsesState.slice().sort((a,b)=>a.rank-b.rank).map(h=>h.id);
  currentHorseRaceRound.result = result;
  currentHorseRaceRound.end_time = new Date().toISOString();
  db.run('UPDATE horse_race_rounds SET end_time=?, result=? WHERE id=?', [currentHorseRaceRound.end_time, JSON.stringify(result), currentHorseRaceRound.id]);
  db.all('SELECT * FROM horse_race_bets WHERE round_id = ?', [currentHorseRaceRound.id], (err, bets) => {
    if (!bets) bets = [];
    const userPayouts = {};
    bets.forEach(bet => {
      const rank = result.indexOf(bet.horse_id) + 1;
      let payout = 0;
      if (HORSE_RANK_ODDS[rank]) {
        payout = Math.floor(bet.amount * HORSE_RANK_ODDS[rank]);
      }
      if (payout > 0) {
        db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [payout, bet.user_id]);
        db.run('UPDATE horse_race_bets SET paid_rank = ? WHERE id = ?', [rank, bet.id]);
      }
      if (!userPayouts[bet.user_id]) userPayouts[bet.user_id] = 0;
      userPayouts[bet.user_id] += (payout - bet.amount);
    });
    Object.entries(userPayouts).forEach(([userId, amount]) => {
      if (userSockets[userId]) {
        userSockets[userId].forEach(socketId => {
          io.to(socketId).emit('horse_race_payout', { amount });
        });
      }
    });
    broadcastHorseRaceResult();
  });
  setTimeout(() => {
    currentHorseRaceRound = null;
    horseRaceHorsesState = null;
    startHorseRaceBettingPhase();
  }, 8000);
}

// 서버 시작 시 라운드 자동 시작
setTimeout(() => {
  if (!currentHorseRaceRound) startHorseRaceBettingPhase();
}, 2000);

// [경마] API: 현재 라운드 정보
app.get('/api/horse-race/round', (req, res) => {
  if (!currentHorseRaceRound) return res.json({ betting: false });
  res.json({
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
});
// [경마] API: 베팅 등록 (odds는 등수별 고정값 사용)
app.post('/api/horse-race/bet', checkSession, express.json(), (req, res) => {
  if (!horseRaceBettingPhase || !currentHorseRaceRound) return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다.' });
  const userId = req.session.userId;
  const horseId = parseInt(req.body.horse_id, 10);
  const amount = parseInt(req.body.amount, 10);
  if (!HORSE_LIST.find(h=>h.id===horseId)) return res.status(400).json({ error: '잘못된 말 선택' });
  if (!Number.isInteger(amount) || amount < 1000 || amount > 1000000) return res.status(400).json({ error: '베팅금액은 1,000~1,000,000원' });
  // 중복 베팅 방지(한 라운드에 한 말만)
  db.get('SELECT id FROM horse_race_bets WHERE round_id = ? AND user_id = ? AND horse_id = ?', [currentHorseRaceRound.id, userId, horseId], (err, row) => {
    if (row) return res.status(400).json({ error: '이미 이 말에 베팅하셨습니다.' });
    db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
      if (!user || user.money_balance < amount) return res.status(400).json({ error: '머니 부족' });
      db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [amount, userId], (err) => {
        if (err) return res.status(500).json({ error: 'DB 오류' });
        db.run('INSERT INTO horse_race_bets (user_id, round_id, horse_id, amount) VALUES (?, ?, ?, ?)', [userId, currentHorseRaceRound.id, horseId, amount], function (err) {
          if (err) return res.status(500).json({ error: 'DB 오류' });
          res.json({ success: true });
        });
      });
    });
  });
});
// [경마] API: 최근 10개 라운드 결과
app.get('/api/horse-race/history', (req, res) => {
  db.all('SELECT id, start_time, end_time, horses, result FROM horse_race_rounds WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 10', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    res.json(rows.reverse());
  });
});

// [경마] 소켓: 라운드/베팅/진행/결과 브로드캐스트
function broadcastHorseRaceRoundStart() {
  io.emit('horse_race_round_start', {
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: true,
    bettingCountdown: horseRaceBettingCountdown
  });
}
function broadcastHorseRaceBettingPhase() {
  io.emit('horse_race_betting_phase', {
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
}
function broadcastHorseRaceProgress() {
  io.emit('horse_race_progress', {
    horses: horseRaceHorsesState.map(h=>({ id: h.id, name: h.name, pos: h.pos, rank: h.rank, color: h.color }))
  });
}
function broadcastHorseRaceResult() {
  io.emit('horse_race_result', {
    roundId: currentHorseRaceRound.id,
    result: currentHorseRaceRound.result,
    horses: horseRaceHorsesState.map(h=>({ id: h.id, name: h.name, rank: h.rank, color: h.color }))
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 