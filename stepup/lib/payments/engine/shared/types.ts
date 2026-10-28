// Puerto VERBATIM del original (`src/shared/types.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
// Definiciones canónicas de los enums de "alumno" que hoy están duplicados
// en dashboard/, students/ y student-profile/ (cada feature los redeclaró
// de forma independiente). Nueva clase es la primera feature que los
// importa de acá en vez de redeclararlos.
//
// Deuda técnica pendiente (no resuelta hoy, fuera de este pedido): migrar
// dashboard/students/student-profile para que también importen desde acá,
// y borrar sus copias locales.

// Corrección (a pedido de Joaquín — niveles personalizados): antes una
// unión cerrada de 6 literales CEFR. TeacherFlow ya no asume que sólo se
// usa para idiomas — una profesora puede crear sus propios niveles
// ("Infantes", "Apoyo escolar", etc., ver `CustomLevel` en
// `features/students/types/index.ts`), así que el campo real de un alumno
// acepta cualquier string. Los 6 valores CEFR estándar (`A1`-`C2`) siguen
// siendo strings válidos — ningún alumno existente ni ningún literal ya
// escrito en el código deja de tipar.
export type CEFRLevel = string;

export type StudentModality = 'presencial' | 'online' | 'mixta';

export type StudentStatus = 'activo' | 'pausado' | 'inactivo' | 'archivado';

export type PaymentStatus = 'verde' | 'amarillo' | 'naranja' | 'rojo';

export type BillingType = 'por_clase' | 'mensual';

export type StudentCategory =
  | 'primaria'
  | 'secundaria'
  | 'profesorado_ingles'
  | 'universitario'
  | 'adulto_interes_personal'
  | 'adulto_laboral'
  | 'examen_internacional'
  | 'apoyo_escolar'
  | 'otro';
