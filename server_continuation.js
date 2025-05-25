  }));
  const startTime = new Date().toISOString();
  db.run('INSERT INTO horse_race_rounds (start_time, horses) VALUES (?, ?)', [startTime, JSON.stringify(horses)], function(err) {
    if (err) return;
    currentHorseRaceRound = {
      id: this.lastID,
      start_time: startTime,
      horses,
      result: null,
      end_time: null
    };
    horseRaceHorsesState = horses.map(h => ({ ...h, pos: 0, finishedAt: null, rank: null }));
    broadcastHorseRaceRoundStart();
    broadcastHorseRaceBettingPhase();
    horseRaceBettingTimer = setInterval(() => {
      horseRaceBettingCountdown--;
      broadcastHorseRaceBettingPhase();
      if (horseRaceBettingCountdown <= 0) {
        clearInterval(horseRaceBettingTimer);
        horseRaceBettingPhase = false;
        startHorseRaceProgress();
      }
    }, 1000);
  });
}

// [경마] 경주 진행(인기마 가속 우위)
function startHorseRaceProgress() {
  horseRaceProgressTick = 0;
  let finishedCount = 0;
  horseRaceHorsesState.forEach(h => { h.pos = 0; h.finishedAt = null; h.rank = null; });
  horseRaceProgressTimer = setInterval(() => {
    horseRaceProgressTick++;
    horseRaceHorsesState.forEach(horse => {
      if (horse.finishedAt) return;
      let add = 0.01;
      // 인기마는 가속 확률/가속량 증가
      if (horse.isPopular) {
        if (Math.random() < 0.18) add += +(Math.random() * 0.18).toFixed(3); // 더 자주, 더 크게 가속
      } else {
        if (Math.random() < 0.10) add += +(Math.random() * 0.15).toFixed(3);
      }
      horse.pos = Math.min(100, +(horse.pos + add).toFixed(3));
      if (horse.pos >= 100 && !horse.finishedAt) {
        horse.finishedAt = horseRaceProgressTick;
        horse.rank = ++finishedCount;
      }
    });
    broadcastHorseRaceProgress();
    if (finishedCount === horseRaceHorsesState.length) {
      clearInterval(horseRaceProgressTimer);
      finishHorseRaceRound();
    }
  }, 10);
}

// [경마] 라운드 종료/정산 (고정배당)
function finishHorseRaceRound() {
  const result = horseRaceHorsesState.slice().sort((a,b)=>a.rank-b.rank).map(h=>h.id);
  currentHorseRaceRound.result = result;
  currentHorseRaceRound.end_time = new Date().toISOString();
  db.run('UPDATE horse_race_rounds SET end_time=?, result=? WHERE id=?', [currentHorseRaceRound.end_time, JSON.stringify(result), currentHorseRaceRound.id]);
  db.all('SELECT * FROM horse_race_bets WHERE round_id = ?', [currentHorseRaceRound.id], (err, bets) => {
    if (!bets) bets = [];
    const userPayouts = {};
    bets.forEach(bet => {
      const rank = result.indexOf(bet.horse_id) + 1;
      let payout = 0;
      if (HORSE_RANK_ODDS[rank]) {
        payout = Math.floor(bet.amount * HORSE_RANK_ODDS[rank]);
      }
      if (payout > 0) {
        db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [payout, bet.user_id]);
        db.run('UPDATE horse_race_bets SET paid_rank = ? WHERE id = ?', [rank, bet.id]);
      }
      if (!userPayouts[bet.user_id]) userPayouts[bet.user_id] = 0;
      userPayouts[bet.user_id] += (payout - bet.amount);
    });
    Object.entries(userPayouts).forEach(([userId, amount]) => {
      if (userSockets[userId]) {
        userSockets[userId].forEach(socketId => {
          io.to(socketId).emit('horse_race_payout', { amount });
        });
      }
    });
    broadcastHorseRaceResult();
  });
  setTimeout(() => {
    currentHorseRaceRound = null;
    horseRaceHorsesState = null;
    startHorseRaceBettingPhase();
  }, 8000);
}

// 서버 시작 시 라운드 자동 시작
setTimeout(() => {
  if (!currentHorseRaceRound) startHorseRaceBettingPhase();
}, 2000);

// [경마] API: 현재 라운드 정보
app.get('/api/horse-race/round', (req, res) => {
  if (!currentHorseRaceRound) return res.json({ betting: false });
  res.json({
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
});

// [경마] API: 베팅 등록 (odds는 등수별 고정값 사용)
app.post('/api/horse-race/bet', checkSession, express.json(), (req, res) => {
  if (!horseRaceBettingPhase || !currentHorseRaceRound) return res.status(400).json({ error: '지금은 베팅 시간이 아닙니다.' });
  const userId = req.session.userId;
  const horseId = parseInt(req.body.horse_id, 10);
  const amount = parseInt(req.body.amount, 10);
  if (!HORSE_LIST.find(h=>h.id===horseId)) return res.status(400).json({ error: '잘못된 말 선택' });
  if (!Number.isInteger(amount) || amount < 1000 || amount > 1000000) return res.status(400).json({ error: '베팅금액은 1,000~1,000,000원' });
  // 중복 베팅 방지(한 라운드에 한 말만)
  db.get('SELECT id FROM horse_race_bets WHERE round_id = ? AND user_id = ? AND horse_id = ?', [currentHorseRaceRound.id, userId, horseId], (err, row) => {
    if (row) return res.status(400).json({ error: '이미 이 말에 베팅하셨습니다.' });
    db.get('SELECT money_balance FROM users WHERE id = ?', [userId], (err, user) => {
      if (!user || user.money_balance < amount) return res.status(400).json({ error: '머니 부족' });
      db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [amount, userId], (err) => {
        if (err) return res.status(500).json({ error: 'DB 오류' });
        db.run('INSERT INTO horse_race_bets (user_id, round_id, horse_id, amount) VALUES (?, ?, ?, ?)', [userId, currentHorseRaceRound.id, horseId, amount], function (err) {
          if (err) return res.status(500).json({ error: 'DB 오류' });
          res.json({ success: true });
        });
      });
    });
  });
});

// [경마] API: 최근 10개 라운드 결과
app.get('/api/horse-race/history', (req, res) => {
  db.all('SELECT id, start_time, end_time, horses, result FROM horse_race_rounds WHERE end_time IS NOT NULL ORDER BY id DESC LIMIT 10', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    res.json(rows.reverse());
  });
});

// [경마] 소켓: 라운드/베팅/진행/결과 브로드캐스트
function broadcastHorseRaceRoundStart() {
  io.emit('horse_race_round_start', {
    roundId: currentHorseRaceRound.id,
    horses: currentHorseRaceRound.horses,
    betting: true,
    bettingCountdown: horseRaceBettingCountdown
  });
}
function broadcastHorseRaceBettingPhase() {
  io.emit('horse_race_betting_phase', {
    betting: horseRaceBettingPhase,
    bettingCountdown: horseRaceBettingCountdown
  });
}
function broadcastHorseRaceProgress() {
  io.emit('horse_race_progress', {
    horses: horseRaceHorsesState.map(h=>({ id: h.id, name: h.name, pos: h.pos, rank: h.rank, color: h.color }))
  });
}
function broadcastHorseRaceResult() {
  io.emit('horse_race_result', {
    roundId: currentHorseRaceRound.id,
    result: currentHorseRaceRound.result,
    horses: horseRaceHorsesState.map(h=>({ id: h.id, name: h.name, rank: h.rank, color: h.color }))
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${dbPath}`);
});
