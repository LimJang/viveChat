const { pool } = require('../config/database');

// 세션 토큰 검증 미들웨어 (완화된 검증)
async function checkSession(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '로그인 필요' });
  }
  
  try {
    // 사용자 존재 여부만 확인 (세션 토큰 검증 완화)
    const result = await pool.query('SELECT id, session_token FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows[0]) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '사용자 정보를 찾을 수 없습니다.' });
    }
    
    // 세션 토큰이 있고 일치하지 않는 경우에만 중복 로그인 감지
    const user = result.rows[0];
    if (user.session_token && req.session.sessionToken && user.session_token !== req.session.sessionToken) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '다른 기기에서 로그인되어 세션이 만료되었습니다.' });
    }
    
    next();
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

// 어드민 권한 확인 미들웨어
async function checkAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '로그인 필요' });
  }
  
  try {
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows[0] || !result.rows[0].is_admin) {
      return res.status(403).json({ error: '어드민 권한 필요' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

module.exports = { checkSession, checkAdmin };
