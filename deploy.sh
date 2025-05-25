#!/bin/bash

# Railway 배포 스크립트
# 이 파일은 필요 시 수동으로 실행하여 배포 상태를 확인할 수 있습니다.

echo "🚀 ViveGame Railway 배포 준비 중..."

# 환경 변수 확인
echo "📋 환경 변수 확인:"
echo "NODE_ENV: ${NODE_ENV:-development}"
echo "PORT: ${PORT:-3000}"
echo "DATABASE_PATH: ${DATABASE_PATH:-./db.sqlite}"

# 데이터베이스 디렉토리 생성 (필요 시)
if [ "$NODE_ENV" = "production" ] && [ ! -z "$DATABASE_PATH" ]; then
    DB_DIR=$(dirname "$DATABASE_PATH")
    if [ ! -d "$DB_DIR" ]; then
        echo "📁 데이터베이스 디렉토리 생성: $DB_DIR"
        mkdir -p "$DB_DIR"
    fi
fi

# Node.js 버전 확인
echo "🔍 Node.js 버전: $(node --version)"
echo "📦 NPM 버전: $(npm --version)"

# 의존성 설치 확인
if [ ! -d "node_modules" ]; then
    echo "📥 의존성 설치 중..."
    npm install
else
    echo "✅ 의존성이 이미 설치되어 있습니다."
fi

echo "✨ 배포 준비 완료!"
echo "🌐 서버 시작: npm start"
