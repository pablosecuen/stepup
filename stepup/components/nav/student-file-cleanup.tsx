"use client";
import { useEffect } from "react";
import { sweepStudentFilesAction } from "@/lib/actions/student-deletion";

/** Reintenta sólo trabajos ya confirmados de eliminación, nunca decide borrar alumnos. */
export function StudentFileCleanup() {
  useEffect(() => {
    const sweep = () => { if (navigator.onLine) void (async () => { try { await sweepStudentFilesAction(); } catch {} })(); };
    sweep(); window.addEventListener("online", sweep);
    return () => window.removeEventListener("online", sweep);
  }, []);
  return null;
}

