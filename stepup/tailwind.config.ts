import type { Config } from "tailwindcss";

// Diseño natural aprobado: crema, lavanda, oliva y marrón. Conserva los colores semánticos y la geometría del calendario.
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
        lavender: "#C2BFCB", lavenderSoft: "#E8E4EF", lavenderText: "#625571",
        // Superficies y texto (papel cálido).
        background: "#EAE6E1",
        paperDeep: "#E5E0DA",
        surface: "#FCFAF6",
        surface2: "#F1EEE8",
        border: "#D8CFC3",
        borderMid: "#AD9980",
        // Borde de controles de formulario (campos, selectores): 3:1 sobre el fondo y la superficie (WCAG 1.4.11). El borde claro
        // de arriba queda para tarjetas y separadores, que no necesitan contraste propio.
        borderStrong: "#8A7965",
        textPrimary: "#583B1F",
        textSecondary: "#675039",
        textMuted: "#6F604F",
        ink: "#583B1F",
        ivory: "#F2EEDF",
        // Barra lateral oscura y panel de marca de las pantallas de acceso.
        side: "#583B1F",
        side2: "#604329",
        sideActive: "#694C2F",
        sideLine: "#846D53",
        sideText: "#F6F1E8",
        sideMuted: "#DFD4C4",
        sideAccent: "#DFDBE8",
        // Único acento: terracota.
        accent: "#583B1F",
        accentDark: "#412A16",
        accentSoft: "#DFDBE8",
        accentText: "#583B1F",
        accentLine: "#B5ACC3",
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
        // Azul con significado de DATO/categoría: «Necesidades» del plan 50/30/20 (control y cifra). El azul heredado de INTERFAZ se retiró
        // en el Bloque 6: ninguna pantalla lo usa.
        dataNeeds: "#583B1F",
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
        pastelLavenderText: "#625571",
        pastelSage: "#DDEDDC",
        pastelSageText: "#59602F",
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
        focus: "0 0 0 3px rgba(98,85,113,0.28)",
        focusError: "0 0 0 3px rgba(150,42,32,0.12)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "tf-fade": { from: { opacity: "0" }, to: { opacity: "1" } },
        "tf-pop": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        "tf-sheet": { from: { opacity: "0.4", transform: "translateY(40px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "tf-rise": { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "tf-fade": "tf-fade 160ms ease-out",
        "tf-pop": "tf-pop 180ms ease-out",
        "tf-sheet": "tf-sheet 220ms ease-out",
        // Entrada inicial suave de los bloques de Inicio (una sola vez; sólo opacidad y desplazamiento: sin saltos de layout).
        "tf-rise": "tf-rise 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
