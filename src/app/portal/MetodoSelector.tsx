"use client";

import { useState } from "react";

export default function MetodoSelector() {
  const [m, setM] = useState("otp");
  return (
    <fieldset className="space-y-2">
      <legend className="label text-base">¿Cómo quieres entrar?</legend>
      <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${m === "otp" ? "border-rose-500 bg-rose-50" : ""}`}>
        <input type="radio" name="metodo" value="otp" checked={m === "otp"} onChange={() => setM("otp")} />
        <span>Recibir un código por SMS o correo</span>
      </label>
      <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${m === "pin" ? "border-rose-500 bg-rose-50" : ""}`}>
        <input type="radio" name="metodo" value="pin" checked={m === "pin"} onChange={() => setM("pin")} />
        <span>Tengo un PIN en mi talón impreso</span>
      </label>
      {m === "pin" && (
        <input className="input py-3 text-center font-mono text-2xl tracking-[0.4em]" name="pin" inputMode="numeric" maxLength={6} placeholder="••••••" required aria-label="PIN de 6 dígitos" />
      )}
    </fieldset>
  );
}
