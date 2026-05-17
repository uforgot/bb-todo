# server/

bb-todo 백엔드. `usage-server.js`가 Express + SQLite + Ably + Discord
client를 띄우고, 그 안에서 cron poller / voice-bridge / relay-bridge가 함께
돈다. launchd에서 `com.bbtodo.usage-server`로 띄우고 로그는 `/tmp/usage-server.log`.

## 구성

| 파일 | 역할 |
|---|---|
| `usage-server.js` | Express API 본체. cron poller 기동, voice-bridge.start() 호출 |
| `voice-bridge.js` | bb-app ↔ Ably ↔ Discord webhook voice 흐름, `[voice]` 캡처 |
| `relay-bridge.js` | Discord 무멘션 followup → 직전 등록 봇으로 자동 mention relay |
| `voice-config.json` | 등록된 봇 목록 (key, discordUserId, voiceId, color 등) |
| `cron.db` | 크론 잡 SQLite |
| `migrate-*.js` | 마이그레이션 스크립트 |
| `start.sh` | 수동 기동 (launchd 없이) |

## Discord 다리

자세한 흐름·env vars·분리 이유는 [../docs/discord-bridges.md](../docs/discord-bridges.md)
참조.

## 재기동

```sh
launchctl kickstart -k gui/$(id -u)/com.bbtodo.usage-server
tail -f /tmp/usage-server.log
```
