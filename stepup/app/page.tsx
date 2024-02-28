import Image from "next/image";
import { zapatillasJordan } from "@/app/data";
import CardContainer from "./components/cardContainer/card-container";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between ">
      <CardContainer />
    </main>
  );
}
