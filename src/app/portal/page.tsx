import { redirect } from "next/navigation";
import { getPaciente } from "@/lib/auth";
import { iniciarAcceso } from "./actions";
import MetodoSelector from "./MetodoSelector";

const ERR: Record<string, string> = {
  datos: "No encontramos un registro con esos datos. Revisa tu folio y tu fecha de nacimiento.",
  pin: "El PIN no es correcto o ya venció.",
  limite: "Demasiados intentos. Espera unos minutos o llama al 341 410 8111.",
  sincontacto: "No tienes teléfono ni correo registrado. Usa el PIN de tu talón impreso, llama al 341 410 8111 o acude a EIRA.",
  envio: "No pudimos enviarte el código ahora. Usa el PIN de tu talón o llama al 341 410 8111.",
  expirado: "Tu código venció o hubo demasiados intentos. Solicita uno nuevo.",
  sesion: "Tu sesión terminó. Vuelve a entrar.",
};

export default async function Portal({ searchParams }: { searchParams: { error?: string; folio?: string } }) {
  if (await getPaciente()) redirect("/portal/resultados");
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="card space-y-4">
        <h1 className="text-3xl font-bold">Consulta tu documento</h1>
        <p className="text-lg text-slate-600">Necesitas tu <b>folio EIRA</b> (viene en tu talón o tu cartilla) y tu <b>fecha de nacimiento</b>.</p>
        {searchParams.error && <p className="rounded-lg bg-red-50 p-3 text-base text-red-700" role="alert">{ERR[searchParams.error] ?? "Error"}</p>}
        <form action={iniciarAcceso} className="space-y-4">
          <div>
            <label className="label text-base" htmlFor="folio">Folio EIRA</label>
            <input className="input py-3 text-lg uppercase" id="folio" name="folio" placeholder="EIRA-00348" defaultValue={searchParams.folio ?? ""} required autoComplete="off" />
          </div>
          <div>
            <label className="label text-base" htmlFor="dob">Fecha de nacimiento</label>
            <input className="input py-3 text-lg" id="dob" name="dob" type="date" required />
          </div>
          <MetodoSelector />
          <button className="btn-primary w-full py-3 text-lg">Continuar</button>
        </form>
      </div>
      <div className="card text-base">
        <h2 className="h2 mb-1">¿No tienes celular, correo o internet?</h2>
        <p className="text-slate-600">Llama al <b>341 410 8111</b> o acude a la oficina de EIRA o a la próxima jornada en tu municipio. Te lo entregamos en persona, en sobre cerrado.</p>
      </div>
    </div>
  );
}
