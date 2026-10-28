import { PAGE_WIDTH } from "@/components/ui/page-header";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { StatusHistoryRecord, LevelHistoryRecord, PriceHistoryRecord } from "@/lib/repositories/student-history-mapping";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import type { PendingHomeworkTask } from "@/lib/lessons/homework";
import type { AttendanceStatus } from "@/lib/lessons/attendance";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "@/lib/repositories/payments";
import type { ReportRecordSummary } from "@/lib/repositories/reports-mapping";
import type { ProfileClassStats, StudentNextClass } from "@/lib/students/profile-overview";
import { ChangeStatusForm } from "@/components/students/change-status-form";
import { StudentProfileHeader } from "@/components/students/profile/profile-header";
import { EnterOnChange } from "@/components/ui/enter-on-change";
import { ProfileTabsNav, type ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { ResumenTabContent } from "@/components/students/profile/resumen-tab";
import { InformacionTabContent } from "@/components/students/profile/informacion-tab";
import { ClasesTabContent } from "@/components/students/profile/clases-tab";
import { TareasTabContent } from "@/components/students/profile/tareas-tab";
import { ProgresoTabContent } from "@/components/students/profile/progreso-tab";
import { CobrosTabContent } from "@/components/students/profile/cobros-tab";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "@/lib/payments/billing-plan";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { ReportesTabContent } from "@/components/students/profile/reportes-tab";

export interface StudentProfileData {
  statusHistory: StatusHistoryRecord[];
  levelHistory: LevelHistoryRecord[];
  priceHistory: PriceHistoryRecord[];
  registrations: LessonRegistrationRecord[];
  attendanceByRegistrationId: Record<string, AttendanceStatus>;
  pendingTasks: PendingHomeworkTask[];
  evaluationEntries: { registration: LessonRegistrationRecord; evaluation: LessonRegistrationEvaluationRecord }[];
  charges: PaymentChargeRecord[];
  payments: PaymentRecord[];
  allocations: PaymentAllocationRecord[];
  /** Incidencias heredadas del traslado, por clase registrada y por cobro (vacío si no hay). */
  registrationIncidents?: Record<string, OriginIncidentView[]>;
  chargeIncidents?: Record<string, OriginIncidentView[]>;
  monthsWithClasses: string[];
  reportHistory: ReportRecordSummary[];
  stats: ProfileClassStats;
  nextClass: StudentNextClass;
  totalCollected: number;
  todayDateKey: string;
}

/**
 * Perfil del alumno (presentación): encabezado, pestañas y el contenido de la pestaña activa. La página carga SÓLO los datos de
 * la pestaña que se muestra (ver `app/(app)/alumnos/[id]/page.tsx`); esta vista únicamente los dibuja. Las tareas de fondo
 * (generar mensualidades, limpiar PDFs) las dispara la página, no la vista.
 */
export function StudentProfileView({ student, tab, data }: { student: StudentRecord; tab: ProfileTabKey; data: StudentProfileData }) {
  return (
    <div className={PAGE_WIDTH.medium}>
      <StudentProfileHeader student={student} />

      <div className="mt-6">
        <ProfileTabsNav studentId={student.id} active={tab} />
      </div>

      <EnterOnChange changeKey={tab} className="mt-5">
        {tab === "resumen" && (
          <div className="flex flex-col gap-6">
            <ResumenTabContent student={student} stats={data.stats} nextClass={data.nextClass} pendingTasks={data.pendingTasks} />
            <ChangeStatusForm studentId={student.id} currentStatus={student.status} />
          </div>
        )}
        {tab === "clases" && <ClasesTabContent registrations={data.registrations} attendanceByRegistrationId={data.attendanceByRegistrationId} incidentsByRegistrationId={data.registrationIncidents} />}
        {tab === "progreso" && <ProgresoTabContent entries={data.evaluationEntries} />}
        {tab === "tareas" && <TareasTabContent tasks={data.pendingTasks} />}
        {tab === "cobros" && (
          <CobrosTabContent studentId={student.id} studentName={student.name} billingPlan={resolveStudentBillingPlan({ billingPlan: student.billingPlan as StudentBillingPlan | null, billingType: student.billingType, price: student.price })} charges={data.charges} payments={data.payments} allocations={data.allocations} chargeIncidents={data.chargeIncidents} todayDateKey={data.todayDateKey} />
        )}
        {tab === "reportes" && (
          <ReportesTabContent studentId={student.id} studentName={student.name} monthsWithClasses={data.monthsWithClasses} initialHistory={data.reportHistory} />
        )}
        {tab === "informacion" && (
          <InformacionTabContent
            student={student}
            statusHistory={data.statusHistory}
            levelHistory={data.levelHistory}
            priceHistory={data.priceHistory}
            stats={data.stats}
            totalCollected={data.totalCollected}
          />
        )}
      </EnterOnChange>
    </div>
  );
}
