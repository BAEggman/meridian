# 경락 허브 시험 학습 엔진

`exam-engine.js`는 DOM, 저장소, 네트워크, 외부 라이브러리에 의존하지 않는 계산 모듈이다. 브라우저에서는 `window.MeridianExamEngine`, Node에서는 `require('./exam-engine.js')`로 사용한다. 실제 저장과 화면 처리는 앱이 담당한다.

## 무엇을 측정하는가

- **처음 본 항목(seen)**: 실제 응답을 했거나 기존 학습 기록에서 노출 여부를 가져온 항목이다. 암기 완료를 뜻하지 않는다.
- **숙련(mastered)**: 마지막 실패 이후 **서로 다른 3개 날짜에서 2 또는 3점으로 성공했다고 기록한 항목**이다. 날짜가 연속될 필요는 없지만, 같은 날 여러 번 맞힌 것은 성공일 하나로 센다.
- **실패(lapse)**: 0점 또는 1점. 해당 항목을 당일 재확인 대상으로 두고 현재 성공일 누적을 초기화한다. 과거의 누적 정답 수는 지우지 않는다.
- **확인 대기**: `needsVerification: true`인 출처 충돌 항목. 원문과 기존 기록을 보존하되, 일반 학습 큐와 숙련 분모에 넣지 않는다.

숙련은 자가 채점·연결 퀴즈 기록에 따른 **학습 관리 지표**다. 독립적인 지식 검증, 시험 합격, 전 범위의 완전한 암기를 보장하지 않는다. 객관식 `evidence: 'choice'`와 회상 `evidence: 'recall'`의 성공은 현재 같은 날짜 규칙을 적용하며 증거 유형을 따로 남긴다.

## 기본 설정과 날짜

```js
{
  examDate: '2027-01-01',
  dailyMinutes: 60,
  reserveDays: 14
}
```

날짜 키는 엄격한 `YYYY-MM-DD`이고, 실제 시각을 날짜로 변환할 때는 KST(UTC+09:00)를 사용한다. 실행 컴퓨터의 현지 시간대에 의존하지 않는다. 윤년, 월말, 연말을 검증하며 `2026-02-31` 같은 날짜는 허용하지 않는다.

`daysRemaining`은 통상적인 D-day 차이로, 시험 당일은 0이다. 마지막 필수 학습일(`lastStudyDay`)은 시험 전날이다. `calendarDaysAvailable`은 오늘부터 그 마지막 학습일까지의 일수다. 신규 학습일 수는 다음과 같다.

```text
coverageDays = max(시험일까지의 날짜 차이 - reserveDays, 1)
coverageDeadline = examDate - reserveDays - 1
newTarget = max(오늘 이미 처음 본 수,
                ceil((아직 보지 않은 수 + 오늘 이미 처음 본 수) / coverageDays))
```

2026-11-02 시작, 2027-01-01 시험, 마무리 14일이면 첫 회독 기간은 46일이고 첫 회독 목표일은 2026-12-17이다. 11월 3일 시작이면 45일이다. 마무리 창은 **2026-12-18~2026-12-31의 14일**이며 첫 회독 마지막 날과 겹치지 않는다. 마무리 기간 0일이면 첫 회독 마감은 시험 전날이다. 필수 마지막 확인을 시험 당일로 배정하지 않는다.

오늘 학습하면서 `unseen`이 줄어도 `newCompletedToday`가 그만큼 늘기 때문에 오늘의 신규 목표는 줄어들지 않는다. 날짜가 바뀌면 남은 양과 남은 날짜로 다시 계산한다. 쉰 날의 분량을 임의로 삭제하거나 별도의 벌점으로 더하지 않는다. 시험 당일과 시험 이후에도 분모가 0이 되지 않는다. 그때는 `studyDeadlinePassed: true`, 필수 잔량 `requiredRemaining: 0`, 남은 신규 필수 할당 `newRemaining: 0`으로 전환한다. 남은 미숙련은 그대로 표시하며 날짜 재설정 또는 선택 복습을 할 수 있다.

## 하루 목표와 복습

`today` 학습은 날짜가 지난 복습부터 처리한 뒤 오늘의 신규 할당을 제시한다. 신규 항목은 남아 있는 과목을 번갈아 선택하되 과목 내부의 원문 순서는 유지한다. 이미 오늘 공부한 신규 항목의 과목 수를 고려하므로 세트를 나눠 시작해도 계속 균형 있게 이어진다.

기본 세트 크기 12는 한 번에 제시하는 양일 뿐 하루 분량의 상한이 아니다. 2분 복귀 모드나 짧은 시간 예산을 선택해도 시험일까지 필요한 신규 목표 자체를 줄이지 않는다. 필요한 시간이 설정 예산보다 길면 부족분을 표시한다.

오늘 처음 본 항목을 틀리면 `newCompletedToday`에는 한 번만 포함되며, 동시에 `dueCount`와 `newRetryCount`에 남는다. 다시 성공하기 전까지 하루 완료량에는 포함되지 않는다. 여러 번 답해도 하루 완료는 고유 항목으로 센다.

### 간격

현재 성공일이 늘어날 때 기본 간격은 **1, 3, 7, 14, 30일**이다. 같은 날의 재정답은 다음 단계로 넘어가지 않는다. 실패하면 오늘 다시 보도록 한다. 이 간격과 3일 성공 기준은 제품의 운영 규칙이며, 경락 학습에서 검증된 최적 알고리즘이라는 의미는 아니다.

반전 학습에서는 실패한 항목의 **다음날 재검사**를 추가로 관리한다. 당일 교정은 이 예약이나 실패 근거를 없애지 않는다. 정규 복습과 재검사 날짜가 겹치면 문항 ID의 합집합으로 한 번만 제시한다. 날짜를 넘긴 첫 무힌트 회상 성공에서만 회복으로 기록하고, 힌트·선택형 성공이나 같은 날 재시도는 이 지표와 구분한다. 기존 숙련 기록은 보존하며 새 지표를 과거 기록에서 역추정하지 않는다. 자세한 API와 측정 범위는 [reversal-protocol.md](reversal-protocol.md)를 참고한다.

장기 간격이 시험 전날을 넘으면 카드 ID에 따른 안정적인 배분으로 마지막 복습 기간에 배치한다. 자연 간격이 정확히 시험일인 경우도 최종 확인이 미완료라면 시험 전날 이전으로 당긴다. 모든 카드를 시험일 하루로 밀어 넣지 않는다. 마지막 기간에 3일 성공 상태로 다시 확인한 카드는 해당 시험의 마지막 확인을 마친 것으로 표시하고, 이후 정상 간격이 시험일을 넘으면 선택 복습 일정으로 그대로 둔다. 다시 틀리면 이 표시를 해제한다. 마지막 학습일에 처음 접한 카드처럼 남은 날짜가 부족한 경우 숙련을 임의로 올리지 않는다. 시험 당일 성공한 카드는 다음 날 이후로 넘어가므로 당일 무한 반복이 생기지 않는다.

## API

모든 함수는 입력 상태를 변경하지 않는다. `createState`, `normalizeState`, `review`는 새 상태 객체를 반환한다. `buildSession`과 계획의 카드 배열은 카탈로그 원본 카드 객체를 참조하므로 호출자가 카드를 수정하지 않아야 한다.

카탈로그는 아래 배열 또는 `{ cards: [...], topics: [...] }` 객체 모두 가능하다. 같은 ID가 여러 번 있으면 첫 카드만 사용한다.

```js
{
  id, topic, prompt, answer, detail, tool, sourceId, kind,
  needsVerification: false // 선택 필드
}
```

### `createState(today?)`

버전 1 빈 상태를 만든다. 날짜를 생략하면 현재 KST 날짜를 사용한다.

### `normalizeState(raw, catalog, today?)`

누락 필드를 채우고 날짜·숫자를 검증한다. 기존에 알 수 없는 필드와 카탈로그에서 사라진 ID의 기록도 보존한다. 새 카탈로그에 등장한 모든 미학습 카드를 미리 상태에 생성하지는 않는다.

기존 화면의 학습 진도는 아래 최소 형태로 가져올 수 있다.

```js
state.records[cardId] = {
  seen: true,
  imported: true,
  due: today,
  successDays: []
};
state = E.normalizeState(state, catalog, today);
```

이 기록은 노출 사실만 인정한다. 성공일이나 숙련을 임의로 만들어 주지 않는다. 잘못된 원시 기록은 `_recovery`, 잘못된 개별 필드는 `record.invalidFields`, 잘못된 성공일은 `invalidSuccessDays`에 보존한다. 유효하지 않은 시험일은 기본 시험일로 돌아가며 원래 값도 `_recovery.settings`에 남긴다.

### `getPlan(catalog, state, today?)`

| 필드 | 의미 |
| --- | --- |
| `today`, `examDate` | 기준 날짜, 목표 날짜 |
| `lastStudyDay`, `studyDeadlinePassed` | 마지막 필수 학습일(시험 전날), 그 날짜를 지났는지 |
| `daysUntilExam` | 시험일까지의 부호 있는 날짜 차이 |
| `daysRemaining` | `max(daysUntilExam, 0)` |
| `calendarDaysAvailable` | 오늘부터 시험 전날까지 남은 학습 일수 |
| `coverageDays`, `coverageDeadline` | 신규 학습 분모, 첫 회독 목표일 |
| `reserveDays`, `inReserve`, `phase` | 마무리 기간 설정 및 현재 단계. 단계는 `coverage`, `reserve`, `after-exam`이며 시험 당일부터 마지막 단계 |
| `deadlinePassed`, `examIsToday` | 시험일 관련 상태 |
| `catalogTotal` | 확인 대기 항목을 포함한 고유 카탈로그 크기 |
| `verificationPending` | 일반 학습에서 제외한 확인 대기 항목 수 |
| `total`, `unseen` | 학습 가능한 항목 수, 그중 미학습 수 |
| `newTarget` | 오늘의 신규 전체 목표. 이미 한 분량 포함 |
| `newCompletedToday` | 오늘 실제 처음 본 고유 항목 수. 정답·숙련 수가 아님 |
| `newSuccessfulToday` | 오늘 새로 본 뒤 현재 재확인이 남지 않은 항목 수 |
| `newRemaining` | 오늘 아직 처음 보지 않은 신규 할당 |
| `dueCount`, `reviewRemaining` | 현재 남은 복습·재시도 항목 수. 신규 오답도 포함 |
| `dueTarget` | 오늘 기존 학습 항목 중 복습 할당을 받은 고유 항목 수. 완료분 포함 |
| `dueCompletedToday` | 위 할당에서 오늘 성공하고 현재 재시도가 남지 않은 수 |
| `overdueCount` | 복습 날짜가 오늘보다 이전인 남은 수 |
| `newRetryCount` | 오늘 처음 본 항목 중 아직 오답·힌트 상태인 수 |
| `totalTarget` | `dueTarget + newTarget` |
| `totalCompletedToday` | 오늘 목표 중 현재 성공 처리된 고유 항목 수. `totalTarget`을 넘지 않음 |
| `totalRemaining` | `dueCount + newRemaining` |
| `requiredRemaining` | 기한 전에는 `totalRemaining`, 시험 당일부터는 0 |
| `optionalReviewCount` | 시험 당일 이후 선택 복습으로 남는 `dueCount`; 그전에는 0 |
| `dueCards`, `newCards` | 복습 순서와 과목 교차 신규 할당 카드 배열 |
| `estimatedSecondsPerCard` | 시간 추정에 사용한 초/항목 |
| `estimateSampleCount`, `estimatePriorWeight` | 실측 응답 수, 보수적인 초기 추정의 가중치(20) |
| `estimateHasTimingData` | 실제 시간 기록을 사용했는지 여부 |
| `estimatedMinutes` | **오늘 전체 목표**의 예상 분. 완료분 포함 |
| `remainingMinutes` | **현재 남은 목표**의 예상 분 |
| `capacityMinutes`, `capacityCards` | 설정 예산, 추정 속도로 그 예산에 가능한 항목 수 |
| `capacityShortfall` | 오늘 전체 목표가 예산을 초과하는지 |
| `shortfallMinutes`, `capacityShortfallPercent` | 예산 초과 분, 예산 대비 초과 비율(%) |
| `clockAffectedCards` | 미래 날짜 오류를 감지해 격리한 이력이 있는 항목 수 |

사용 예:

```js
const p = E.getPlan(CATALOG, state, E.localDay());
// “오늘 남은 학습 예상시간”은 p.remainingMinutes 사용.
// “오늘 목표 / 가용 시간 비교”는 p.estimatedMinutes와 p.capacityMinutes 사용.
```

### `buildSession(catalog, state, options)`

```js
E.buildSession(CATALOG, state, {
  mode: 'today', // today | weak | mock | topic
  topic: 'routes',
  limit: 12,
  today: '2026-11-02',
  seed: 123 // mock에서 선택. 같은 값은 같은 순서, 생략 시 날짜 기준
});
```

- `today`: 남은 복습을 먼저, 남은 신규 할당을 뒤에 둔다. 오늘 할당이 끝나면 빈 배열이다.
- `weak`: 이미 공부한 항목 가운데 성공일이 3일 미만이거나 최근 실패한 항목. 미학습 전체를 약점으로 부르지 않는다.
- `mock`: 과목을 교차해 섞은 회상 세트. `seed` 또는 `nonce`를 바꾸면 같은 날에도 다른 세트를 만들 수 있다.
- `topic`: 해당 과목에서 복습 예정, 미학습, 기타 학습 항목 순으로 구성한다.

모든 모드에서 중복 ID와 `needsVerification` 카드는 제외한다. `limit: 0`은 빈 배열이다. 다른 모드 이름은 `RangeError`다.

### `review(state, cardId, grade, options)`

```js
state = E.review(state, card.id, 2, {
  today: E.localDay(),
  now: Date.now(),
  seconds: 42,
  evidence: 'recall'
});
```

점수는 정수 0~3이며, 2·3은 성공, 0·1은 실패다. 유효하지 않은 점수는 `RangeError`다. `seconds`를 생략하면 0으로 기록하며 모르는 시간을 만들어 내지 않는다. `now`는 보조 시각 기록이고 날짜 판정은 검증된 `today`를 따른다. 둘이 다르면 경고를 남긴다.

새 상태의 `lastReview`:

```js
{
  cardId, grade, today, isFirstSeen, passed,
  mastered, successDayCount, due, warnings: []
}
```

`review`에는 카탈로그를 전달하지 않으므로 ID의 출처 충돌 여부를 자체 검사할 수 없다. 일반 세트는 엔진이 이미 제외하고, 외부 퀴즈 연결부도 확인 대기 카드를 전달하지 않아야 한다.

### `forecast(catalog, state, { today, days: 14 })`

향후 부담을 예측하는 가벼운 시뮬레이션이다. 기본 14일, 최대 366일이며 **시험 전날까지로 자동 제한**한다. 시험 당일부터는 빈 예측을 반환한다. 상태를 복제한 작은 일정 배열만 사용하며 매 응답마다 `review()`를 호출하는 무거운 전체 상태 시뮬레이션을 하지 않는다. 입력 상태를 바꾸거나 실제 진도를 올리지 않는다.

```js
{
  days: [{ day, new, review, total, minutes, seenAfter, masteredAfter }],
  assumption: 'all-first-attempt-correct',
  todayIsRemainingOnly: true,
  estimatedSecondsPerCard,
  estimateHasTimingData,
  capacityMinutes,
  totalMinutes,
  averageMinutes,
  peakMinutes,
  peakDay,
  overCapacityDays
}
```

**가정: 매일 할당을 끝내고, 앞으로 모든 예정 항목을 첫 시도에 성공한다.** 첫 행은 오늘 이미 완료한 일을 뺀 남은 양이고, 이후 행은 각 날짜의 전체 할당이다. 설정 시간 예산으로 잘라서 미학습 분량을 숨기지 않는다. 오답 재시도, 긴 원문 학습, 설명을 읽는 추가 시간 등은 늘어날 수 있다. 예측된 `masteredAfter`를 실제 숙련으로 저장하거나 실제 완료처럼 표시해서는 안 된다.

### `summary(catalog, state, today?)`

주요 필드:

| 묶음 | 필드 |
| --- | --- |
| 범위 | `catalogTotal`, `verificationPending`, `total` |
| 진도 | `seen`, `unseen`, `mastered`, `learning`, `coveragePercent`, `masteryPercent` |
| 재학습 | `dueToday`/`dueCount`, `overdue`, `weak` |
| 오늘 | `newToday`, `reviewsToday`, `uniqueReviewedToday`, `correctToday`, `studySecondsToday`, `studyMinutesToday` |
| 누적 | `totalReviews`, `cumulativeCorrect`, `totalLapses`, `recallSuccessRate`, `totalStudyMinutes` |
| 활동 | `activeDays`, `recentActiveDays`, `recentDays` |
| 과목 | `topics: [{ id, title, label, name, total, seen, mastered, due, weak }]` |
| 날짜 오류 | `clockAffectedCards` |

`recallSuccessRate`는 전체 응답 중 2·3점 비율(0~100)이며 응답이 없으면 `null`이다. `coveragePercent`는 처음 본 비율, `masteryPercent`는 3일 성공 기준 비율이다. 최근 활동은 7일의 `{ day, reviews, minutes, active }` 배열이다. 접속만으로는 활동이 증가하지 않는다. `reviewsToday`는 재시도 포함 응답 수이고 `uniqueReviewedToday`와 구분한다.

### 날짜 도우미

```js
E.localDay(dateOrTimestamp?) // KST YYYY-MM-DD, 잘못된 값은 null
E.isValidDay('2027-01-01')   // true
E.dayDiff(from, to)         // to - from 일수. 잘못된 날짜는 NaN
E.addDays(day, amount)      // YYYY-MM-DD, 잘못된 값은 null
```

## 상태 구조

```js
{
  version: 1,
  settings: { examDate, dailyMinutes, reserveDays },
  records: { [cardId]: record },
  days: { [day]: dayStats },
  createdDay,
  lastActiveDay,
  lastReview
}
```

기본 `record`:

```js
{
  seen: false,
  imported: false,
  firstSeen: null,
  lastReviewed: null,
  lastReviewedAt: null,
  due: null,
  lastGrade: null,
  attempts: 0,
  correct: 0,
  lapses: 0,
  seconds: 0,
  timedAttempts: 0,
  successDays: [],
  stage: 0,
  mastered: false,
  examReviewedFor: null,
  lastEvidence: null,
  historyBase: null,
  history: []
}
```

`successDays`는 마지막 실패 이후의 성공일이다. `correct`는 실패로 지워지지 않는 누적 성공 응답 수다. `stage`와 `mastered`는 날짜에서 재계산하므로 외부에서 `mastered: true`만 저장해도 숙련이 되지 않는다.

`history`는 `{ day, grade, due, at, seconds, examReviewedFor }`의 최소 이벤트 목록이다. `historyBase`는 구버전 기록을 처음 이벤트 방식으로 갱신했을 때의 기준 상태다.

하루 기록:

```js
{
  reviews: 0,
  correct: 0,
  lapses: 0,
  seconds: 0,
  timedReviews: 0,
  reviewedIds: [], // 실제 응답한 고유 카드
  newIds: [],      // 처음 본 고유 카드
  dueIds: []       // 기존 학습 카드 중 오늘 복습 대상으로 응답한 고유 카드
}
```

배열은 중복 없이 유지한다. 하루가 빠져도 과거 날짜의 기록과 누적 진도를 지우지 않는다.

### 잘못된 미래 시계

기준 날짜보다 미래인 성공일·리뷰 이벤트는 현재 숙련에 사용하지 않는다. 날짜 오류를 발견하면 `quarantinedSuccessDays`, `quarantinedHistory`, `quarantinedLastReviewed`, `_recovery.futureDays`에 원본을 보존한다. 미래의 실패가 정상적인 과거 성공 기록을 지운 경우, 이벤트 기록에서 과거의 점수·복습일·성공일을 복원한다. 날짜가 나중에 해당 미래 날짜에 도달해도 격리된 잘못된 실패를 자동으로 다시 적용하지 않는다.

이전 버전처럼 이벤트 이력이 없는 자료는 실제 과거 점수를 추측해서 복원하지 않는다. 유효한 과거 성공일은 남기되 확인 가능한 근거가 없는 점수·다음 날짜를 보수적으로 처리한다. 인터넷 시계에 접속하지 않는 모듈이므로 기기와 사용자가 제공한 기준 날짜 자체가 틀린지 항상 판별할 수는 없다.

## 시간 추정과 실제 카탈로그 예시

시간 기록이 없으면 1항목당 45초를 사용한다. 기록이 생기면 **45초인 응답 20개에 해당하는 초기 가중치**와 실측을 함께 계산한다.

```text
추정 초/항목 = (실측 초 합계 + 20 × 45) / (실측 응답 수 + 20)
```

17초짜리 짧은 답변 한 번으로는 43.7초가 되어 긴 원문을 포함한 전체 예측이 갑자기 17초 기준으로 떨어지지 않는다. 실측이 쌓이면 실제 속도의 비중이 커진다. 계획값은 15~180초 범위로 제한한다. 실제 저장된 학습 시간 자체를 이 범위로 바꾸지는 않는다. 퀴즈 연결에서 `seconds: 0`인 응답은 시간 평균의 분모에 넣지 않는다. 과목별 속도를 별도로 추정하지 않으므로 여전히 모델의 한계가 있다.

2026-11-02, 신규 기록 없음, 현재 카탈로그 **1,201개 중 확인 대기 3개를 제외한 1,198개**, 45초 기준 예측:

| 구간 | 계산 결과 |
| --- | --- |
| 첫날 | 신규 26개, 약 20분 |
| 첫 14일 | 하루 평균 56분, 가장 많은 날 78분, 60분 초과 3일 |
| 시험 전날까지 60일 | 총 약 78.3시간, 하루 평균 약 78.3분 |
| 가장 많은 날 | 약 124분(2026-12-18) |
| 60분 예산 초과 | 60일 중 46일 |
| 마지막 필수 학습일 | 2026-12-31, 약 64분의 복습 |

이는 `forecast()`가 **모든 첫 시도 성공**을 가정해 계산한 해당 시점의 모델 출력이다. 실제 필요한 공부 시간의 보장이나 연구 결과가 아니다. 과목·원문의 길이, 오답, 사용 속도에 따라 달라지며 카탈로그가 변경되면 다시 계산해야 한다. 첫날 20분을 전체 기간의 매일 소요시간으로 안내하면 안 된다.

## 근거와 운영 규칙의 구분

회상 연습과 간격을 둔 재학습 자체에는 학습 연구의 근거가 있다. 이 앱의 3일 기준, 1·3·7·14·30일 간격, 45초 추정, 마지막 기간 분산은 여기서 채택한 운영 설계다.

- Roediger & Karpicke (2006), *Test-Enhanced Learning*: <https://doi.org/10.1111/j.1467-9280.2006.01693.x>
- Cepeda et al. (2008), *Spacing Effects in Learning*: <https://doi.org/10.1111/j.1467-9280.2008.02209.x>
- Lally et al. (2010), *How are habits formed*: <https://doi.org/10.1002/ejsp.674>

## 검증

```bash
node tests/exam-engine.test.cjs
```

23개 검증은 KST 경계·윤년·연말, 하루 중 목표 안정성, 결석 후 재계산, 작은 시간 예산과 목표의 분리, 서로 다른 날짜의 숙련, 실패·복귀, 당일 오답 재시도, 고유 완료량, 기한 경계, 마지막 복습 분산과 시험 전날 마감, 구버전·오류 자료 보존, 미래 실패의 과거 상태 복원, 확인 대기 제외, 안정적인 큐·과목 교차·모의 세트 seed, 예측과 실제 전체 성공 세션의 일치, 적은 시간 표본의 과도한 일반화 방지, 시간·숙련 지표, 불변성과 JSON 저장 복원을 다룬다.
