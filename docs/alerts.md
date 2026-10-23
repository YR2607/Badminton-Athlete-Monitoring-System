# Правила предупреждений

Файл: `src/lib/alerts.ts`. Срабатывание — в `src/lib/evaluate.ts` после каждой
отправки анкеты (и вручную через `reevaluateAthlete`). Правила хранятся в
`alert_rules` (code, severity, params, enabled, version) — параметры и
включённость настраивает админ на `/admin/rules`.

## Уровни

| severity | Значение |
|---|---|
| `normal` | обычное состояние (информационный уровень) |
| `attention` | обратить внимание |
| `review_load` | пересмотреть нагрузку |
| `priority` | приоритетное внимание — не маскируется высоким баллом готовности |

## Реестр правил (seed в 0003)

| code | severity | Условие | Действие |
|---|---|---|---|
| `acute_pain` | priority | сегодня: `acute_instability`, ИЛИ отёк, ИЛИ ограничение движения, ИЛИ боль ≥7 | не выполнять провоцирующие упражнения, медицинская оценка |
| `illness_symptoms` | priority | непустое поле symptoms сегодня | уточнить состояние до занятия |
| `joint_pain` | attention / review_load | joint_tendon/other; review_load если severity ≥5 | убрать провоцирующие движения, переоценка |
| `readiness_drop` | attention | score < baseline.avg − 1·sd ИЛИ падение ≥ 10 (нужен baseline) | обсудить восстановление |
| `sustained_decline` | review_load | все последние 3 дня ниже baseline | пересмотреть нагрузку |
| `repeated_fatigue` | attention | fatigue ≥ 7 три дня подряд (шкала 1–10) | проверить сон, лёгкий день |

Правила `load_spike` и `load_with_decline` отключены: параметры тренировок
(duration/RPE) больше не собираются, поэтому нагрузка не вычисляется. Строки
правил остаются в `alert_rules` с `enabled = false` (миграция 0006).
| `missing_morning` | attention | анкета не заполнена к 12:00 лок. (внешний джоб напоминаний) | информирование тренера |

## Изоляция медицинских сигналов

Правила боли/симптомов оцениваются независимо от балла готовности: высокий
score не отменяет `priority`. Тест `fires priority alert on acute pain even
with perfect readiness` фиксирует это поведение.

## Дедупликация и жизненный цикл

- `dedup_key = athlete_id:rule_code:YYYY-MM-DD`, уникальный индекс → повторная
  оценка не плодит дубликаты.
- Статусы: `open` → `acknowledged` → `resolved` | `dismissed` с
  `resolution_note`, `reviewed_by`, `reviewed_at`.
- Каждый alert хранит `evidence` (какие именно данные сработали) и
  `recommendation` — формулировки «сигнал для проверки», без диагнозов.
- Приоритетные alert → внутреннее уведомление всем тренерам
  (`notifications`, тоже дедуплицируется).
