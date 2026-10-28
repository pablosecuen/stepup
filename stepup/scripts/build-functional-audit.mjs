import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(path.join(root,'docs/MATRIZ_EQUIVALENCIA_APP_WEB.md'),'utf8');
const parseIds=text=>new Set(text.split(/\s+/).filter(Boolean));
const missing=parseIds('ACC-06 ALU-09 ALU-10 ALU-15 ALU-17 CAL-03 CAL-08 PAG-05 PAG-07');
const partial=parseIds('ACC-07 INI-04 INI-07 INI-14 INI-15 ALU-03 ALU-04 ALU-05 ALU-16 CAL-04 CAL-05 CAL-09 REG-04 REG-06 REG-08 REG-09 REG-11 REG-13 PAG-09 REP-03 CFG-02 UX-01');
const intentional=parseIds('ACC-02 CAL-10 CAL-11 REG-07 PAG-06 CFG-01');
const excluded=parseIds('CFG-04 UX-02');
const notes={
 'ACC-02':'Pedido nuevo: dos navegadores/PWA simultáneos. Antes la web copiaba el bloqueo de un único dispositivo. La app nativa conserva su permiso independiente de respaldo; no se habilitan dos escritores locales sobre una copia móvil.',
 'ACC-06':'Falta el interruptor de seguimiento de clases en vivo de Configuración. Tener botones Comenzar/Finalizar en Inicio no sustituye esa preferencia.',
 'ACC-07':'Cookies y enlaces web sustituyen almacenamiento seguro/deep links. Falta abrir y trabajar sin red durante la ventana que sí tiene el original; no hay cola offline equivalente.',
 'INI-04':'La web tiene Resumen financiero y cobros de hoy; falta la misma tarjeta mensual completa dentro de Inicio (previsto/cobrado/pendiente/vencido).',
 'INI-07':'Comenzar, finalizar, puntualidad y corregir inicio existen y están publicados. Faltan Ajustar horario y el aviso específico de sesión restaurada; el aviso del navegador sólo se mantiene mientras está montado Inicio.',
 'INI-14':'Falta elegir barra inferior o menú del logo. La web decide por ancho; cambiar la estética no autoriza quitar una preferencia funcional.',
 'INI-15':'La web permite ocultar/mostrar datos marcados de QA. No equivale al circuito completo de crear/eliminar ejemplos del original.',
 'ALU-03':'Hay acciones en el resumen del perfil, pero no todas están disponibles directamente en cada fila de la lista. Faltan accesos de compartir reporte y varios cambios de estado desde ese lugar.',
 'ALU-04':'Alta y edición básicas existen. La acción no recibe edad, objetivos académicos ni días/hora habituales como el formulario original; el perfil tampoco los ofrece completos. El nombre completo en un campo conserva el dato, pero no es la misma captura separada.',
 'ALU-05':'Los planes semanal/quincenal/paquete/sin cargo ya existen al editar el plan. El alta no ofrece la misma configuración completa ni la decisión inicial pago/pendiente del mes.',
 'ALU-09':'Falta reactivar ofreciendo comenzar la mensualidad este mes o el próximo, conservando historial y sin duplicar deuda.',
 'ALU-10':'Falta la eliminación definitiva en cascada. Se mantiene pendiente de decisión porque el original borra historial financiero; no se implementa por inferencia.',
 'ALU-12':'Resumen y accesos rápidos implementados; inversión histórica desde asignaciones vigentes. No se extrapola la tarifa actual al pasado.',
 'ALU-13':'La evolución mensual de puntualidad sí está implementada (no falta, aunque la matriz vieja lo decía). Falta completar verificación autenticada de este bloque.',
 'ALU-14':'Logro de nivel, fecha, nota, salto/corrección y duración ya implementados con RPC atómica; falta recorrido autenticado en producción.',
 'ALU-15':'Falta corregir inicio, fin y puntualidad de una clase ya guardada desde su historial. Corregir inicio de la clase actualmente en curso no cubre esto.',
 'ALU-16':'Plan y monto mensual ya editables; faltan situación inicial/corrección y accesos equivalentes a marcar mes pagado. Ver PAG-05: es el mismo trabajo, no dos faltas distintas.',
 'ALU-17':'Falta el aviso de cancelación por reprogramación con Entendido/ya avisé y Eliminar y reemplazar.',
 'CAL-03':'Falta el selector de espacios disponibles y ampliación por bloques de 15 minutos. Tocar un hueco de la grilla precarga fecha/hora pero no sustituye ese selector.',
 'CAL-04':'Vacaciones y bloqueos existen. No está acreditada la misma opción de agendar igualmente en todos los caminos de alta, reprogramación y edición; hay caminos que rechazan el bloqueo.',
 'CAL-05':'Reprogramar existe con fecha/hora; falta calendario mensual de disponibilidad y grilla visual libre/ocupado.',
 'CAL-08':'Falta convertir Clase ↔ Entrenamiento con el alcance del original y la coordinación atómica del acuerdo/cuota. No basta cambiar la etiqueta.',
 'CAL-09':'Participantes de serie y de clase suelta/ocurrencia implementados. Crear alumno abre otra pestaña y requiere actualizar; falta alta integrada sin salir del diálogo.',
 'CAL-10':'Se conserva historial: no se elimina una clase con registro/cobro como permite el original. El resto de las acciones está implementado.',
 'CAL-11':'Restaurar/reemplazar existen; una cancelada con registro/cobro queda protegida para conservar historial. Diferencia intencional, no equivalencia literal.',
 'REG-04':'Los dos interruptores se guardan; No cobrable interviene en el cargo por clase. Consume cuota no tiene un consumo de créditos completo conectado en la web: falta contrastar los contadores y políticas reales, sin prometer un motor de paquetes que tampoco tiene UI en el original.',
 'REG-06':'La edición está implementada; falta acreditar la misma confirmación al abandonar con cambios en todos los caminos de navegación, cierre y cambio de alumno.',
 'REG-07':'Se conserva la edición de listas y tareas en entrenamientos. Planificado/Visto se quitó por pedido expreso y no debe reintroducirse al copiar el original.',
 'REG-08':'Notas 1–10 y Sin calificar, barra y botones grandes implementados por pedido. Falta la función mostrar/ocultar cada área; funcionamiento físico de Mac/iPhone no acreditado por emulación.',
 'REG-09':'Asignación común/personal, revisión e historial existen. La fecha es un input libre; falta seleccionar entre próximas clases reales como en el original.',
 'REG-10':'Subida, PDF, miniaturas, leyendas, privacidad por alumno y reutilización implementados. Cámara/galería/HEIC con iPhone físico siguen sin acreditarse: presencia en código no prueba el dispositivo.',
 'REG-11':'Inicio/final real se guardan desde clase en vivo. Falta corrección manual postclase y completar los alcances del ajuste horario.',
 'REG-13':'Hay validaciones en línea; no está el mismo resumen previo Revisá estos datos con su recorrido equivalente.',
 'PAG-01':'Por clase/mensual/semanal/quincenal implementados. Paquete se puede elegir pero el motor no tiene compra/consumo conectados a pantallas tampoco en el original; no se cuenta como falta web una UI inexistente en el origen.',
 'PAG-05':'Falta declarar Este mes ya está pago/pendiente, fecha real e historial de declaración y su corrección. Debe distinguirse de un pago registrado con dinero y asignaciones.',
 'PAG-06':'Recargos automáticos apagados por decisión vigente; no deben reactivarse al portar el original.',
 'PAG-07':'Falta historial individual de pagos de 12 meses, puntaje/riesgo, racha y obligaciones resueltas. El gráfico agregado de todos los alumnos no lo sustituye.',
 'PAG-09':'Restricciones, generación idempotente y diagnóstico existen; faltan equivalentes de algunas reconciliaciones/reparaciones. No se habilitan reparaciones destructivas automáticas.',
 'REP-03':'Abrir/descargar PDF existe; falta compartir el archivo con selector del sistema, WhatsApp y copiar el mensaje, con alternativa si el navegador no puede compartir archivos.',
 'CFG-01':'Base central y lecturas del servidor sustituyen la copia local y recuperación de backup. No resuelve uso sin red (ACC-07).',
 'CFG-02':'Diagnóstico de sólo lectura implementado; falta reparación segura de los casos demostrados. Restricciones relacionales impiden varias categorías del original.',
 'CFG-03':'El importador del traslado existe. Exportar de vuelta hacia la app nativa no se declara implementado ni necesario por este resultado.',
 'CFG-04':'Propio de la web, excluido de la comparación con el original.',
 'UX-01':'Controles responsivos y de teclado implementados con pruebas de emulación parciales. Sigue pendiente iPhone anclado y Mac/Safari real; no se acredita paridad física.',
 'UX-02':'La estética web se conserva por pedido; no se cuenta igualdad visual con React Native.',
};
const web={
 'ACC-02':'lib/auth/device-session/server.ts; app/dispositivo; web_device_sessions',
 'ACC-04':'components/account/tutorial.tsx; app/(app)/configuracion/tutorial',
 'INI-07':'components/dashboard/active-class-card.tsx; lib/actions/live-class.ts; lib/repositories/live-class.ts',
 'ALU-12':'components/students/profile/resumen-tab.tsx',
 'ALU-13':'components/students/profile/punctuality-section.tsx',
 'ALU-14':'components/students/profile/level-achievement-card.tsx; lib/actions/level-achievement.ts',
 'CAL-09':'components/calendar/lesson-participants-dialog.tsx; lib/actions/lesson-participants.ts',
 'REG-04':'app/(app)/registro/[calendarLessonId]/registration-workspace.tsx; lib/repositories/lesson-registrations.ts',
 'PAG-01':'lib/payments/periodic-charge-candidates.ts; components/students/profile/billing-plan-card.tsx',
 'PAG-04':'components/students/profile/billing-plan-card.tsx; change_student_monthly_amount',
};
const rows=source.split(/\r?\n/).filter(line=>/^\| (ACC|INI|ALU|CAL|REG|PAG|REP|CFG|UX)-\d+ \|/.test(line)).map(line=>{
 const cells=line.split('|').map(s=>s.trim());const id=cells[1];
 const status=excluded.has(id)?'EXCLUIDO':missing.has(id)?'FALTA':partial.has(id)?'PARCIAL':intentional.has(id)?'DIFERENCIA VIGENTE':'DISPONIBLE';
 return {id,function:cells[2],original:cells[3],web:web[id]??(cells[4]??''),status,note:notes[id]??'Estructura/acción presente en el código web. No equivale a una certificación de punta a punta ni de dispositivo físico.'};
});
if(rows.length!==89 || new Set(rows.map(r=>r.id)).size!==89) throw new Error('Cambió el catálogo: revisar manualmente antes de recalcular.');
const counted=rows.filter(r=>r.status!=='EXCLUIDO');
const count=status=>counted.filter(r=>r.status===status).length;
const counts={available:count('DISPONIBLE'),intentional:count('DIFERENCIA VIGENTE'),partial:count('PARCIAL'),missing:count('FALTA'),excluded:rows.length-counted.length,total:counted.length};
const pct=n=>(100*n/counted.length).toFixed(1);
const weighted=pct(counts.available+counts.intentional+counts.partial*.5);
writeFileSync(path.join(root,'docs/AUDITORIA_FUNCIONAL_20261028.json'),JSON.stringify({date:'2026-10-28',baseline:'de9cd6134af6614869ecf39d224c5311ee67462d',method:'Presencia estructural; disponible o diferencia vigente=1; parcial=0.5; falta=0. No mide corrección ni QA.',counts,weightedIndex:Number(weighted),rows},null,2)+'\n');
const out=['# Comparación funcional app ↔ web — 28/10/2026','',
'La estructura de pantallas, acciones y datos es el criterio. No se comparan node_modules, builds, configuración del editor ni número de líneas. Se tomó el catálogo funcional existente y se corrigió contra las rutas, componentes, acciones y consumidores del código publicado de9cd61. El cambio nuevo de dos sesiones web se documenta por separado hasta su publicación. La app original permanece intacta.','',
'## Qué significa el porcentaje','',
`Catálogo: ${rows.length} bloques. Se excluyen ${counts.excluded} (datos propios de QA web y estética). Base comparable: **${counts.total} bloques**. Todos pesan igual; bloques amplios pueden contener varias acciones. ALU-16/PAG-05 y REG-11/INI-07 se solapan: este índice es una lectura del catálogo, no un cálculo de esfuerzo restante. No es una auditoría de corrección de cada rama ni una garantía de ausencia de errores.`,
'',`- ${counts.available+counts.intentional}/${counts.total} disponibles o con diferencia vigente: **${pct(counts.available+counts.intentional)} %** (${counts.available} disponibles + ${counts.intentional} diferencias vigentes).`,
`- ${counts.partial}/${counts.total} parciales: **${pct(counts.partial)} %**.`,
`- ${counts.missing}/${counts.total} faltantes: **${pct(counts.missing)} %**.`,
`- Si se asigna medio punto a cada parcial: **índice estructural aproximado ${weighted} %**. Es una ponderación declarada, no «${weighted} % probado» ni equivalencia exacta.`,
'','No se calcula porcentaje de funcionamiento confirmado: no existe una prueba comparable y actual de todos los circuitos y dispositivos. Una suite que incluye pruebas del núcleo original copiado no acredita la interfaz publicada.','',
'## Diferencias, punto por punto','',
'| ID | Situación | Diferencia concreta |','|---|---|---|',
...rows.filter(r=>r.status!=='DISPONIBLE'&&r.status!=='EXCLUIDO').map(r=>`| ${r.id} | ${r.status} | ${r.note} |`),
'','## Inventario completo por función','',
'DISPONIBLE significa que se encontró el circuito estructural, no que todas sus variantes fueron verificadas. Las celdas heredadas de rutas son referencias de búsqueda, no evidencia por sí solas.','',
'| ID | Función del original | Estado actual | Evidencia web / límite |','|---|---|---|---|',
...rows.map(r=>`| ${r.id} | ${r.function} | ${r.status} | ${r.web.replaceAll('|','/')} — ${r.note} |`),
'','## Reparto para trabajar sin pisarse','',
'**Claude — alumnos, cobros y reportes:** ALU-03/04/05/09/16, PAG-05/07 y REP-03. Alta académica y horarios habituales, decisiones de mensualidad inicial/reactivación y su corrección, historial individual de pagos, accesos de la lista y compartir reportes. Un solo circuito para las filas solapadas. La eliminación definitiva ALU-10 queda como decisión pendiente. No toca autenticación, calendario, registro ni shell.','',
'**Codex — acceso, calendario, clase en vivo y registro:** dos sesiones web; ACC-06, INI-07, CAL-03/04/05/08/09, ALU-15/17, REG-04/06/08/09/11/13. Debe conservar el calendario aprobado, importes estrictos, aislamiento financiero y tareas en entrenamientos. El uso offline completo, notificaciones de fondo y reparaciones de datos requieren un diseño explícito; no se declaran resueltos por tener otro mecanismo.','',
'**Integración:** Claude entrega commits en una rama aparte basada en el commit de Codex entregado; no despliega otra rama sobre producción mientras Codex integra. Codex revisa e integra ambos bloques y publica una versión final verificable. No force push ni escritura en la cuenta real para probar.','',
'## Dos dispositivos (pedido nuevo)','',
'Dos navegadores/PWA simultáneos, con cookie propia y registro separado del permiso de respaldo de la app nativa. El primero y segundo no se expulsan; el tercero elige qué sesión reemplazar. Cerrar sesión es local. Una sesión reemplazada se rechaza en el servidor y no reaparece por el chequeo periódico. Pruebas PostgreSQL aisladas: 23 comprobaciones, incluidas tres altas concurrentes, dos lugares como máximo, aislamiento entre cuentas, repetición, versiones obsoletas, renovación, vencimiento y cierre local. Falta acreditar dos dispositivos físicos y edición concurrente del mismo formulario; permitir sesiones no equivale a coeditar un borrador.',''];
writeFileSync(path.join(root,'docs/AUDITORIA_FUNCIONAL_20261028.md'),out.join('\n'));
console.log(JSON.stringify({counts,weightedIndex:weighted}));
