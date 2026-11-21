"use client";

import { useState } from "react";

/** Graba el enlace en la etiqueta con Web NFC (Chrome en Android, sitio con HTTPS). */
export default function Grabar({ url }: { url: string }) {
  const [msg, setMsg] = useState("");
  async function grabar() {
    const NDEF = (window as unknown as { NDEFReader?: new () => { write(m: unknown): Promise<void> } }).NDEFReader;
    if (!NDEF) return setMsg("Este navegador no graba NFC. Copia el enlace y grábalo con la app NFC Tools (Escribir → Añadir registro → URL).");
    try {
      setMsg("Acerca el llavero a la parte trasera del celular…");
      await new NDEF().write({ records: [{ recordType: "url", data: url }] });
      setMsg("Listo: llavero grabado. Acércalo de nuevo para probarlo.");
    } catch (e) {
      setMsg(`No se pudo grabar: ${(e as Error).message}`);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={grabar}>Grabar en el llavero</button>
        <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(url).then(() => setMsg("Enlace copiado"))}>Copiar enlace</button>
      </div>
      {msg && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900" role="status">{msg}</p>}
    </div>
  );
}
