# Railway 배포 수정사항

## 수정된 파일들
1. **railway.toml** - Railway 배포 설정
2. **nixpacks.toml** - Nixpacks 설정  
3. **Procfile** - 프로세스 정의
4. **start.sh** - 시작 스크립트
5. **package.json** - build 스크립트 추가

## Railway 재배포 방법

### 방법 1: Git Push로 자동 재배포
```bash
git add .
git commit -m "Fix Railway deployment configuration"
git push origin main
```

### 방법 2: Railway 대시보드에서 수동 설정
1. Railway 대시보드 접속
2. 프로젝트 선택 → Settings → Deploy
3. **Start Command** 필드에 입력: `node server.js`
4. **Redeploy** 클릭

### 방법 3: 환경 변수로 설정
Railway 대시보드에서 환경 변수 추가:
```
RAILWAY_START_COMMAND=node server.js
```

## 배포 후 확인사항
- [ ] 서버 정상 시작 확인
- [ ] 데이터베이스 연결 확인  
- [ ] Socket.io 실시간 통신 확인
- [ ] 게임 기능 테스트
