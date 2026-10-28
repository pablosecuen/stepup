"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";

export async function saveNavigationPreference(value: "barra" | "menu") {
  await requireAuthenticatedDbContext();
  if (value !== "barra" && value !== "menu") return { error: "Elegí una opción válida." };
  (await cookies()).set("tf-navigation", value, {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000,
  });
  revalidatePath("/", "layout");
  return {};
}
