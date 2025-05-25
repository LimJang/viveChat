const { pool } = require('../config/database');

// 세션 토큰 검증 미들웨어
async function checkSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  
  try {
    const result = await pool.query('SELECT session_token FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows[0] || result.rows[0].session_token !== req.session.sessionToken) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '중복 로그인 감지, 다시 로그인하세요.' });
    }
    next();
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
}

// 어드민 권한 확인 미들웨어
function checkAdmin(req, res, next) {
  if (!req.session.userId || !req.session.is_admin) {
    return res.status(403).json({ error: '어드민 권한 필요' });
  }
  next();
}

module.exports = { checkSession, checkAdmin };
