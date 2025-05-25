const express = require('express');
const { pool } = require('../config/database');
const { checkSession } = require('../middleware/auth');
const { 
  HORSE_MIN_BET, 
  HORSE_MAX_BET, 
  HORSE_LIST,
  HORSE_RANK_ODDS,
  currentHorseRaceRound, 
  horseRaceBettingPhase,
  horseRaceBettingCountdown
} = require('../game-logic/horseRaceGame');

const router = express.Router();

// 현재 라운드 정보
router.get('/round', (req, res) => {
  if (!currentHorseRaceRound) {
    return res.json({ betting: false });
  }
  
  res.json({
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
});

// 베팅 등록 (odds는 등수별 고정값 사용)
router.post('/bet', checkSession, express.json(), async (req, res) => {
  if (!horseRaceBettingPhase || !currentHorseRaceRound) {
    return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다.' });
  }
  
  const userId = req.session.userId;
  const horseId = parseInt(req.body.horse_id, 10);
  const amount = parseInt(req.body.amount, 10);
  
  if (!HORSE_LIST.find(h => h.id === horseId)) {
    return res.status(400).json({ error: '잘못된 말 선택' });
  }
  
  if (!Number.isInteger(amount) || amount < HORSE_MIN_BET || amount > HORSE_MAX_BET) {
    return res.status(400).json({ error: `베팅금액은 ${HORSE_MIN_BET.toLocaleString()}~${HORSE_MAX_BET.toLocaleString()}원` });
  }
  
  try {
    // 중복 베팅 방지(한 라운드에 한 말만)
    const existingBet = await pool.query(
      'SELECT id FROM horse_race_bets WHERE round_id = $1 AND user_id = $2 AND horse_id = $3',
      [currentHorseRaceRound.id, userId, horseId]
    );
    
    if (existingBet.rows.length > 0) {
      return res.status(400).json({ error: '이미 이 말에 베팅하셨습니다.' });
    }
    
    // 잔고 확인
    const userResult = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0] || userResult.rows[0].money_balance < amount) {
      return res.status(400).json({ error: '머니 부족' });
    }
    
    // 베팅 처리
    await pool.query('UPDATE users SET money_balance = money_balance - $1 WHERE id = $2', [amount, userId]);
    await pool.query(
      'INSERT INTO horse_race_bets (user_id, round_id, horse_id, amount) VALUES ($1, $2, $3, $4)',
      [userId, currentHorseRaceRound.id, horseId, amount]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error placing horse race bet:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 최근 10개 라운드 결과
router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, start_time, end_time, horses, result 
      FROM horse_race_rounds 
      WHERE end_time IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 10
    `);
    
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching horse race history:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 말 목록과 배당률 정보
router.get('/info', (req, res) => {
  res.json({
    horses: HORSE_LIST,
    odds: HORSE_RANK_ODDS,
    minBet: HORSE_MIN_BET,
    maxBet: HORSE_MAX_BET
  });
});

module.exports = router;
