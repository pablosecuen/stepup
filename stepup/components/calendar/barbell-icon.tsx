// Ícono discreto de entrenamiento — mismo espíritu que Ionicons
// "barbell-outline" en la app móvil (heroicons no incluye un equivalente).
// Formas rellenas (no trazos finos): se mantienen legibles como mancuerna
// incluso al tamaño chico de una tarjeta de la grilla.
export function BarbellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="1" y="8.5" width="3" height="7" rx="1" />
      <rect x="20" y="8.5" width="3" height="7" rx="1" />
      <rect x="4.5" y="9.5" width="2" height="5" rx="0.5" />
      <rect x="17.5" y="9.5" width="2" height="5" rx="0.5" />
      <rect x="6.5" y="11" width="11" height="2" rx="1" />
    </svg>
  );
}
