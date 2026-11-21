import type { Metadata } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google; works offline in the kiosk PWA).
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-poppins",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PaDi · EIRA — Expediente Único y Resultados Seguros",
  description:
    "Expediente digital único y entrega segura, inclusiva y offline-ready de resultados de Papanicolaou — EIRA Movimiento Rosa A.C.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${poppins.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-[#FFFAFB] font-sans text-padi-ink antialiased">
        {/* Background ribbons (PaDi reference) */}
        <div className="padi-ribbons" aria-hidden="true">
          <svg viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMin slice">
            <path className="r a" d="M880 -150C940 170 1250 310 1520 70" strokeWidth="270" />
            <path
              className="r b"
              d="M1520 390C1200 390 1010 650 1150 810C1270 940 1520 850 1520 850"
              strokeWidth="240"
            />
            <path className="echo a" d="M830 -150C890 190 1240 360 1520 120" />
          </svg>
        </div>
        <div className="padi-app">{children}</div>
      </body>
    </html>
  );
}
