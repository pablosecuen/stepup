import type { Metadata } from "next";
import { Toaster } from "sonner";
import SideBar from "./sidebar";

export const metadata: Metadata = {
  title: "Admin",
  description: "Dashboard",
};

export default function DashBoardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mt-24 min-h-screen ">
      <Toaster position="top-center" closeButton={true} />

      <SideBar />
    </div>
  );
}
