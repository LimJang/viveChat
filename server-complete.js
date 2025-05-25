// 경마 히스토리 API
app.get('/api/horse-race/history', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, start_time, end_time, horses, result FROM horse_race_rounds WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 10');
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching horse race history:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

// 어드민 API들
app.post('/api/admin/clear-baccarat', adminDeleteLimiter, checkSession, async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM baccarat_bets');
    await pool.query('DELETE FROM baccarat_games');
    
    baccaratHistory = [];
    currentBaccaratGame = null;
    baccaratNextGameId = 1;
    
    await pool.query('COMMIT');
    
    setTimeout(() => {
      if (!currentBaccaratGame) startBaccaratBettingPhase();
    }, 1000);
    
    res.json({ success: true });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error clearing baccarat:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.post('/api/admin/clear-graph', adminDeleteLimiter, checkSession, async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ error: '어드민 권한 필요' });
  
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM graph_bets');
    await pool.query('DELETE FROM graph_games');
    
    nextGameId = 1;
    recentRounds = [];
    currentGraphGame = null;
    
    await pool.query('COMMIT');
    
    setTimeout(() => {
      if (!currentGraphGame) startBettingPhase();
    }, 1000);
    
    res.json({ success: true });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error clearing graph:', error);
    res.status(500).json({ error: 'DB 오류' });
  }
});

app.get('/api/admin/game-stats', checkSession, async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ success: false, error: '어드민 권한 필요' });
  
  try {
    const results = await Promise.all([
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM baccarat_bets'),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM graph_bets'),
      pool.query('SELECT SUM(bet_amount) as totalBet, SUM(win_amount) as totalWin FROM slot_games'),
      pool.query('SELECT SUM(amount) as totalBet FROM horse_race_bets'),
      pool.query('SELECT SUM(amount * odds) as totalWin FROM horse_race_bets WHERE paid_rank IS NOT NULL')
    ]);
    
    const baccarat = { totalBet: results[0].rows[0]?.totalbet || 0, totalWin: results[0].rows[0]?.totalwin || 0 };
    const graph = { totalBet: results[1].rows[0]?.totalbet || 0, totalWin: results[1].rows[0]?.totalwin || 0 };
    const slot = { totalBet: results[2].rows[0]?.totalbet || 0, totalWin: results[2].rows[0]?.totalwin || 0 };
    const horse = { totalBet: results[3].rows[0]?.totalbet || 0, totalWin: results[4].rows[0]?.totalwin || 0 };
    
    res.json({ success: true, baccarat, graph, slot, horse });
  } catch (error) {
    console.error('Error fetching game stats:', error);
    res.json({ success: false, error: 'DB 오류' });
  }
});

app.get('/api/admin/player-stats', checkSession, async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.status(403).json({ success: false, error: '어드민 권한 필요' });
  
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
      graph: { totalBet: results[0].rows[0]?.totalbet || 0, totalWin: results[0].rows[0]?.totalwin || 0 },
      baccarat: { totalBet: results[1].rows[0]?.totalbet || 0, totalWin: results[1].rows[0]?.totalwin || 0 },
      slot: { totalBet: results[2].rows[0]?.totalbet || 0, totalWin: results[2].rows[0]?.totalwin || 0 },
      horse: { totalBet: results[3].rows[0]?.totalbet || 0, totalWin: results[4].rows[0]?.totalwin || 0 }
    };
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.json({ success: false, error: 'DB 오류' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('PostgreSQL connection configured');
});
