const express = require('express');
const { pool } = require('../config/database');
const { checkSession } = require('../middleware/auth');
const { 
  GRAPH_MIN_BET, 
  GRAPH_MAX_BET, 
  currentGraphGame, 
  currentMultiplier, 
  bettingPhase, 
  pendingBets 
} = require('../game-logic/graphGame');

const router = express.Router();

// 그래프게임 베팅 API
router.post('/bet', checkSession, express.json(), async (req, res) => {
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

// 그래프게임 스톱 API
router.post('/stop', checkSession, express.json(), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  const userId = req.session.userId;
  if (!currentGraphGame || !currentGraphGame.id) return res.status(400).json({ error: '진행 중인 라운드 없음' });
  
  try {
    const result = await pool.query('SELECT * FROM graph_bets WHERE game_id = $1 AND user_id = $2', [currentGraphGame.id, userId]);
    if (result.rows.length === 0 || result.rows[0].result !== 'playing') {
      return res.status(400).json({ error: '베팅 없음 또는 이미 스톱/종료' });
    }
    if (currentMultiplier >= currentGraphGame.crash_multiplier) return res.status(400).json({ error: '이미 터짐' });
    
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

// 내 베팅 상태 조회
router.get('/my-bet', checkSession, async (req, res) => {
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

module.exports = router;
