#!/bin/bash

echo "🔧 ViveGame 버그 수정 배포..."

# 변경사항 추가
git add .

# 커밋
git commit -m "🐛 Fix frontend API endpoints and Socket.IO connections

- Fix slot.js: Add both /spin and /play endpoints, /rankings and /ranking
- Add Socket.IO script tags to all game pages 
- Ensure API compatibility between frontend and backend
- Fix graph game bet parameter handling
- Resolve baccarat card flipping issues
- Fix horse racing UI rendering problems

All games should now work properly:
✅ Login/Register fixed
✅ Slot machine API routes fixed  
✅ Socket.IO connections restored
✅ API endpoints standardized"

# 푸시
git push origin main

echo "✅ 수정사항 배포 완료!"
