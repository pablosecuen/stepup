import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listOpenChargeBalances } from "@/lib/repositories/payments";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { CollectionsErrorView, CollectionsView } from "@/components/payments/collections-view";
import { listStudents } from "@/lib/repositories/students";
import { buildCollectionsCenterEntriesFromBalances, type CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { localDateKeyInTimeZone } from "@/lib/payments/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobros · TeacherFlow" };

export default async function CobrosPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let entries: CollectionsCenterEntry[];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDateKey = localDateKeyInTimeZone(new Date());
    // R2: esta página SÓLO LEE. La generación de mensualidades/cuotas del período (idempotente) la dispara
    // `ChargeGenerationTrigger` con una Server Action (POST) después de mostrar la pantalla — un GET nunca escribe.
    // Sólo los cargos con saldo pendiente (calculados en la base), no toda la historia de cargos/asignaciones/pagos.
    const [balances, students] = await Promise.all([listOpenChargeBalances(ctx), listStudents(ctx)]);
    entries = buildCollectionsCenterEntriesFromBalances({ balances, students, todayDateKey });
  } catch {
    return <CollectionsErrorView />;
  }

  return (
    <>
      <ChargeGenerationTrigger />
      <CollectionsView entries={entries} />
    </>
  );
}
