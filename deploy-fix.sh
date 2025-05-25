#!/bin/bash

# ViveGame 서버 배포 스크립트

echo "🚀 ViveGame 서버 배포 시작..."

# 1. Git 상태 확인
echo "📋 Git 상태 확인..."
git status

# 2. 변경사항 추가
echo "📦 변경사항 추가 중..."
git add .

# 3. 커밋
echo "💾 커밋 생성 중..."
git commit -m "🔧 Fix API routing: Resolve login/register 404 errors

- Fix authRoutes path from /api/auth to /api for compatibility
- Remove incorrect router configuration
- Now supports /api/login, /api/register, /api/logout, /api/me
- Modularized server structure with all game APIs included
- All games (Graph, Baccarat, Slot, Horse Racing) working
- PostgreSQL integration completed"

# 4. 푸시
echo "🚀 Railway에 배포 중..."
git push origin main

echo "✅ 배포 완료! Railway에서 자동 빌드가 시작됩니다."
echo "🌐 배포 상태는 Railway 대시보드에서 확인하세요."
