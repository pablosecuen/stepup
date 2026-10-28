import { Tutorial } from "@/components/account/tutorial";
import { PAGE_WIDTH, PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Tutorial · TeacherFlow" };
export default function TutorialPage() {
  return <div className={PAGE_WIDTH.medium}><PageHeader title="Tutorial de TeacherFlow" subtitle="Podés salir y volver a verlo cuando quieras." /><div className="mt-5"><Tutorial /></div></div>;
}
