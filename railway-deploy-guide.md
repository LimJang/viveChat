# Railway 배포 가이드

## 1. Railway 계정 생성 및 설정

### 1-1. Railway 가입
1. [Railway.app](https://railway.app) 접속
2. "Start a New Project" 클릭
3. GitHub 계정으로 로그인/가입

### 1-2. 프로젝트 연결
1. "Deploy from GitHub repo" 선택
2. `viveChat` 리포지토리 선택
3. "Deploy Now" 클릭

## 2. 환경 설정

### 2-1. 환경 변수 설정 (필요시)
Railway 대시보드에서:
```
PORT=3000
NODE_ENV=production
```

### 2-2. package.json 수정 확인
현재 package.json에 이미 올바른 scripts가 있는지 확인:
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

## 3. 자동 배포 설정

### 3-1. GitHub 연동
- Railway가 자동으로 GitHub 리포지토리 감지
- main/master 브랜치에 push할 때마다 자동 배포

### 3-2. 도메인 설정
1. Railway 대시보드에서 프로젝트 선택
2. "Settings" → "Domains" 
3. "Generate Domain" 클릭하여 무료 도메인 생성
4. 또는 커스텀 도메인 연결 가능

## 4. 데이터베이스 처리

### 4-1. SQLite 파일 위치
현재 `./db.sqlite` 파일이 로컬에 있음
Railway에서는 영구 저장을 위해 볼륨 마운트 필요:

```javascript
// server.js 수정 (배포용)
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/app/data/db.sqlite'  // Railway 볼륨 경로
  : './db.sqlite';         // 로컬 개발용

const db = new sqlite3.Database(dbPath);
```

### 4-2. Railway 볼륨 설정
1. Railway 대시보드에서 "Variables" 탭
2. "Add Volume" 클릭
3. Mount Path: `/app/data`
4. 이렇게 하면 서버 재시작 시에도 데이터 유지

## 5. 배포 확인

### 5-1. 로그 확인
- Railway 대시보드에서 "Deployments" 탭
- 실시간 로그 확인 가능
- 에러 발생 시 디버깅 정보 제공

### 5-2. 접속 테스트
1. Railway에서 제공하는 URL로 접속
2. 회원가입/로그인 테스트
3. 게임 기능 정상 작동 확인
4. 실시간 채팅 테스트

## 6. SSL/HTTPS 자동 적용
- Railway는 자동으로 SSL 인증서 제공
- HTTPS로 자동 리다이렉트
- 별도 설정 불필요

## 7. 모니터링
- Railway 대시보드에서 CPU/메모리 사용량 확인
- 응답 시간 모니터링
- 트래픽 통계 확인

## 비용 정보
- **무료 티어**: 월 500시간 (약 21일)
- **Pro 플랜**: $5/월 (무제한)
- Socket.io 실시간 통신도 지원
