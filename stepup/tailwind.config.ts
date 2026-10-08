import type { Config } from "tailwindcss";

// Rediseño visual v1 (docs/design/web-v1/01-fundamentos.md). Papel cálido + tinta de la marca + terracota como único acento.
// Los colores se mantienen como hexadecimales (las pruebas de contraste de B8 los leen) y espejan 1:1 las variables `--tf-*` de
// `app/globals.css` (lib/ui/__tests__/design-tokens.test.ts falla si dejan de coincidir). Texto 4.5:1 sobre el fondo y las
// superficies; controles y foco 3:1. El móvil no se toca; los colores del calendario (escala congelada, lib/calendar-theme.ts)
// tampoco pasan por acá.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // Se declara completo (no `extend`) para fijar el orden: `nav` (820 px) entre `md` y `lg`, así `lg:` siempre gana a `nav:`.
    screens: {
      sm: "640px",
      md: "768px",
      // Navegación móvil/escritorio: por debajo de 820 px barra inferior + hojas; desde 820 px barra lateral + diálogos centrados.
      nav: "820px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        // Superficies y texto (papel cálido).
        background: "#F6F0E5",
        paperDeep: "#EFE6D4",
        surface: "#FFFDF8",
        surface2: "#FAF4E8",
        border: "#E6DAC4",
        borderMid: "#CDBE9F",
        // Borde de controles de formulario (campos, selectores): 3:1 sobre el fondo y la superficie (WCAG 1.4.11). El borde claro
        // de arriba queda para tarjetas y separadores, que no necesitan contraste propio.
        borderStrong: "#8E8369",
        textPrimary: "#1C1812",
        textSecondary: "#4B4337",
        textMuted: "#655B4D",
        ink: "#1C1812",
        ivory: "#F2EEDF",
        // Barra lateral oscura y panel de marca de las pantallas de acceso.
        side: "#1F1A14",
        side2: "#2C251C",
        sideActive: "#34291D",
        sideLine: "#3A3126",
        sideText: "#D2C8B5",
        sideMuted: "#A89E8B",
        sideAccent: "#E58A5F",
        // Único acento: terracota.
        accent: "#B4461E",
        accentDark: "#953815",
        accentSoft: "#F6DCCB",
        accentText: "#7A2C0E",
        accentLine: "#E9B79D",
        // Tonos de estado (siempre con texto + ícono; nunca sólo color).
        ok: "#2F5736",
        okSoft: "#DCEADB",
        okLine: "#B9D3B8",
        warn: "#6B4700",
        warnSoft: "#FBEBC6",
        warnLine: "#E6C873",
        bad: "#962A20",
        badSoft: "#F9DEDA",
        badLine: "#E9AFA8",
        info: "#1F4D63",
        infoSoft: "#D8E8F0",
        infoLine: "#B0CDDB",
        // Heredados: el azul de marca sigue en las pantallas que todavía no migraron al rediseño (se retira en el último bloque).
        brandBlue: "#0A64D2",
        brandBlueDark: "#004BA8",
        // Semáforo de cobro: reservado, no se usa para otra cosa.
        statusVerde: "#1B7634",
        statusAmarillo: "#7F5F00",
        statusNaranja: "#AA5208",
        statusRojo: "#BF2A20",
        statusPendiente: "#4361B8",
        statusSinDatos: "#655B4D",
        // Exclusivos del plan 50/30/20 (Fase 8, `Resumen financiero`/
        // `budgetDistributionStore.ts` móvil) — nunca reutilizar para otra
        // pantalla (regla congelada, ver CLAUDE.md del repo móvil).
        pastelLavender: "#E9E2FF",
        pastelLavenderText: "#5A4780",
        pastelSage: "#DDEDDC",
        pastelSageText: "#35613B",
      },
      fontFamily: {
        // Variables definidas por `next/font` en app/layout.tsx.
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      fontSize: {
        // Escala del rediseño (tamaño, interlínea, tracking).
        hero: ["3.875rem", { lineHeight: "1.03", letterSpacing: "-0.035em" }],
        page: ["2.375rem", { lineHeight: "1.08", letterSpacing: "-0.025em" }],
        section: ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        card: ["1.1875rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        label: ["0.75rem", { lineHeight: "1.2", letterSpacing: "0.12em" }],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "22px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(60,40,10,0.06), 0 8px 20px -14px rgba(60,40,10,0.22)",
        cardHover: "0 2px 4px rgba(60,40,10,0.08), 0 16px 28px -14px rgba(60,40,10,0.26)",
        panel: "0 24px 56px -18px rgba(40,25,5,0.38), 0 2px 6px rgba(40,25,5,0.08)",
        subtle: "0 1px 2px rgba(60,40,10,0.06)",
        // Halo de foco de los campos (se suma al cambio de borde a tinta).
        focus: "0 0 0 3px rgba(180,70,30,0.28)",
        focusError: "0 0 0 3px rgba(150,42,32,0.12)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "tf-fade": { from: { opacity: "0" }, to: { opacity: "1" } },
        "tf-pop": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        "tf-sheet": { from: { opacity: "0.4", transform: "translateY(40px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "tf-fade": "tf-fade 160ms ease-out",
        "tf-pop": "tf-pop 180ms ease-out",
        "tf-sheet": "tf-sheet 220ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
