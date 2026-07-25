# Project-scoped Today Queue contract

## 목적

Home의 각 프로젝트에서 그 프로젝트의 AI Today task만 실행·정지한다.

- 같은 프로젝트 안에서는 항상 한 번에 한 task만 순차 실행한다.
- 서로 다른 프로젝트는 동시에 실행할 수 있다.
- 프로젝트 A의 완료 이벤트가 프로젝트 B의 task를 가져가면 안 된다.
- `done`은 사용자가 승인하는 상태다. Queue는 결과 marker를 받으면 `review`까지만 변경한다.

## 대상 item

Queue 대상은 아래 조건을 모두 만족하는 item이다.

```text
project.status = active
item.is_today = 1
item.owner = AI
item.status IN (todo, in_progress, review)
```

- dispatch 대상은 `todo`뿐이다.
- `in_progress`는 해당 프로젝트의 현재 실행 task다. 프로젝트당 최대 1개다.
- `review`는 완료 수치에는 포함하지만 다시 dispatch하지 않는다.
- 프로젝트별 순서는 root item → category 순서 → item 순서 → id 순으로 기존 정렬 규칙을 유지한다.

## 상태 모델

```json
{
  "project_id": 7,
  "project_name": "할일빵빵",
  "project_emoji": "🤖",
  "has_discord_target": true,
  "running": true,
  "counts": {
    "todo": 2,
    "in_progress": 1,
    "review": 3,
    "total": 6
  },
  "active": [],
  "next": null,
  "items": []
}
```

규칙:

- `running`은 그 프로젝트에 `in_progress`가 있을 때만 `true`다.
- `active`는 배열 형식을 유지하지만 길이는 0 또는 1이다.
- `next`는 같은 프로젝트 안의 첫 `todo` item이다.
- `total`은 `todo + in_progress + review`다.
- 대상 item이 없는 프로젝트는 전체 status의 `projects`에서 생략할 수 있다. 앱은 누락된 프로젝트를 zero state로 취급한다.

## API

### 상태 조회

```http
GET /api/today-queue/status
GET /api/today-queue/status?project_id=7
```

전체 응답은 기존 top-level aggregate를 유지하고 프로젝트별 상태를 `projects`에 추가한다.

```json
{
  "running": true,
  "counts": {},
  "active": [],
  "next": null,
  "items": [],
  "projects": []
}
```

- query가 없으면 모든 대상 프로젝트를 반환한다.
- `project_id`가 있으면 같은 envelope를 유지하되 해당 프로젝트만 `projects`에 포함한다.
- 기존 top-level 필드는 구버전 앱 호환용 aggregate다. 새 Home은 `projects[].project_id`를 key로 사용한다.

### 시작

```http
POST /api/today-queue/start
Content-Type: application/json

{
  "project_id": 7,
  "bot_key": "bbangbbang"
}
```

- 해당 프로젝트의 첫 `todo` item만 dispatch한다.
- 같은 프로젝트에 active 또는 start mutation이 있으면 새 dispatch를 만들지 않는다.
- 다른 프로젝트의 active task는 시작을 막지 않는다.
- `bot_key`가 없으면 해당 프로젝트의 `default_ai_bot_key`를 사용한다.

### 다음 task

```http
POST /api/today-queue/next
Content-Type: application/json

{
  "project_id": 7
}
```

- 외부 버튼보다 완료 listener의 연속 실행용이다.
- 완료된 item에서 읽은 `project_id`를 그대로 전달한다.
- 전체 Queue의 첫 item을 다시 검색하지 않는다.

### 정지

```http
POST /api/today-queue/stop
Content-Type: application/json

{
  "project_id": 7
}
```

- 해당 프로젝트의 `in_progress`만 `todo`로 되돌린다.
- `dispatch_nonce`와 `dispatch_started_at`을 지워 늦게 도착한 이전 marker를 무효화한다.
- 다른 프로젝트의 active task에는 영향을 주지 않는다.
- 이미 정지된 프로젝트에 다시 호출해도 성공하며 `stopped=0`이다.

### action 응답

start, next, stop은 같은 기본 형태를 사용한다.

```json
{
  "project_id": 7,
  "started": false,
  "stopped": 0,
  "reason": "already_running",
  "dispatch": null,
  "item": null,
  "error": null,
  "status": {}
}
```

`status`는 해당 프로젝트의 최신 상태다. Domain 결과는 HTTP 200으로 반환하고 입력 오류는 HTTP 오류로 구분한다.

- `400 missing_project_id`: migration 종료 후 `project_id` 누락
- `400 invalid_project_id`: 양의 정수가 아님
- `404 project_not_found`: 프로젝트 없음 또는 archived

## 결과 및 오류 규칙

| reason | 동작 |
|---|---|
| `dispatched` | 첫 item을 `in_progress`로 만들고 dispatch metadata를 저장한다. |
| `already_running` | 같은 프로젝트에 active task가 있어 아무것도 바꾸지 않는다. |
| `action_in_progress` | 같은 프로젝트의 start/stop mutation이 진행 중이다. 중복 전송하지 않고 상태를 재조회한다. |
| `empty` | 같은 프로젝트에 dispatch 가능한 `todo`가 없다. |
| `missing_discord_target` | 첫 `todo`를 유지하고 오류를 기록한다. 다음 item으로 건너뛰지 않는다. |
| `dispatch_failed` | 첫 `todo`를 유지하고 오류를 기록한다. Run 재시도 시 같은 item부터 다시 시도한다. |
| `stopped` | 해당 프로젝트 active를 `todo`로 되돌리고 이전 marker를 무효화한다. |

동시 요청은 project별 mutation lock 또는 동등한 atomic claim으로 직렬화한다. Discord 응답을 기다리는 동안 같은 프로젝트의 두 start가 같은 item을 중복 dispatch하면 안 된다.

## 완료 listener

1. 기존 규칙대로 bot author, `run_id`, `item_id`, `nonce`, channel, target bot, `git_commit`을 검증한다.
2. accepted item만 `in_progress → review`로 변경한다.
3. accepted item의 `project_id`로 `next`를 호출한다.
4. 다른 프로젝트의 active/next 상태는 읽거나 변경하지 않는다.
5. 중복·stale marker는 다음 task를 시작하지 않는다.

SSE의 모든 Queue 이벤트에는 `projectId`를 포함한다.

```json
{
  "action": "next-after-result",
  "projectId": 7,
  "previousItemId": 1094,
  "started": true,
  "reason": "dispatched",
  "itemId": 1095
}
```

## Home UI 소비 규칙

- 프로젝트 행은 `project_id`에 대응하는 상태만 읽는다.
- `running=true`면 Stop, `todo>0`이고 정지 상태면 Run을 표시한다.
- `todo=0`이고 running도 아니면 action 버튼을 숨긴다.
- 프로젝트 행 탭은 상세 이동을 유지하고 Run/Stop은 독립된 44pt hit target을 사용한다.
- 요청 중에는 해당 프로젝트 버튼만 loading/disabled 처리한다.
- 기존 Task 섹션의 전역 control은 제거하거나 읽기 전용 aggregate로 바꾼다.

## Migration

1. backend가 `project_id` contract와 `projects` status를 먼저 배포한다.
2. 전환 기간에는 `project_id` 없는 기존 start/stop을 legacy global 동작으로 허용하고 deprecation log를 남긴다.
3. bb-app이 프로젝트별 action으로 전환되면 전역 control을 제거한다.
4. 앱 전환 확인 후 mutating endpoint의 `project_id`를 필수로 만든다.

새 코드와 테스트는 처음부터 `project_id`를 반드시 전달한다.

## 완료 기준

- A를 시작해도 B item은 선택되지 않는다.
- A에서는 active가 최대 1개다.
- A와 B는 동시에 각 1개씩 실행할 수 있다.
- A 결과 marker는 A의 다음 item만 시작한다.
- A Stop은 B를 멈추지 않는다.
- empty, missing target, dispatch failure, duplicate marker가 자동 skip이나 중복 dispatch를 만들지 않는다.
