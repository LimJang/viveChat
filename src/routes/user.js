const express = require('express');
const { pool } = require('../config/database');
const { checkSession, checkAdmin } = require('../middleware/auth');
const router = express.Router();

// 사용자 목록 조회 (어드민)
router.get('/', checkSession, checkAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, money_balance FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 사용자 머니 충전 (어드민)
router.post('/:id/add-money', checkSession, checkAdmin, express.json(), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'userId, amount 필요/유효성 오류' });
  }
  
  try {
    await pool.query('UPDATE users SET money_balance = money_balance + $1 WHERE id = $2', [amount, userId]);
    const result = await pool.query('SELECT id, username, money_balance FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: '사용자 없음' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error adding money:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 내 머니 잔고 조회
router.get('/me', checkSession, async (req, res) => {
  try {
    const result = await pool.query('SELECT money_balance FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: '사용자 없음' });
    
    res.json({ money_balance: result.rows[0].money_balance });
  } catch (error) {
    console.error('Error fetching user money:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

module.exports = router;
