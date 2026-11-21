/**
 * SIMULACIÓN: proveedores de SMS y correo.
 * En producción este módulo se sustituye por un proveedor real (misma firma `entregar`).
 * Los mensajes no salen del sistema: se guardan en la tabla `notificaciones` (bandeja simulada).
 */
import { getSetting, setSetting } from "@/lib/db";

/** telegram = mensajería por internet · malla = Bluetooth/Wi-Fi local (Bridgefy, Briar o Nearby) llevada por una "mula" de datos. */
export type Canal = "sms" | "correo" | "telegram" | "malla";

export function proveedorCaido(canal: Canal) {
  return getSetting(`fallo_${canal}`) === "1";
}

/** Simula una caída (como el bloqueo de la cuenta de WhatsApp) o la restablece. */
export function simularCaida(canal: Canal, caido: boolean) {
  setSetting(`fallo_${canal}`, caido ? "1" : "0");
}

/** Devuelve el estado de entrega que tendría el envío. */
export function entregar(canal: Canal): { ok: boolean; estado: "simulado" | "fallido" } {
  return proveedorCaido(canal) ? { ok: false, estado: "fallido" } : { ok: true, estado: "simulado" };
}
