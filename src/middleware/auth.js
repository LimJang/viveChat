const { pool } = require('../config/database');

// 세션 토큰 검증 미들웨어 (완화된 검증 + 디버깅)
async function checkSession(req, res, next) {
  console.log('\n=== CHECK SESSION START ===');
  console.log('Session exists:', !!req.session);
  console.log('Session ID:', req.session?.id);
  console.log('User ID from session:', req.session?.userId);
  console.log('Session token present:', !!req.session?.sessionToken);
  
  if (!req.session.userId) {
    console.log('ERROR: No userId in session');
    console.log('=== CHECK SESSION END (NO USER) ===\n');
    return res.status(401).json({ error: '로그인 필요' });
  }
  
  try {
    console.log('Querying user with ID:', req.session.userId);
    // 사용자 존재 여부만 확인 (세션 토큰 검증 완화)
    const result = await pool.query('SELECT id, session_token FROM users WHERE id = $1', [req.session.userId]);
    console.log('User query result:', result.rows);
    
    if (!result.rows[0]) {
      console.log('ERROR: User not found in database');
      req.session.destroy(() => {});
      console.log('=== CHECK SESSION END (USER NOT FOUND) ===\n');
      return res.status(401).json({ error: '사용자 정보를 찾을 수 없습니다.' });
    }
    
    // 세션 토큰이 있고 일치하지 않는 경우에만 중복 로그인 감지
    const user = result.rows[0];
    console.log('Session token comparison:');
    console.log('  DB token:', user.session_token ? 'present' : 'null');
    console.log('  Request token:', req.session.sessionToken ? 'present' : 'missing');
    
    if (user.session_token && req.session.sessionToken && user.session_token !== req.session.sessionToken) {
      console.log('ERROR: Session token mismatch - duplicate login detected');
      req.session.destroy(() => {});
      console.log('=== CHECK SESSION END (TOKEN MISMATCH) ===\n');
      return res.status(401).json({ error: '다른 기기에서 로그인되어 세션이 만료되었습니다.' });
    }
    
    console.log('SUCCESS: Session check passed');
    console.log('=== CHECK SESSION END (SUCCESS) ===\n');
    next();
  } catch (error) {
    console.error('Session check database error:', error);
    console.log('=== CHECK SESSION END (DB ERROR) ===\n');
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
