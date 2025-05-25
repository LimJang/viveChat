const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const router = express.Router();

// 회원가입 API
router.post('/register', express.json(), async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  
  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existingUser.rows.length > 0) return res.status(409).json({ error: '이미 존재하는 닉네임 또는 이메일' });
    
    const hash = await bcrypt.hash(password, 10);
    const isAdmin = username === 'ogf2002' ? 1 : 0;
    
    const result = await pool.query(
      'INSERT INTO users (username, password, email, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, email, isAdmin]
    );
    
    res.json({ success: true, userId: result.rows[0].id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그인 API (세션 안정성 개선)
router.post('/login', express.json(), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '필수 입력값 누락' });
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    
    // 세션 토큰 생성 및 세션 설정
    const sessionToken = uuidv4();
    
    // 세션 설정 먼저
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.is_admin = user.is_admin;
    req.session.sessionToken = sessionToken;
    
    // 세션 저장 후 DB 업데이트
    req.session.save(async (err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: '세션 저장 오류' });
      }
      
      try {
        await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [sessionToken, user.id]);
        res.json({ 
          success: true, 
          username: user.username, 
          is_admin: user.is_admin,
          userId: user.id
        });
      } catch (dbError) {
        console.error('Database update error:', dbError);
        res.status(500).json({ error: 'DB 오류' });
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그인 상태 확인 및 사용자 정보 반환 (세션 강화)
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '로그인 필요' });
  }
  
  try {
    const result = await pool.query('SELECT id, username, email, is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) {
      // 사용자가 없으면 세션 삭제
      req.session.destroy(() => {});
      return res.status(401).json({ error: '사용자 정보를 찾을 수 없습니다.' });
    }
    
    const user = result.rows[0];
    res.json({ 
      id: user.id, 
      username: user.username, 
      email: user.email, 
      is_admin: user.is_admin,
      sessionActive: true
    });
  } catch (error) {
    console.error('User info error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 로그아웃 API (안전한 로그아웃)
router.post('/logout', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      // DB에서 세션 토큰 삭제
      await pool.query('UPDATE users SET session_token = NULL WHERE id = $1', [req.session.userId]);
    } catch (error) {
      console.error('Logout DB error:', error);
    }
  }
  
  // 세션 완전 삭제
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ error: '로그아웃 오류' });
    }
    res.clearCookie('vivegame.sid');
    res.json({ success: true });
  });
});

module.exports = router;
