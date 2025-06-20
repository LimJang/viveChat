# ViveGame 주요 기술 결정 사항

## 2025년 프로젝트 개발 결정들

### 1. 기술 스택 선택
**날짜**: 프로젝트 시작 시점
**결정**: Node.js + Express + Socket.io + SQLite
**컨텍스트**: 실시간 게임 플랫폼 개발을 위한 기술 스택 선택
**결정 사유**:
- Node.js: JavaScript 풀스택 개발로 개발 효율성 극대화
- Express: 빠른 API 개발과 라우팅
- Socket.io: 실시간 게임 및 채팅을 위한 WebSocket 통신
- SQLite: 파일 기반 DB로 개발/데모 환경에 적합
**대안**:
- Python + Django + WebSocket
- PHP + Laravel + WebSocket  
- Java + Spring Boot + WebSocket
**결과**: 빠른 개발과 실시간 통신에 최적화된 환경 구축

### 2. 데이터베이스 설계 방식
**날짜**: 초기 개발 단계
**결정**: 게임별 독립적인 테이블 구조
**컨텍스트**: 4가지 게임(그래프, 바카라, 슬롯, 경마)의 데이터 저장 방식
**결정 사유**:
- 각 게임의 고유한 데이터 구조 지원
- 게임별 독립적인 관리 및 확장 가능
- 성능 최적화 (게임별 인덱스 최적화)
**대안**:
- 통합 게임 테이블 + JSON 데이터
- NoSQL 문서 기반 저장
**결과**: 각 게임별 최적화된 데이터 구조와 쿼리 성능 확보

### 3. 실시간 게임 진행 방식
**날짜**: 게임 로직 설계 시점
**결정**: 메모리 기반 게임 상태 + DB 결과 저장
**컨텍스트**: 실시간 게임 진행과 데이터 일관성 보장
**결정 사유**:
- 빠른 실시간 응답 (메모리 처리)
- 영구 데이터 보존 (DB 저장)
- 서버 재시작 시 상태 복원 가능
**대안**:
- 모든 상태를 DB에서 직접 처리
- Redis 등 외부 캐시 서버 사용
**결과**: 높은 성능과 데이터 안정성 동시 확보

### 4. 세션 관리 방식
**날짜**: 사용자 인증 시스템 구현 시점
**결정**: Express Session + 세션 토큰 방식
**컨텍스트**: 사용자 인증 및 중복 로그인 방지
**결정 사유**:
- Express Session의 안정성
- 세션 토큰으로 중복 로그인 감지
- Socket.io와의 세션 공유 용이성
**대안**:
- JWT 토큰 기반 인증
- OAuth 소셜 로그인
**결과**: 안정적인 인증 시스템과 중복 로그인 방지 구현

### 5. 게임별 베팅 타임 설계
**날짜**: 각 게임 구현 시점
**결정**: 게임별 차별화된 베팅 시간
**컨텍스트**: 게임별 특성에 맞는 사용자 경험 제공
**결정 사유**:
- 그래프 게임: 30초 (신중한 배당률 선택)
- 바카라: 20초 (빠른 진행)
- 슬롯: 즉시 (개인 게임)
- 경마: 30초 (다양한 말 분석)
**대안**:
- 모든 게임 동일한 베팅 시간
- 사용자가 베팅 시간 조절 가능
**결과**: 게임별 최적화된 사용자 경험 제공

### 6. 어드민 기능 접근 방식
**날짜**: 관리자 기능 구현 시점
**결정**: 하드코딩된 어드민 계정 (ogf2002)
**컨텍스트**: 간단하고 안전한 어드민 권한 관리
**결정 사유**:
- 개발/데모 환경에 적합
- 복잡한 권한 시스템 불필요
- 보안 위험 최소화
**대안**:
- 역할 기반 권한 시스템 (RBAC)
- 어드민 등록 기능
**결과**: 단순하면서도 안전한 관리자 시스템

### 7. 프론트엔드 구현 방식
**날짜**: UI 개발 시점
**결정**: 바닐라 JavaScript + 반응형 CSS
**컨텍스트**: 빠른 개발과 가벼운 클라이언트
**결정 사유**:
- 프레임워크 없이 빠른 개발
- 번들링/빌드 과정 불필요
- 가벼운 클라이언트 사이드
- 직접적인 DOM 조작으로 성능 최적화
**대안**:
- React + Webpack
- Vue.js
- Svelte
**결과**: 빠른 개발과 가벼운 클라이언트 구현

### 8. 게임 확률 및 배당률 설계
**날짜**: 각 게임 밸런싱 시점
**결정**: 현실적인 확률 분포 적용
**컨텍스트**: 재미있으면서도 균형잡힌 게임 경험
**결정 사유**:
- 그래프 게임: 실제 서비스 분포 모사
- 바카라: 실제 카지노 규칙 및 배당률
- 슬롯: 다양한 배당 테이블
- 경마: 등수별 차별화된 배당
**대안**:
- 모든 게임 동일한 확률
- 완전 랜덤 배당률
**결과**: 각 게임별 특색있는 플레이 경험 제공

### 9. 실시간 통신 최적화
**날짜**: 성능 튜닝 시점
**결정**: 이벤트별 선별적 브로드캐스트
**컨텍스트**: 다수 사용자 동시 접속 시 성능 확보
**결정 사유**:
- 필요한 사용자에게만 이벤트 전송
- 네트워크 대역폭 절약
- 클라이언트 성능 최적화
**대안**:
- 모든 이벤트를 전체 브로드캐스트
- Room 기반 그룹 통신만 사용
**결과**: 효율적인 실시간 통신 및 확장성 확보

### 10. 에러 처리 및 사용자 경험
**날짜**: 전체 개발 과정
**결정**: 사용자 친화적 에러 메시지 + 로그
**컨텍스트**: 안정적인 서비스 운영과 사용자 경험
**결정 사유**:
- 기술적 에러를 사용자가 이해할 수 있는 메시지로 변환
- 개발자를 위한 상세 로그 유지
- 클라이언트 사이드 에러 핸들링
**대안**:
- 원본 에러 메시지 그대로 표시
- 에러 발생 시 페이지 리다이렉트
**결과**: 사용자 친화적이면서도 디버깅 가능한 에러 처리

## 향후 결정이 필요한 사항

### 1. 확장성 관련
- 사용자 증가 시 데이터베이스 마이그레이션 (SQLite → PostgreSQL)
- 다중 서버 환경에서의 실시간 통신 (Redis Adapter)
- CDN 및 정적 자원 최적화

### 2. 보안 강화
- HTTPS 적용 및 SSL 인증서
- API Rate Limiting 세분화
- 입력 검증 강화 (SQL Injection, XSS 방지)

### 3. 모니터링 및 운영
- 로깅 시스템 구축
- 성능 모니터링 도구
- 백업 및 복구 전략