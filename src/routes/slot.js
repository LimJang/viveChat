const express = require('express');
const { pool } = require('../config/database');
const { checkSession } = require('../middleware/auth');
const router = express.Router();

// 슬롯머신 상수
const SLOT_MIN_BET = 1000;
const SLOT_MAX_BET = 50000;
const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '🍀', '7️⃣', '💎', '🍉'];

// 슬롯머신 배당표
const SLOT_PAYOUTS = {
  '7️⃣7️⃣7️⃣': 100,
  '💎💎💎': 50,
  '🍀🍀🍀': 25,
  '🔔🔔🔔': 15,
  '🍉🍉🍉': 10,
  '🍋🍋🍋': 8,
  '🍒🍒🍒': 5,
  '7️⃣7️⃣': 3,
  '💎💎': 2,
  '🍀🍀': 2,
  '🍒🍒': 2
};

// 슬롯머신 돌리기
function spinSlots() {
  const result = [];
  for (let i = 0; i < 3; i++) {
    // 가중치를 적용한 랜덤 선택
    const rand = Math.random();
    if (rand < 0.4) result.push(SLOT_SYMBOLS[Math.floor(Math.random() * 4)]); // 낮은 등급 40%
    else if (rand < 0.8) result.push(SLOT_SYMBOLS[Math.floor(Math.random() * 6)]); // 중간 등급 40%
    else result.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]); // 전체 20%
  }
  return result;
}

// 당첨 계산
function calculateWin(symbols, betAmount) {
  const symbolString = symbols.join('');
  
  // 3개 같은 것 먼저 확인
  for (const [pattern, multiplier] of Object.entries(SLOT_PAYOUTS)) {
    if (pattern.length === 9 && symbolString === pattern) { // 3개 같음
      return betAmount * multiplier;
    }
  }
  
  // 2개 같은 것 확인
  const first = symbols[0];
  const second = symbols[1];
  const third = symbols[2];
  
  if (first === second || first === third || second === third) {
    const matchSymbol = first === second ? first : (first === third ? first : second);
    const pattern = matchSymbol + matchSymbol;
    
    if (SLOT_PAYOUTS[pattern]) {
      return betAmount * SLOT_PAYOUTS[pattern];
    }
  }
  
  return 0;
}

// 슬롯머신 플레이 API (spin과 play 둘 다 지원)
router.post('/play', checkSession, express.json(), async (req, res) => {
  await handleSlotPlay(req, res);
});

router.post('/spin', checkSession, express.json(), async (req, res) => {
  await handleSlotPlay(req, res);
});

// 슬롯머신 플레이 핸들러
async function handleSlotPlay(req, res) {
  const userId = req.session.userId;
  const amount = parseInt(req.body.amount, 10);
  
  if (!amount || amount < SLOT_MIN_BET || amount > SLOT_MAX_BET) {
    return res.status(400).json({ error: `베팅금액은 ${SLOT_MIN_BET}~${SLOT_MAX_BET}원` });
  }
  
  try {
    // 잔고 확인
    const userResult = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0] || userResult.rows[0].money_balance < amount) {
      return res.status(400).json({ error: '머니 부족' });
    }
    
    // 슬롯 결과 생성
    const symbols = spinSlots();
    const winAmount = calculateWin(symbols, amount);
    const finalAmount = winAmount; // 베팅금은 이미 차감되므로 순수 당첨금만
    
    // 베팅금 차감
    await pool.query('UPDATE users SET money_balance = money_balance - $1 WHERE id = $2', [amount, userId]);
    
    // 당첨금 지급
    if (winAmount > 0) {
      await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [winAmount, userId]);
    }
    
    // 게임 기록 저장
    await pool.query(
      'INSERT INTO slot_games (user_id, bet_amount, result, win_amount) VALUES ($1, $2, $3, $4)',
      [userId, amount, JSON.stringify(symbols), winAmount]
    );
    
    res.json({
      success: true,
      symbols,
      betAmount: amount,
      winAmount,
      profit: winAmount - amount
    });
  } catch (error) {
    console.error('Error playing slot:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

// 슬롯머신 랭킹 (rankings와 ranking 둘 다 지원)
router.get('/ranking', async (req, res) => {
  await handleSlotRanking(req, res);
});

router.get('/rankings', async (req, res) => {
  await handleSlotRanking(req, res);
});

// 슬롯머신 랭킹 핸들러
async function handleSlotRanking(req, res) {
  try {
    const result = await pool.query(`
      SELECT u.username, s.win_amount, s.bet_amount, s.result, s.created_at
      FROM slot_games s
      JOIN users u ON s.user_id = u.id
      WHERE s.win_amount > 0
      ORDER BY s.created_at DESC
      LIMIT 50
    `);
    
    // 당첨금 기준으로 정렬
    const ranking = result.rows
      .sort((a, b) => b.win_amount - a.win_amount)
      .slice(0, 10);
    
    res.json(ranking);
  } catch (error) {
    console.error('Error fetching slot ranking:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

// 슬롯머신 배당표 조회
router.get('/payouts', (req, res) => {
  res.json({
    symbols: SLOT_SYMBOLS,
    payouts: SLOT_PAYOUTS,
    minBet: SLOT_MIN_BET,
    maxBet: SLOT_MAX_BET
  });
});

module.exports = router;
