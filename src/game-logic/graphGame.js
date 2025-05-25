const { pool } = require('../config/database');

// 그래프 게임 상수
const GRAPH_MIN_BET = 1000;
const GRAPH_MAX_BET = 100000;
const GRAPH_ROUND_INTERVAL = 10000; // 10초(그래프 최대 진행)
const GRAPH_TICK_MS = 100; // 0.1초마다 배당률 갱신
const GRAPH_MAX_MULTIPLIER = 10.0;

// 그래프 게임 상태 변수
let currentGraphGame = null;
let currentMultiplier = 1.0;
let currentCrash = null;
let graphGameTimer = null;
let pendingBets = {}; // userId: { amount }
let nextGameId = 1;
let bettingPhase = false;
let bettingCountdown = 0;
let bettingTimer = null;
let recentRounds = [];

function getRandomCrashMultiplier() {
  // 실제 서비스 분포: 1.01~2.0x(55%), 2.01~4.0x(25%), 4.01~7.0x(15%), 7.01~10.0x(5%)
  const r = Math.random();
  if (r < 0.55) return +(1.01 + Math.random() * 0.99).toFixed(2); // 1.01~2.00 (55%)
  if (r < 0.80) return +(2.01 + Math.random() * 1.99).toFixed(2); // 2.01~4.00 (25%)
  if (r < 0.95) return +(4.01 + Math.random() * 2.99).toFixed(2); // 4.01~7.00 (15%)
  return +(7.01 + Math.random() * 2.99).toFixed(2); // 7.01~10.00 (5%)
}

function startBettingPhase(io) {
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
      startGraphGameRound(io);
    }
  }, 1000);
}

async function startGraphGameRound(io) {
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
    
    runGraphGameTick(io);
  } catch (error) {
    console.error('Error starting graph game round:', error);
  }
}

function runGraphGameTick(io) {
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
      endGraphGameRound(io);
      clearInterval(graphGameTimer);
    } else {
      io.emit('graph_multiplier', { multiplier: currentMultiplier, crashed: false });
    }
  }, GRAPH_TICK_MS);
}

async function endGraphGameRound(io) {
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
      startBettingPhase(io);
    }, 2000);
  } catch (error) {
    console.error('Error ending graph game round:', error);
  }
}

// 서버 시작 시 초기화
async function initializeGraphGame(io) {
  // DB에서 MAX(id)로 nextGameId 동기화
  try {
    const result = await pool.query('SELECT MAX(id) as maxId FROM graph_games');
    if (result.rows[0] && result.rows[0].maxid) {
      nextGameId = result.rows[0].maxid + 1;
    }
  } catch (error) {
    console.error('Error syncing nextGameId:', error);
  }

  // DB에서 최근 5개 라운드 불러오기
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

  // 라운드 자동 시작
  setTimeout(() => {
    if (!currentGraphGame) startBettingPhase(io);
  }, 3000);
}

module.exports = {
  GRAPH_MIN_BET,
  GRAPH_MAX_BET,
  currentGraphGame,
  currentMultiplier,
  bettingPhase,
  bettingCountdown,
  recentRounds,
  pendingBets,
  initializeGraphGame,
  startBettingPhase
};
