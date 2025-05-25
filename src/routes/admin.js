const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const { checkSession, checkAdmin } = require('../middleware/auth');
const { startBettingPhase } = require('../game-logic/graphGame');
const { startBaccaratBettingPhase } = require('../game-logic/baccaratGame');

const router = express.Router();

// 어드민 데이터 삭제 API rate limit: 1분 1회
const adminDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  message: { error: '1분에 1회만 시도할 수 있습니다.' }
});

// 게임별 수익 통계
router.get('/game-stats', checkSession, checkAdmin, async (req, res) => {
  try {
    const results = await Promise.all([
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM baccarat_bets'),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM graph_bets'),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM slot_games'),
      pool.query('SELECT SUM(amount) as totalBet FROM horse_race_bets'),
      pool.query('SELECT SUM(amount * odds) as totalWin FROM horse_race_bets WHERE paid_rank IS NOT NULL')
    ]);
    
    const baccarat = { 
      totalBet: results[0].rows[0]?.totalbet || 0, 
      totalWin: results[0].rows[0]?.totalwin || 0 
    };
    const graph = { 
      totalBet: results[1].rows[0]?.totalbet || 0, 
      totalWin: results[1].rows[0]?.totalwin || 0 
    };
    const slot = { 
      totalBet: results[2].rows[0]?.totalbet || 0, 
      totalWin: results[2].rows[0]?.totalwin || 0 
    };
    const horse = { 
      totalBet: results[3].rows[0]?.totalbet || 0, 
      totalWin: results[4].rows[0]?.totalwin || 0 
    };
    
    res.json({ success: true, baccarat, graph, slot, horse });
  } catch (error) {
    console.error('Error fetching game stats:', error);
    res.json({ success: false, error: 'DB 오류' });
  }
});

// 플레이어별 게임 통계
router.get('/player-stats', checkSession, checkAdmin, async (req, res) => {
  const userId = parseInt(req.query.userId, 10);
  if (!userId) return res.status(400).json({ success: false, error: 'userId 필요' });
  
  try {
    const results = await Promise.all([
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM graph_bets WHERE user_id = $1', [userId]),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM baccarat_bets WHERE user_id = $1', [userId]),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM slot_games WHERE user_id = $1', [userId]),
      pool.query('SELECT SUM(amount) as totalBet FROM horse_race_bets WHERE user_id = $1', [userId]),
      pool.query('SELECT SUM(amount * odds) as totalWin FROM horse_race_bets WHERE user_id = $1 AND paid_rank IS NOT NULL', [userId])
    ]);
    
    const result = {
      graph: { 
        totalBet: results[0].rows[0]?.totalbet || 0, 
        totalWin: results[0].rows[0]?.totalwin || 0 
      },
      baccarat: { 
        totalBet: results[1].rows[0]?.totalbet || 0, 
        totalWin: results[1].rows[0]?.totalwin || 0 
      },
      slot: { 
        totalBet: results[2].rows[0]?.totalbet || 0, 
        totalWin: results[2].rows[0]?.totalwin || 0 
      },
      horse: { 
        totalBet: results[3].rows[0]?.totalbet || 0, 
        totalWin: results[4].rows[0]?.totalwin || 0 
      }
    };
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.json({ success: false, error: 'DB 오류' });
  }
});

// 바카라 게임 데이터 전체 삭제
router.post('/clear-baccarat', adminDeleteLimiter, checkSession, checkAdmin, async (req, res) => {
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM baccarat_bets');
    await pool.query('DELETE FROM baccarat_games');
    
    // 바카라 게임 상태 초기화는 게임 로직에서 처리
    // (여기서는 데이터베이스만 정리)
    
    await pool.query('COMMIT');
    
    // 1초 후 새 게임 시작을 위해 게임 로직에 신호
    setTimeout(() => {
      const io = req.app.get('io'); // app에서 io 인스턴스 가져오기
      if (io) startBaccaratBettingPhase(io);
    }, 1000);
    
    res.json({ success: true });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error clearing baccarat:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 그래프 게임 데이터 전체 삭제
router.post('/clear-graph', adminDeleteLimiter, checkSession, checkAdmin, async (req, res) => {
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM graph_bets');
    await pool.query('DELETE FROM graph_games');
    
    // 그래프 게임 상태 초기화는 게임 로직에서 처리
    
    await pool.query('COMMIT');
    
    // 1초 후 새 게임 시작을 위해 게임 로직에 신호
    setTimeout(() => {
      const io = req.app.get('io'); // app에서 io 인스턴스 가져오기
      if (io) startBettingPhase(io);
    }, 1000);
    
    res.json({ success: true });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error clearing graph:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

module.exports = router;
