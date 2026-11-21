import Link from "next/link";
import { verificarOtp } from "../actions";

export default function Verificar({ searchParams }: { searchParams: { c?: string; d?: string; error?: string; r?: string } }) {
  return (
    <div className="mx-auto max-w-lg">
      <form action={verificarOtp} className="card space-y-4">
        <h1 className="text-3xl font-bold">Escribe tu código</h1>
        {searchParams.d && <p className="text-lg text-slate-600">Te enviamos un código de 6 dígitos por {searchParams.c === "correo" ? "correo" : "SMS"} a <b>{searchParams.d}</b>. Vence en 10 minutos.</p>}
        {searchParams.error && <p className="rounded-lg bg-red-50 p-3 text-red-700" role="alert">Código incorrecto. Te quedan {searchParams.r} intentos.</p>}
        <input className="input py-4 text-center font-mono text-3xl tracking-[0.5em]" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus aria-label="Código de 6 dígitos" />
        <button className="btn-primary w-full py-3 text-lg">Entrar</button>
        <p className="text-sm text-slate-500">Demo: el código aparece en la bandeja simulada del personal EIRA. <Link className="underline" href="/portal">Volver</Link></p>
      </form>
    </div>
  );
}
