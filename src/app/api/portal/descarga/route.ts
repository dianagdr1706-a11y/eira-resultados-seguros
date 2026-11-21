import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { kv } from "@/lib/kv";
import { PAC_COOKIE, clientIp } from "@/lib/auth";
import { canjearDescarga } from "@/core/reto4/portal";
import { ErrorDominio } from "@/core/errores";

function denegado(msg: string, status = 401) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Acceso denegado</title><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:20px"><h1 style="color:#be123c">Acceso denegado</h1><p>${msg}</p><p><a href="/portal">Ir al portal de EIRA</a></p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const sesion = cookies().get(PAC_COOKIE)?.value ?? null;
  const pacienteDeSesion = sesion ? await (await kv()).get(`ps:${sesion}`) : null;
  try {
    const { pdf, archivo } = await canjearDescarga({ token, sesion, pacienteDeSesion, ip: clientIp() });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${archivo}"`,
        "Cache-Control": "no-store, private, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof ErrorDominio) return denegado(e.message, e.http);
    throw e;
  }
}
