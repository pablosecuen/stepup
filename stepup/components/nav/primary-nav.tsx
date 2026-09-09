"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  UsersIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import {
  HomeIcon as HomeIconSolid,
  UsersIcon as UsersIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
  BanknotesIcon as BanknotesIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
} from "@heroicons/react/24/solid";

const NAV_ITEMS = [
  { href: "/inicio", label: "Inicio", icon: HomeIcon, iconActive: HomeIconSolid },
  { href: "/alumnos", label: "Alumnos", icon: UsersIcon, iconActive: UsersIconSolid },
  { href: "/calendario", label: "Calendario", icon: CalendarDaysIcon, iconActive: CalendarDaysIconSolid },
  { href: "/cobros", label: "Cobros", icon: BanknotesIcon, iconActive: BanknotesIconSolid },
  { href: "/configuracion", label: "Configuración", icon: Cog6ToothIcon, iconActive: Cog6ToothIconSolid },
];

// Distribución responsive: barra inferior fija en anchos chicos (mismo
// espíritu que la barra de pestañas de la app móvil), sidebar persistente
// en escritorio (md+) — mejor aprovechamiento del ancho grande, a pedido.
export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = isActive ? item.iconActive : item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-inset"
            >
              <Icon className={`h-6 w-6 ${isActive ? "text-brandBlue" : "text-textMuted"}`} aria-hidden />
              <span className={isActive ? "text-brandBlue" : ""}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col gap-1 border-r border-border bg-surface p-4 md:flex"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = isActive ? item.iconActive : item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue ${
                isActive ? "bg-brandBlue/10 text-brandBlue" : "text-textSecondary hover:bg-background"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
