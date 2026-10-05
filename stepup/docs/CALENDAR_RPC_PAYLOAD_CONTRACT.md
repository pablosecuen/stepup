# Contrato de payloads TypeScript ↔ SQL de los RPC de Calendario

Auditado el 2026-10-04 (hallazgo "Series vs. Calendario"). Frontera: `ctx.supabase.rpc(<función>, { p_payload })`.

## Regla general

- Dentro de un `p_payload`, **toda clave es snake_case**, incluidas las de objetos anidados (`original_patch.end_date`, cada elemento de `freeze_occurrences`, cada `participants[]`).
- Las fechas civiles viajan como texto `YYYY-MM-DD` (`effective_date`, `start_date`, `end_date`, `successor_start_date`, `successor_end_date`, `original_patch.end_date`); los instantes como ISO con zona (`start_at`, `end_at`).
- **Única excepción**: el contenido de `weeks` es el jsonb del motor de recurrencias y se guarda **tal cual** (`weekIndex`, `sessions[].weekday | hour | minute | durationMinutes`: camelCase por diseño). Ninguna función SQL lo lee con `->>`.
- Los objetos de **dominio** TypeScript (camelCase, p. ej. el plan de `planRecurrenceSplit`: `{ status, endDate }`) **nunca** cruzan la frontera tal cual: se arman con un constructor de payload (`buildSplitRpcPayload`, `buildParticipantFreezePayload`, `recurrenceSeriesInputToPayload`).
- El SQL lee con `->>'clave'`: una clave mal escrita **no falla**, llega como `NULL`. Por eso hay un test de contrato (`lib/calendar/__tests__/split-rpc-contract.test.ts`) que compara las claves del payload real con las que lee la **versión vigente** (última migración que la define) de cada función.

## `split_recurrence_this_and_future` (versión vigente: `20261004120000_split_original_patch_end_date_contract.sql`)

| Clave del payload | Tipo | Constructor TS | Lectura SQL |
|---|---|---|---|
| `original_recurrence_id` | uuid | `buildSplitRpcPayload` | `->>'original_recurrence_id'` |
| `effective_date` | date | idem | `->>'effective_date'` |
| `original_patch` | objeto | idem | `->'original_patch'` |
| `original_patch.status` | `active` \| `ended` | idem | `->>'status'` (obligatorio, validado) |
| `original_patch.end_date` | date \| null | idem | `->>'end_date'` — **canónica**. Obligatoria si `status = active`, anterior a `effective_date` y no anterior al inicio de la original |
| `original_patch.endDate` | — | **ya no se envía** | `->>'endDate'` — aceptada **temporalmente** (clientes anteriores); si llegan las dos gana `end_date` |
| `successor_id` | uuid | idem | `->>'successor_id'` |
| `successor_start_date` / `successor_end_date` | date / date \| null | idem | `->>'successor_start_date'`, `->>'successor_end_date'` |
| `rule_type`, `cycle_length_weeks`, `modality`, `class_title`, `activity_kind` | texto / número | idem | `->>` homónimos |
| `weeks` | jsonb del motor (camelCase interno) | idem | `->'weeks'` (se guarda sin leer sus claves) |
| `participant_ids` | uuid[] | idem | `jsonb_array_elements_text(p_payload->'participant_ids')` |
| `primary_student_id` | uuid | idem | `->>'primary_student_id'` (explícito, debe estar en `participant_ids`) |
| `excluded_occurrence_keys` | texto[] | idem | `jsonb_array_elements_text(...)` |

**Defecto corregido (2026-10-04):** hasta esa fecha el cliente enviaba `original_patch: { status, endDate }` y el SQL leía `end_date` desde la primera migración (`20260920130000`), así que la serie original quedaba siempre `active` y sin fin, generando ocurrencias en paralelo a la sucesora. El plan TypeScript tenía test (camelCase); el contrato con el RPC no.

## `apply_recurrence_participants_from_date` (vigente: `20261001140000`)

`p_payload`: `rule_id`, `new_participant_ids`, `primary_student_id`, `freeze_occurrences[]`.
Cada elemento de `freeze_occurrences` (`buildParticipantFreezePayload`): `occurrence_key`, `recurrence_index`, `start_at`, `end_at`, `primary_student_id`, `student_name`, `level`, `lesson_type`, `modality`, `class_title`, `activity_kind`, `color`, `participants[]`.
Cada `participants[]`: `student_id`, `student_name`, `level`. **Todo snake_case; coincide con lo que lee el SQL.**

## `create_recurrence_series` (vigente: `20261001150000`)

`operation_id`, `primary_student_id`, `rule_type`, `cycle_length_weeks`, `weeks`, `modality`, `timezone`, `start_date`, `end_date`, `class_title`, `activity_kind`, `participant_ids` — `recurrenceSeriesInputToPayload`, todo snake_case; coincide con el SQL.

## No cubierto por el test automático (auditado a mano)

`archive_student_and_prune_future` arma sus propios `freeze_occurrences` en `lib/repositories/students.ts` (`buildFreezePayload`): mismas claves snake_case que `apply_recurrence_participants_from_date`, verificadas por lectura; pendiente extraerlo a un constructor puro para sumarlo al test de contrato.

## Cómo agregar un RPC nuevo

1. Armar el payload con una función pura exportada (nunca un literal con objetos de dominio dentro).
2. Sumar su función SQL y su constructor al test de contrato.
3. Si cambia una clave, la migración debe aceptar la clave vieja temporalmente (`coalesce(nuevo, viejo)`) y fallar con `22023` si el dato obligatorio no puede determinarse.
