"use client";
import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-medium shadow-sm hover:bg-slate-50">
      <Printer className="h-4 w-4" /> PDF
    </button>
  );
}
