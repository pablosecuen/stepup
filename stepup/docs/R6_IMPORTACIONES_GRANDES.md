# R6 — Importaciones grandes

Cierra el hallazgo **M-08** de la auditoría defensiva (`auditoria-2026-10-06/INFORME.md`): *«Importación grande: crecimiento superlineal y riesgo de timeout»*. Parte de `c28e114` (R5 cerrado). Este documento está separado del resto a propósito: sólo habla de la importación de respaldos (vista previa, confirmación, deshacer), sus límites y su medición. **No** mezcla R7 (controles externos), funciones antiguas, `endDate`, rediseño visual ni la app móvil.

## 1. Resumen

| | Antes de R6 | Después de R6 |
|---|---|---|
| Vista previa de 10.000 filas | 8,7 s | 607 ms |
| Aplicación de 10.000 filas | 28,6 s (la API la corta a los 8 s) | 4,9 s |
| Lock de la cuenta durante la aplicación (10.000 filas) | 28,5 s | 4,7 s |
| Crecimiento con el tamaño (exponente p de t ∝ n^p entre 2.000 y 10.000 elementos) | superlineal: vista previa p ≈ 1,7 (cuadrática en el tramo financiero), revisar deshacer p ≈ 2,9, aplicación p ≈ 1,3 sobre un costo por fila ~10× mayor | **lineal o mejor**: vista previa p ≈ 0,55, aplicación p ≈ 0,8, revisar deshacer p ≈ 0,9 |
| Cuándo falla una importación grande | al confirmar, a los 8 s, con todo el trabajo hecho (se revierte todo) | se rechaza **antes de procesar**, con un texto que dice qué hacer |
| Máximo explícito por importación | 50.000 filas contadas, sin contar lo anidado: no acotaba el trabajo real | **7.500 unidades de trabajo** (filas contadas + anidadas), medidas |
| Deshacer una importación con vínculos entre filas | imposible (la propia importación dejaba sus filas «editadas») | funciona |
| Aplicar un respaldo con historial de niveles | imposible (error interno de la función) | funciona |

*(La columna «Después» de las tres primeras filas se midió con el tope desactivado, sólo para mostrar el escalado: en Production un respaldo de 10.000 filas se rechaza antes de procesar. Lo que sí se acepta —hasta 7.500 unidades de trabajo— tarda ≈ 2 s en aplicarse con la máquina en su estado rápido y ≈ 4,5 s en el lento, ver §2 y §10.)*

Qué se hizo, en una frase: se **midió** el comportamiento anterior con datos sintéticos (6 tamaños, 4 perfiles) en un PostgreSQL 17.6 real (la misma versión mayor que Production), se **identificó por ablación** qué consultas lo hacían cuadrático, se reescribieron la vista previa, la aplicación y el deshacer **por lotes** (una sentencia por tabla, sin consultas por elemento), se movió **todo el análisis posible fuera del lock de la cuenta**, se fijaron **límites medidos** y se comprobó con una prueba diferencial que, con los mismos datos, el resultado es **el mismo** que el de la versión anterior (salvo las diferencias documentadas en §8).

## 2. Cómo se midió

* **Entorno.** `embedded-postgres` 17.6 (binarios reales de PostgreSQL, **fuera** del repo) con las 52 migraciones del repo y los *stubs* mínimos de Supabase; Windows 11, la misma máquina para «antes» y «después». Las ejecuciones son secuenciales y sin otra carga. Production **no** se usó para medir volumen.
* **Datos.** Respaldos sintéticos con el formato móvil v2 (`supabase/tests/postgres/r6_dataset.cjs`, determinista): perfil `mix` (cuenta grande típica), `students_heavy`, `financial_heavy` y `nested_heavy` (muchas filas anidadas). «Elemento» = fila principal de las 17 colecciones que cuenta la validación; las filas **anidadas** (integrantes de clases y series, roster, asistencias, evaluaciones, revisiones de tarea, historial de niveles) no se veían en esa cuenta y son parte real del trabajo: **unidad de trabajo = filas contadas + anidadas**.
* **Qué se mide** (`r6_import_scale.cjs`): tiempo total de cada fase, **consultas** (lecturas de tabla dentro de la transacción, `pg_stat_xact_user_tables`) y llamadas a funciones (`pg_stat_xact_user_functions`, con tiempo propio por función), **memoria** (pico del conjunto de trabajo del proceso del backend de Windows, medido por conexión nueva; incluye páginas compartidas tocadas), tamaño del payload y de la clasificación, y la **duración real del lock de la cuenta** (sondeo de `pg_locks` cada 5 ms).
* **El tope real de la API.** En Production, `authenticated` tiene `statement_timeout = 8s` (`anon` 3 s; `authenticator` 8 s de `statement_timeout` y de `lock_timeout`), leído en sólo lectura de `pg_roles`. Se comprobó en Postgres real que un `SET statement_timeout` dentro de la función **no** amplía el tope de la sentencia que ya empezó: **no hay forma de dar más de 8 s a una RPC**; la importación tiene que entrar en ese tiempo o rechazarse antes.
* **Velocidad de Production frente a esta máquina (y cuánto varía la máquina).** Se calibró con una prueba de sólo CPU y una tabla *temporal* de la sesión (revertida, sin tocar tablas de la aplicación), en Production y acá: CPU 2,0 s en Production contra 2,4 s acá (Production 0,84×), inserción en tabla temporal con índice 420–525 ms contra 340 ms (1,2–1,5×), unión por hash 77 ms contra 37 ms (2,1×). Durante la ronda esta máquina pasó por **dos estados**: uno *rápido* (el de esa calibración y de las tablas de §3 y §10) y otro *lento* en el que **la misma prueba tarda 2,3 veces más** (CPU 5,5 s, inserción 790 ms, unión 85–95 ms; otra carga del equipo): frente al estado lento, Production es 2,7× más rápido en CPU, 1,6–1,9× en inserciones y igual en uniones. Por eso **el estado lento es un sustituto conservador de Production** y es el que se usa para fijar el máximo.
* **Presupuesto.** Una importación aceptada tiene que terminar cada fase **dentro de ≈ 60 % del tope de 8 s en el estado lento de esta máquina** (≈ 4,8 s) y, por lo tanto, en ≈ 2 s en el estado rápido (25 % del tope). Cada fase se mide por separado: vista previa, aplicación (la que más pesa), revisar el deshacer y deshacer.

## 3. Comportamiento anterior (medido)

| Elementos (contadas + anidadas) | Payload | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 100 (100 + 129) | 0,05 MB | 246 ms | 441 ms | 284 ms | 3.323 | 26 MB | 190 ms | no se puede (bloqueado) |
| 500 (499 + 644) | 0,23 MB | 293 ms | 900 ms | 838 ms | 16.556 | 31 MB | 418 ms | no se puede (bloqueado) |
| 1.000 (997 + 1.287) | 0,46 MB | 298 ms | 1,5 s | 1,5 s | 33.055 | 37 MB | 520 ms | no se puede (bloqueado) |
| 2.000 (1.994 + 2.574) | 0,92 MB | 589 ms | 3,4 s | 3,3 s | 66.143 | 43 MB | 781 ms | no se puede (bloqueado) |
| 5.000 (4.985 + 6.434) | 2,31 MB | 2,7 s | 10,9 s (⚠ > 8 s) | 10,8 s | 165.186 | 57 MB | 3,0 s | no se puede (bloqueado) |
| 10.000 (9.970 + 12.867) | 4,62 MB | 8,7 s | 28,6 s (⚠ > 8 s) | 28,5 s | 334.695 | 83 MB | 76,2 s | no se puede (bloqueado) |

(Consultas = lecturas de tabla dentro de la transacción; memoria = pico del backend; «bloqueado»: ver §5.2.)

Lectura: la **vista previa** crece con p ≈ 1,7 (la parte financiera, p ≈ 2) y **revisar el deshacer** con p ≈ 2,9 (76 s con 10.000 filas); la **aplicación** crece menos (p ≈ 1,3) pero con un costo por fila ~10 veces mayor que el actual: pasa los 8 s a partir de ~4.000–5.000 elementos (con 10.000 tarda ~29 s: la API la cancela y la importación **nunca** se puede completar). Durante toda la aplicación la cuenta queda con el lock `backup_import:<cuenta>` tomado (el 99 % del tiempo de la aplicación). **Confirmar el deshacer** no se pudo medir por una razón distinta al tamaño: siempre quedaba bloqueado (§5.2) en estos datos.

## 4. Qué parte exacta producía el crecimiento no lineal

No se optimizó por intuición: la ablación (se quita **una** pieza de la función anterior en una base de pruebas y se mide el resto) y las micro-pruebas del mecanismo (SQL puro) identifican cuatro causas:

**Vista previa — `_classify_financial_components` (perfil financiero, tiempo en ms para 1.000 / 2.000 / 4.000 elementos; `p` = exponente entre 2.000 y 4.000):**

| Tramo | 1.000 | 2.000 | 4.000 | p |
|---|---:|---:|---:|---:|
| Armar nodos y aristas (inserciones por lote) | 29 | 46 | 83 | 0,85 |
| **Unión de componentes** (un `UPDATE` de todos los nodos por arista) | 138 | 531 | 2.060 | **1,96** |
| **Análisis de componentes** (recorrido de miembros + búsqueda lineal de la fila de cada miembro en el respaldo) | 163 | 625 | 2.345 | **1,91** |
| ↳ sólo el `SELECT * … WHERE root = …` por componente | 91 | 309 | 1.191 | 1,95 |
| ↳ sólo la búsqueda `jsonb_array_elements(…) WHERE id = …` por miembro | 91 | 339 | 1.261 | 1,89 |

**Aplicación — versión anterior completa, perfil `mix`, ablación de una pieza por vez (ms para 1.000 / 2.000 / 4.000 elementos):**

| Variante | 1.000 | 2.000 | 4.000 | p |
|---|---:|---:|---:|---:|
| Completa | 1.443 | 3.105 | 7.801 | 1,33 |
| **Sin los disparadores de cuotas de R3** (un `count(*)` de la tabla de la cuenta por cada `INSERT` de una fila) | 972 | 1.905 | 4.671 | 1,29 |
| → costo del disparador por fila (diferencia) | **470** | **1.200** | **3.130** | **1,38** (32–40 % de la aplicación) |
| Sin la segunda pasada de clases (`UPDATE … FROM jsonb_array_elements(payload)`) | 1.403 | 3.182 | 8.037 | – (no cuesta nada) |

La segunda pasada **no** era una causa de lentitud (sí lo era de la imposibilidad de deshacer: §5.2). El resto de la aplicación (≈ 60 %) es el costo de escribir cada fila con su propio `INSERT` y de buscar cada elemento en el respaldo, que las micro-pruebas siguientes aíslan.

**Micro-pruebas del mecanismo en SQL puro (ms para 1.000 / 2.000 / 4.000 elementos):**

| Mecanismo | 1.000 | 2.000 | 4.000 | p |
|---|---:|---:|---:|---:|
| Una búsqueda lineal en el respaldo por elemento (`jsonb_array_elements(v) WHERE id = …`, lo que hacía cada `_apply_*`) | 227 | 836 | 3.297 | 1,98 |
| La misma búsqueda extrayendo el arreglo del documento cada vez (`p_payload->'x'`: además copia el subárbol) | 227 | 809 | 3.429 | 2,08 |
| Acumular el resultado con `v := v \|\| jsonb_build_object(…)` (lo que hacía cada clasificador) | 191 | 650 | 2.887 | 2,15 |
| **Lo mismo con una sola agregación** (`jsonb_agg`) | 3 | 5 | 9 | 0,80 |
| Unión de componentes con un `UPDATE` por arista (algoritmo anterior), cadena de n/4 nodos (250 / 500 / 1.000 nodos) | 768 | 7.310 | 65.661 | **3,17** |
| **La misma cadena con union-find en un arreglo** (algoritmo nuevo) | 3 | 3 | 4 | 0,37 |


Resumen de causas, en orden de peso:

1. **Búsqueda lineal en el respaldo por cada elemento** (`jsonb_array_elements(p_payload->'x') … WHERE id = …` dentro de cada bucle de `_apply_*` y de la clasificación financiera): *n* recorridos de *n* elementos, y además cada `->` copia el arreglo entero. Cuadrática.
2. **Unión de componentes financieras** con un `UPDATE` de **todos** los nodos por cada arista y un `SELECT … WHERE root = …` por componente (`_classify_financial_components`): cuadrática; era el 75 % de la vista previa de 10.000 filas.
3. **Acumulación con `v := v || jsonb_build_object(…)`** (cada concatenación copia todo el arreglo) y `_external_ref_available`, que recorría la lista clasificada para **cada** referencia: cuadráticas.
4. **El disparador por sentencia de cuotas de R3** (`tf_quota_after_insert`: un `count(*)` de la tabla de la cuenta) corría **una vez por fila** porque cada fila se insertaba con su propio `INSERT`: con *n* filas, *n* conteos de hasta *n* filas.
5. (Lineal pero costoso) **Deshacer**: dos huellas por fila más ≈ 22 consultas por alumno para buscar dependencias.

## 5. Hallazgos adicionales (defectos previos encontrados al medir)

Se encontraron al correr datos realistas; ninguno estaba en la lista del encargo, todos están en el camino de importación y se corrigen porque sin ello «deshacer completo» e «importación máxima» no se pueden probar de verdad:

1. **No se podía aplicar un respaldo con historial de niveles con id.** `_apply_student_level_history` (anterior) usa la variable `entry` fuera de la consulta que la define: `column "entry" does not exist`. Toda confirmación de un respaldo que trajera `levelHistory` con id fallaba (se revertía todo). Corregido en la versión nueva y cubierto con pruebas.
2. **No se podía deshacer una importación con vínculos entre filas** (clase liberada por otra, serie que reemplaza a otra, pago que reemplaza a otro, registro reprogramado). La importación escribía la fila, tomaba su instantánea y **después** la actualizaba en una segunda pasada: la huella de la instantánea ya no coincidía y la propia importación quedaba «editada después» → deshacer bloqueado para siempre. La versión nueva resuelve esas referencias **en el mismo `INSERT`** (ids asignados de antemano) y la instantánea coincide con la fila final.
3. **Los mensajes de error de la importación llevaban ids y nombres de tablas** (`La fila <uuid> de students cambió…`). La web los descarta (filtro anti-fuga) y mostraba el texto genérico en lugar de la explicación prevista; ahora los mensajes no llevan ningún dato y llegan al traductor (`deshacer bloqueado`, `desactualizado`…).
4. **Los reemplazos de campos de un alumno buscaban el candidato en los candidatos de *cualquier* vista previa** de ese alumno; ahora sólo en la de esta confirmación.

Observaciones **que no se cambian** (fuera de alcance; quedan para decisión):

* La clasificación sólo reconoce como «existente» una **serie, clase o acuerdo ya cargado en la web**, no los que la misma copia está agregando: en una primera importación a una cuenta vacía, las clases que pertenecen a una serie nueva, los registros que referencian una clase nueva y las series que referencian un acuerdo nuevo se **omiten** (`omitted_broken_reference`, se muestran en la vista previa). Es el comportamiento vigente desde la Fase 9 y se conserva exactamente.
* Los reemplazos de **porcentajes del presupuesto 50/30/20** fallan siempre: `_apply_singleton` actualiza cada campo por separado y el `CHECK` de suma 100 salta en el primero (falla en la versión anterior y en la nueva; esa función no se tocó).
* Un nivel personalizado del respaldo cuyo **nombre** ya existe en la web con otro id de la app móvil termina en «Ese registro ya existe» (restricción única por nombre) al confirmar.
* `_enforce_owner_match_fk` (disparador de integridad entre cuentas, 2 consultas dinámicas por fila y por clave foránea) es el **40 %** del tiempo de la aplicación ya optimizada (26.000 llamadas × ≈ 40 µs en 5.000 elementos). No se toca (es de otro bloque y su semántica es de seguridad); es la siguiente palanca si algún día hace falta subir el máximo.

## 6. Diseño nuevo

**Principios:** todo o nada (una RPC = una transacción de Postgres, sin «rollback manual»), idempotencia por `unique (owner_id, preview_id)`, aislamiento por `auth.uid()` + `owner_id` explícito en cada sentencia, mismo formato de respaldo móvil, mismas 6 RPC públicas con **la misma firma y los mismos privilegios** (compatibilidad con la web ya desplegada).

**Migraciones** (aditivas e idempotentes; sólo funciones nuevas o redefinidas con la misma firma; ningún `drop`, `truncate` ni cambio de tablas):

| Archivo | Contenido |
|---|---|
| `20261010100000_r6_import_limits_and_helpers.sql` | `_import_limits()` (fuente única de los límites), `_import_check_payload()` (forma, tamaño y conteo **antes** de procesar), `_import_arr()`, `_import_available_ids()` |
| `20261010110000_r6_import_preview_set_based.sql` | clasificadores por lote (`_import_classify_*`, componentes con union-find en arreglos), proyección de cuotas de R3 (`_import_project_quotas`) y `preview_backup_import` |
| `20261010120000_r6_import_apply_set_based.sql` | validación de decisiones, preparación del respaldo en tablas temporales tipadas (`_import_stage`), una sentencia por tabla (`_import_apply_*`), huellas por lote, invariantes en una pasada y `apply_backup_import` |
| `20261010130000_r6_import_undo_set_based.sql` | análisis común de deshacer (`_import_undo_analyze`), relaciones padre→hija (`_import_undo_relations`, idéntica al registro auditado), `preview_undo_backup_import` y `apply_undo_backup_import` |

Las funciones anteriores (`_classify_*`, `_apply_*`, `_external_*`) **no se tocan**: quedan sin llamadas y permiten volver atrás con `supabase/repairs/r6_import_rollback.sql` (§11). Todas las funciones nuevas nacen con `EXECUTE` revocado a `public`, `anon` y `authenticated` (el rol que migra en Supabase concede `EXECUTE` a `anon` por defecto: se revoca explícitamente y se comprueba).

**Vista previa** (sin lock de cuenta, es sólo lectura de datos de negocio): 1) rechazo por tamaño, forma y filas (`_import_check_payload`); 2) clasificación por lote: cada clasificador es **una** sentencia con uniones por hash (alumnos existentes por `(owner_id, legacy_mobile_id)`, candidatos a duplicado con **una unión por señal** —nombre, correo, teléfono— y no una comparación de cada alumno con cada candidato); 3) componentes financieras con **union-find en arreglos** (O(n·α), con compresión de caminos; la raíz es la menor clave, igual que antes); 4) los identificadores que se van a **agregar** no pueden repetirse; 5) proyección de cuotas de R3 (si ya se sabe que se superaría un tope, se avisa ahora y no se guarda nada); 6) huellas y candidatos a duplicado por lote.

**Aplicación** — orden (el lock sólo cubre lo que lo necesita):

1. *Sin lock:* vista previa (inmutable), reintento (si ya hay corrida, devuelve el resultado), validez, **validación de decisiones y reemplazos** (por lote) y **conversión del respaldo a tablas temporales tipadas** (`_ia_*`: una pasada, todas las conversiones de fechas, números e importes; un dato inválido falla acá, **sin esperar el lock**).
2. **Lock de la cuenta** (`pg_advisory_xact_lock(hashtext('backup_import:'||owner))`; el mismo de siempre, para serializar importaciones y deshacer de la misma cuenta; la purga de R4 sigue usando `try`-lock y salteando la cuenta ocupada). Se vuelve a leer la vista previa `FOR UPDATE` y se re-evalúa el reintento (dos confirmaciones simultáneas de la misma revisión: una aplica, la otra repite).
3. *Con lock:* corrida (`ON CONFLICT DO NOTHING`), re-verificación de huellas contra el estado **actual**, y la escritura: una sentencia por tabla en el orden topológico de siempre (alumnos → niveles → perfil/presupuesto/disponibilidad → acuerdos → historial de niveles → recargos → series → clases → excepciones → registros → cobros), cada una con su instantánea (`WITH ins AS (INSERT … RETURNING *) INSERT INTO import_run_row_snapshots …`), invariantes, resumen.

Como cada tabla es **una** sentencia, el disparador por sentencia de cuotas de R3 corre **una vez por tabla** (≈ 23 veces en total, medido) y sigue siendo la barrera final: una cuota alcanzada a mitad de la escritura revierte **todo**.

**Deshacer:** un análisis común (`_import_undo_analyze`) compara **una vez por lote** la huella de la fila viva con la de su instantánea y busca dependencias ajenas con **una consulta por relación** (50); la confirmación lo repite bajo el lock (**nunca** confía en `is_safe`), borra por tabla en el mismo orden inverso real y restaura los reemplazos (si una fila tiene vínculo y reemplazo, vuelve al estado **anterior a la importación**).

## 7. Límites

Todos medidos o derivados de un límite real, **explícitos** y repetidos en tres lugares (la web antes de llamar a la base, la RPC como defensa en profundidad y la pantalla del asistente, que ahora dice el máximo **antes** de empezar): `lib/backup/limits.ts` ⇄ `_import_limits()` (una prueba compara ambos con la migración).

| Límite | Valor | Justificación |
|---|---:|---|
| Tamaño del respaldo | 20 MB | Igual al límite real de `upload_cloud_backup` (móvil). Con 7.500 unidades el respaldo típico pesa ≈ 1,5 MB; un respaldo de 18 MB (2.000 alumnos con notas de 4.500 caracteres) se previsualiza y aplica dentro del presupuesto (la batería exige vista previa < 5 s y aplicación < 8 s, y pasa). |
| **Unidades de trabajo** (contadas + anidadas) | **7.500** | La medida real. Costo medido de la aplicación: 0,21–0,28 / 0,55–0,62 ms por unidad (estado rápido / estado lento). En el estado lento, con **7.500 unidades** el peor perfil tarda **4,7 s** (≈ 55–60 % del tope de 8 s) y en el estado rápido ≈ 2 s; con 10.000 unidades habrían sido ≈ 6 s en el estado lento (78 % del tope), sin margen para Production ni para otra carga. |
| Filas contadas (17 colecciones) | 7.500 | Ninguna de las dos partes puede, sola, pasar el presupuesto. |
| Filas anidadas | 7.500 | Ídem. |
| Filas por colección | 5.000 | Ninguna colección real se acerca (las cuotas de R3 son más bajas para alumnos, niveles y acuerdos). |
| Reemplazos de campos por confirmación | 2.000 | Cada uno cuesta una actualización + una instantánea (≈ 0,5 ms). |
| Decisiones de duplicado por confirmación | 2.000 | Ídem. |
| Profundidad / texto libre | 12 niveles / 10.000 caracteres | La forma real del respaldo no pasa de 4–5 niveles; sin cambios. |

**Rechazo antes de procesar y sin dejar nada:** la web controla el conteo antes de serializar el documento y antes de recorrer profundidad y textos (con 300.000 elementos rechaza en < 1 ms); la RPC controla tamaño, forma y conteos antes de **cualquier** lectura o escritura. Una colección que no es lista, un elemento sin identificador, una asignación sin pago o cobro, un ajuste sin cobro o un movimiento sin paquete se rechazan igual (antes terminaban en un error interno al analizar).

**Textos** (`lib/backup/import-copy.ts`): al pasar el máximo — *«Tu copia tiene más datos de los que se pueden importar de una sola vez (el límite es de 7.500 elementos …). No se cambió nada y tu copia en la nube sigue intacta. Avisá a soporte con el código y la pasamos a la web por partes.»* (código `backup_too_many_rows`); datos repetidos (`backup_duplicate_items`); demasiadas decisiones (`selection_too_large`); **tiempo agotado** (`operation_timeout`, detectado por el SQLSTATE `57014`, nunca por el texto) con la explicación según el paso (importar: *«se detuvo; no se importó nada a medias; mirá el historial… no se duplica nada»*). Sin ids, nombres de tablas ni datos personales; los registros de error llevan sólo categoría y código.

## 8. Equivalencia con la versión anterior

La prueba diferencial (`r6_differential.cjs`) levanta **dos** PostgreSQL reales (anterior y nuevo), siembra los mismos datos web con ids deterministas y compara, en 9 escenarios (vacío, mínimo, normal con y sin vínculos, alumnos pesado, financiero pesado, cadena y componente gigante, duplicados + conflictos + referencias rotas con decisiones, singletons): clasificación, resumen, **todas** las tablas de negocio (con los ids reemplazados por el id de la app móvil), instantáneas, reintento y, donde la versión anterior podía, deshacer. **Resultado: coinciden.** Diferencias admitidas y documentadas (todas mejoran o endurecen, ninguna cambia un resultado válido):

1. Las **componentes financieras** listan sus miembros en el orden de aparición en la copia (antes, el orden físico de una tabla temporal); si una componente tiene **varios** motivos para omitirse, el motivo mostrado es el del primer miembro por ese orden. El identificador, el estado y el conjunto de miembros son idénticos.
2. El **candidato a duplicado** (varios alumnos web sin id que coinciden con uno de la copia) es el más antiguo; antes, el primero que devolviera el motor sin orden definido.
3. Los **identificadores repetidos** entre lo que se va a agregar se rechazan al **previsualizar** (antes: «ya existe» al confirmar, con todo el trabajo hecho).
4. Dos decisiones para el mismo duplicado, dos vínculos al mismo alumno o dos reemplazos de la misma fila se rechazan (antes se procesaban en secuencia sin sentido).
5. Las instantáneas de filas con vínculo a otra de su tabla traen ya el vínculo (antes, desactualizadas: ver §5.2).
6. Mensajes sin ids ni tablas (§5.3) y formas inválidas rechazadas con un mensaje claro (antes: error interno).

## 9. Pruebas

* **Batería de importación** (`r6_import.cjs`, Postgres real 17.6): 157 comprobaciones: límites **−1 / exacto / +1** para cada límite (por colección, filas, anidadas, trabajo, bytes, decisiones y reemplazos; por la función y por la vista previa real); importación **vacía, mínima, normal y máxima** (con el tope de 8 s de la API fijado en la sesión); muchos alumnos con muchas relaciones; duplicados y conflictos con las cinco decisiones; referencias faltantes y cruzadas (otra cuenta); **dos propietarias en paralelo con los mismos ids móviles**; **dos importaciones simultáneas de la misma propietaria** (la misma revisión dos veces; revisiones distintas; revisiones que quieren agregar lo mismo; lock ocupado por otra conexión); **respuesta perdida y reintento** (también con la revisión vencida y con deshacer); **error a mitad de la aplicación** (disparador de prueba), **tiempo agotado a mitad** (`statement_timeout`) y **corte de la conexión** (`pg_terminate_backend`): TODO se revierte, no queda ninguna fila, instantánea, corrida ni lock, y reconfirmar importa **una sola vez**; deshacer completo y bloqueado (fila editada, dato posterior que depende); revisión vencida (de importación y de deshacer); **cuotas de R3** al previsualizar y **durante** la aplicación (revierte todo); **purga de R4** posterior; huellas completas de la cuenta (todas las tablas con `owner_id`) antes/después en cada caso; ningún mensaje propio lleva ids ni tablas.
* **Mutaciones** (`r6_import.cjs --mutations`): se rompe a propósito cada garantía y la batería lo detecta — **17/17**: clasificación y aplicación otra vez por elemento (cuadráticas), error tragado a mitad de la aplicación (atomicidad), reintento no reconocido (idempotencia), sin lock, lock antes del análisis, máximo agrandado, vista previa sin límites, cuotas sin proyectar, datos repetidos aceptados, instantáneas desactualizadas, deshacer sin re-verificar, sin comprobar dependencias, huellas sin verificar, decisiones sin validar, fuga entre cuentas, instantánea que no coincide con la fila.
* **Diferencial** (§8), **ensayo de migración** (`r6_migration_rehearsal.cjs`: 17 comprobaciones; transacción revertida —datos, funciones, disparadores, políticas, índices y privilegios idénticos salvo lo esperado—, idempotencia, compatibilidad con una vista previa pendiente y una corrida creadas **antes** de R6, y rollback exacto).
* **Web:** 19 pruebas unitarias nuevas o ampliadas (límites ±1 y rechazo temprano, arreglo de 300.000 elementos sin reventar la pila, textos de error y de tiempo agotado, paridad web ⇄ base de los límites, tiempo máximo de la página, máximo dicho en pantalla). Typecheck, lint y `next build` limpios; suite completa **1.081/1.081** (copia con saltos de línea LF; la línea base era 1.062).

## 10. Mediciones antes / después (mismos datos)

**Después** (sin tope, sólo para medir el escalado: en producción los respaldos de 5.000 y 10.000 elementos de este perfil se rechazan antes de procesar, ver §7):

| Elementos (contadas + anidadas) | Vista previa | Aplicar | Lock de la cuenta | Consultas (aplicar) | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 (100 + 129) | 158 ms | 390 ms | 234 ms | 2.125 | 31 MB | 210 ms | 276 ms |
| 500 (499 + 644) | 157 ms | 700 ms | 513 ms | 9.956 | 35 MB | 353 ms | 316 ms |
| 1.000 (997 + 1.287) | 203 ms | 787 ms | 621 ms | 19.250 | 41 MB | 303 ms | 374 ms |
| 2.000 (1.994 + 2.574) | 252 ms | 1,3 s | 1,1 s | 37.759 | 44 MB | 375 ms | 768 ms |
| 5.000 (4.985 + 6.434) | 382 ms | 2,6 s | 2,3 s | 92.744 | 63 MB | 727 ms | 2,6 s |
| 10.000 (9.970 + 12.867) | 607 ms | 4,9 s | 4,7 s | 185.272 | 95 MB | 1,6 s | 7,3 s |

**Comparación sobre los MISMOS datos:**

| Elementos | Vista previa antes → después | Aplicar antes → después | Lock antes → después | Consultas (aplicar) antes → después |
|---:|---|---|---|---|
| 100 | 246 ms → 158 ms (1,6×) | 441 ms → 390 ms (1,1×) | 284 ms → 234 ms (1,2×) | 3.323 → 2.125 |
| 500 | 293 ms → 157 ms (1,9×) | 900 ms → 700 ms (1,3×) | 838 ms → 513 ms (1,6×) | 16.556 → 9.956 |
| 1.000 | 298 ms → 203 ms (1,5×) | 1,5 s → 787 ms (1,9×) | 1,5 s → 621 ms (2,4×) | 33.055 → 19.250 |
| 2.000 | 589 ms → 252 ms (2,3×) | 3,4 s → 1,3 s (2,6×) | 3,3 s → 1,1 s (3,0×) | 66.143 → 37.759 |
| 5.000 | 2,7 s → 382 ms (7,0×) | 10,9 s → 2,6 s (4,2×) | 10,8 s → 2,3 s (4,7×) | 165.186 → 92.744 |
| 10.000 | 8,7 s → 607 ms (14,3×) | 28,6 s → 4,9 s (5,8×) | 28,5 s → 4,7 s (6,1×) | 334.695 → 185.272 |

Exponente de crecimiento entre 2.000 y 10.000 elementos (t ∝ n^p; p=1 lineal, p=2 cuadrático): vista previa **antes 1,67 → después 0,55**; aplicar **antes 1,33 → después 0,82**; revisar deshacer **antes 2,85 → después 0,89**.

**El máximo aceptado (7.500 unidades) en los cuatro perfiles, estado LENTO de la máquina** (el que se usa para fijar el máximo):

| Perfil | Unidades | Vista previa | Aplicar | Lock | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|
| mix (con historial de niveles) | 7.498 | 678 ms | 4,4 s | 4,0 s | 52 MB | 1,1 s | 1,6 s |
| financiero pesado | 7.499 | 826 ms | 4,7 s | 4,2 s | 49 MB | 1,2 s | 1,7 s |
| muchos alumnos con muchas relaciones | 7.495 | 663 ms | 4,2 s | 3,7 s | 55 MB | 1,5 s | 2,0 s |
| muchas filas anidadas | 7.499 | 593 ms | 4,4 s | 4,0 s | 45 MB | 920 ms | 1,1 s |

**Referencia: 10.000 unidades (el máximo que se había considerado) en el estado RÁPIDO** (2,1–2,8 s; en el estado lento serían ≈ 6 s):

| Perfil | Unidades | Vista previa | Aplicar | Lock | Memoria (aplicar) | Deshacer: revisar | Deshacer: confirmar |
|---|---:|---:|---:|---:|---:|---:|---:|
| mix (con historial de niveles) | 9.990 | 443 ms | 2,4 s | 2,2 s | 59 MB | 594 ms | 771 ms |
| financiero pesado | 10.000 | 518 ms | 2,8 s | 2,5 s | 56 MB | 695 ms | 939 ms |
| muchos alumnos con muchas relaciones | 10.000 | 497 ms | 2,1 s | 1,9 s | 60 MB | 1,0 s | 1,4 s |
| muchas filas anidadas | 9.994 | 354 ms | 2,5 s | 2,3 s | 50 MB | 622 ms | 618 ms |

**Web (validación de un respaldo en el servidor):** 2 ms con 100 elementos, 12 ms (+14 MB de heap) con el máximo aceptado (≈ 1,5 MB), 18 ms (+16 MB) con el máximo y notas de 9.000 caracteres (≈ 4,3 MB); rechazo por exceso en ≤ 1 ms, también con un arreglo de 300.000 elementos.

## 11. Despliegue, verificación y rollback

**Cierre en Production (7/oct/2026).** Commits (sin force, `c28e114..9b39cb8` por *fast-forward* a `teacherflow-web`): `93ef797` (migraciones, rollback y pruebas de base) y `9b39cb8` (web); este documento, en un tercer commit sin nuevo deploy.

1. **Línea base de sólo lectura antes de tocar nada** (`baseline6.sql`: huellas de datos —`cloud_backups` sólo por cantidad—, RLS, políticas, privilegios de tabla y de columna, cuerpos, `search_path` y privilegios de cada función, índices, disparadores, privilegios por defecto, `pg_cron`, migraciones): 217 filas, 96 funciones, 48 migraciones (`20261009120000`), **0 vistas previas, 0 corridas y 0 instantáneas de importación** (no hay ninguna importación en vuelo que el cambio pueda afectar), purga de R4 activa. Los cuerpos de las 4 RPC en Production coinciden (ignorando el retorno de carro) con los de las migraciones anteriores con las que se probó y se midió: lo que se probó es lo que había.
2. **Ensayo REVERTIDO en Production** (`BEGIN … RAISE EXCEPTION`, nada se confirma): las 4 migraciones, dos propietarias sintéticas creadas dentro de la transacción y un ciclo completo con ≈ 230 filas (vista previa → aplicar → reintento → deshacer → reintento), rechazo por exceso de filas, rechazo por datos repetidos y aislamiento entre cuentas. **Mismo resultado que en el Postgres local**: 230 filas escritas, el reintento repite la misma corrida, deshacer seguro y completo (230 borradas, 0 alumnos y 0 filas de negocio después), 29 funciones nuevas sin ningún `EXECUTE` para la API, privilegios de las 6 RPC iguales (`anon` no, `authenticated` sí). Después del ensayo, las tablas de la base quedaron con los mismos conteos (217 filas) y 0 filas de importación.
3. **Dry-run** (`db push --dry-run`): exactamente las 4 migraciones `20261010100000`…`20261010130000`, con SHA-256 iguales a los del commit. **Un único** `supabase db push --yes`.
4. **Después del push** (línea base nueva, tomada justo antes y justo después; las huellas de datos se comparan **tabla por tabla**): migraciones **52/52** (`local = remote`); **datos de las 48 tablas idénticos**; las **únicas funciones existentes modificadas son las 4 RPC** (`preview_backup_import`, `apply_backup_import`, `preview_undo_backup_import`, `apply_undo_backup_import`); 29 funciones nuevas, **todas `_import_*`, ninguna ejecutable por `anon` ni `authenticated`**; privilegios de las 6 RPC de importación iguales; RLS, políticas, privilegios de tabla y de columna, índices (192), disparadores (120), privilegios por defecto, funciones sin `search_path` vacío, `EXECUTE` de `anon` y trabajos de `pg_cron` **idénticos**. (La primera línea base difería de la de antes del push sólo por `active_sessions.last_seen_at`, el latido de la propia aplicación; no era un efecto del ensayo ni del cambio.) **API anónima** (clave pública `anon`): las 4 RPC y las internas probadas (`_import_limits`, `_import_check_payload`, `_import_undo_analyze`) → **401 / 42501**.
5. **Deploy** desde un checkout limpio (`dpl_6fbKWGTAw164RF6Woz7NpR9WNeM7`, `Ready`, producción; sin `supabase/.temp` ni `.vercel` en el árbol): `/login` 200, `/configuracion/respaldo` sin sesión → `/login?next=…`, cabeceras de R1 presentes. Los dos lados son compatibles entre sí y con la versión anterior de la web (mismas 6 RPC y firmas).
6. **QA de sólo lectura** con la sesión existente: **Respaldo** muestra «Hay un máximo por importación… hasta 7.500 elementos…» y el historial carga (consulta `import_runs` contra el esquema nuevo: «Todavía no importaste ningún respaldo»); Inicio y Calendario cargan; sin errores de consola; los logs del deployment no registran errores. **No se analizó ni se importó ninguna copia** (analizar lee la copia de la nube y escribe una vista previa: fuera de lo permitido en esta ronda).

**Qué NO se verificó en Production (a propósito):** una importación real de punta a punta con la copia de la profesora; las cuotas de R3 durante una confirmación real; la reacción del asistente ante un tiempo agotado real. Todo eso está cubierto por la batería y las mutaciones en Postgres 17.6 real y por el ensayo revertido de arriba.


**Rollback:** `supabase/repairs/r6_import_rollback.sql` vuelve a definir las 4 RPC públicas con el cuerpo **exacto** que tenían en Production antes de R6 (sacado de la base real y verificado: sus `prosrc` coinciden, salvo el retorno de carro, con los de las migraciones anteriores). Es una regresión deliberada (vuelven los problemas de §3 y §5): ejecutarlo sólo si R6 rompiera algo que la aplicación necesita. Se ensayó (§9). La web desplegada es compatible en las dos direcciones: usa las mismas 6 RPC con las mismas firmas.

## 12. Riesgos residuales y pendiente

* **Una cuenta con más de 7.500 unidades no se importa de una vez** (≈ un año de clases, registros y cobros de una cuenta grande). Es el costo de conservar «todo o nada» dentro de los 8 s de la API; el mensaje lo explica y manda a soporte. Subir el máximo requiere reducir el costo por fila (§5, `_enforce_owner_match_fk`) o un diseño de importación en varias confirmaciones (cambia la garantía de atomicidad: decisión del producto).
* Las observaciones de §5 que no se cambian.
* El deshacer vuelve a verificar **todo** bajo el lock (decisión de seguridad heredada): ≈ 2,0 s con el máximo.
* No se verificó en Production una importación real (a propósito: sólo lecturas, un ensayo revertido con dos cuentas sintéticas de ≈ 200 filas y estados seguros).
