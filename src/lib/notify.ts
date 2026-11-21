import { db, type Paciente } from "./db";
import { entregar, proveedorCaido } from "@/sim/proveedores";
import { maskEmail, maskPhone } from "./ids";
import { nowIso } from "@/sim/reloj";

export const PORTAL_URL = process.env.PORTAL_URL ?? "https://resultados.eira.org/portal";
const TEL = "341 410 8111";

const PROHIBIDAS = [
  "diagnost", "resultado positivo", "negativ", "positiv", "vph", "papiloma", "lesion", "lesión", "cancer", "cáncer",
  "carcinoma", "displasia", "nic ?[123]", "bethesda", "asc-", "hsil", "lsil", "maligno", "anormal", "hallazgo", "tumor",
];

export function esNeutro(msg: string) {
  const m = msg.toLowerCase();
  return !PROHIBIDAS.some((w) => new RegExp(`\\b${w}`).test(m));
}

type Tipo = "disponible" | "acompanado" | "otp" | "seguimiento";

function plantilla(tipo: Tipo, canal: "sms" | "correo", extra?: { codigo?: string }) {
  switch (tipo) {
    case "disponible":
      return canal === "sms"
        ? { asunto: null, mensaje: `EIRA: Tienes un documento disponible para consulta segura en ${PORTAL_URL} con tu folio y fecha de nacimiento. Dudas: ${TEL}` }
        : {
            asunto: "EIRA: Tienes un documento disponible en tu portal",
            mensaje: `Hola. Tienes un documento disponible para consulta segura.\n\nEntra a ${PORTAL_URL}, escribe tu folio EIRA y tu fecha de nacimiento, y te enviaremos un código de acceso temporal.\n\nSi prefieres recibirlo en persona, llama al ${TEL} o acude a la oficina de EIRA.\n\nEste correo no contiene información médica.`,
          };
    case "acompanado":
      return canal === "sms"
        ? { asunto: null, mensaje: `EIRA: Tu documento está listo. Queremos entregártelo en persona; te llamaremos para agendar o llama al ${TEL}.` }
        : {
            asunto: "EIRA: Tu documento está listo para entrega personal",
            mensaje: `Hola. Tu documento está listo y queremos entregártelo personalmente con orientación de nuestro equipo.\n\nTe llamaremos para agendar, o puedes llamar al ${TEL}.\n\nEste correo no contiene información médica.`,
          };
    case "seguimiento":
      return canal === "sms"
        ? { asunto: null, mensaje: `EIRA: Recuerda que tienes un documento disponible. Consulta en ${PORTAL_URL} o llama al ${TEL}.` }
        : { asunto: "EIRA: Recordatorio de documento disponible", mensaje: `Hola. Te recordamos que tienes un documento disponible en ${PORTAL_URL}. Dudas: ${TEL}.` };
    case "otp":
      return canal === "sms"
        ? { asunto: null, mensaje: `EIRA: Tu código de acceso es ${extra?.codigo}. Vence en 10 minutos. No lo compartas con nadie.` }
        : { asunto: "EIRA: Tu código de acceso", mensaje: `Tu código de acceso es ${extra?.codigo}. Vence en 10 minutos. No lo compartas con nadie.` };
  }
}

export { proveedorCaido };

export type ResultadoEnvio = { canal: "sms" | "correo"; destino: string } | null;

export function enviarNeutro(p: Paciente, tipo: Tipo, estudioId: string | null, extra?: { codigo?: string }): ResultadoEnvio {
  const orden: ("sms" | "correo")[] = p.canal_preferido === "correo" ? ["correo", "sms"] : ["sms", "correo"];
  const ins = db().prepare(
    `INSERT INTO notificaciones (estudio_id, paciente_id, canal, destino_enmascarado, asunto, mensaje, estado, tipo, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const canal of orden) {
    const destino = canal === "sms" ? p.telefono : p.correo;
    if (!destino) continue;
    const { asunto, mensaje } = plantilla(tipo, canal, extra);
    if (tipo !== "otp" && !esNeutro(`${asunto ?? ""} ${mensaje}`)) throw new Error("Mensaje con términos clínicos bloqueado");
    const masked = canal === "sms" ? maskPhone(destino) : maskEmail(destino);
    const envio = entregar(canal);
    ins.run(estudioId, p.id, canal, masked, asunto, mensaje, envio.estado, tipo, nowIso());
    if (envio.ok) return { canal, destino: masked };
  }
  return null;
}
