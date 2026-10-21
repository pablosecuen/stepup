# Traslado Expo Go → web: plan final y aprobación única

Estado (20/10/2026): **el circuito completo está construido y probado en local con datos sintéticos**; nada se aplicó en Production. El origen (respaldos de la nube y datos del teléfono) se conserva intacto: congelarlo requiere tu confirmación posterior, con el cotejo final en la mano.

## 1. Qué se recupera desde Supabase y qué es exclusivo del teléfono

| | Dónde está | Estado |
|---|---|---|
| Datos (alumnos, clases, series, cobros, pagos, historiales, reportes de texto…) | último respaldo de la nube (Supabase) | Ensayo real sin diferencias (3.643 filas, 33.964 campos). **El corte NO usa esa copia (es antigua): usa la última en el momento de importar** (ver §4) |
| Respaldos de la nube (la app anterior rota: sólo conserva los 10 últimos) | Supabase | R11 los archiva de forma permanente (paso 3) |
| 80 fotos de clases | **sólo teléfono** | Revisión real de sólo lectura (20/10): 80/80 encontradas, 170,6 MB, la mayor 4,59 MB, **64 HEIC reales**, 14 JPEG, 2 PNG, 0 con tamaño distinto |
| Materiales con archivo, PDF de reportes | **sólo teléfono** | 0 y 0: nada que copiar |
| Estado del teléfono | — | 0 operaciones pendientes, sin clase en curso |

Fuentes alternativas descartadas: la copia de iPhone de esta computadora es de 2024; la app anterior no sube archivos a ningún almacenamiento.

## 2. Tu intervención (completa)

1. **Abrir `tools\transfer\Ejecutar-traslado.cmd` UNA vez** y escribir tu correo y contraseña en el formulario (nunca en el chat). Esa única sesión sirve para TODAS las fases; si la sesión caduca durante la ejecución, el programa vuelve a entrar con lo ya escrito (sólo en la memoria del proceso), sin pedirlo otra vez.
2. **Teléfono desbloqueado con Expo Go abierto** cuando la ventana lo pida: primero para la **pausa de carga** (justo antes del paso 5: el teléfono confirma, sólo leyendo su marcador de protección, que TODO lo cargado ya está respaldado en la nube), luego durante el paso 6 y otra vez en el paso 7 (unos minutos; sin tocar nada). La computadora pide la recarga a Metro y el teléfono responde solo.
3. **Confirmar antes de congelar el origen**, con el cotejo final a la vista.
4. **Pausa de carga** desde el paso 5 hasta el final: no cargar clases ni cobros en la app anterior (si se carga algo, el paso 7 lo detecta; ver §4).

Todo lo demás lo hago yo desde la computadora (migraciones, despliegue, verificaciones).

## 3. Los 7 pasos (en este orden; cada uno corre sólo si el anterior verificó)

«Orquestador» = `Ejecutar-traslado.cmd` (una sesión, reanudable: cada fase mira primero qué hay en la cuenta, así que repetirlo no duplica ni pierde nada).

| # | Quién | Acción en Production | Verificación | Vuelta atrás |
|---|---|---|---|---|
| 1 | orquestador | **Respaldos previos (sólo lectura):** copia cifrada (Windows DPAPI) del origen y del destino, con la recuperación comprobada leyendo lo escrito en disco; nunca se pisa una copia anterior | copias abiertas desde el disco | — (no modifica nada) |
| 2 | yo | **Migraciones R9, R10, R11, R12, R13 y R14** (`supabase migration list --linked` → `db push --dry-run` → ensayo `BEGIN…ROLLBACK` → un único `db push --yes`). El orquestador detecta solo que el esquema quedó completo | tablas, funciones y bucket `lesson-files` presentes | `supabase/repairs/r14…r9_*_rollback.sql` en orden inverso (R13 y R11 se niegan a ejecutarse si ya hay datos nuevos: no destruyen información) |
| 3 | orquestador | **Archivo permanente del origen** (`archive_legacy_cloud_backups`): conserva todos los respaldos de la nube antes de que la rotación borre ninguno | el último respaldo está en el archivo | no se deshace: sólo agrega |
| 4 | yo | **Código de la web** (importación, incidencias heredadas, excesos de pago, vista previa de fotos HEIC y su ruta de archivos): commit local de `transfer-prep-web`, `git push origin transfer-prep-web:teacherflow-web` y `vercel deploy --prod` desde checkout limpio. Al verificarlo, creo `despliegue-verificado.txt` y el orquestador sigue | Inicio, Alumnos y Cobros responden; la ruta de archivos sin sesión da 401 | `vercel rollback` al despliegue anterior |
| 5 | orquestador | **Pausa de carga verificada en el teléfono** (si hay cambios sin respaldar, espera y no avanza) y **importación** con el último respaldo de ESE momento (archivado y guardado cifrado): vista previa limpia (0 conflictos, 0 duplicados, 0 filas sin agregar, 0 omitidas) → aplicar → **cotejo inmediato** destino ↔ origen (campos, balance de filas) | 0 defectos y el balance cierra | **automática**: si el cotejo encuentra una diferencia, la importación se DESHACE sola (se prueba) |
| 6 | orquestador + teléfono | **Copia de las 80 fotos:** control de capacidad (§5) → prueba con UN archivo (se prefiere una foto HEIC) con verificación → copia completa. Cada archivo se sube sin pisar uno existente, con su formato real. Después el orquestador **descarga cada archivo de la cuenta y verifica huella SHA-256, tamaño y formato** (no confía en lo que informa el teléfono). Los que el teléfono ya no tenga se declaran **ausentes**, nunca copiados | todos «verificados»; 0 pendientes; ausentes declarados aparte | lo copiado no se borra (es sólo almacenamiento); la importación se deshace sin tocarlo |
| 7 | orquestador | **Copia final actualizada:** nuevas copias cifradas del origen y del destino, archivo permanente del último respaldo, comparación con lo importado y **cotejo final** con integridad de archivos | veredicto COMPLETO (sin diferencias, 0 pendientes, ausentes comprobados leyendo el teléfono) | — |

**Fuera de esta aprobación:** congelar el origen (`freeze_legacy_source`), dejar la app anterior en modo consulta y declarar el traslado completo. No se declara completo mientras falte algún archivo.

## 4. Copia final actualizada (la del ensayo no sirve para el corte)

- Cada importación (paso 5) toma **el último respaldo de la nube en ese momento**, lo archiva (paso 3) y guarda una copia cifrada «importada». La copia del ensayo del 19/10 y el ensayo real no se usan para el corte.
- El paso 7 vuelve a leer el último respaldo. Si **el contenido** cambió respecto de lo importado (se cargó algo en la app anterior), se frena con «CAMBIOS POSTERIORES» (con la cantidad de nuevos/cambiados/quitados) y no se da por completo. Un respaldo nuevo con los mismos datos no cuenta como cambio.
- Remedio probado: `--rehacer` deshace la importación (sólo si es seguro), importa la copia más reciente, vuelve a registrar los archivos (los adjuntos ya subidos se reconocen por su contenido: no se duplican) y repite el cotejo.

## 5. Capacidad de almacenamiento (resuelta)

El plan del proyecto no se puede consultar sin credenciales del panel, así que el control usa el **piso que garantiza cualquier plan de Supabase: 1 GB de archivos** (y archivos de hasta 50 MB; el bucket limita a 20 MiB por archivo):

| | |
|---|---|
| A copiar (lo medido en el teléfono) | 170,6 MB (80 fotos), 0 materiales, 0 PDF |
| Ya usado en la cuenta | ≈ 0 (el bucket `lesson-files` todavía no existe) |
| Mayor archivo | 4,59 MB (tope 20 MiB) |
| Ocupación con la copia | **≈ 16,7 % del cupo mínimo** (se deja siempre 10 % libre) |

El orquestador repite esta cuenta con los datos reales de la cuenta justo antes de llamar al teléfono y se frena, sin molestarlo, si no entra (probado).

## 6. Qué se probó (todo local, datos sintéticos, Postgres real aislado)

- **Recorrido completo** (`supabase/tests/postgres/orchestrator_rehearsal.cjs`, 32/32): respaldar → esperar migraciones → archivo → puerta de despliegue → importar con falla simulada y **vuelta atrás automática** → reanudar sin duplicar → capacidad → copia de archivos con **tres interrupciones** (el teléfono se bloquea al empezar, tras la prueba, a mitad de la copia) → integridad → cambios posteriores → `--rehacer` → cotejo final COMPLETO → sesión caducada.
- **Credenciales una sola vez:** una sola sesión en todo el circuito; con la sesión caducada se reingresa con lo que ya está en memoria (2 inicios en total, sin pedir nada). El ejecutable real, lanzado como proceso aparte con las credenciales por la entrada estándar, rechaza una contraseña mala (código 10) y no imprime ni guarda correo, contraseña ni datos personales.
- **Origen intacto:** sin congelar, 0 respaldos borrados, copias del origen conservadas.
- **Teléfono:** el módulo temporal de copia compila en la app (typecheck 0 errores), se instala y se borra solo, y la app queda idéntica; el módulo se ejercitó con un teléfono simulado que corre el mismo `runPhoneExtraction`.
- 10 pruebas de unidad del orquestador, 3 del canal del teléfono; ensayos de migraciones R9–R14 y del extractor vuelven a pasar.

## 7. Hallazgos de la prueba que cambiaron el plan

1. **Defecto real, corregido con R14:** declarar que el teléfono ya no tiene un archivo bloqueaba «deshacer» toda la importación (después de un solo ausente no se podía rehacer ni volver atrás). R14 lo corrige (ensayada con y sin la migración, idempotente, con su rollback).
2. Los PDF de reportes se guardan bajo el id del reporte: al rehacer se vuelven a subir y el anterior queda **huérfano** (inofensivo, se avisa, no se borra). Hoy hay 0 PDF de reportes.
3. La integridad exige la **familia** del archivo (foto o PDF), no el tipo que declaraba la app: las fotos «.HEIC» que en realidad son JPEG no son un problema.

## 8. Condiciones que frenan sin consultarte

- Cualquier diferencia en el cotejo (campos, filas, balance): importación deshecha sola y se informa.
- Un archivo del teléfono que no se encuentra: **ausente**, no copiado; el traslado no se da por completo.
- Un archivo copiado que no pasa la verificación de huella, tamaño o formato; un pendiente que no se copió ni se declaró ausente.
- El teléfono no responde o se bloquea: se informa, lo copiado queda a salvo y se retoma sin duplicar.
- Deshacer no es seguro (hay datos creados después): no se toca nada y se informa qué tablas.
- Cupo de almacenamiento insuficiente: no se llama al teléfono.

## 9. Solicitud de aprobación (única)

> **«Apruebo ejecutar el traslado en Production: pasos 1 a 7 del plan (migraciones R9 a R14 incluidas), en ese orden, con las verificaciones y vueltas atrás indicadas. No se congela el origen ni se borra nada sin una confirmación mía posterior.»**
