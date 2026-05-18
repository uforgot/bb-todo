# Discord Bridges — voice-bridge & relay-bridge

bb-private 채널에서 도는 두 개의 Discord 다리. usage-server.js가 시작될 때
voice-bridge.start()가 Discord client를 띄우고, 그 client에 relay-bridge가
attach 된다.

## voice-bridge.js — Ably voice 흐름 + [voice] 캡처

bb-app에서 Ably로 보낸 voice 요청을 Discord로 forward하고, 봇 답을 다시
Ably로 publish한다. 사진 얼굴 컨텍스트(face memory)도 이 경로에서만 처리.

### 흐름

1. bb-app → Ably `bb-voice` 채널 `request` 이벤트 publish
   (text + 선택적 image_url, mention, location)
2. voice-bridge가 location → reverse geocode / bb-admin places로 라벨 만들고,
   image_url 있으면 face match로 `Photo: L=..., C=..., R=...` 요약 추가.
3. `[voice] <@봇id>\n<voice 톤 룰>\n\nTime: ...\nLoc: ...\nPhoto: ...\nUser: ...`
   형태로 Discord webhook(`DISCORD_VOICE_WEBHOOK_URL`)에 POST. 봇이 사용자
   메시지처럼 받아 답변.
4. voice-bridge가 `[voice]` prefix 보면 `awaitingResponse=true`로 arm,
   다음에 들어오는 등록된 봇 답을 캡처 → `cleanForVoice` 후 Ably `reply`
   publish → bb-app TTS.

### Time 라벨

`YYYY년 M월 D일 요일 (오전|점심|오후|저녁|밤) HH:MM` 형식. 시간 부분이
모호한 자연어 + 정확한 시계 시간 둘 다 들어가서 봇이 골라 쓰게 함.

### 환경 변수

| 변수 | 용도 |
|---|---|
| `DISCORD_VOICE_BOT_TOKEN` | listener 봇 로그인 토큰 (필수) |
| `ABLY_ROOT_KEY` | Ably client (필수) |
| `ABLY_VOICE_CHANNEL` | 기본 `bb-voice` |
| `BB_VOICE_CHANNEL_IDS` | voice 요청/응답 캡처 채널 id (콤마 구분), 기본 bb-private |
| `BBANGBBANG_USER_ID` | 멘션 fallback (빵빵) |
| `DISCORD_VOICE_WEBHOOK_URL` | `[voice]` post용 webhook |
| `GOOGLE_PLACES_API_KEY` | reverse geocode (선택) |
| `BB_ADMIN_PLACES_API_URL` | places alias lookup, 기본 `http://127.0.0.1:3000/api/places` |
| `FACE_CLI_PATH` | 얼굴 인식 CLI 경로 |
| `FACE_MATCH_THRESHOLD` | 매치 임계값, 기본 0.4 |

## relay-bridge.js — 무멘션 followup relay

같은 listener 봇 client에 attach 되는 보조 핸들러. 단일 책임: 사용자가
멘션 없이 메시지 보내면 직전에 답한 등록 봇한테 자동으로 멘션을 박아
다시 트리거.

### 트리거 케이스

다음을 모두 만족하는 사용자 메시지에서 발동:
- author가 사람 (봇/webhook 아님)
- `[voice]` prefix 아님
- Discord reply(댓글) 메시지 아님
- 텍스트 또는 이미지 첨부 있음
- 등록된 봇 멘션이 본문에 없음

Discord reply로 봇 메시지에 답글 단 경우는 OpenClaw가 이미 해당 봇 세션으로
전달하므로 relay-bridge가 다시 멘션하지 않는다. 일반 무멘션은 바로 직전
메시지가 `voice-config.json` bots에 등록된 봇일 때만 그 봇으로 relay한다.

### relay 페이로드

listener 봇이 댓글(reply)을 달지 않고 새 일반 메시지를 보낸다. 본문은 원문을
그대로 복사한 형태다:

```
<@bot_id> 원문 텍스트
```

원본 메시지의 첨부(이미지 등)는 그대로 재첨부한다. Discord reply reference와
별도 relay prompt에 의존하지 않게 해서 agent 입력을 단순하게 유지한다.

### 환경 변수

| 변수 | 용도 |
|---|---|
| `RELAY_CHANNEL_IDS` | relay 감시 채널/스레드 id (콤마 구분). 없으면 `BB_VOICE_CHANNEL_IDS`를 사용 |
| `RELAY_ALL_VISIBLE_CHANNELS` | `true`면 listener 봇이 볼 수 있는 모든 채널/스레드에서 relay 허용 |

webhook 없이 봇 client의 `channel.send`만 사용하므로 별도 webhook env 필요
없음.

`RELAY_CHANNEL_IDS`/`RELAY_ALL_VISIBLE_CHANNELS`와 `BB_VOICE_CHANNEL_IDS`는
분리되어 있다. relay를 여러 Discord 채널/스레드에서 쓰더라도, voice 응답
캡처는 `BB_VOICE_CHANNEL_IDS` 안에서만 일어나므로 다른 채널의 봇 답변이
Ably voice reply로 섞이지 않는다.

### 루프 안전성

- relay message는 listener author → 다른 핸들러들이 `msg.author.bot` 체크로
  스킵
- face 인식은 Ably 경로 전용, Discord 직접 사진은 무처리
- `[voice]` arm은 prefix 체크 후 voice-bridge에서만 fire

## 분리 이유

이전엔 voice-bridge.js 한 파일에 (1) Ably voice 흐름 (2) Discord 직접 사진
face 처리 (3) 무멘션 followup relay가 다 섞여 있었음. 핸들러 우선순위가
꼬여서 사진 + 무멘션 followup이 동시에 와도 face 응답이 followup을 막던
이슈가 있었음. 책임 분리 후:

- voice-bridge → Ably 입출력 + `[voice]` 캡처에만 집중
- relay-bridge → Discord 메시지의 무멘션 followup 라우팅만 처리
- 사진 face 인식은 bb-app 경로로 통일 (Discord 직접 업로드는 무처리,
  필요하면 bb-admin에서 등록)
