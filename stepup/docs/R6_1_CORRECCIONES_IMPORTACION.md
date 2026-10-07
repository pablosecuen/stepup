# R6.1 — Corrección funcional de la importación

Corrige los **tres defectos funcionales** que se encontraron al medir R6 (`docs/R6_IMPORTACIONES_GRANDES.md`, §5 y §12). Parte de `0d9256e` (R6 cerrado). Este documento está separado del de R6 a propósito: R6 trata del rendimiento; R6.1, de que lo que se importa sea lo que la copia contiene.

## 1. Resumen

| | Antes (R6) | Después (R6.1) |
|---|---|---|
| Cuenta web VACÍA: serie cuyo acuerdo agrega la misma copia | se omitía («referencia a acuerdo de entrenamiento inexistente») | se importa |
| Cuenta web VACÍA: clase de una serie que agrega la misma copia | se omitía («serie que no se importó») | se importa |
| Cuenta web VACÍA: registro de una clase que agrega la misma copia | se omitía («clase de calendario que no se importó») | se importa |
| Cadena acuerdo → serie → clase → registro → asistencia / tarea / cobro | llegaba cortada: sólo lo que no dependía de otra fila de la copia | llega **completa**, con cada vínculo apuntando a la fila correcta |
| Reemplazo de los porcentajes 50/30/20 | **fallaba siempre** (cada campo se actualizaba por separado y la suma deja de dar 100 a mitad de camino) | se aplica de una vez, con la suma final **exactamente 100**; lo que no suma 100 se rechaza antes de escribir |
| Nivel con el mismo nombre que otro | error genérico «Ese registro ya existe» | se informa como **repetido** (se conserva el que ya tenés y no se agrega el repetido); nunca dos niveles con el mismo nombre; un reemplazo de nombre que choca tiene su propio mensaje |
| Importación de 7.500 unidades (máximo de R6) con la cadena completa | — | vista previa 363 ms, aplicación 2,3 s (tope de la API: 8 s), todo se escribe |
| Crecimiento con el tamaño | lineal (R6) | **lineal**: 8× más unidades cuestan 3,5× el tiempo y 7,6× las consultas |

Las 6 RPC públicas conservan firma, resultado y privilegios: la web desplegada antes de R6.1 sigue funcionando con la base nueva. **No se importó ninguna copia real** y no se cambió nada de GitHub, Supabase Auth, SSL, el firewall de Vercel, las variables ni el CAPTCHA.

## 2. Defecto 1 — dependencias dentro de la misma copia

### 2.1 Causa exacta

La escritura de R6 ya resolvía bien las referencias entre filas de la copia (todo ocurre en una transacción, en orden de dependencia, con identificadores asignados de antemano). El error estaba **antes**, en la **clasificación** de la vista previa: cada clasificador comprobaba la referencia contra *lo que ya existe en la web* y sólo para los alumnos miraba también *lo que la importación va a agregar*:

| Fase | Referencia | R6 comprobaba… | Consecuencia en una cuenta vacía |
|---|---|---|---|
| Series | `trainingBillingAgreementId` | acuerdos de la web | la serie con un acuerdo nuevo se omitía |
| Clases | `recurrenceId` | series de la web | la clase de una serie nueva se omitía |
| Registros | `calendarLessonId` | clases de la web | el registro de una clase nueva se omitía |
| Cobros | acuerdo, registro, clase | web ∪ copia | (ya estaba bien) |

Y como cada omisión arrastra a lo que depende de la fila omitida, en una cuenta vacía casi toda la agenda y su historia quedaban afuera.

### 2.2 Corrección: clasificar por fases con un mapa de ids

La vista previa clasifica **en el orden de dependencia** y cada fase resuelve sus referencias contra un **mapa de ids** = lo que ya existe en la web (id canónico) ∪ lo que **esta** importación va a agregar en las fases anteriores (id de la copia, que se resuelve al escribir):

| # | Fase | Depende de | Mapa que usa |
|---|---|---|---|
| 1 | Alumnos | — | web |
| 2 | Acuerdos de entrenamiento | — | web (sólo se agregan o conservan) |
| 3 | Series | alumno, acuerdo | alumnos (web ∪ altas), **acuerdos (web ∪ altas)** |
| 4 | Clases | alumno principal, serie | alumnos, **series (web ∪ las insertables de la fase 3)** |
| 5 | Registros | clase, integrantes | alumnos, **clases (web ∪ las insertables de la fase 4)** |
| 6 | Cobros y pagos | alumno, acuerdo, registro, clase (+ el grafo de pagos) | alumnos, acuerdos, registros, clases (ya era así) |

* `_import_available_ids` (que ya existía) ahora también conoce las **series**; devuelve el conjunto UNA vez y cada clasificador lo une por hash: **cero consultas por elemento** (la prueba de escala lo vigila: las llamadas a los clasificadores y al mapa de ids son las mismas con 4× más filas).
* Las tres funciones son sobrecargas **nuevas** de 4 argumentos (`_import_classify_recurrence_rules`, `_import_classify_calendar_lessons`, `_import_classify_lesson_registrations`); las de 3 argumentos de R6 quedan sin llamadas (sirven para el rollback).
* **Cascada.** Sólo lo *insertable* entra en el mapa: una serie omitida (acuerdo realmente faltante) hace que sus clases se omitan («serie que no se importó»), que los registros de esas clases se omitan y que las componentes de cobros que los usan se omitan **enteras** (nunca un cobro suelto).
* **Clase sin alumno principal.** La tabla exige alumno principal; R6 clasificaba como importable una clase con `primaryStudentId` nulo y la escritura la descartaba en silencio (y sus registros quedaban sin clase). Ahora se omite con su motivo.
* **Aislamiento.** El mapa se arma siempre filtrando por la cuenta: un id que sólo existe en OTRA cuenta es, para esta, una referencia faltante (hay una prueba y una mutación que lo vigilan).

La escritura **no cambió**: conserva el orden topológico, los ids preasignados (`new_id`) para las referencias entre filas de la misma tabla, las instantáneas y la validación de invariantes.

### 2.3 Qué NO cambió (observaciones que siguen vigentes)

* Un alumno clasificado como **«posible duplicado»** no está en el mapa hasta que la profesora decide: lo que depende de él se omite en esta vista previa (igual que en R6). No ocurre en una cuenta vacía.
* Los integrantes de clases y series, y las asistencias, evaluaciones y revisiones de tarea cuyo alumno no se puede resolver se descartan en silencio (R6 y antes ya lo hacían); el **roster** de un registro sí se controla y omite el registro entero.
* Una cuenta con más de 7.500 unidades de trabajo no se importa de una vez (R6, §7).

## 3. Defecto 2 — presupuesto 50/30/20

**Causa.** `budget_distribution_settings_sum_100` (`needs + wants + savings = 100`) es una restricción **por sentencia**. `_apply_singleton` aplicaba cada porcentaje elegido con su propio `UPDATE`, así que después del primero la suma dejaba de dar 100 y la base lo rechazaba: reemplazar los porcentajes **fallaba siempre**, aun eligiendo los tres.

**Corrección.**

1. **Estado final antes de escribir.** `_import_validate_selection` (fase sin lock) calcula los tres porcentajes finales —lo elegido sale de la copia, lo demás queda como está en la web— y exige **suma = 100**; si no, `La distribución 50/30/20 que elegiste no suma 100.` (SQLSTATE 22023, antes de tocar nada).
2. **Un solo `UPDATE`.** `_apply_singleton` vuelve a calcular el estado final y escribe los tres porcentajes (y la meta de ahorro elegida) en **una** sentencia. La restricción de la base queda como respaldo final.
3. **Una sola decisión en pantalla.** El asistente muestra los tres porcentajes como **«Distribución 50/30/20 (necesidades / gustos / ahorro)»: *En la web: 50/30/20 → En la copia: 40/40/20***; marcarla marca los tres campos a la vez (`lib/backup/budget-distribution-fields.ts`). Un cliente que mande los porcentajes sueltos (la web desplegada antes de R6.1) llega a la base igual: si suman 100 se aplica; si no, se rechaza con el mensaje claro.
4. **Deshacer.** La instantánea guarda la fila completa antes y después; deshacer restaura los tres de una vez (ya lo hacía; ahora hay una prueba que lo cubre con un reemplazo real).

Casos probados: válido (los tres), **parcial inválido** (sólo uno: 40+30+20), parcial válido (necesidades + gustos cuando el ahorro coincide), **repetido** (la misma decisión dos veces se rechaza; el mismo campo repetido en la lista cuenta una vez), copia con distribución que no suma 100 (se rechaza al analizar), sólo la meta de ahorro (los porcentajes no se tocan), la web cambió después de revisar (se frena por la huella), cuenta sin presupuesto (se agrega completo), respuesta perdida y reintento, y deshacer.

## 4. Defecto 3 — niveles duplicados

**Causa.** El índice único `custom_levels_owner_name_unique (owner_id, lower(btrim(name)))` rechaza dos niveles con el mismo nombre normalizado, pero la vista previa sólo comparaba por el id de la copia: un nivel nuevo con el nombre de uno existente (o repetido dentro de la copia) terminaba en una violación de índice único, que la web mostraba como el genérico «Ese registro ya existe», **al confirmar**, con todo analizado.

**Corrección.**

* **Clasificación.** `_import_classify_custom_levels` conserva `inserts`, `equal` y `conflicts` y agrega `duplicates` (cada elemento: motivo, nombre, y el nombre del nivel existente). Un nivel de la copia **sin vínculo** con la web:
  * si su nombre normalizado ya lo tiene un nivel de la web → `same_name_in_web` (se **conserva el de la web**, no se agrega);
  * si no, pero se repite dentro de la copia → el **primero** se agrega y los demás son `same_name_in_copy`;
  * si el nombre queda vacío → `blank_name` (no se agrega).
* **Sin decisión que tomar.** «Conservar el existente» y «no importar el duplicado» son el mismo resultado: no se crea nada. La pantalla lo dice nivel por nivel («`«Nivel A»`: ya tenés un nivel con ese nombre. Se conserva el que ya tenés.») y **no** cuenta como algo para decidir.
* **Aplicación.** `_import_apply_custom_levels` nunca crea dos niveles con el mismo nombre normalizado: si apareció uno en la web después de analizar → «Apareció un nivel con el mismo nombre…» (la importación se frena, sin escribir nada); si un **reemplazo de nombre** choca con otro nivel (de la web, agregado ahora, o elegido en la misma selección) → «Ya existe otro nivel con ese nombre.» (SQLSTATE 22023, **no** 23505); un nombre que quedaría vacío → «Un nivel quedaría sin nombre.».
* **Mensajes** (`lib/backup/import-copy.ts`): códigos propios `level_name_taken`, `level_name_blank`, `level_name_appeared`, `budget_sum_invalid`; nada de constraints, tablas ni SQL (hay pruebas que lo vigilan, incluso con una violación de índice única cruda).

Una vista previa pendiente creada antes de R6.1 (sin la clave `duplicates`) se confirma igual (probado).

## 5. Lo que se conserva (invariantes)

Atomicidad (una función = una transacción; un error a mitad revierte **todo**: probado con una falla en la última tabla de una cadena con presupuesto y niveles), idempotencia (`unique (owner_id, preview_id)` + el mismo resultado en el reintento), decisiones (agregar / conservar / reemplazar / vincular / crear aparte / omitir), instantáneas y deshacer, RLS y `auth.uid()`, cuotas de R3 (proyección al analizar y disparadores al escribir), retención de R4, el **lock mínimo** de R6 (el análisis y el armado de tablas temporales siguen **antes** del lock de la cuenta), los límites de R6 (7.500 unidades), el formato de respaldo móvil (no se tocó) y los mensajes sin ids ni datos.

## 6. Pruebas

Todo en **PostgreSQL 17.6 real** (la misma versión mayor que Production), con varias conexiones simultáneas y datos sintéticos; nunca contra Production.

| Qué | Cómo | Resultado |
|---|---|---|
| Batería de R6.1 (`r61_import.cjs`) | 13 secciones: `static`, `chain`, `independent`, `mixed`, `levels`, `budget`, `owners`, `concurrent`, `stale`, `undoblocked`, `quotas`, `midfailure`, `scale` | **125/125** |
| Mutaciones de R6.1 (`--mutations`) | cada una rompe a propósito una garantía y la batería la tiene que detectar | **25/25 detectadas** |
| Ensayo de la migración (`r61_migration_rehearsal.cjs`) | estado de Production con R6 → BEGIN/ROLLBACK (datos, funciones, disparadores, políticas, índices, privilegios idénticos), idempotencia, compatibilidad con lo creado antes y rollback | **19/19** |
| Diferencial R6 ↔ R6.1 (`r6_differential.cjs`) | 9 escenarios, dos Postgres reales | **coinciden** (ver §8) |
| Batería de R6 (`r6_import.cjs`), contra la última definición | los límites, la atomicidad, los timeouts, el deshacer, las cuotas y la purga de R6 siguen valiendo | **157/157** (una expectativa se actualizó: la clase de una serie que agrega la misma copia ahora entra) |
| Mutaciones de R6 (`r6_import.cjs --mutations`) | ahora también se aplican a la definición vigente de R6.1 | **17/17 detectadas** |
| Web: pruebas nuevas | `budget-distribution-fields` (6), `r61-import-copy` (10), `r61-import-wizard` (4): mensajes, mapeo, agrupamiento del 50/30/20 y estructura del asistente | **20 nuevas**; suite completa **1.101/1.101** (sobre una copia con saltos de línea LF; era 1.081) |
| Typecheck, lint y `next build` | | limpios |

Cobertura de lo pedido (sección de la batería):

* **Importación completa sobre una cuenta totalmente vacía; cadena acuerdo → serie → clase → registro → asistencia / tarea / cobro** — `chain` (clasificación, filas escritas por tabla, **cada vínculo** leído de la base: serie ↔ acuerdo, «reemplaza a», clase ↔ serie, «liberada por», registro ↔ clase, reprogramado, cobro ↔ registro / clase / acuerdo, asignación pago ↔ cobro, excepción ↔ clase de reemplazo, integrantes, asistencias y tareas).
* **Varias cadenas independientes** — `independent` (4 cadenas: ningún vínculo cruza de una a otra) y `concurrent` (2 cadenas).
* **Referencia válida creada dentro de la misma copia / mezclada con la web** — `chain`, `mixed` (serie nueva con un acuerdo de la web, clase con una serie de la web o de la copia, registro con una clase de la web o de la copia, cobro que une un registro de la web con una clase de la copia).
* **Referencia realmente faltante** — `chain` (acuerdo, serie, clase y alumno inexistentes, clase sin alumno principal) con su **cascada** (la clase de una serie omitida, el registro de una clase omitida, la componente de cobros entera) y `owners` (ids que sólo existen en OTRA cuenta).
* **Duplicados contra la web y dentro de la propia copia** — `levels` (nombre repetido con otras mayúsculas o espacios, repetido dentro de la copia, sin nombre, igual y con diferencias, el mismo identificador repetido) más los de alumnos de R6.
* **Presupuesto 50/30/20 válido, inválido, parcial y repetido** — `budget` (24 comprobaciones).
* **Vista previa, confirmación, respuesta perdida, reintento y deshacer** — `chain`, `levels`, `budget`, `concurrent` (dos confirmaciones simultáneas de la misma revisión).
* **Dos propietarias sin cruces** — `owners` (los mismos ids móviles en dos cuentas, en paralelo; mismo grafo, ids propios, deshacer en una no toca a la otra).
* **Cuotas de R3** — `quotas` (al previsualizar y durante la aplicación, con todo revertido). **Purga de R4** — `quotas` (los datos importados no se tocan; ya no se puede deshacer).
* **Límite de 7.500 unidades de R6** — `scale`: el mayor respaldo enlazado que cabe (7.493 unidades) entra y termina bajo los 8 s de la API; una unidad más se rechaza antes de procesar.
* **Dataset grande, sin crecimiento cuadrático** — `scale`: las llamadas a los clasificadores y al mapa de ids no crecen con 4× más filas, las lecturas secuenciales tampoco, el disparador de cuotas corre una vez por tabla, las consultas crecen ≤ 4,6× con 4× filas y el tiempo ≤ 8×.
* **Error intermedio con retroceso total** — `midfailure` (falla en la última tabla de una cadena con presupuesto y niveles: cero filas, cero instantáneas, sin lock, la misma revisión sigue sirviendo y se aplica sin duplicados).
* **Revisión vencida y desactualizada, y compatibilidad con una vista previa de antes de R6.1** — `stale`; **deshacer bloqueado** — `undoblocked`.
* **Mutaciones de orden de fases, mapa de ids, suma de porcentajes e idempotencia** — las 25 (series sin los acuerdos de la copia, clases sin las series, registros sin las clases, ids disponibles que no cuentan lo agregado / cuentan lo omitido / no filtran por cuenta, clase sin alumno principal importable, **orden de escritura** invertido —clases antes que series, cobros antes que registros—, vínculos de serie, clase, registro, cobro, «reemplaza a» y «liberada por» que no se resuelven, reintento que no se reconoce, error a mitad que se traga, porcentajes de a uno, suma 100 sin validar, deshacer que no restaura el presupuesto, los cuatro casos de niveles y la llamada al mapa **por registro**).


## 7. Mediciones

**Entorno.** El mismo de R6 (§2 de `docs/R6_IMPORTACIONES_GRANDES.md`): PostgreSQL 17.6 real (`embedded-postgres`), las 53 migraciones, la misma máquina, respaldos sintéticos (`r6_dataset.cjs`). Calibración de CPU (la prueba de sólo CPU de R6, antes / durante / después de medir): **2,4–2,8 s** de CPU en todas las corridas (R6: Production 2,0 s, esta máquina entre 2,4 s —estado rápido— y 5,5 s —estado lento—): **toda la medición de hoy se hizo en el estado rápido y estable**; las comparaciones R6 contra R6.1 son *ida y vuelta* (A B A B) con los mismos datos, para separar la variación de la máquina. «Unidades» = filas contadas + anidadas (el máximo de R6 es 7.500). `--linked` arma la cadena completa acuerdo → serie → clase → registro → cobro dentro de la copia.

**1. Los mismos datos de R6 (sin enlaces dentro de la copia), 7.498 unidades: R6.1 no cambia el costo.** (Las pocas filas de más de R6.1 son las series cuyo acuerdo agrega la misma copia, que R6 omitía.)

| Corrida | Unidades | Filas escritas | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R6 (a) | 7.498 | 7.402 | 301 ms | 1,9 s | 1,7 s | 60.272 | 52.1 MB | 636 ms | 768 ms |
| R6.1 (a) | 7.498 | 7.498 | 344 ms | 2,1 s | 1,9 s | 61.103 | 52.8 MB | 581 ms | 879 ms |
| R6 (b) | 7.498 | 7.402 | 385 ms | 2,3 s | 2,0 s | 60.272 | 52.5 MB | 648 ms | 905 ms |
| R6.1 (b) | 7.498 | 7.498 | 1,1 s | 1,9 s | 1,7 s | 61.103 | 52.5 MB | 532 ms | 728 ms |

Otros tres perfiles al máximo (7.500 unidades), sin enlaces, R6 y R6.1 seguidos:

| Corrida | Unidades | Filas escritas | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R6 financial_heavy | 7.500 | 7.500 | 519 ms | 2,1 s | 1,8 s | 68.962 | 48.5 MB | 520 ms | 711 ms |
| R6.1 financial_heavy | 7.500 | 7.500 | 398 ms | 2,1 s | 1,8 s | 68.968 | 49 MB | 535 ms | 733 ms |
| R6 students_heavy | 7.495 | 7.293 | 416 ms | 1,7 s | 1,5 s | 54.256 | 54.9 MB | 830 ms | 1,0 s |
| R6.1 students_heavy | 7.495 | 7.495 | 330 ms | 1,8 s | 1,6 s | 56.027 | 55.4 MB | 712 ms | 1,0 s |
| R6 nested_heavy | 7.496 | 7.496 | 260 ms | 1,9 s | 1,7 s | 62.248 | 46.6 MB | 517 ms | 617 ms |
| R6.1 nested_heavy | 7.496 | 7.496 | 274 ms | 1,9 s | 1,7 s | 62.254 | 46.8 MB | 466 ms | 609 ms |

**2. La cadena completa dentro de la copia (lo que R6.1 hace posible), 7.498 unidades:** R6 sólo podía escribir lo que no dependía de otra fila de la copia (3.014 de 7.498 filas); R6.1 escribe **todo**.

| Corrida | Unidades | Filas escritas | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R6.1 (a) | 7.498 | 7.498 | 379 ms | 2,1 s | 1,9 s | 63.249 | 53.6 MB | 796 ms | 950 ms |
| R6.1 (b) | 7.498 | 7.498 | 347 ms | 2,2 s | 2,0 s | 63.249 | 53.3 MB | 756 ms | 875 ms |
| R6 (a) | 7.498 | 3.014 | 320 ms | 1,2 s | 840 ms | 24.510 | 39.6 MB | 441 ms | 561 ms |

Otros perfiles al máximo con la cadena enlazada (R6.1):

| Corrida | Unidades | Filas escritas | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R6.1 students_heavy enlazado | 7.495 | 7.495 | 395 ms | 2,0 s | 1,7 s | 57.651 | 55.9 MB | 716 ms | 1,1 s |
| R6.1 financial_heavy enlazado | 7.500 | 7.500 | 585 ms | 2,6 s | 2,3 s | 71.082 | 49.5 MB | 534 ms | 750 ms |
| R6.1 nested_heavy enlazado | 7.496 | 7.496 | 336 ms | 2,4 s | 2,2 s | 63.302 | 47.2 MB | 475 ms | 607 ms |

**3. Crecimiento con el tamaño (R6.1, perfil `mix` enlazado).** 8,0 veces más unidades cuestan 3,5 veces el tiempo de aplicación (exponente p ≈ 0,60: el lock y el armado de tablas temporales son costos fijos) y 7,6 veces las consultas: **lineal, ≈ 9 consultas por fila en todos los tamaños** (casi todas, las dos del disparador de integridad entre cuentas por clave foránea, ver R6 §5). La vista previa hace 300 → 1.689 lecturas de tabla (**sublineal**: 0,32 → 0,23 por unidad).

| Unidades | Vista previa | Lecturas (vista previa) | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 934 | 214 ms | 300 | 670 ms | 451 ms | 8.491 (9,1 por fila) | 35.1 MB | 325 ms | 367 ms |
| 1.868 | 236 ms | 498 | 939 ms | 731 ms | 16.336 (8,7 por fila) | 40.1 MB | 344 ms | 438 ms |
| 3.734 | 281 ms | 894 | 1,7 s | 1,3 s | 32.572 (8,7 por fila) | 46.3 MB | 431 ms | 552 ms |
| 7.498 | 363 ms | 1.689 | 2,3 s | 2,1 s | 64.522 (8,6 por fila) | 57.3 MB | 718 ms | 839 ms |

**Presupuesto.** El tope real de la API es 8 s. Con el máximo (7.500 unidades) y la cadena completa, en el estado rápido de esta máquina la aplicación tarda **2,1–2,2 s** con `mix` y **2,6 s** en el peor perfil (financiero enlazado); la vista previa, 0,3–0,6 s; deshacer, ≤ 1,1 s. Production calibró **más rápido** que el estado rápido de esta máquina (CPU 2,0 s frente a 2,4–2,8 s), así que se esperan ≈ 2 s. Para el estado lento de esta máquina (≈ 2,3×, medido en R6) la proyección del peor perfil es ≈ 5,9 s: **bajo el tope de 8 s con margen**, aunque por encima del objetivo interno de R6 (≈ 4,8 s = 60 % del tope en el estado lento): la cadena completa tiene más claves foráneas por fila que lo que R6 podía escribir. No se baja el máximo (7.500) porque el costo medido sigue lejos del tope y cada fila de la copia que antes se omitía ahora se importa.

## 8. Equivalencia con R6

`r6_differential.cjs` (con `R61_COMPARE=1`) corre los 9 escenarios de R6 en **dos Postgres reales** —migraciones hasta R6 y hasta R6.1— con los mismos datos, y compara clasificación, resumen, **todas** las tablas de negocio (ids reemplazados por el de la app móvil), instantáneas, reintento, deshacer y estado tras deshacer. Para que sólo puedan diferir los tres defectos corregidos, se quita de los respaldos lo que R6.1 vuelve importable a propósito (series con acuerdo de la misma copia, clase de una serie de la misma copia, registro de una clase de la misma copia). Resultado: **los 9 escenarios coinciden**. La única diferencia de forma admitida es la clave `duplicates` (vacía) en los niveles.

## 9. Despliegue, verificación y rollback

**Cierre en Production (7/oct/2026).** Commits (sin force, `0d9256e..3dc0183` por *fast-forward* a `teacherflow-web`): `6eea8ff` (migración, rollback y pruebas de base) y `3dc0183` (web); este documento, en un tercer commit sin nuevo deploy.

1. **Línea base de sólo lectura antes de tocar nada** (`baseline6.sql` de R6: huellas de datos —`cloud_backups` sólo por cantidad e ids—, RLS, políticas, privilegios de tabla y de columna, cuerpos, `search_path` y privilegios de cada función, índices, disparadores, privilegios por defecto, `pg_cron`, migraciones) más una huella **por tabla** (`tablewise.sql`, 48 tablas): 217 filas, 125 funciones, 52 migraciones (`20261010130000`), **0 vistas previas, 0 corridas y 0 instantáneas de importación** (no había ninguna importación en vuelo que el cambio pudiera afectar), purga de R4 activa.
2. **Ensayo REVERTIDO en Production** (`BEGIN … RAISE EXCEPTION`, nada se confirma): la migración nueva, **dos propietarias sintéticas creadas dentro de la transacción** (con un nivel y un presupuesto 50/30/20 sintéticos) y un ciclo completo con **dos cadenas completas dentro de la copia** (acuerdo → serie → clase → registro → asistencia / tarea / cobro): las 6 series, 8 clases, 6 registros y 4 componentes de cobros son importables; el reemplazo parcial de los porcentajes (sólo necesidades) se rechaza con el mensaje propio (SQLSTATE 22023) y el presupuesto queda en 50/30/20; con los tres porcentajes se aplica (40/40/20); los niveles repetidos se informan (`same_name_in_web`, `same_name_in_copy`) y se agrega sólo el nuevo; **76 filas escritas**, 6 vínculos clase↔serie, 4 serie↔acuerdo, 6 registro↔clase y 2 cobro↔registro; el reintento repite la misma corrida; deshacer es seguro y completo (75 borradas, 1 restaurada; el presupuesto vuelve a 50/30/20 y el nivel agregado desaparece); la segunda propietaria (mismos ids de la copia) recibe su propia cadena (77 filas) sin ninguna referencia cruzada y la primera queda sin filas; ninguna función interna con `EXECUTE` para la API. **Mismo resultado que en el Postgres local.** Después del ensayo las 48 tablas quedaron con las mismas huellas.
3. **Dry-run** (`db push --dry-run`): exactamente `20261011100000_r61_import_dependencies_budget_levels.sql`. **Un único** `supabase db push --yes`.
4. **Después del push** (línea base nueva, tomada justo antes y justo después): migraciones **53/53** (`20261011100000`); **datos de las 48 tablas idénticos** (huella por tabla); **las únicas funciones existentes modificadas son 6** (`_import_available_ids`, `_import_classify_custom_levels`, `_import_apply_custom_levels`, `_import_validate_selection`, `_apply_singleton`, `preview_backup_import`) y las **únicas nuevas son 3** (las sobrecargas de 4 argumentos de series, clases y registros); funciones 125 → 128 y 29 → 32 internas `_import_*`, **ninguna con `EXECUTE` para la API**; RLS, políticas, privilegios de tabla y de columna, índices, disparadores (120), privilegios por defecto, funciones sin `search_path` vacío (0), `EXECUTE` de `anon` (0), privilegios de las RPC de importación y trabajos de `pg_cron` **idénticos**. **API anónima** (clave pública `anon`): las 4 RPC de importación y las 8 funciones internas tocadas o nuevas → **401 / 42501**.
5. **Deploy** desde un checkout limpio (`dpl_7YJYTAHeyc2sZhxFJqpRb1thf7JL`, `Ready`, producción; sin `supabase/.temp` ni `.next`, árbol sin cambios): `/login` 200, `/configuracion/respaldo` sin sesión → `/login?next=…`, cabeceras de R1 presentes. La base nueva es compatible con la web anterior (mismas 6 RPC y firmas) y la web nueva con la base anterior (la clave `duplicates` es opcional).
6. **QA de sólo lectura** con la sesión existente: **Respaldo** carga con el máximo («hasta 7.500 elementos») y el historial carga contra el esquema vigente («Todavía no importaste ningún respaldo»); sin errores de consola. **No se analizó ni se importó ninguna copia** (analizar lee la copia de la nube y escribe una vista previa: fuera de lo permitido en esta ronda).

**Qué NO se verificó en Production (a propósito):** una importación real de punta a punta con la copia de la profesora, la pantalla de «Revisar y decidir» con niveles repetidos o con la distribución agrupada (hace falta analizar una copia: lo cubren las pruebas del asistente y del mapeo), las cuotas de R3 durante una confirmación real y la reacción del asistente ante un tiempo agotado real. Todo eso está cubierto por la batería, las mutaciones y el ensayo revertido de arriba.


**Rollback** (`supabase/repairs/r61_import_rollback.sql`, manual, no es una migración): vuelve a definir las 6 funciones modificadas con su cuerpo EXACTO de R6 (probado: huella idéntica, incluidos privilegios y configuración) y elimina las 3 sobrecargas nuevas. Las RPC públicas no cambian de firma, así que la web desplegada sigue funcionando. **Es una regresión deliberada** (vuelven los tres defectos); ejecutarlo sólo si R6.1 rompiera algo que la aplicación necesita, y volver a aplicarlo después (`supabase migration repair --status reverted 20261011100000`).

## 10. Riesgos residuales y pendiente

* **Pendiente de prueba real:** ninguna importación real se ejecutó en Production (a propósito); la cadena completa se probó en Postgres 17.6 real, en un ensayo revertido en Production y con 25 mutaciones. Falta que la profesora importe su copia real y confirme lo que ve.
* Las observaciones de §2.3 siguen vigentes.
* Un nivel de la copia con un nombre que sólo difiere por espacios INTERNOS (`Nivel  A` / `Nivel A`) **no** se considera repetido: es el mismo criterio que el índice único de la base (`lower(btrim(name))`), que es la regla del producto.
* Una cuenta con más de 7.500 unidades sigue sin poder importarse de una vez (R6, §7).
* No se tocó nada de R7 (GitHub, Supabase Auth, SSL de la base, el firewall de Vercel, variables ni CAPTCHA).
