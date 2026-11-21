"use client";

import QRCode from "qrcode";
import { useState } from "react";
import Grabar from "./Grabar";

/** Emite el llavero solo cuando la persona lo pide: cada emisión desactiva el llavero anterior. */
export default function Emitir({ pacienteId }: { pacienteId: string }) {
  const [llavero, setLlavero] = useState<{ url: string; qr: string } | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function emitir() {
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/reto4/pacientes/${pacienteId}/llavero`, { method: "POST", credentials: "same-origin" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.mensaje ?? "No se pudo emitir el llavero");
      const url = `${window.location.origin}${j.ruta}`;
      setLlavero({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" className={llavero ? "btn-secondary" : "btn-primary"} onClick={emitir} disabled={cargando}>
        {llavero ? "Emitir otro (desactiva el anterior)" : "Emitir llavero"}
      </button>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>}
      {llavero && (
        <>
          <p className="break-all rounded bg-slate-900 p-3 font-mono text-sm text-emerald-300">{llavero.url}</p>
          <Grabar url={llavero.url} />
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={llavero.qr} alt="QR del llavero" width={160} height={160} />
            <p className="text-sm text-slate-600">Respaldo: imprime este QR en el talón. Funciona igual que el llavero cuando el celular no tiene NFC.</p>
          </div>
        </>
      )}
    </div>
  );
}
