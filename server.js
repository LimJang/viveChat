const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const sharedSession = require('express-socket.io-session');

// 설정 및 미들웨어 가져오기
const { initializeDatabase } = require('./src/config/database');
const { handleSocketConnection, broadcastOnlineUsers } = require('./src/game-logic/socketHandlers');

// 라우터 가져오기
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const graphRoutes = require('./src/routes/graph');
const baccaratRoutes = require('./src/routes/baccarat');
const slotRoutes = require('./src/routes/slot');
const horseRoutes = require('./src/routes/horse');
const adminRoutes = require('./src/routes/admin');

// 게임 로직 가져오기
const { initializeGraphGame } = require('./src/game-logic/graphGame');
const { initializeBaccaratGame } = require('./src/game-logic/baccaratGame');
const { initializeHorseRaceGame } = require('./src/game-logic/horseRaceGame');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Express에 io 인스턴스 저장 (어드민 라우터에서 사용)
app.set('io', io);

// 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// 세션 미들웨어 설정 (Railway HTTPS 프록시 대응)
const sessionMiddleware = session({
  secret: 'vivegame-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  name: 'vivegame.sid',
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7일
    secure: false, // Railway는 HTTPS 프록시를 사용하므로 false
    httpOnly: true,
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);

// Socket.IO 세션 공유
io.use(sharedSession(sessionMiddleware));

// API 라우터 연결
app.use('/api', authRoutes);  // /api/login, /api/register, /api/logout, /api/me
app.use('/api/users', userRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/baccarat', baccaratRoutes);
app.use('/api/slot', slotRoutes);
app.use('/api/horse-race', horseRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO 연결 처리
handleSocketConnection(io);

// 서버 초기화 함수
async function initializeServer() {
  try {
    // 1. 데이터베이스 초기화
    await initializeDatabase();
    
    // 2. ogf2002 계정을 어드민으로 설정
    setTimeout(async () => {
      try {
        const { pool } = require('./src/config/database');
        await pool.query("UPDATE users SET is_admin = 1 WHERE username = 'ogf2002'");
        console.log('Admin status updated for ogf2002');
      } catch (error) {
        console.error('Error updating admin status:', error);
      }
    }, 1000);
    
    // 3. 게임 시스템 초기화
    setTimeout(() => {
      initializeGraphGame(io);
      initializeBaccaratGame(io);
      initializeHorseRaceGame(io);
      console.log('All game systems initialized');
    }, 2000);
    
    console.log('Server initialization completed successfully');
  } catch (error) {
    console.error('Error during server initialization:', error);
  }
}

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ViveGame Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: PostgreSQL (${process.env.DATABASE_URL ? 'Connected' : 'Local'})`);
  console.log(`🎮 Games: Graph, Baccarat, Slot, Horse Racing`);
  console.log(`💬 Features: Real-time Chat, User Management, Admin Panel`);
  
  // 서버 초기화 실행
  initializeServer();
});

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
