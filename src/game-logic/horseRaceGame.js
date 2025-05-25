const { pool } = require('../config/database');

// 경마 게임 상수
const HORSE_MIN_BET = 1000;
const HORSE_MAX_BET = 100000;
const HORSE_BETTING_TIME = 30; // 30초 베팅 타임

// 등수별 고정 배당률
const HORSE_RANK_ODDS = {
  1: 2.5,  // 1등 2.5배
  2: 1.5,  // 2등 1.5배
  3: 0,    // 3등 0배 (본전도 못찾음)
  4: 0,    // 4등 0배
  5: 0,    // 5등 0배
  6: 0,    // 6등 0배
  7: 1.0,  // 7등 1배 (본전)
  8: 2.0   // 8등 2배 (꼴찌 보너스)
};

// 말 목록 (8마리)
const HORSE_LIST = [
  { id: 1, name: '번개', color: '#FF6B6B', isPopular: true },
  { id: 2, name: '질풍', color: '#4ECDC4', isPopular: false },
  { id: 3, name: '천둥', color: '#45B7D1', isPopular: true },
  { id: 4, name: '바람', color: '#96CEB4', isPopular: false },
  { id: 5, name: '폭풍', color: '#FECA57', isPopular: false },
  { id: 6, name: '태풍', color: '#FF9FF3', isPopular: true },
  { id: 7, name: '우박', color: '#54A0FF', isPopular: false },
  { id: 8, name: '소나기', color: '#5F27CD', isPopular: false }
];

// 경마 게임 상태 변수
let currentHorseRaceRound = null;
let horseRaceBettingPhase = false;
let horseRaceBettingCountdown = 0;
let horseRaceBettingTimer = null;
let horseRaceProgressTimer = null;
let horseRaceProgressTick = 0;
let horseRaceHorsesState = null;

// 경마 베팅 페이즈 시작
function startHorseRaceBettingPhase(io) {
  if (horseRaceBettingPhase || (currentHorseRaceRound && !currentHorseRaceRound.end_time)) {
    return;
  }
  
  horseRaceBettingPhase = true;
  horseRaceBettingCountdown = HORSE_BETTING_TIME;
  
  // 말들 상태 초기화 (인기마 랜덤 선택)
  const horses = HORSE_LIST.map(h => ({ ...h }));
  
  io.emit('horse_race_betting_start', {
    horses,
    betting: true,
    seconds: horseRaceBettingCountdown
  });
  
  startHorseRaceRound(io, horses);
}

// 경마 라운드 시작
async function startHorseRaceRound(io, horses) {
  const startTime = new Date().toISOString();
  
  try {
    const result = await pool.query(
      'INSERT INTO horse_race_rounds (start_time, horses) VALUES ($1, $2) RETURNING id',
      [startTime, JSON.stringify(horses)]
    );
    
    currentHorseRaceRound = {
      id: result.rows[0].id,
      start_time: startTime,
      horses,
      result: null,
      end_time: null
    };
    
    horseRaceHorsesState = horses.map(h => ({ 
      ...h, 
      pos: 0, 
      finishedAt: null, 
      rank: null 
    }));
    
    broadcastHorseRaceRoundStart(io);
    broadcastHorseRaceBettingPhase(io);
    
    horseRaceBettingTimer = setInterval(() => {
      horseRaceBettingCountdown--;
      broadcastHorseRaceBettingPhase(io);
      
      if (horseRaceBettingCountdown <= 0) {
        clearInterval(horseRaceBettingTimer);
        horseRaceBettingPhase = false;
        startHorseRaceProgress(io);
      }
    }, 1000);
    
  } catch (error) {
    console.error('Error starting horse race round:', error);
  }
}

// 경주 진행 (인기마 가속 우위)
function startHorseRaceProgress(io) {
  horseRaceProgressTick = 0;
  let finishedCount = 0;
  
  horseRaceHorsesState.forEach(h => { 
    h.pos = 0; 
    h.finishedAt = null; 
    h.rank = null; 
  });
  
  horseRaceProgressTimer = setInterval(() => {
    horseRaceProgressTick++;
    
    horseRaceHorsesState.forEach(horse => {
      if (horse.finishedAt) return;
      
      let add = 0.01;
      
      // 인기마는 가속 확률/가속량 증가
      if (horse.isPopular) {
        if (Math.random() < 0.18) {
          add += +(Math.random() * 0.18).toFixed(3); // 더 자주, 더 크게 가속
        }
      } else {
        if (Math.random() < 0.10) {
          add += +(Math.random() * 0.15).toFixed(3);
        }
      }
      
      horse.pos = Math.min(100, +(horse.pos + add).toFixed(3));
      
      if (horse.pos >= 100 && !horse.finishedAt) {
        horse.finishedAt = horseRaceProgressTick;
        horse.rank = ++finishedCount;
      }
    });
    
    broadcastHorseRaceProgress(io);
    
    if (finishedCount === horseRaceHorsesState.length) {
      clearInterval(horseRaceProgressTimer);
      finishHorseRaceRound(io);
    }
  }, 10);
}

// 라운드 종료/정산 (고정배당)
async function finishHorseRaceRound(io) {
  if (!currentHorseRaceRound) return;
  
  const result = horseRaceHorsesState
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(h => h.id);
  
  currentHorseRaceRound.result = result;
  currentHorseRaceRound.end_time = new Date().toISOString();
  
  try {
    await pool.query(
      'UPDATE horse_race_rounds SET end_time = $1, result = $2 WHERE id = $3',
      [currentHorseRaceRound.end_time, JSON.stringify(result), currentHorseRaceRound.id]
    );
    
    // 베팅 정산
    const bets = await pool.query('SELECT * FROM horse_race_bets WHERE round_id = $1', [currentHorseRaceRound.id]);
    const userPayouts = {};
    
    for (const bet of bets.rows) {
      const rank = result.indexOf(bet.horse_id) + 1;
      let payout = 0;
      
      if (HORSE_RANK_ODDS[rank]) {
        payout = Math.floor(bet.amount * HORSE_RANK_ODDS[rank]);
      }
      
      if (payout > 0) {
        await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [payout, bet.user_id]);
        await pool.query('UPDATE horse_race_bets SET paid_rank = $1 WHERE id = $2', [rank, bet.id]);
      }
      
      if (!userPayouts[bet.user_id]) userPayouts[bet.user_id] = 0;
      userPayouts[bet.user_id] += (payout - bet.amount);
    }
    
    // 사용자별 정산 결과 전송
    Object.entries(userPayouts).forEach(([userId, amount]) => {
      io.emit('horse_race_payout', { userId: parseInt(userId), amount });
    });
    
    broadcastHorseRaceResult(io);
    
    setTimeout(() => {
      currentHorseRaceRound = null;
      horseRaceHorsesState = null;
      startHorseRaceBettingPhase(io);
    }, 8000);
    
  } catch (error) {
    console.error('Error finishing horse race round:', error);
  }
}

// 소켓 브로드캐스트 함수들
function broadcastHorseRaceRoundStart(io) {
  io.emit('horse_race_round_start', {
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: true,
    bettingCountdown: horseRaceBettingCountdown
  });
}

function broadcastHorseRaceBettingPhase(io) {
  io.emit('horse_race_betting_phase', {
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
}

function broadcastHorseRaceProgress(io) {
  io.emit('horse_race_progress', {
    horses: horseRaceHorsesState.map(h => ({ 
      id: h.id, 
      name: h.name, 
      pos: h.pos, 
      rank: h.rank, 
      color: h.color 
    }))
  });
}

function broadcastHorseRaceResult(io) {
  io.emit('horse_race_result', {
    roundId: currentHorseRaceRound.id,
    result: currentHorseRaceRound.result,
    horses: horseRaceHorsesState.map(h => ({ 
      id: h.id, 
      name: h.name, 
      rank: h.rank, 
      color: h.color 
    }))
  });
}

// 경마 게임 초기화
function initializeHorseRaceGame(io) {
  // 자동 시작
  setTimeout(() => {
    if (!currentHorseRaceRound) startHorseRaceBettingPhase(io);
  }, 2000);
}

module.exports = {
  HORSE_MIN_BET,
  HORSE_MAX_BET,
  HORSE_LIST,
  HORSE_RANK_ODDS,
  currentHorseRaceRound,
  horseRaceBettingPhase,
  horseRaceBettingCountdown,
  initializeHorseRaceGame,
  startHorseRaceBettingPhase
};
