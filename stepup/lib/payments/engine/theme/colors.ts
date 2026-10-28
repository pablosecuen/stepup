// Puerto VERBATIM del original (`src/theme/colors.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
// Paleta de TeacherFlow — minimalista, estilo Apple.
// Azul = color de marca / acciones. Verde/Amarillo/Naranja/Rojo se reservan
// exclusivamente para el semáforo de estado de cobro (nunca se usa el verde
// de marca fuera de "Pagado", para no generar ambigüedad visual).
//
// Excepción documentada (2026-07-16, a pedido explícito de Joaquín): el
// mismo verde/amarillo/naranja/rojo se reutiliza también para el color de
// demanda por día del Calendario (`calendarDemandColors`, más abajo) — es
// una pantalla distinta (Calendario, no Cobros/Perfil), y siempre se
// acompaña de texto/ícono, nunca sólo el color.

export const colors = {
  // Fondo operativo neutro. El degradado pastel de las pantallas
  // principales se dibuja por separado; así perfiles, formularios y
  // modales no quedan teñidos de amarillo.
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  border: '#E3E5E8',

  textPrimary: '#080808',
  textSecondary: '#5D6168',
  textMuted: '#9499A1',

  // Renovación visual (2026-07-17, versión aprobada por Joaquín): azul de
  // acción actualizado de #0A84FF a #168CF4 — sigue siendo EXCLUSIVAMENTE
  // para acciones/enlaces/selección/foco, nunca decorativo.
  brandBlue: '#168CF4',
  brandBlueDark: '#0060DF',

  // Semáforo de cobros — confirmado con la profesora
  statusVerde: '#2FB350', // pago a tiempo (día 1–10)
  statusAmarillo: '#E8B400', // 1er vencimiento (día 11–18, +10%)
  statusNaranja: '#F07C1D', // 2do vencimiento (día 19–26, +5% adicional)
  statusRojo: '#E0362B', // último vencimiento (día 27–fin de mes, +5% adicional)

  // Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
  // tarjetas de Alumnos): dos estados que el semáforo de 4 colores no podía
  // distinguir de "pagado"/"vencido". Nunca reutiliza `brandBlue` (esa
  // reserva es exclusiva de acciones/enlaces, ver comentario de arriba).
  statusPendiente: '#4361B8', // pendiente EN TÉRMINO (día 1–10 del mes, sin recargo) — nunca "Al día"
  statusSinDatos: '#9499A1', // sin plan mensual, comienza el próximo mes, o cargo todavía sin generar (mismo tono que textMuted)

  white: '#FFFFFF',

  // Uso exclusivo del badge "Alumno destacado" — deliberadamente distinto
  // de statusAmarillo para no mezclar semántica de cobros con esto.
  highlight: '#C98A00',

  danger: '#E0362B',

  // Renovación visual (2026-07-17, versión aprobada por Joaquín) — paleta
  // de identidad de marca (ícono, splash, monograma T·F, acentos
  // editoriales puntuales en encabezados/tarjetas). `ink`/`ivory` no
  // reemplazan `background`/`textPrimary` de la UI operativa general —
  // esas pantallas siguen claras y tranquilas, sólo la marca y algunos
  // acentos puntuales usan este par negro/marfil.
  ink: '#080808',
  ivory: '#F2EEDF',
  graphite: '#252525',
  warmGray: '#F0F1F2',
  softSky: '#DCEEFF',
  softLavender: '#E9E2FF',
  softPeach: '#FFE4D2',
  softSage: '#DDEDDC',
  softBlue: '#EAF4FF',

  // Alias semánticos consumidos por los componentes visuales más nuevos.
  // Conservan una única paleta y evitan duplicar hexadecimales en la UI.
  pastelSky: '#DCEEFF',
  pastelSkyText: '#245A7A',
  pastelLavender: '#E9E2FF',
  pastelLavenderText: '#5A4780',
  pastelPeach: '#FFE4D2',
  pastelPeachText: '#8A4B25',
  pastelSage: '#DDEDDC',
  pastelSageText: '#35613B',
  pastelRose: '#F8DEDF',
  pastelRoseText: '#8C3F46',
  pastelReplacement: '#DDF4EE',
  pastelReplacementText: '#176B5B',

  // Corrección puntual 2026-08-18 (a pedido de Joaquín — escala cromática
  // CONGELADA del Calendario, ver CLAUDE.md "Reglas visuales congeladas
  // del calendario"): tokens EXCLUSIVOS de las tarjetas del Calendario —
  // nunca reutilizar `pastelSky`/`pastelPeach`/`pastelLavender`/
  // `pastelReplacement` de arriba, que siguen siendo los colores reales de
  // otras pantallas (Onboarding, NextClassCard, SwipeableStudentRow) y no
  // deben cambiar. Sólo Joaquín puede autorizar modificar estos valores.
  calendarOnlineBg: '#DDEEFF',
  calendarOnlineBorder: '#2D6F91',
  calendarPresencialBg: '#FCE4D2',
  calendarPresencialBorder: '#A85A2A',
  calendarMixtaBg: '#E9DDFC',
  calendarMixtaBorder: '#67458F',
  // Corrección puntual 2026-08-18 (a pedido de Joaquín — DIFERENCIAR
  // CANCELADA DE PRESENCIAL/GRUPAL): el naranja anterior (#FFE3C2/#D97706)
  // se confundía con el durazno de `calendarPresencialBg/Border`
  // (#FCE4D2/#A85A2A) — ámbar nuevo, más claro y más saturado, sin
  // solaparse con presencial ni con ningún otro color congelado. Prioridad
  // absoluta sobre la regla de "clase transcurrida": una cancelada NUNCA
  // se vuelve gris oscuro por el paso del tiempo.
  calendarCancelledBg: '#FFF1B8',
  calendarCancelledBorder: '#D99100',
  calendarCancelledTextPrimary: '#7A4B00',
  calendarCancelledTextSecondary: '#9A6200',
  // Corrección puntual 2026-08-18 (a pedido de Joaquín — CAMBIO VISUAL
  // PUNTUAL, CLASES DADAS Y CANCELADAS): gris oscuro FIJO para toda clase
  // NO cancelada cuya hora de FINALIZACIÓN ya pasó — tiene prioridad sobre
  // la modalidad y sobre un reemplazo activo (ver CLAUDE.md). Reemplaza la
  // corrección anterior del mismo día (mezcla de gris sobre el color de
  // modalidad) — esa regla queda descartada, no combinada.
  calendarElapsedBg: '#D1D5DB',
  calendarElapsedBorder: '#4B5563',
  calendarElapsedTextPrimary: '#374151',
  calendarElapsedTextSecondary: '#4B5563',
  // Coral pastel reservado EXCLUSIVAMENTE para un reemplazo activo, válido
  // y FUTURO (si su horario ya terminó, pasa a gris oscuro de "clase
  // transcurrida", nunca queda coral) — nunca verde, violeta, azul,
  // naranja, ni el rojo de errores.
  calendarReplacementBg: '#FCE8E6',
  calendarReplacementBorder: '#D96C68',

  // Corrección 2026-07-22 (a pedido de Joaquín — "MODALIDAD VISIBLE +
  // INFORMACIÓN"): bloque de disponibilidad (trabajo/estudio/vacaciones/
  // feriado/licencia) en la grilla del Calendario. Antes vivían como
  // hexadecimales sueltos directamente en `WeekTimeGrid.tsx` — ahora acá,
  // única fuente, para que la pantalla "Información" pueda mostrar
  // exactamente el mismo color sin copiarlo a mano.
  availabilityBlockBg: '#D9DDE3',
  availabilityBlockBorder: '#8A929E',
  availabilityBlockText: '#4B5563',

  // Corrección 2026-08-11 (a pedido de Joaquín — corrección urgente de
  // registro de clases: 4to estado de asistencia "Ausente con aviso"):
  // color propio, deliberadamente distinto del semáforo de cobros/calendario
  // (reservado arriba) y de `highlight` (exclusivo del badge "Alumno
  // destacado") — evita mezclar la semántica de otra pantalla con la fila
  // de asistencia. Siempre se acompaña de texto/ícono, nunca sólo el color.
  attendanceAvisoColor: '#C97A22',
} as const;

export type StatusColorKey =
  | 'statusVerde'
  | 'statusAmarillo'
  | 'statusNaranja'
  | 'statusRojo'
  | 'statusPendiente'
  | 'statusSinDatos';

/**
 * Color de demanda por día en el Calendario (2026-07-16, a pedido de
 * Joaquín) — ver `src/features/calendar/utils/calendarDailyDemand.ts` para
 * los rangos de horas libres exactos que definen cada nivel. Mismos tonos
 * que el semáforo de cobros (por legibilidad: verde = tranquilo, rojo =
 * urgente ya es un lenguaje aprendido en el resto de la app), con dos
 * niveles nuevos que el semáforo de cobros no tiene: `completo` (negro, el
 * día no tiene ni un hueco libre) y `vacaciones` (gris oscuro, un día
 * completo marcado como vacaciones — siempre distinto de "completo": uno
 * es "ocupada dando clases", el otro es "el día libre de la profesora").
 */
export const calendarDemandColors = {
  libre: colors.statusVerde,
  media: colors.statusAmarillo,
  ocupado: colors.statusNaranja,
  saturado: colors.statusRojo,
  completo: '#1C1C1E',
  vacaciones: '#6E6E73',
} as const;
