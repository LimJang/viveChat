# ViveGame 시스템 패턴 및 아키텍처

## 코드 구조 패턴

### 1. 서버 아키텍처 패턴
```javascript
// 메인 서버 구조
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

// 앱 초기화
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new sqlite3.Database('./db.sqlite');
```

### 2. 데이터베이스 테이블 설계 패턴
- **명명 규칙**: snake_case 사용
- **관계 설정**: 외래키로 테이블 간 관계 정의
- **공통 필드**: created_at, updated_at 자동 관리
- **소프트 삭제**: status 필드로 deleted 상태 관리

### 3. API 설계 패턴
```javascript
// 인증 미들웨어 패턴
function checkSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  // 세션 토큰 검증 로직
}

// API 응답 패턴
app.post('/api/endpoint', checkSession, express.json(), (req, res) => {
  // 입력 검증 → 비즈니스 로직 → 응답
});
```

### 4. Socket.io 이벤트 처리 패턴
```javascript
io.on('connection', (socket) => {
  // 세션 정보 추출
  const sess = socket.handshake.session;
  
  // 이벤트 리스너 등록
  socket.on('event_name', (data) => {
    // 권한 체크 → 처리 → 브로드캐스트
  });
  
  // 연결 해제 시 정리
  socket.on('disconnect', () => {
    // 사용자 목록에서 제거
  });
});
```

## 게임 구현 패턴

### 1. 게임 라운드 관리 패턴
```javascript
// 각 게임별 상태 변수
let currentGameRound = null;
let bettingPhase = false;
let bettingCountdown = 0;
let gameTimer = null;

// 라운드 시작 → 베팅 타임 → 게임 진행 → 결과 → 대기
function startBettingPhase() {
  // 베팅 타임 시작
}

function startGameRound() {
  // 게임 진행
}

function endGameRound() {
  // 결과 처리 및 다음 라운드 예약
}
```

### 2. 실시간 브로드캐스트 패턴
```javascript
// 게임 상태 브로드캐스트
function broadcastGameState() {
  io.emit('game_event', {
    gameId: currentGame.id,
    state: gameState,
    timestamp: Date.now()
  });
}
```

### 3. 베팅 처리 패턴
```javascript
// 베팅 API 패턴
app.post('/api/game/bet', checkSession, express.json(), (req, res) => {
  // 1. 베팅 시간 체크
  // 2. 베팅 금액 검증
  // 3. 사용자 머니 확인
  // 4. 머니 차감
  // 5. 베팅 기록 저장
  // 6. 응답 반환
});
```

## 보안 패턴

### 1. 인증/인가 패턴
- 세션 기반 인증
- 세션 토큰으로 중복 로그인 방지
- 어드민 권한 체크
- API별 권한 검증

### 2. 입력 검증 패턴
```javascript
// 공통 검증 패턴
const amount = parseInt(req.body.amount, 10);
if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
  return res.status(400).json({ error: '잘못된 베팅 금액' });
}
```

### 3. Rate Limiting 패턴
```javascript
// 특정 API 요청 제한
const adminDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  message: { error: '1분에 1회만 시도할 수 있습니다.' }
});
```

## 데이터 관리 패턴

### 1. 트랜잭션 처리 패턴
```javascript
db.serialize(() => {
  db.run('BEGIN TRANSACTION');
  db.run('UPDATE users SET money_balance = money_balance - ? WHERE id = ?', [amount, userId]);
  if (win) {
    db.run('UPDATE users SET money_balance = money_balance + ? WHERE id = ?', [winAmount, userId]);
  }
  db.run('COMMIT');
});
```

### 2. 메모리 상태 관리 패턴
- 게임 진행 상태를 메모리에 저장
- DB와 메모리 상태 동기화
- 서버 재시작 시 DB에서 상태 복원

### 3. 소프트 삭제 패턴
```sql
-- 메시지 삭제 시
UPDATE messages SET status = 'deleted' WHERE status IS NULL OR status != 'deleted'

-- 조회 시 삭제된 것 제외
SELECT * FROM messages WHERE status IS NULL OR status != 'deleted'
```

## 프론트엔드 패턴

### 1. 실시간 UI 업데이트 패턴
```javascript
// Socket 이벤트 리스너
socket.on('game_update', (data) => {
  updateGameUI(data);
});

// DOM 조작 패턴
function updateGameUI(data) {
  document.getElementById('game-status').textContent = data.status;
  // UI 업데이트
}
```

### 2. 반응형 디자인 패턴
- Mobile-first 접근
- CSS Grid/Flexbox 활용
- 미디어 쿼리로 브레이크포인트 관리

### 3. 상태 관리 패턴
- 전역 변수로 게임 상태 관리
- 로컬 스토리지 없이 세션 기반 상태

## 성능 최적화 패턴

### 1. 메모리 효율성
- 게임 히스토리 제한 (최근 N개만 유지)
- 주기적인 메모리 정리
- 불필요한 타이머 정리

### 2. 실시간 통신 최적화
- 필요한 데이터만 브로드캐스트
- 사용자별 맞춤 이벤트 전송
- 연결 상태 관리

### 3. 데이터베이스 최적화
- 인덱스 활용
- 적절한 쿼리 설계
- 트랜잭션 최소화

## 확장성 고려사항

### 1. 모듈화 패턴
- 게임별 로직 분리 가능
- API 라우터 분리 가능
- 공통 유틸리티 함수화

### 2. 설정 관리 패턴
- 게임별 상수 정의
- 환경별 설정 분리 가능
- 런타임 설정 변경 가능

### 3. 에러 처리 패턴
- 중앙화된 에러 핸들링
- 클라이언트 친화적 에러 메시지
- 로깅 및 모니터링 준비