import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { AnnouncementBar } from "@/components/landing/announcement-bar";
import { Closing, CalendarDetail, FinanceDetail, Hero, HowItWorks, ProductIndex, SceneAgenda, SceneCollections, SceneStudents, Security, StudentsDetail, TourSection } from "@/components/landing/sections";
import { RevealController } from "@/components/landing/reveal-controller";
import { SiteHeader } from "@/components/landing/site-header";
import { BrandMark } from "@/components/ui/brand";
import "@/components/landing/landing-natural.css";

// Tipografía de la landing: DM Serif Display para títulos y DM Sans para la interfaz. Se declaran acá, sólo para esta página, así la
// portada se ve completa aunque las fuentes globales de la aplicación todavía no las incluyan (`next/font` las autoaloja).
const landingSans = DM_Sans({ subsets: ["latin"], variable: "--tf-landing-sans", display: "swap" });
const landingDisplay = DM_Serif_Display({ subsets: ["latin"], variable: "--tf-landing-display", display: "swap", weight: "400", style: ["normal", "italic"] });

export default function HomePage() {
  return (
    <div className={`tf-landing ${landingSans.variable} ${landingDisplay.variable} flex min-h-screen flex-col`}>
      <AnnouncementBar />
      <SiteHeader />
      <RevealController />

      <main id="contenido" tabIndex={-1} className="focus:outline-none flex-1">
        <Hero />
        <ProductIndex />
        <SceneAgenda />
        <SceneStudents />
        <SceneCollections />
        <TourSection />
        <CalendarDetail />
        <StudentsDetail />
        <FinanceDetail />
        <HowItWorks />
        <Security />
        <Closing />
      </main>

      <footer className="tf-footer border-t-[1.5px] border-border px-5 py-8 text-center text-sm text-textMuted nav:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-3">
          <BrandMark size="sm" />
          <p>TeacherFlow — para profesoras y profesores independientes.</p>
        </div>
      </footer>
    </div>
  );
}
