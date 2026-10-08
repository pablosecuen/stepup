import Image from "next/image";

// Marca: ícono + «TeacherFlow» en serifa (Fraunces). El ícono es decorativo (`alt=""`): el nombre ya está en el texto.

export function BrandMark({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const icon = size === "lg" ? 38 : size === "md" ? 34 : 30;
  const text = size === "lg" ? "text-[22px]" : size === "md" ? "text-xl" : "text-[19px]";
  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-semibold tracking-tight ${text} ${className}`}>
      <Image src="/icon.png" alt="" width={icon} height={icon} className="rounded-[9px]" />
      TeacherFlow
    </span>
  );
}
