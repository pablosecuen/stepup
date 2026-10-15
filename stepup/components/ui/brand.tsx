import Image from "next/image";

// Marca: ícono + «TeacherFlow» en serifa (Fraunces). El ícono es decorativo (`alt=""`): el nombre ya está en el texto.

/** `compact`: por debajo de 380 px sólo se ve el ícono (el nombre sigue disponible para lectores de pantalla). */
export function BrandMark({ size = "md", className = "", compact = false }: { size?: "sm" | "md" | "lg"; className?: string; compact?: boolean }) {
  const icon = size === "lg" ? 38 : size === "md" ? 34 : 30;
  const text = size === "lg" ? "text-[22px]" : size === "md" ? "text-xl" : "text-[19px]";
  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-semibold tracking-tight ${text} ${className}`}>
      <Image src="/icon.png" alt="" width={icon} height={icon} className="rounded-[9px]" />
      {compact ? <span className="max-[380px]:sr-only">TeacherFlow</span> : "TeacherFlow"}
    </span>
  );
}
