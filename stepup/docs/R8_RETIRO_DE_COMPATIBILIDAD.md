# R8 — Retiro de compatibilidad en desuso

Retira tres piezas que quedaron «en desuso, a retirar en una migración futura» y actualiza `supabase-js`. Parte de `bb50e6f` (R7 cerrado). Este documento está separado del resto a propósito. Fecha: 7/oct/2026 (la migración se llama `20261012100000…` para ordenar después de R6.1).

## 1. Resumen

| Pieza | Estado |
|---|---|
| `claim_student_creation()` | **Retirada** (`drop function`) |
| `create_student_via_web(uuid, jsonb, boolean)` | **Retirada** (`drop function`) |
| Compatibilidad `endDate` en `split_recurrence_this_and_future(jsonb)` | **Retirada**: el split lee sólo `original_patch.end_date` |
| `@supabase/supabase-js` | **2.116.0 → 2.117.3** (el rango `^2.116.0` ya lo permitía; sólo cambian los paquetes de Supabase del lockfile) |

No se tocó: la tabla `student_creation_claims` (la usa `create_student_with_operation`), sus índices ni sus disparadores de cuotas de R3; el alta nueva; ningún dato. **No hubo cambios de comportamiento visibles para la usuaria.**

## 2. Qué se verificó antes de retirar (dependencias)

| Verificación | Resultado |
|---|---|
| ¿La **web** llama a las dos funciones? | **No.** Ninguna llamada `rpc("claim_student_creation" …)` ni `rpc("create_student_via_web" …)` en `app/`, `lib/` ni `components/` (sólo había comentarios y nombres de pruebas; ahora hay una prueba que lo vigila). El alta usa `create_student_with_operation`. |
| ¿La **app móvil** las llama? | **No.** La app móvil sólo usa 8 RPC (`delete_own_account`, sesión activa y copias de seguridad en la nube); no llama a estas dos ni a `split_recurrence_this_and_future` (sus series son locales). |
| ¿Otra función de **Production** las referencia? | **No** (0 cuerpos de funciones con su nombre; 0 dependencias en `pg_depend`). |
| ¿Hay **filas** que dependan de ellas? | **No**: `student_creation_claims` está vacía (0 filas; ninguna sin `operation_id`). |
| ¿Se **llaman** hoy? | No hay estadística de llamadas (`track_functions = none`), pero la web que las usaba se reemplazó hace más de una semana (20261005160000) y ningún cliente vigente las invoca. |
| ¿La web envía `endDate` al split? | **No**: `buildSplitRpcPayload` sólo arma `original_patch: { status, end_date }` (con prueba de contrato). |
| ¿Se **corrompe** algo si un cliente viejo manda sólo `endDate`? | No: la función ya rechazaba (22023) una original `active` sin fecha de fin determinable **antes de escribir**; un cliente así recibe ese rechazo y no se escribe nada. |

## 3. La migración (`20261012100000_r8_retire_legacy_student_claims_and_enddate.sql`)

* `drop function if exists public.create_student_via_web(uuid, jsonb, boolean);` y `drop function if exists public.claim_student_creation();` (idempotente).
* `create or replace function public.split_recurrence_this_and_future(jsonb)` con el cuerpo vigente, igual salvo que `v_patch_end_date := nullif(v_original_patch->>'end_date', '')::date;` (antes `coalesce` con `endDate`). Mantiene **`security invoker`**, la misma firma y retorno, el **`search_path` vacío fijado por R5** (al redefinir la función hay que declararlo: un `create or replace` sin él lo borraría; hay una prueba y una mutación que lo vigilan) y los privilegios (`public` y `anon` sin `EXECUTE`).
* No edita ninguna migración ya aplicada. «Aditiva» en el sentido del proyecto: sólo funciones, ningún `drop table`, `truncate` ni `alter table` (una prueba lo exige).

## 4. Pruebas

* **Batería en Postgres 17.6 real** (`supabase/tests/postgres/r8_retire.cjs`, **26/26**): las funciones ya no existen ni las referencia ninguna otra; llamarlas falla; el alta nueva sigue creando, repite sin duplicar ante una respuesta perdida, aísla a las propietarias (la misma clave en otra cuenta es otra operación) y un payload inválido no deja claims huérfanos; el split acepta `end_date`, **rechaza (22023) un payload con sólo `endDate` sin escribir nada**, ignora `endDate` cuando llegan las dos claves, conserva todas las validaciones (fin anterior a la fecha efectiva, no anterior al inicio, status `active|ended`, `ended` sin fin), es idempotente, conserva privilegios y `search_path` vacío, y otra propietaria no puede dividir una serie ajena.
* **Ensayo de la migración** (`--rehearsal`, **14/14**): sobre el estado anterior (con claims y altas hechos por el camino viejo): dentro de una transacción que se revierte, sólo cambian las 3 funciones previstas y todo lo demás (datos, disparadores, políticas, índices, privilegios) queda idéntico; al revertir vuelve a la huella inicial; aplicada dos veces no cambia nada; lo creado antes se conserva y el alta nueva funciona encima; el **rollback** devuelve las 3 funciones a su cuerpo, privilegios y configuración exactos y el camino viejo vuelve a funcionar.
* **Mutaciones** (`r8_retire_mutations.cjs`, **7/7 detectadas**): no retirar cada función, volver a aceptar `endDate`, perder el `search_path`, dejar `EXECUTE` a `anon`, dejar de validar el fin de una original activa, retirar de más (la tabla de claims).
* **Pruebas existentes actualizadas** a la realidad nueva: el contrato del split (sólo `end_date`; la versión vigente es la de R8; la web no llama a las RPC retiradas), el escenario PGlite del alta de alumnos (38/38: «las funciones viejas ya no existen») y el SQL pgTAP del split (los casos de `endDate` pasaron de «se acepta» a «se rechaza»).
* **Web:** typecheck, lint y `next build` limpios; suite completa **1.103/1.103** (sobre una copia con saltos de línea LF; era 1.101).

## 5. Actualización de `supabase-js` (2.116.0 → 2.117.3)

Es la última 2.x (7/oct/2026) y entra en el rango `^2.116.0`; `@supabase/ssr@0.12.7` exige `^2.114.0`. Las notas de las versiones: 2.117.0 agrega passkeys (API por defecto; **la web no las usa**), 2.117.1 corrige la **devolución de la sesión guardada cuando un refresco pierde contra otra pestaña** (relevante para el manejo de sesión; es una corrección), 2.117.2 corrige un error de tipos de PostgREST con uniones de relaciones grandes, 2.117.3 corrige envíos de `Blob`/`File` en funciones y de campos multipart en Storage (**no se usan**). Ninguna es un cambio incompatible. En el lockfile cambian **sólo** los 6 paquetes de Supabase. Verificación: typecheck, lint, suite completa, build, y en Production la sesión existente navega (Inicio, Respaldo) y refresca sin errores de consola.

## 6. Despliegue, verificación y rollback

**Cierre en Production (7/oct/2026).** Commit de código (sin force, `bb50e6f..91e5913` por *fast-forward* a `teacherflow-web`): `91e5913` (migración, rollback, pruebas, actualización de `supabase-js` y comentarios); este documento, en un segundo commit sin nuevo deploy.

1. **Línea base de sólo lectura antes de tocar nada** (`baseline6.sql` de R6 + huella por tabla): 217 filas, 128 funciones, 53 migraciones (`20261011100000`).
2. **Ensayo REVERTIDO en Production** (`BEGIN … RAISE EXCEPTION`, nada se confirma): la migración nueva y una **cuenta sintética creada dentro de la transacción**: las dos funciones retiradas ya no existen (0), el alta nueva existe (1), el alta crea un alumno y su reintento devuelve el **mismo** alumno (`replayed = true`), el split con `end_date` cierra la original (`2026-11-15`) y crea la sucesora, el split con **sólo `endDate`** se rechaza con SQLSTATE **22023** («No se puede determinar la fecha de fin de la serie original …») y la serie queda intacta; el split conserva `anon` sin `EXECUTE`, `authenticated` con `EXECUTE` y el `search_path` vacío. **Mismo resultado que en el Postgres local.** Después del ensayo las 48 tablas quedaron con las mismas huellas.
3. **Dry-run:** exactamente `20261012100000_r8_retire_legacy_student_claims_and_enddate.sql`. **Un único** `supabase db push --yes`.
4. **Después del push** (línea base nueva): migraciones **54/54**; **datos de las 48 tablas idénticos**; las únicas diferencias son las previstas: **2 funciones retiradas** (`claim_student_creation()`, `create_student_via_web(uuid,jsonb,boolean)`), **1 modificada** (el split: cuerpo distinto; **`security invoker`, privilegios y `search_path` iguales**) y, por derivación, el total de funciones (128 → 126), la huella de cuerpos y la lista de funciones ejecutables por `authenticated`. RLS, políticas, privilegios de tabla y de columna, índices, disparadores (120), privilegios por defecto, funciones sin `search_path` vacío (0), `EXECUTE` de `anon` (0) y `pg_cron` **idénticos**. **API anónima:** `split_recurrence_this_and_future` y `create_student_with_operation` → **401 / 42501**; `claim_student_creation` → 404 (ya no existe).
5. **Deploy** desde un checkout limpio (`dpl_E6gofhxGbXaY754gZtYqCxpwJmkM`, `Ready`, producción; sin `supabase/.temp` ni `.next`, árbol sin cambios): `/login` 200, `/configuracion/respaldo` sin sesión → `/login?next=…`, cabeceras (`Strict-Transport-Security`, `X-Frame-Options`, `Content-Security-Policy: frame-ancestors`) presentes.
6. **QA de sólo lectura** con la sesión existente y `supabase-js` 2.117.3: Alumnos carga la lista (2 alumnos) y navega sin errores de consola; antes, Inicio y Respaldo en la misma sesión. **No se creó ni se modificó ningún dato** (no se creó un alumno ni se dividió una serie en Production: lo cubren la batería y el ensayo revertido con una cuenta sintética).

**Qué NO se verificó en Production (a propósito):** un alta de alumno real y un split de serie real (escriben datos de la profesora); lo cubren la batería (26), el ensayo de migración (14) y el ensayo revertido en Production con una cuenta sintética.


**Rollback** (`supabase/repairs/r8_retire_rollback.sql`, manual, no es una migración): recrea `claim_student_creation()` y `create_student_via_web(uuid, jsonb, boolean)` y vuelve a definir el split con el cuerpo **exacto** que tenían en Production antes de R8 (sacado de `pg_get_functiondef`, con `endDate` y `search_path` vacío), con sus privilegios (`authenticated` y `service_role`; nunca `anon`). Probado: huella idéntica. El de `supabase-js` es volver a `2.116.0` en `package.json` y el lockfile. Es una regresión deliberada; ejecutarlo sólo si algo que hoy no existe llegara a necesitarlo (`supabase migration repair --status reverted 20261012100000`).

## 7. Pendiente

* Ningún cliente conocido depende de lo retirado. Una **pestaña web abierta desde antes del 5/oct** con el código viejo recibiría un error al crear un alumno hasta recargar (la web vigente se desplegó hace más de una semana).
* Los comentarios históricos de las migraciones ya aplicadas (`20260927100000…`, `20261005160000…`, `20261004120000…`) siguen diciendo «en desuso»: no se editan migraciones aplicadas.
