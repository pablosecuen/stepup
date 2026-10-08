import type { ComponentProps, ReactNode } from "react";

// Tabla del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §5): encabezado en mayúsculas pequeñas sobre
// `surface2`, filas de ≥ 54 px, hover cálido, importes alineados a la derecha con numerales tabulares. Bajo 820 px una tabla
// `stackable` muestra cada fila como tarjeta (clase `.tf-table-stack` en app/globals.css; cada celda lleva `data-label`).

export function Table({ stackable = false, caption, children }: { stackable?: boolean; caption?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border-[1.5px] border-border bg-surface shadow-card">
      <table className={`w-full border-collapse text-[14.5px]${stackable ? " tf-table-stack" : ""}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ align = "left", className, ...props }: { align?: "left" | "right" } & ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={`border-b-[1.5px] border-border bg-surface2 px-4 py-2.5 text-label font-bold uppercase text-textMuted ${align === "right" ? "text-right" : "text-left"}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={`group${className ? ` ${className}` : ""}`} {...props} />;
}

export function Td({ align = "left", numeric = false, className, ...props }: { align?: "left" | "right"; numeric?: boolean } & ComponentProps<"td">) {
  return (
    <td
      className={`min-h-[54px] border-b border-border px-4 py-3 align-middle group-last:border-b-0 group-hover:bg-surface2 ${align === "right" ? "text-right" : "text-left"}${numeric ? " tf-num" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}
