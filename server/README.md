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

## relay-bridge 무한루프 긴급 중지

`relay-bridge`는 단독 프로세스가 아니라 `usage-server.js` 안에서 `voice-bridge`에
attach되어 돈다. 그래서 relay만 `pm2 stop relay-bridge`처럼 끌 수 없다.

릴레이가 무한루프를 만들면 `usage-server` launchd 서비스를 내려서 즉시 차단한다.

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.bbtodo.usage-server.plist
```

다시 켤 때:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bbtodo.usage-server.plist
tail -f /tmp/usage-server.log
```

주의: 이 명령은 `relay-bridge`뿐 아니라 Usage API, cron poller, `voice-bridge`도
같이 내린다. PID만 `kill`하면 `KeepAlive` 때문에 다시 살아날 수 있으니 긴급 차단
때는 launchd 서비스를 내린다.
