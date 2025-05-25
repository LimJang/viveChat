const { pool } = require('../config/database');

// 바카라 게임 상수
const BACCARAT_MIN_BET = 1000;
const BACCARAT_MAX_BET = 100000;
const BACCARAT_BETTING_TIME = 20; // 20초 베팅 타임

// 바카라 게임 상태 변수
let currentBaccaratGame = null;
let baccaratBettingPhase = false;
let baccaratBettingCountdown = 0;
let baccaratBettingTimer = null;
let baccaratNextGameId = 1;
let baccaratHistory = [];

// 카드 덱 생성
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  
  return shuffleArray(deck);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 카드 값 계산
function getCardValue(card) {
  const rank = card.slice(0, -1);
  if (rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(rank)) return 0;
  return parseInt(rank, 10);
}

// 점수 계산 (바카라 룰)
function calculatePoints(cards) {
  return cards.reduce((sum, card) => sum + getCardValue(card), 0) % 10;
}

// 3번째 카드 규칙
function needsThirdCard(playerCards, bankerCards) {
  const playerPoints = calculatePoints(playerCards);
  const bankerPoints = calculatePoints(bankerCards);
  
  // 플레이어가 8 또는 9이면 Natural - 더 이상 카드 없음
  if (playerPoints >= 8 || bankerPoints >= 8) {
    return { player: false, banker: false };
  }
  
  // 플레이어 3번째 카드 규칙
  const playerNeedsThird = playerPoints <= 5;
  
  // 뱅커 3번째 카드 규칙
  let bankerNeedsThird = false;
  if (!playerNeedsThird) {
    // 플레이어가 카드를 받지 않은 경우
    bankerNeedsThird = bankerPoints <= 5;
  } else {
    // 플레이어가 3번째 카드를 받은 경우
    const playerThirdCardValue = getCardValue(playerCards[2]);
    
    if (bankerPoints <= 2) bankerNeedsThird = true;
    else if (bankerPoints === 3) bankerNeedsThird = playerThirdCardValue !== 8;
    else if (bankerPoints === 4) bankerNeedsThird = [2, 3, 4, 5, 6, 7].includes(playerThirdCardValue);
    else if (bankerPoints === 5) bankerNeedsThird = [4, 5, 6, 7].includes(playerThirdCardValue);
    else if (bankerPoints === 6) bankerNeedsThird = [6, 7].includes(playerThirdCardValue);
  }
  
  return { player: playerNeedsThird, banker: bankerNeedsThird };
}

// 바카라 베팅 페이즈 시작
function startBaccaratBettingPhase(io) {
  if (baccaratBettingPhase || (currentBaccaratGame && !currentBaccaratGame.end_time)) {
    return;
  }
  
  baccaratBettingPhase = true;
  baccaratBettingCountdown = BACCARAT_BETTING_TIME;
  
  io.emit('baccarat_betting_phase', { 
    betting: true, 
    seconds: baccaratBettingCountdown 
  });
  
  baccaratBettingTimer = setInterval(() => {
    baccaratBettingCountdown--;
    io.emit('baccarat_betting_phase', { 
      betting: true, 
      seconds: baccaratBettingCountdown 
    });
    
    if (baccaratBettingCountdown <= 0) {
      clearInterval(baccaratBettingTimer);
      baccaratBettingPhase = false;
      startBaccaratGameRound(io);
    }
  }, 1000);
}

// 바카라 게임 라운드 시작
async function startBaccaratGameRound(io) {
  const deck = createDeck();
  let playerCards = [deck.pop(), deck.pop()];
  let bankerCards = [deck.pop(), deck.pop()];
  
  const startTime = new Date().toISOString();
  
  try {
    const result = await pool.query(
      'INSERT INTO baccarat_games (start_time, player_card1, player_card2, banker_card1, banker_card2) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [startTime, playerCards[0], playerCards[1], bankerCards[0], bankerCards[1]]
    );
    
    currentBaccaratGame = {
      id: result.rows[0].id,
      start_time: startTime,
      status: 'playing',
      playerCards,
      bankerCards,
      deck
    };
    
    io.emit('baccarat_round_start', {
      gameId: currentBaccaratGame.id,
      playerCards: playerCards.slice(0, 2),
      bankerCards: bankerCards.slice(0, 2),
      playerPoints: calculatePoints(playerCards),
      bankerPoints: calculatePoints(bankerCards)
    });
    
    // 3초 후 3번째 카드 처리
    setTimeout(() => processThirdCards(io), 3000);
    
  } catch (error) {
    console.error('Error starting baccarat game:', error);
  }
}

// 3번째 카드 처리
async function processThirdCards(io) {
  if (!currentBaccaratGame) return;
  
  const thirdCardNeeds = needsThirdCard(currentBaccaratGame.playerCards, currentBaccaratGame.bankerCards);
  
  // 플레이어 3번째 카드
  if (thirdCardNeeds.player) {
    const thirdCard = currentBaccaratGame.deck.pop();
    currentBaccaratGame.playerCards.push(thirdCard);
    
    await pool.query(
      'UPDATE baccarat_games SET player_card3 = $1 WHERE id = $2',
      [thirdCard, currentBaccaratGame.id]
    );
  }
  
  // 뱅커 3번째 카드
  if (thirdCardNeeds.banker) {
    const thirdCard = currentBaccaratGame.deck.pop();
    currentBaccaratGame.bankerCards.push(thirdCard);
    
    await pool.query(
      'UPDATE baccarat_games SET banker_card3 = $1 WHERE id = $2',
      [thirdCard, currentBaccaratGame.id]
    );
  }
  
  // 최종 결과 계산
  setTimeout(() => finishBaccaratGame(io), 2000);
}

// 바카라 게임 종료 및 정산
async function finishBaccaratGame(io) {
  if (!currentBaccaratGame) return;
  
  const playerPoints = calculatePoints(currentBaccaratGame.playerCards);
  const bankerPoints = calculatePoints(currentBaccaratGame.bankerCards);
  
  let result;
  if (playerPoints > bankerPoints) result = 'player';
  else if (bankerPoints > playerPoints) result = 'banker';
  else result = 'tie';
  
  const endTime = new Date().toISOString();
  
  try {
    await pool.query(
      'UPDATE baccarat_games SET end_time = $1, result = $2, player_point = $3, banker_point = $4 WHERE id = $5',
      [endTime, result, playerPoints, bankerPoints, currentBaccaratGame.id]
    );
    
    // 베팅 정산
    const bets = await pool.query('SELECT * FROM baccarat_bets WHERE game_id = $1', [currentBaccaratGame.id]);
    
    for (const bet of bets.rows) {
      let winAmount = 0;
      let betResult = 'lose';
      
      if (bet.bet_type === result) {
        betResult = 'win';
        if (result === 'player') winAmount = bet.bet_amount * 2;
        else if (result === 'banker') winAmount = Math.floor(bet.bet_amount * 1.95);
        else if (result === 'tie') winAmount = bet.bet_amount * 8;
      }
      
      if (winAmount > 0) {
        await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [winAmount, bet.user_id]);
      }
      
      await pool.query(
        'UPDATE baccarat_bets SET result = $1, win_amount = $2 WHERE id = $3',
        [betResult, winAmount, bet.id]
      );
    }
    
    // 히스토리 업데이트
    baccaratHistory.unshift({
      gameId: currentBaccaratGame.id,
      result,
      playerPoints,
      bankerPoints,
      endTime
    });
    if (baccaratHistory.length > 20) baccaratHistory.pop();
    
    io.emit('baccarat_result', {
      gameId: currentBaccaratGame.id,
      result,
      playerCards: currentBaccaratGame.playerCards,
      bankerCards: currentBaccaratGame.bankerCards,
      playerPoints,
      bankerPoints,
      history: baccaratHistory.slice(0, 20)
    });
    
    currentBaccaratGame = null;
    
    // 5초 후 다음 라운드
    setTimeout(() => startBaccaratBettingPhase(io), 5000);
    
  } catch (error) {
    console.error('Error finishing baccarat game:', error);
  }
}

// 바카라 게임 초기화
async function initializeBaccaratGame(io) {
  // DB에서 최근 20개 게임 히스토리 로드
  try {
    const result = await pool.query(`
      SELECT id, result, player_point, banker_point, end_time 
      FROM baccarat_games 
      WHERE end_time IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 20
    `);
    
    baccaratHistory = result.rows.map(row => ({
      gameId: row.id,
      result: row.result,
      playerPoints: row.player_point,
      bankerPoints: row.banker_point,
      endTime: row.end_time
    }));
  } catch (error) {
    console.error('Error loading baccarat history:', error);
  }
  
  // 자동 시작
  setTimeout(() => {
    if (!currentBaccaratGame) startBaccaratBettingPhase(io);
  }, 5000);
}

module.exports = {
  BACCARAT_MIN_BET,
  BACCARAT_MAX_BET,
  currentBaccaratGame,
  baccaratBettingPhase,
  baccaratBettingCountdown,
  baccaratHistory,
  initializeBaccaratGame,
  startBaccaratBettingPhase
};
