"use client";
import { useState } from "react";

export default function Copiar({ texto, etiqueta = "Copiar para Briar / Bridgefy" }: { texto: string; etiqueta?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-secondary py-1" onClick={async () => { await navigator.clipboard.writeText(texto); setOk(true); }}>
      {ok ? "Copiado" : etiqueta}
    </button>
  );
}
