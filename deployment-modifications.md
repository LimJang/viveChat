# 배포를 위한 server.js 수정사항

## 현재 server.js에서 수정이 필요한 부분들

### 1. 포트 설정 수정
```javascript
// 기존
const PORT = process.env.PORT || 3000;

// 수정 필요 (이미 올바름)
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 2. 데이터베이스 경로 수정
```javascript
// 기존
const db = new sqlite3.Database('./db.sqlite');

// 배포용으로 수정
const dbPath = process.env.NODE_ENV === 'production' 
  ? process.env.DATABASE_PATH || './db.sqlite'
  : './db.sqlite';

const db = new sqlite3.Database(dbPath);
```

### 3. 정적 파일 경로 확인
```javascript
// 현재 (이미 올바름)
app.use(express.static(path.join(__dirname, 'public')));
```

### 4. CORS 설정 추가 (필요시)
```javascript
// Railway에서는 보통 불필요하지만, 필요시 추가
const cors = require('cors');
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-railway-domain.railway.app']
    : ['http://localhost:3000'],
  credentials: true
}));
```

## package.json 확인사항

### 1. engines 필드 추가 (권장)
```json
{
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=8.0.0"
  }
}
```

### 2. scripts 확인
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

## 환경변수 설정

Railway 대시보드에서 설정할 환경변수들:
```
NODE_ENV=production
PORT=3000
DATABASE_PATH=/app/data/db.sqlite
```
