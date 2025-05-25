const { pool } = require('../config/database');
const { 
  currentGraphGame, 
  currentMultiplier, 
  bettingPhase, 
  bettingCountdown, 
  recentRounds 
} = require('./graphGame');
const { 
  currentBaccaratGame, 
  baccaratBettingPhase, 
  baccaratHistory 
} = require('./baccaratGame');
const { 
  currentHorseRaceRound, 
  horseRaceBettingPhase, 
  horseRaceBettingCountdown 
} = require('./horseRaceGame');

// 메모리 내 메시지 저장
let messages = [];
let userSockets = {};

// 온라인 유저 목록 브로드캐스트 함수
async function broadcastOnlineUsers(io) {
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

// 사용자 수 브로드캐스트 함수
function broadcastUserCount(io) {
  const count = Object.keys(userSockets).length;
  io.emit('user count', count);
}

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

// Socket.IO 연결 처리 함수
function handleSocketConnection(io) {
  io.on('connection', (socket) => {
    const sess = socket.handshake.session;
    const username = sess && sess.username ? sess.username : '익명';
    let currentRoom = null;

    const userId = sess && sess.userId;
    if (userId) {
      if (!userSockets[userId]) userSockets[userId] = new Set();
      userSockets[userId].add(socket.id);
      broadcastOnlineUsers(io);
      broadcastUserCount(io);
    }

    // 룸 참여 처리
    socket.on('join room', ({ room }) => {
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = room;
      socket.join(room);
      updateRoomUsers(room, io, socket);
    });

    // 연결 해제 처리
    socket.on('disconnect', () => {
      if (currentRoom) updateRoomUsers(currentRoom, io, socket);
      const userId = sess && sess.userId;
      if (userId && userSockets[userId]) {
        userSockets[userId].delete(socket.id);
        if (userSockets[userId].size === 0) {
          delete userSockets[userId];
        }
        broadcastOnlineUsers(io);
      }
      broadcastUserCount(io);
    });

    // 룸 사용자 목록 업데이트
    function updateRoomUsers(room, io, socket) {
      const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
      const usernames = clients.map(id => {
        const s = io.sockets.sockets.get(id);
        return s && s.handshake.session && s.handshake.session.username;
      }).filter(Boolean);
      io.to(room).emit('room users', usernames);
    }

    // 초기 게임 상태 전송
    sendInitialGameStates(socket);

    // 접속 시 DB에서 메시지 불러와 전송
    loadAndSendMessages(socket);
    broadcastUserCount(io);

    // 메시지 수신 처리
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
}

// 초기 게임 상태 전송
function sendInitialGameStates(socket) {
  // 그래프 게임 상태
  socket.emit('recent_rounds', recentRounds);
  
  if (bettingPhase) {
    socket.emit('betting_phase', { seconds: bettingCountdown });
  } else if (currentGraphGame) {
    socket.emit('graph_round_start', {
      gameId: currentGraphGame.id,
      startTime: currentGraphGame.start_time,
      crashMultiplier: currentGraphGame.crash_multiplier,
      minBet: 1000,
      maxBet: 100000
    });
    socket.emit('graph_multiplier', { multiplier: currentMultiplier, crashed: false });
  }

  // 바카라 게임 상태
  if (baccaratBettingPhase) {
    socket.emit('baccarat_betting_phase', { betting: true });
  }
  socket.emit('baccarat_history', baccaratHistory.slice(0, 20));

  // 경마 게임 상태
  if (horseRaceBettingPhase && currentHorseRaceRound) {
    socket.emit('horse_race_betting_start', {
      horses: currentHorseRaceRound.horses,
      betting: true,
      seconds: horseRaceBettingCountdown
    });
  }
}

module.exports = {
  handleSocketConnection,
  broadcastOnlineUsers,
  broadcastUserCount,
  userSockets
};
