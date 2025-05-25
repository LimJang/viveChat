# ViveGame - 모듈화된 실시간 온라인 게임 플랫폼

실시간 채팅과 4가지 온라인 게임이 포함된 Node.js 기반 웹 애플리케이션입니다.

## 🎮 포함된 게임
- **그래프 게임**: 실시간 배당률 변화 그래프 게임
- **바카라**: 플레이어/뱅커/타이 베팅 카드 게임
- **슬롯머신**: 3릴 슬롯머신 (7가지 심볼)
- **경마**: 8마리 말 경주 시뮬레이션

## 🏗️ 프로젝트 구조 (모듈화)

```
/
├── server.js                 # 메인 서버 파일
├── src/
│   ├── config/
│   │   └── database.js       # PostgreSQL 연결 및 테이블 설정
│   ├── middleware/
│   │   └── auth.js           # 인증 미들웨어
│   ├── routes/               # API 라우터들
│   │   ├── auth.js           # 회원가입/로그인/로그아웃
│   │   ├── user.js           # 사용자 정보/머니 관리
│   │   ├── graph.js          # 그래프 게임 API
│   │   ├── baccarat.js       # 바카라 게임 API
│   │   ├── slot.js           # 슬롯머신 API
│   │   ├── horse.js          # 경마 게임 API
│   │   └── admin.js          # 어드민 기능
│   └── game-logic/           # 게임 로직
│       ├── graphGame.js      # 그래프 게임 로직
│       ├── baccaratGame.js   # 바카라 게임 로직
│       ├── horseRaceGame.js  # 경마 게임 로직
│       └── socketHandlers.js # Socket.IO 핸들링
└── public/                   # 프론트엔드 파일들
    ├── index.html
    ├── style.css
    └── script.js
```

## 🚀 기술 스택

### 백엔드
- **Node.js + Express**: 웹 서버
- **Socket.io**: 실시간 통신
- **PostgreSQL**: 데이터베이스 (Railway 클라우드)
- **bcrypt**: 비밀번호 암호화
- **express-session**: 세션 관리

### 프론트엔드
- **HTML5/CSS3/JavaScript**: 프론트엔드
- **Socket.io Client**: 실시간 통신
- **반응형 디자인**: 모바일 대응

## 📊 주요 기능

### 🔐 사용자 관리
- 회원가입/로그인 시스템
- 세션 토큰 기반 인증
- 중복 로그인 방지
- 어드민 권한 관리 (`ogf2002` 자동 어드민)

### 💰 게임머니 시스템
- 사용자별 머니 잔고 관리
- 어드민 머니 충전/차감 기능
- 게임별 베팅/당첨 처리
- 트랜잭션 안전성 보장

### 💬 실시간 채팅
- Socket.io 기반 실시간 메시지
- 온라인 사용자 목록
- 어드민 메시지 구분 표시
- 채팅 히스토리 관리

### 🎯 게임 시스템
각 게임마다 독립적인 로직과 API를 가지고 있으며, 실시간 소켓 통신으로 모든 사용자에게 동기화됩니다.

## 🛠️ 설치 및 실행

### 로컬 개발환경
```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm start
# 또는
node server.js
```

### 환경변수 설정
```bash
# .env 파일 생성
DATABASE_URL=postgresql://username:password@hostname:port/database
NODE_ENV=production  # 프로덕션 환경 시
```

## 🔧 API 엔드포인트

### 인증 API
- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `POST /api/auth/logout` - 로그아웃
- `GET /api/auth/me` - 로그인 상태 확인

### 사용자 API
- `GET /api/users` - 사용자 목록 (어드민)
- `POST /api/users/:id/add-money` - 머니 충전 (어드민)
- `GET /api/users/me` - 내 머니 잔고

### 게임 API
- `POST /api/graph/bet` - 그래프 게임 베팅
- `POST /api/graph/stop` - 그래프 게임 스톱
- `POST /api/baccarat/bet` - 바카라 베팅
- `POST /api/slot/play` - 슬롯머신 플레이
- `POST /api/horse-race/bet` - 경마 베팅

### 어드민 API
- `GET /api/admin/game-stats` - 게임별 수익 통계
- `GET /api/admin/player-stats` - 플레이어별 통계
- `POST /api/admin/clear-baccarat` - 바카라 데이터 삭제
- `POST /api/admin/clear-graph` - 그래프 데이터 삭제

## 🔄 Socket.IO 이벤트

### 채팅 이벤트
- `chat message` - 메시지 전송
- `online users` - 온라인 사용자 목록
- `clear messages` - 채팅 삭제 (어드민)

### 그래프 게임 이벤트
- `betting_phase` - 베팅 페이즈 상태
- `graph_round_start` - 라운드 시작
- `graph_multiplier` - 실시간 배당률
- `recent_rounds` - 최근 라운드 결과

### 바카라 게임 이벤트
- `baccarat_betting_phase` - 베팅 페이즈
- `baccarat_round_start` - 라운드 시작
- `baccarat_result` - 게임 결과

### 경마 게임 이벤트
- `horse_race_betting_start` - 베팅 시작
- `horse_race_progress` - 경주 진행
- `horse_race_result` - 경주 결과

## 📈 데이터베이스 구조

### 주요 테이블
- `users` - 사용자 정보 및 머니 잔고
- `messages` - 채팅 메시지
- `graph_games/graph_bets` - 그래프 게임
- `baccarat_games/baccarat_bets` - 바카라 게임
- `slot_games` - 슬롯머신 게임
- `horse_race_rounds/horse_race_bets` - 경마 게임

## 🚀 배포 (Railway)

Railway 플랫폼에 PostgreSQL과 함께 배포되어 있습니다.

### 배포 설정 파일
- `railway.toml` - Railway 설정
- `nixpacks.toml` - Nixpacks 빌드 설정
- `Procfile` - 프로세스 설정

### 배포 명령어
```bash
# Git 푸시로 자동 배포
git add .
git commit -m "Update server"
git push origin main
```

## 🎯 주요 개선사항 (모듈화)

### ✅ 개선된 점
1. **코드 구조**: 기능별로 파일 분리하여 유지보수성 향상
2. **확장성**: 새로운 게임이나 기능 추가가 쉬워짐
3. **가독성**: 각 파일의 역할이 명확해짐
4. **재사용성**: 공통 로직을 모듈로 분리
5. **테스트**: 각 모듈을 독립적으로 테스트 가능

### 📁 모듈 설명
- **config**: 데이터베이스 연결 등 설정
- **middleware**: 인증, 권한 검사 등 미들웨어
- **routes**: API 엔드포인트별 라우터
- **game-logic**: 게임별 핵심 로직 및 Socket.IO 처리

## 🔒 보안 기능
- bcrypt 비밀번호 해싱
- 세션 토큰 기반 인증
- 중복 로그인 감지 및 방지
- SQL 인젝션 방지 (parameterized queries)
- Rate limiting (어드민 삭제 기능)

## 📱 브라우저 지원
- 모던 브라우저 (Chrome, Firefox, Safari, Edge)
- 모바일 브라우저 대응
- 실시간 기능을 위한 WebSocket 지원 필요

## 👥 개발팀
- **개발자**: ogf2002 (어드민 계정)
- **프로젝트 관리**: Taskmaster 연동
- **AI 어시스턴트**: Claude (Anthropic)

---

## 📞 지원
문제가 발생하거나 새로운 기능이 필요한 경우, GitHub Issues를 통해 문의해주세요.

**🎮 ViveGame에서 즐거운 게임 되세요! 🎮**
