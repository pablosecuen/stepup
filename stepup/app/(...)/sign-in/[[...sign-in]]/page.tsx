import { SignIn } from "@clerk/nextjs";
import "./sing-in.css";

export default function Page() {
  return (
    <div className="h-screen w-screen grid place-content-center">
      <SignIn />
    </div>
  );
}
