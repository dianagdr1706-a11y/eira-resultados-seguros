# EIRA · Entrega segura de resultados de Papanicolaou

Prototipo para el **Reto 4 del Vibeathon Nerdearla México 2026** (EIRA Movimiento Rosa A.C.).
Reemplaza el envío de resultados escaneados por WhatsApp con un flujo de **doble compuerta** (revisión administrativa + autorización médica), notificación neutra multicanal y portal seguro para la paciente.

> **Todos los datos son ficticios.** Los PDFs generados no tienen validez clínica.

## Flujo demostrable

1. **Laboratorio** carga el PDF (folio, fecha de toma, sede). Se calcula SHA-256.
2. **EIRA admin** asocia el PDF a la paciente con búsqueda multiatributo; el sistema **alerta homónimas** y exige checklist de identidad (nombre, nacimiento, ID EIRA, folio).
3. **Médico** captura la categoría **Bethesda**; el **semáforo** sugiere entrega digital o acompañada (ASC-H, HSIL, AGC, carcinoma → acompañada prioritaria). La decisión final es del médico y ambas quedan en bitácora.
4. **Notificación neutra** (sin diagnóstico) con respaldo **SMS → correo → entrega asistida** si un proveedor falla (botón "simular caída").
5. **Paciente** entra con **folio + fecha de nacimiento + OTP** (10 min, 5 intentos) o **PIN** del talón impreso con QR. Solo ve sus documentos autorizados; el enlace de descarga dura 2 min y requiere su sesión.
6. **Seguimiento**: reloj de demo genera alertas de llamada a 7 días sin consulta (48 h si es prioritario).
7. **Auditoría**: bitácora solo-inserción (triggers SQLite) encadenada por hash, verificable en pantalla.

## Implementado vs simulado

| Implementado | Simulado |
|---|---|
| RBAC (laboratorio, admin, médico, auditoría, paciente) | Envío real de SMS/correo (bandeja simulada) |
| Máquina de estados y doble compuerta | Integración con laboratorios/LIS |
| OTP, PIN, sesiones y rate limit en Valkey (fallback memoria) | Firma electrónica del médico |
| SHA-256 del PDF verificado al descargar | Almacenamiento cifrado en la nube |
| Bitácora encadenada e inmutable | Paso del tiempo (reloj de demo) |
| Talón con QR, exportación CSV/JSON sin PII, lectura en voz alta | |

## Correr en local

```bash
docker run -d --name valkey -p 6379:6379 valkey/valkey:8-alpine   # opcional
npm install
npm run dev     # http://localhost:3000
```

Sin Valkey, usa memoria local (`VALKEY_URL=off` para forzarlo). La base SQLite y los PDFs se guardan en `data/` (ignorado por git) y se siembran solos.

**Usuarios de demo** (contraseña `demo`): `laboratorio`, `admin`, `medico`, `auditoria`.
**Pacientes de demo**: `EIRA-00348` (nac. 1991-07-30) y `EIRA-00121` son homónimas; `EIRA-00507` no tiene teléfono ni correo (talón con PIN).

## Stack

Next.js 14 (App Router, TypeScript, Tailwind) · SQLite (`better-sqlite3`) · Valkey (`ioredis`) · `pdf-lib` · `qrcode`.

## Siguientes pasos hacia piloto

Proveedor SMS/correo real con plantillas aprobadas, cifrado en reposo, aviso de privacidad (LFPDPPP), firma del médico, respaldo y hosting en México, y validación con personal de EIRA.

## Licencia

MIT
