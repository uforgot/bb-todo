# Usage 메뉴

> 하단 탭바 네 번째 탭 — 아이콘: `Activity`

---

## 개요

Claude (Anthropic Max Plan)와 Kimi (Moonshot) AI 서비스의 사용량을 **실시간**으로 모니터링하는 대시보드.

---

## 아키텍처

```
[Mobile / Browser]
    ↓ SWR (1분 캐시)
[Vercel /api/usage]
    ↓ fetch (Bearer token)
[Tailscale Funnel]  https://ai.tail6603fc.ts.net/usage
    ↓ proxy
[로컬 Usage API 서버]  localhost:3100
    ├── Claude: macOS plist (Claude Usage Tracker 앱)
    └── Kimi: Moonshot API (/v1/users/me/balance)
```

### 이전 방식 (폐기)
```
크론 (07:00) → update-usage-logs.sh → backup/usage-logs.json → GitHub → Vercel
```
→ 하루 1회 업데이트, 지연 있음

### 현재 방식 (실시간)
```
Vercel → Tailscale Funnel → 로컬 서버 → 직접 데이터 소스 조회
```
→ 요청 시마다 최신 데이터

---

## Claude 카드

Claude Usage Tracker 앱(`HamedElfayome.Claude-Usage`)의 macOS preferences를 직접 파싱.

| 항목 | 설명 |
|------|------|
| 플랜 | Max Plan 뱃지 |
| 현재 세션 | 세션 사용률 (%) + 세션 리셋 카운트다운 (~5시간 주기) |
| 주간 한도 / 모든 모델 | 전체 주간 토큰 사용률 + 재설정 일시 |
| 주간 한도 / Sonnet만 | Sonnet 전용 주간 사용률 |
| Opus | 사용 시에만 표시 |
| 마지막 업데이트 | 상대 시간 표시 + 새로고침 버튼 |

> ⚠️ **제한사항:** OpenClaw 경유 API 사용량은 집계되지 않음. claude.ai 웹/앱 직접 사용량만 반영.

### 카운트다운 실시간 갱신
- `useEffect` + `setInterval`로 매분 re-render
- 세션 리셋: `session_reset_time` (약 5시간 주기)
- 주간 리셋: `weekly_reset_time` (주 1회)

---

## Kimi 카드

Moonshot API `/v1/users/me/balance`를 실시간 호출.

| 항목 | 설명 |
|------|------|
| 현재 잔액 | 뱃지에 `$X.XX` + 큰 글씨 표시 |
| 마지막 업데이트 | 상대 시간 표시 + 새로고침 버튼 |

---

## 로컬 Usage API 서버

### 위치
```
~/repos/bb-todo/server/
├── usage-server.js   ← API 서버 본체
├── start.sh          ← 환경변수 로드 + 실행
└── .env              ← USAGE_API_KEY, USAGE_PORT
```

### 엔드포인트

| Path | 설명 |
|------|------|
| `GET /usage` | Claude + Kimi 합산 |
| `GET /usage/claude` | Claude만 |
| `GET /usage/kimi` | Kimi만 |
| `GET /health` | 헬스체크 |

### 인증
- `Authorization: Bearer <USAGE_API_KEY>` 필수
- 401 반환 시 토큰 확인

### 자동 실행 (launchd)
```
~/Library/LaunchAgents/com.bbtodo.usage-server.plist
```
- `RunAtLoad: true` — 부팅 시 자동 시작
- `KeepAlive: true` — 크래시 시 자동 재시작
- 로그: `/tmp/usage-server.log`

### 관리 명령어
```bash
# 상태 확인
curl -s -H "Authorization: Bearer $(grep USAGE_API_KEY ~/repos/bb-todo/server/.env | cut -d= -f2)" http://localhost:3100/health

# 재시작
launchctl unload ~/Library/LaunchAgents/com.bbtodo.usage-server.plist
launchctl load ~/Library/LaunchAgents/com.bbtodo.usage-server.plist

# 로그 확인
tail -f /tmp/usage-server.log
```

---

## Tailscale Funnel

로컬 서버를 공개 HTTPS로 노출하여 Vercel에서 접근 가능하게 함.

| 항목 | 값 |
|------|------|
| 공개 URL | `https://ai.tail6603fc.ts.net/` |
| 프록시 대상 | `http://127.0.0.1:3100` |
| 인증 | Bearer token (서버 레벨) |

### 관리 명령어
```bash
# 상태 확인
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status

# Funnel 끄기
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --https=443 off

# Funnel 다시 켜기
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 3100
```

### 재부팅 후 동작
- Tailscale Funnel `--bg`는 Tailscale 설정에 영구 저장됨
- Tailscale 데몬이 시작되면 자동 복원

---

## Vercel 환경변수

| 변수 | 용도 |
|------|------|
| `USAGE_API_URL` | `https://ai.tail6603fc.ts.net/usage` |
| `USAGE_API_KEY` | Bearer token (서버 .env와 동일) |

---

## API 응답 포맷

```json
{
  "claude": {
    "plan": "Max",
    "weekly_tokens_used": 830000,
    "weekly_limit": 1000000,
    "weekly_percentage": 83,
    "sonnet_weekly_tokens_used": 600000,
    "sonnet_weekly_percentage": 60,
    "opus_weekly_tokens_used": 0,
    "opus_weekly_percentage": 0,
    "session_percentage": 86,
    "session_reset_time": "2026-02-19T07:00:00.261Z",
    "weekly_reset_time": "2026-02-20T08:00:00.261Z",
    "last_updated": "2026-02-19T06:33:26.377Z"
  },
  "kimi": {
    "current_balance": 21.16195,
    "cash_balance": 20.317339,
    "voucher_balance": 0.84461,
    "currency": "USD"
  },
  "timestamp": "2026-02-19T06:33:49.739Z"
}
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `server/usage-server.js` | 로컬 API 서버 |
| `server/.env` | API key, 포트 설정 |
| `src/app/api/usage/route.ts` | Vercel → 로컬 서버 프록시 |
| `src/components/usage-section.tsx` | Claude + Kimi 카드 UI |
| `src/hooks/use-usage.ts` | SWR 데이터 훅 (1분 캐시) |
| `~/Library/LaunchAgents/com.bbtodo.usage-server.plist` | launchd 자동 실행 |
