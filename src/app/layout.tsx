import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ensureSeeded } from "@/lib/seed";

export const metadata: Metadata = {
  title: "EIRA Resultados Seguros",
  description: "Entrega digital segura de resultados de Papanicolaou: EIRA Movimiento Rosa A.C.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await ensureSeeded();
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <header className="no-print border-b border-rose-100 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl font-black tracking-widest text-rose-600">EIRA</span>
              <span className="hidden text-sm text-slate-500 sm:inline">Resultados Seguros</span>
            </Link>
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">PROTOTIPO: datos ficticios</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
