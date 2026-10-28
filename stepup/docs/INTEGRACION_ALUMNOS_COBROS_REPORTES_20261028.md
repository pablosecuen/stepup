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
