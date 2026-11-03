# Pendientes de clases reprogramadas — 2026-11-02

## Incidencia

Captura aportada: una clase del 28/10, reprogramada, seguía en «Clases por registrar» con «Continuar registro».

## Causa comprobada en código

La proyección de calendario conserva el origen histórico y lo marca con `occupiesSlot: false` o `hiddenByReplacement`. `isEligibleForPendingRegistration` no consultaba ninguna de esas marcas: una fila materializada con estado `scheduled`/`rescheduled` y un borrador seguía entrando en los pendientes. Además, Inicio reconstruía una base parcial del calendario y descartaba `replacementLinks`.

## Corrección

- La regla común de pendientes excluye los orígenes liberados y sustituidos antes de incorporar el progreso del registro. Afecta Registro, su contador y los recordatorios que usan esa proyección.
- El destino real conserva su elegibilidad en su nueva fecha: no se excluyen indiscriminadamente todas las clases con estado `rescheduled`.
- Inicio utiliza la base completa, incluidos los enlaces persistidos de reemplazo.
- Reprogramar invalida Calendario, Registro, Inicio y Recordatorios.
- Un enlace antiguo no puede iniciar/retomar el registro de un origen marcado como liberado o reemplazado; devuelve un aviso para registrar el nuevo horario.
- No se eliminan borradores, registros, clases históricas, cobros ni pagos. No hay migración ni reparación de datos.

## Verificación

Pruebas con el motor real de composición de calendario y de pendientes: origen materializado con borrador → reprogramación con destino futuro → cero pendientes del origen → llegada del nuevo horario → un único pendiente del destino. También sustitución persistida, grupo ajeno parcialmente completado y conservación del borrador. Se protege el cableado de Inicio y la invalidación tras reprogramar.

La captura demuestra el síntoma aportado por el usuario. No se atribuye una consulta ni una edición a su cuenta real: la reproducción de esta corrección usa datos sintéticos, sin tocar esa cuenta.

Suite completa: 5271/5271. Tipos y lint sin errores. Las pruebas de dominio cubren la composición de origen y destino, no sólo un cambio de texto en pantalla.
