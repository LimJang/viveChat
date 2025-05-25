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
router.post('/bet', express.json(), checkSession, async (req, res) => {
  // checkSession 미들웨어에서 이미 세션 검증됨
  
  const userId = req.session.userId;
  const amount = parseInt(req.body.amount, 10);
  
  // 입력 값 검증
  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: '베팅금액을 올바르게 입력해주세요.' });
  }
  
  if (amount < GRAPH_MIN_BET || amount > GRAPH_MAX_BET) {
    return res.status(400).json({ error: `베팅금액은 ${GRAPH_MIN_BET.toLocaleString()}~${GRAPH_MAX_BET.toLocaleString()}원 사이에서 입력해주세요.` });
  }
  
  if (!bettingPhase) {
    return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다. 라운드 종료 후 베팅 가능합니다.' });
  }
  
  if (pendingBets[userId]) {
    return res.status(400).json({ error: '이미 베팅을 예약하셨습니다. 다음 라운드를 기다려주세요.' });
  }
  
  try {
    const result = await pool.query('SELECT money_balance FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '사용자 정보를 찾을 수 없습니다.' });
    }
    
    const userBalance = result.rows[0].money_balance;
    if (userBalance < amount) {
      return res.status(400).json({ 
        error: `보유 머니가 부족합니다. (보유: ${userBalance.toLocaleString()}원, 필요: ${amount.toLocaleString()}원)` 
      });
    }
    
    // 베팅 예약 성공
    pendingBets[userId] = { amount, timestamp: Date.now() };
    console.log(`Graph bet reserved: User ${userId}, Amount ${amount}`);
    
    res.json({ 
      reserved: true, 
      amount: amount,
      message: '베팅이 다음 라운드에 예약되었습니다.' 
    });
  } catch (error) {
    console.error('Error placing graph bet:', error);
    res.status(500).json({ error: '데이터베이스 오류가 발생했습니다.' });
  }
});

// 그래프게임 스톱 API
router.post('/stop', express.json(), checkSession, async (req, res) => {
  // checkSession 미들웨어에서 이미 세션 검증됨
  
  const userId = req.session.userId;
  
  if (!currentGraphGame || !currentGraphGame.id) {
    return res.status(400).json({ error: '진행 중인 라운드가 없습니다. 다음 라운드를 기다려주세요.' });
  }
  
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
  // checkSession 미들웨어에서 이미 세션 검증됨
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
