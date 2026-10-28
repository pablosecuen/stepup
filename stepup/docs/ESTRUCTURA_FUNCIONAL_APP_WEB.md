# Comparación de estructura funcional — 28/10/2026

Trabajo directo desde `pago-aviso-web` (28a8c46), en la rama `parity-codex`. El original permanece sin modificar. La portada `landing-v2-web` no forma parte de esta integración.

La comparación se organiza por pantallas, acciones y datos. `.expo`, `node_modules`, `.teacherflow-*-test-build`, `.next` y configuraciones del editor no son funcionalidades que deban duplicarse en la web. Los módulos originales `integration-tests` y `transfer` se distinguen de las pantallas usadas por la profesora.

## Mapa de los módulos

| Estructura del original | Equivalente web | Diferencias funcionales que requieren trabajo |
|---|---|---|
| `features/account`, navegación y preferencias | Acceso, recuperación, `/dispositivo`, `/configuracion`, shell privado | El control de dispositivo necesita recorrido web↔app; recuperación sin conexión no equivale a cookies web. Tutorial reabrible agregado en `/configuracion/tutorial`. |
| `features/dashboard` | `/inicio`, `/recordatorios`, `/resumen-financiero` | Clase en curso heredada del commit base todavía requiere migración/publicación. Ajustar horario, corrección manual completa y actualización del aviso fuera de Inicio siguen abiertos. |
| `features/students` | `/alumnos`, filtros, tarjetas, niveles personalizados | Acciones rápidas completas de la lista, reactivación con situación mensual y eliminación definitiva siguen pendientes; la eliminación destructiva no está autorizada. |
| `features/new-student` | `/alumnos/nuevo`, `/alumnos/[id]/editar` | Edad, horarios habituales y situación financiera inicial deben resolverse sin alterar datos históricos. Los planes se administran desde Cobros. |
| `features/student-profile` | Siete pestañas en `/alumnos/[id]` | Se agregaron logros de nivel, notas y duración del logro; acciones de resumen y cobro histórico real. Corrección manual de sesión y situación inicial del mes siguen abiertas. |
| `features/calendar` | `/calendario`, nueva clase, series, disponibilidad | Se agregaron Información y modificación de participantes de una clase suelta/ocurrencia. Faltan conversión de actividad con su acuerdo, selector visual de disponibilidad y otros alcances de edición. |
| `features/new-class` | Registro programado y libre, editor compartido | Se conectaron `isBillable` y `consumesMonthlyPackage` al guardado común. `isBillable=false` también interviene en la sincronización del cargo por clase. No se cambia una mensualidad por marcar una clase. |
| `features/payments` | `/cobros`, pestaña Cobros, aviso de pago, planes y resumen | Sigue pendiente la situación inicial y su corrección, historial/riesgo individual completo. Paquete tiene motor sin interfaz conectada también en el original: no se inventa compra automática. |
| `features/reportes` | Pestaña Reportes, generador y almacenamiento privado de PDF | Compartir el archivo mediante selector nativo y copiar mensaje siguen pendientes. La previsualización y el PDF ya existen; no se declaran equivalentes por el nombre. |
| `features/backup` | Repositorios de importación/respaldo, Configuración/consistencia | La web guarda en servidor; no tiene la persistencia local ni la sincronización offline del original. Reparaciones destructivas no se ejecutan por inferencia. |
| `features/transfer` | `tools/transfer`, adaptadores y comparación del traslado | Herramientas de migración, no una pantalla cotidiana a replicar. El original continúa operativo. |
| `features/integration-tests`, `qa` | Pruebas web y Postgres aislado | Evidencia técnica, no nuevas funciones visibles. Las pruebas del núcleo copiado no prueban la conexión web por sí solas. |
| `shared`, `navigation`, `theme`, `assets` | `components/ui`, `lib`, shell, tokens y `public` | Adaptación a DOM/web conservando estética y funciones. No se copian controles nativos que rompen teclado/tacto; pruebas físicas siguen diferenciadas. |

## Implementación de esta ronda

- **Logro de nivel:** nivel CEFR, fecha real, nota, advertencia de salto/corrección, días transcurridos, historial y nivel actual en una transacción. Conserva niveles propios. Reintento y doble ventana no duplican el hito. Mapeo de historial antes omitía nota/duración y ahora los conserva.
- **Participantes de una clase:** búsqueda, selección, al menos uno, promoción del principal al quitarlo, actualización individual/grupal y bloqueo de edición si ya existe registro/cobro. Se materializa una ocurrencia virtual dentro de la misma transacción. No cambia las demás fechas. Crear alumno abre el alta en otra pestaña y luego permite actualizar: esto todavía difiere del alta inline del original.
- **Información:** leyenda usa los tokens reales del calendario; acceso conserva la fecha y vista de regreso. Incluye estados, colores, grupos, entrenamiento, clases cortas, bloqueos y acceso al tutorial.
- **Tutorial:** reabrible y salteable desde Configuración e Información; no modifica datos ni obliga a repetir el alta. La explicación de persistencia se adapta a la web y no promete escritura sin conexión.
- **Perfil:** accesos a registrar con alumno preseleccionado, Cobros, reprogramación de la próxima clase y edición. Inversión histórica calculada desde asignaciones de pagos vigentes, sin usar la tarifa actual.
- **Registro:** controles comunes de cobrable/consumo, disponibles cuando hay un alumno por clase, conservados al guardar progreso/finalizar/editar. Los pedidos antiguos sin esas claves conservan lo ya guardado. El cobro por clase respeta la opción no cobrable y la sincronización existente conserva cargos con pagos.

## Evidencia y publicación

Pruebas de Postgres aislado: logros 16, participantes 12 y controles de cobro 8 comprobaciones. El formulario real de logro se recorrió a 375 px con datos sintéticos, incluyendo advertencia de salto y bloqueo de guardado sin confirmación. No hubo desborde horizontal. No es un iPhone físico ni una prueba autenticada de producción.

Migraciones `20261029100000` (heredada), `20261030100000`, `20261030110000` y `20261030120000`: aplicadas a Production por el mecanismo normal de aprobación. El dry-run previo enumeró exactamente esas cuatro. No se reescribieron alumnos, clases ni pagos existentes.

Gate final: 5067/5067 pruebas, lint y compilación de producción correctos. El build incluye el chequeo TypeScript. Compilación local con `--webpack` porque Turbopack rechaza un `node_modules` enlazado fuera del worktree; no se cambió la configuración de producción. Webpack advierte sobre una dependencia dinámica ya existente de `libheif-js`.

Publicado `de9cd61` por la integración oficial Vercel, en `teacherflow-web`, despliegue `dpl_AqCMUtFuv1XcVhCYUCigXgmXLxtv`, READY y asignado a teacherflowapp.com. No depende del inicio de sesión del CLI por correo. La auditoría actualizada, diferencias concretas y método del porcentaje están en `AUDITORIA_FUNCIONAL_20261028.md` y su JSON reproducible. La sesión única del original se cambia por pedido expreso de Joaquín a dos navegadores/PWA simultáneos; el permiso de respaldo de la app nativa queda separado.

La comparación estructural queda agrupada aquí; el detalle de funciones previo permanece en `MATRIZ_EQUIVALENCIA_APP_WEB.md`. Esta ronda no convierte los casos pendientes de esa matriz en equivalentes ni declara terminada la migración.
