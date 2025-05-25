const express = require('express');
const { pool } = require('../config/database');
const { checkSession } = require('../middleware/auth');
const { 
  BACCARAT_MIN_BET, 
  BACCARAT_MAX_BET, 
  currentBaccaratGame, 
  baccaratBettingPhase,
  baccaratHistory 
} = require('../game-logic/baccaratGame');

const router = express.Router();

// 바카라 베팅 API
router.post('/bet', checkSession, express.json(), async (req, res) => {
  if (!baccaratBettingPhase || !currentBaccaratGame) {
    return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다.' });
  }
  
  const userId = req.session.userId;
  const betType = req.body.bet_type; // 'player', 'banker', 'tie'
  const amount = parseInt(req.body.bet_amount || req.body.amount, 10); // 두 필드 모두 지원
  
  if (!['player', 'banker', 'tie'].includes(betType)) {
    return res.status(400).json({ error: '잘못된 베팅 타입' });
  }
  
  if (!amount || amount < BACCARAT_MIN_BET || amount > BACCARAT_MAX_BET) {
    return res.status(400).json({ error: `베팅금액은 ${BACCARAT_MIN_BET}~${BACCARAT_MAX_BET}원` });
  }
  
  try {
    // 중복 베팅 확인
    const existingBet = await pool.query(
      'SELECT id FROM baccarat_bets WHERE game_id = $1 AND user_id = $2 AND bet_type = $3',
      [currentBaccaratGame.id, userId, betType]
    );
    
    if (existingBet.rows.length > 0) {
      return res.status(400).json({ error: '이미 이 옵션에 베팅하셨습니다.' });
    }
    
    // 잔고 확인
    const userResult = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0] || userResult.rows[0].money_balance < amount) {
      return res.status(400).json({ error: '머니 부족' });
    }
    
    // 베팅 처리
    await pool.query('UPDATE users SET money_balance = money_balance - $1 WHERE id = $2', [amount, userId]);
    await pool.query(
      'INSERT INTO baccarat_bets (user_id, game_id, bet_type, bet_amount) VALUES ($1, $2, $3, $4)',
      [userId, currentBaccaratGame.id, betType, amount]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error placing baccarat bet:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 현재 게임 정보 조회
router.get('/current', async (req, res) => {
  if (!currentBaccaratGame) {
    return res.json({ 
      betting: baccaratBettingPhase,
      history: baccaratHistory.slice(0, 20)
    });
  }
  
  res.json({
    gameId: currentBaccaratGame.id,
    betting: baccaratBettingPhase,
    history: baccaratHistory.slice(0, 20)
  });
});

// 게임 히스토리 조회
router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, result, player_point, banker_point, end_time 
      FROM baccarat_games 
      WHERE end_time IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 20
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching baccarat history:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

module.exports = router;
