# Integración de la entrega de Claude — 28/10/2026

Entrega local original: rama alumnos-cobros-reportes, commits 358dca4, 86424a0, 5dba0a2 y 3d1e3b3, basada en 7dde04b. Se integró en parity-codex conservando el calendario, registro y las dos sesiones ya publicados.

## Revisión y correcciones de integración

- Migración renumerada a 20261031120000 porque 20261031100000 ya estaba aplicada para calendario/registro. No se modificó ninguna migración aplicada.
- Reactivar un alumno y decidir desde cuándo retomar su mensualidad son ahora una sola transacción. La elección se valida en servidor; fallos revierten estado, historial y cargos. Dos llamadas simultáneas dejan una entrada y una obligación.
- Compartir prepara el PDF privado antes del toque que abre el selector del sistema. Descargar usa el archivo ya preparado, sin depender de abrir una ventana después de esperar una petición.
- Las declaraciones iniciales se identifican como tales también en meses anteriores, sin presentarlas como un pago observado en efectivo.
- Se conservaron los controles de importes estrictos, centavos, aislamiento de cuentas, historial y acuerdos de entrenamiento.
- Se contrastaron los hallazgos: el alta original sólo ofrece por clase/mensual; días/horarios habituales no se capturan ni guardan desde su pantalla. No se añadieron campos sin efecto.

## Pruebas previas a publicar

- Suite integrada: 5104/5104.
- Postgres real aislado: 53/53, incluida comparación con la lógica original, concurrencia, reversión intermedia, permisos y preservación de pagos previos.
- Tipos, lint y compilación sobre la versión integrada.
- Migración 20261031120000 aplicada antes de desplegar el código.

## Comparación estructural actualizada

73 bloques disponibles + 6 diferencias vigentes + 7 parciales + 1 faltante, sobre 87 comparables. Disponibles/diferencia vigente: 90,8 %. Índice ponderado (parcial=0,5): 94,8 %. Estos índices no certifican todos los circuitos ni dispositivos.

Restan ACC-07 (trabajo sin red), INI-04 (tarjeta mensual dentro de Inicio), INI-14 (preferencia de ubicación de navegación), INI-15 (crear/eliminar ejemplos), ALU-10 (eliminación definitiva, excluida del bloque por su impacto), PAG-09 y CFG-02 (reparaciones/reconciliaciones seguras), UX-01 (verificación física completa). No se convierte el inventario antiguo de archivos en una lista de funciones ausentes.

El cuadro de puntualidad mostrado en el video del 28/10 queda como pedido separado: esta integración no lo elimina.

## Verificación autenticada de la integración en producción

Sólo cuenta de QA matias. Alta a 375 px: QA Integración Mensual, edad 30, dos objetivos, cuota de $1.500 y mes declarado pago. Reabrir confirmó los datos; edición a edad 31 y objetivos actualizados guardada. Cobros a 390 px: una obligación de $1.500, un pago declarado y mes saldado, sin puntaje inventado por historial insuficiente. Pausar y restaurar exigiendo elección «Cobrar desde este mes» funcionó; conservó el mes saldado sin duplicarlo.

Lista a 430 px: el menú de QA Tres Prueba abrió sus reportes, no los de otro alumno. Compartir preparó el archivo y ofreció descargar/copiar/selector del sistema. La descarga produjo un PDF real de 83.842 bytes, firma %PDF-. No se abrió un contacto ni se envió nada. Captura local: output/qa-parity-20261028-codex/compartir-pdf-integrado-qa.png. Se restauró el tamaño de escritorio.

Se detectó además que el selector de próxima clase aún incluía el origen liberado de una reprogramación; se corrigió para que el menú y el perfil utilicen el destino real, conservando la tarjeta histórica del origen en el calendario. Se agregó prueba de regresión. Continúan separadas las pruebas físicas de iPhone/Safari y las ocho diferencias listadas arriba.

Verificación final tras la corrección de próxima clase: 5105/5105 pruebas, tipos/lint/build sin errores. La reapertura de la edición de QA Integración Mensual confirmó edad 31 y los objetivos actualizados. No se enviaron reportes ni se cerró la sesión de QA.

## Publicación y control final

Código final 1226c1e, despliegue dpl_2rPVJ6XJ6xsY7c7baqr9EMByvMTq READY en teacherflowapp.com (teacherflow-kssxyvdii-teacherflow.vercel.app). Base remota al día, sin migraciones pendientes. Tras recargar producción, la fila QA Paridad Inline muestra «Mañana 20:30», el destino real, y no el origen liberado 09:30. La sesión de QA queda iniciada; no se cambió nada de la cuenta real.
