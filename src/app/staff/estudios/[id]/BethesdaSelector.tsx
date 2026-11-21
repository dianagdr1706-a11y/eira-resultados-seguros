"use client";

import { useState } from "react";

type Opcion = { id: string; label: string; sug: { modo: string; prioridad: string; color: string; motivo: string } };

const COLORES: Record<string, string> = {
  verde: "border-emerald-400 bg-emerald-50 text-emerald-900",
  amarillo: "border-amber-400 bg-amber-50 text-amber-900",
  rojo: "border-red-500 bg-red-50 text-red-900",
};

export default function BethesdaSelector({ opciones }: { opciones: Opcion[] }) {
  const [sel, setSel] = useState("");
  const o = opciones.find((x) => x.id === sel);
  return (
    <div className="space-y-2">
      <label className="label" htmlFor="bethesda">Categoría Bethesda del reporte (formato EIRA, reactivo 27/33A)</label>
      <select id="bethesda" name="bethesda" className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Selecciona…</option>
        {opciones.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      {o && (
        <div className={`rounded-lg border-2 p-3 text-sm ${COLORES[o.sug.color]}`}>
          <div className="font-bold">
            Semáforo {o.sug.color.toUpperCase()}: se sugiere {o.sug.modo === "digital" ? "ENTREGA DIGITAL" : "ENTREGA ACOMPAÑADA"}
            {o.sug.prioridad === "prioritario" ? " PRIORITARIA" : ""}
          </div>
          <div>{o.sug.motivo}</div>
          <div className="mt-1 text-xs opacity-80">Es una sugerencia. La decisión final es del médico y queda en la bitácora.</div>
        </div>
      )}
    </div>
  );
}
