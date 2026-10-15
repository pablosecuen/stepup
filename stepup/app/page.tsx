import { Closing, CalendarDetail, FinanceDetail, Hero, HowItWorks, ProductIndex, SceneAgenda, SceneCollections, SceneStudents, Security, StudentsDetail, TourSection } from "@/components/landing/sections";
import { RevealController } from "@/components/landing/reveal-controller";
import { SiteHeader } from "@/components/landing/site-header";
import { BrandMark } from "@/components/ui/brand";

export default function HomePage() {
  return (
    <div className="tf-landing flex min-h-screen flex-col">
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

      <footer className="border-t-[1.5px] border-border bg-background px-5 py-8 text-center text-sm text-textMuted nav:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-3">
          <BrandMark size="sm" />
          <p>TeacherFlow — para profesoras y profesores independientes.</p>
        </div>
      </footer>
    </div>
  );
}
