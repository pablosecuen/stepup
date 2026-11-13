# Agenda operativa del Calendario

`lib/calendar/agenda.ts` es la ÚNICA regla que decide qué clases cuentan como una clase vigente.

* `composeCalendarView` (`lib/calendar/compose.ts`, puro) devuelve la vista COMPLETA de un rango: clases reales, ocurrencias de series y las filas que son historia (canceladas, orígenes de una reprogramación, clases reemplazadas). Los vínculos explícitos (`calendar_replacement_links`, `calendar_series_replacement_links`, `recurrence_exceptions`, `freed_by_lesson_id`) marcan `occupiesSlot: false` / `hiddenByReplacement`; nunca la coincidencia de fecha, hora o nombre.
* `resolveAgendaItems` / `isOperativeAgendaItem` / `occupiesAgendaSlot` dejan fuera: canceladas, origen liberado de una reprogramación y clases reemplazadas. «Desaparecer» = quitar de la agenda operativa; la fila, el registro, los cobros, la asistencia, los adjuntos y la auditoría NO se tocan.
* Se aplica ANTES de calcular carriles, numeración de simultáneas, contadores, pendientes, próxima clase, horarios libres y choques; nunca se esconde con CSS lo ya contado. Dos clases realmente vigentes en el mismo horario siguen siendo dos.
* Quedan en la lista completa (historial): la ficha del alumno, los registros, los cobros y las horas canceladas de las estadísticas.
* Tras cancelar, el detalle de la clase ofrece una sola vez «Reemplazar con otro alumno» y «Deshacer la cancelación» (la tarjeta ya no está en la grilla).

Pruebas: `lib/calendar/__tests__/agenda.test.ts` (regla, caso de la captura, guardas estructurales) y `supabase/tests/postgres/calendar_agenda.mjs` (operaciones reales en Postgres: cancelar suelta/virtual/materializada, reemplazar, reprogramar dentro del día / a otra semana / ya reprogramada, esta ocurrencia, esta y las siguientes, simultáneas legítimas, registro asociado, reintento, aislamiento, Inicio/pendientes/contador). Con `AGENDA_RULE=legacy` la batería reproduce el defecto (regla anterior): 8 pasos fallan.
