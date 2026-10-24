# Метрики и формулы

Формулы считаются на сервере (`src/lib/`), клиент только отображает.
Источники — в конце файла. Пороги правил настраиваются в `/admin/rules`.

## Анкеты

- Утренняя: 6 шкал 1–10 (сон, восстановление, усталость, мышцы, стресс, настроение).
- Вечерняя (после тренировки): 3 шкалы 1–10 + **sRPE-поля** (см. ниже, за флагом `srpe`).
- Балл анкеты 0–100: нормализация `(v−1)/9`; веса — сон .20, восстановление .25,
  усталость .20, мышцы .15, стресс .10, настроение .10.
- Балл дня = 0.7 × утренняя + 0.3 × вечерняя.

## Нагрузка (sRPE, Foster) — флаг `srpe`

- Вечерняя анкета собирает `session_rpe` (CR-10, 0–10 с вербальными якорями) и
  `session_minutes` (по умолчанию — план из расписания группы).
- `training_sessions.session_load` = `session_rpe × duration_minutes` (generated column).
- `daily_load` = Σ session_load за локальный день спортсмена. День без тренировки
  по расписанию — 0 («отдых»); день по расписанию без данных — `hasData=false`
  («нет данных»).
- Дозаполнение: вчерашнюю тренировку можно заполнить до конца следующего дня;
  анкета привязывается к дате сессии, а не ко времени отправки.

### ACWR (EWMA, Williams et al. 2017)

- `acute` = EWMA(daily_load, λ=2/8) — ~7-дневное окно.
- `chronic` = EWMA(daily_load, λ=2/29) — ~28-дневное окно.
- EWMA инициализируется первым наблюдением (steady state читается сразу).
- `ACWR = acute / chronic`; показывается при ≥21 дне истории и chronic ≥ 1.

### Монотонность и strain (Foster)

- `monotony` = mean(daily_load за 7 дн.) / population-SD; null при SD≈0.
- `strain` = сумма недели × monotony.

### План против факта

- Расписание группы хранит `planned_minutes` и `planned_rpe` →
  `planned_load` = их произведение (суммируется при нескольких слотах в день).

## Новые правила алертов

| Код | Параметры (default) | Условие |
|---|---|---|
| `acwr_high` | threshold 1.5, min_days 21 | ACWR > порога |
| `acwr_low` | threshold 0.8, min_days 28 | ACWR < порога (информационный) |
| `monotony_high` | threshold 2.0 | монотонность 7 дней > порога |
| `plan_deviation` | ratio 1.25, sessions 3 | факт > план × ratio — N дней подряд |

## Фиче-флаги

`feature_flags` (key, enabled, group_ids): `enabled` + пустой `group_ids` =
включено для всех; непустой список = только спортсмены этих групп.
Управление — `/admin/features`.

## Источники

- Foster C. et al. — session-RPE: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5673663/
- Williams S. et al. (2017), BJSM — EWMA-ACWR
- Soligard T. et al. (2016), BJSM — консенсус МОК по нагрузке:
  https://bjsm.bmj.com/content/50/17/1030
