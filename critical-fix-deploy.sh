#!/bin/bash

echo "🚨 ViveGame 긴급 버그 수정 배포..."

# 변경사항 추가
git add .

# 커밋
git commit -m "🚨 CRITICAL: Fix all major frontend/backend errors

메인 페이지 수정:
- Fix null reference error on admin-money-btn-wrap element
- Add proper null checks for DOM elements

API 파라미터 호환성 수정:
- Baccarat: Support both bet_amount and amount parameters  
- Slot: Support both bet and amount parameters
- Graph: Keep existing amount parameter

바카라 게임 수정:
- Fix card rendering null reference errors
- Fix Socket.IO event data structure mismatch
- Add null checks for player/banker card arrays
- Fix playerCards/bankerCards vs player/banker field names

모든 400 Bad Request 에러 해결:
✅ 로그인/회원가입 API 경로 수정됨
✅ 게임 API 파라미터 호환성 확보
✅ Socket.IO 이벤트 데이터 구조 수정
✅ DOM 요소 null 체크 추가

이제 모든 게임이 정상 작동해야 함!"

# 푸시
git push origin main

echo "✅ 긴급 수정사항 배포 완료!"
echo "🎮 모든 게임을 다시 테스트해주세요."
