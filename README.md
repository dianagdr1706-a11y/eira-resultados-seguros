# EIRA Resultados Seguros — Reto 1 + Reto 4 (Vibeathon Nerdearla México 2026)

> **PaDi** es la submarca de la interfaz (portal y paneles con la identidad visual de EIRA). El producto y el repositorio se llaman **EIRA Resultados Seguros**.

Plataforma única que cubre el **Reto 1 (Expediente Digital Único)** y el **Reto 4 (Entrega Segura de resultados de Papanicolaou)** en un solo recorrido: **registro en jornada → expediente único → carga/asociación de PDF → doble compuerta → entrega segura/asistida → cierre de ciclo**.

Es una alternativa segura, inclusiva y *offline-ready* a WhatsApp y a las hojas de captura duplicadas para el **registro sin duplicados, la verificación de identidad, la autorización clínica, la notificación neutra, la entrega autenticada y el seguimiento de ciclo cerrado (*Closed-Loop*)** de resultados de **Papanicolaou** para **EIRA Movimiento Rosa A.C.**

> **Licencia:** Open Source [MIT](./LICENSE)  
> **Enfoque:** Flujo crítico completo + Nodo Kiosco Comunitario (Raspberry Pi / Local-First) + Motor de Alertas Insistentes hasta confirmación (ACK).  
> **Documentación técnica de Red, NFC, Bridgefy/Nearby/LoRa y Loop:** [docs/ARQUITECTURA_RED_NFC_LOOP_OFFLINE.md](./docs/ARQUITECTURA_RED_NFC_LOOP_OFFLINE.md)

---

## 1. Problema que resuelve

Actualmente, EIRA recibe resultados impresos del laboratorio, los escanea, los asocia manualmente por nombre y envía **más de 300 PDFs al mes por WhatsApp**. Cuando la cuenta de WhatsApp se bloquea, las entregas se detienen por completo; además, existe riesgo de homonimia, fuga de datos clínicos y exclusión de mujeres sin correo, teléfono propio o señal constante.

**Reto 1 (Expediente):** las pacientes se identifican solo por nombre completo, por lo que una mujer que acude 4 veces al año se registra 4 veces (cuatro "pacientes" distintas, sin historial único). Variantes de escritura (acentos, "Ma."/"Gpe.", día/mes invertidos) generan duplicados, y en las jornadas la captura debe poder hacerse **sin internet**.

---

## 2. Qué está Implementado Hoy vs. Qué está Simulado para Piloto

| Capacidad | Estado hoy | Detalle técnico |
| --- | --- | --- |
| Carga de PDF privado + integridad `SHA-256` | **Implementado** | Almacenamiento en `private_storage/pdfs/` (fuera de `public/`) + generación de PDF sintético con `pdf-lib`. |
| Asociación multiatributo anti-homónimos | **Implementado** | Visor lado a lado (PDF vs. ficha) + checklist humano obligatorio de 3 puntos. |
| Doble compuerta (Revisión Admin + Autorización Clínica) | **Implementado** | RBAC estricto (`laboratorio`, `eira_admin`, `medico`, `promotora_kiosco`) + modo `digital` vs. `acompanado`. |
| Descarga autenticada sin enlaces públicos permanentes | **Implementado** | Endpoint `/api/studies/[id]/pdf` con cookies `HttpOnly`, tokens efímeros (60 s), `Cache-Control: no-store`, marca de agua dinámica y rechazo `HTTP 401` sin sesión. |
| Store TTL compatible con **Valkey** | **Implementado** | Adaptador `ioredis` listo para `VALKEY_URL=redis://...` con fallback automático a tabla SQLite TTL para demo cero-fricción. |
| Acceso Paciente cero-fricción (OTP / PIN impreso) + Tarjeta QR | **Implementado** | Folio + Fecha de nacimiento + OTP de 6 dígitos (o PIN de 4 dígitos para mujeres sin celular) + QR "Semáforo Clínico" sin diagnósticos. |
| Modo Kiosco Comunitario (Raspberry Pi / Offline *Store-and-Forward*) | **Implementado (software) / Simulado (hardware RPi)** | Caché local cifrada **AES-256-GCM**, switch Online/Offline, registro de entregas asistidas en cola local y sincronización al reconectar + información preventiva offline. |
| Motor Closed-Loop de alertas insistentes hasta ACK | **Implementado (motor) / Simulado (pasarela SMS/LoRa/Mesh)** | Escalamiento por tiempo (`+24h/+48h`): SMS/Correo neutro → Kiosco Wi-Fi / Nearby P2P → LoRa 433MHz pseudonimizado → Escalamiento a Promotora. Parada inmediata al recibir ACK. |
| Guardián anti-filtración clínica + Bitácora inmutable | **Implementado** | `assertNoClinicalLeak()` bloquea cualquier término clínico en notificaciones/alertas + tabla `audit_logs` *append-only*. |
| Interoperabilidad en formatos abiertos | **Implementado** | Exportación directa de seguimiento y trazabilidad en **CSV** y **JSON** (`/api/export?format=csv|json`). |
| **Reto 1:** ID EIRA estable + visitas separadas | **Implementado** | Folio `PAC-AAAA-NNN` = ID EIRA (campo 3 del formato en papel), independiente del nombre. Tabla `visits` separada de `studies` (fecha, sede, comunidad, servicios, folio de muestra, quién capturó, si fue sin conexión). PIN impreso de 4 dígitos mostrado una sola vez. |
| **Reto 1:** Coincidencias multi-atributo explicables + confirmación humana | **Implementado** | `POST /api/patients/match` con puntaje y razones (fecha de nacimiento +40, día/mes invertidos +20, nombre muy similar +30 / parecido +15 tolerante a acentos, "Ma."/"Gpe." y errores de 1 letra, mismos apellidos +10, teléfono +25, entidad +5, comunidad +5; ≥70 probable, 40–69 posible). **Nunca vincula ni fusiona automáticamente**: "Es ella" o "Es otra persona" (motivo ≥10 caracteres; `POST /api/patients` responde `409 POSSIBLE_DUPLICATE`). |
| **Reto 1:** Captura offline + sincronización idempotente | **Implementado en navegador** | Cola local (`localStorage`) con `client_uuid`; `POST /api/sync/registrations` re-ejecuta coincidencias en servidor: altas que coinciden → **conflicto** para confirmación humana (no se crean), reenvíos → `ya_sincronizado`, ediciones con versión vieja → conflicto. |
| **Reto 1:** Bitácora antes/después y control de versión | **Implementado** | `PATCH /api/patients/[id]` envía solo campos cambiados con `base_version` (`409 VERSION_CONFLICT`); bitácora con valor antes/después por campo. |
| **Puente Reto 1 → Reto 4:** sugerencia por folio de muestra + alerta de discordancia | **Implementado** | En el cotejo de `/eira`, `GET /api/studies/[id]/suggested-patient` propone a la paciente cuya visita registró el mismo folio de muestra; si el operador elige a otra, aparece alerta roja de discordancia y una casilla extra obligatoria (mitiga el riesgo Pérez vs. Peralta). |
| **Reto 1:** Fusión/depuración de duplicados históricos importados de Excel | **Diseñado, no implementado** | Requiere importador con revisión humana por lotes (ver sección 7). |
| **Reto 1:** Cifrado de la cola offline del navegador | **Pendiente para piloto** | Hoy la cola en `localStorage` no está cifrada; se propone WebCrypto y borrado al sincronizar. |

---

## 3. Arquitectura y Tecnologías

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS (PWA instalable en Android/iOS).
- **Base de datos:** SQLite nativo de Node.js (`node:sqlite`, `data/eira.db`) — migrable 1:1 a PostgreSQL.
- **Store efímero / Rate-Limit:** **Valkey** (protocolo Redis vía `ioredis`, activable con `VALKEY_URL`) con fallback automático a SQLite TTL.
- **Seguridad y Criptografía:** `node:crypto` (`SHA-256` para integridad de PDF, `AES-256-GCM` para paquetes *Store-and-Forward / Sneakernet* de Kioscos Raspberry Pi, HMAC-SHA256 en cookies `HttpOnly`).
- **PDF y QR:** `pdf-lib` (generación de PDFs sintéticos y marca de agua en descarga) + `qrcode` (Tarjetas QR "Semáforo Clínico").

---

## 4. Instalación y Ejecución Local

### Requisitos
- **Node.js 22+ LTS** (probado en Node.js 26 LTS con `node:sqlite` integrado).
- *(Opcional)* **Valkey** corriendo en `redis://127.0.0.1:6379` (definir `VALKEY_URL`).

### Pasos
```bash
# 1. Instalar dependencias
npm install

# 2. (Opcional) Activar Valkey real
# En PowerShell: $env:VALKEY_URL="redis://127.0.0.1:6379"

# 3. Iniciar en modo desarrollo
npm run dev
```

> **Modo demo (`EIRA_DEMO_MODE`)**: en `npm run dev` está activo por defecto y el portal muestra el OTP simulado (no hay pasarela SMS real). En producción (`npm start`) está **apagado** y el OTP nunca viaja en la respuesta de la API; para una demo desplegada define `EIRA_DEMO_MODE=1`. Todas las APIs de personal (`/api/patients`, `/api/studies`, `/api/loop`, `/api/export`, etc.) exigen sesión de personal y responden `401` sin ella.

Abre **[http://localhost:3000](http://localhost:3000)**. Al primer inicio se crean automáticamente la base SQLite (`data/eira.db`), los 5 PDFs sintéticos en `private_storage/pdfs/` y las pacientes ficticias de demostración.

### Verificación automatizada (Build + Pruebas E2E y Seguridad)
```bash
npm run typecheck
npm run build
node scripts/verify-e2e.mjs
```

`scripts/verify-e2e.mjs` ejecuta **15 pasos** (a, a2, b–j del Reto 4 + k–n del Reto 1). Debe correrse contra una base recién sembrada:

```bash
# 1. Borrar la base y los PDFs generados
rm -f data/eira.db* private_storage/pdfs/*.pdf   # PowerShell: Remove-Item data/eira.db*, private_storage/pdfs/*.pdf
# 2. Iniciar el servidor
npm run dev
# 3. En otra terminal (BASE_URL por defecto http://127.0.0.1:3000)
node scripts/verify-e2e.mjs
```

---

## 5. Guion de Demostración (2 Minutos)

1. **Registro y Expediente (`/registro`):** Entrar como promotora (auto-login demo), pulsar autollenar paciente recurrente *"Ma. Gpe. Hernandez Perez"*, `1988-05-14` → **Buscar coincidencias** → coincidencia **probable (90)** con razones explicables → **"Es ella: registrar visita"** → ver el historial con visitas. Luego **"Simular sin señal"**, capturar de nuevo, **"Sincronizar"** y mostrar el **conflicto** (no se crea un duplicado).
2. **Panel General (`/`):** Mostrar métricas, la sección **Expediente Único (Reto 1)** (pacientes únicas, visitas, recurrentes, duplicados evitados), separación real vs. simulado, exportación CSV/JSON y bandeja de notificaciones neutras (cero diagnósticos).
3. **Carga + Asociación Anti-Homónimos (`/eira`):** Abrir el estudio `PAP-2026-101`; EIRA **sugiere por folio de muestra** a *María Guadalupe Hernández Pérez* (`PAC-2026-001`). Mostrar el PDF lado a lado y, al elegir a la *Peralta*, la **alerta roja de discordancia** con casilla extra obligatoria; volver a la paciente correcta, confirmar el checklist de 3 puntos y aprobar la **Revisión Administrativa**.
4. **Autorización Clínica (`/medico`):** Cambiar a `Dra. Elena Ramírez`, revisar `PAP-2026-102` y autorizar (mostrando modo `Digital` vs. `Acompañado Prioritario`).
5. **Portal Paciente y Prueba `401` (`/paciente`):** Ingresar como `PAC-2026-006` (*Patricia Reyes*, `1995-07-08`), solicitar OTP neutro, entrar, descargar PDF con marca de agua y pulsar **"Probar enlace sin sesión (401)"** para demostrar que no existen enlaces públicos permanentes.
6. **Loop Insistente + Kiosco Raspberry Pi Offline (`/alertas-loop` y `/kiosco`):** Avanzar `+24h/+48h` en `PAP-2026-104` (*Sierra Norte, sin celular*) para ver el escalamiento a **LoRa 433MHz pseudonimizado** y **Promotora**; luego pasar a `/kiosco` en modo **Offline**, registrar la **Entrega Asistida con ACK**, reconectar para sincronizar y ver cómo el **Loop se detiene automáticamente**.

---

## 6. Despliegue en Piloto Real (Kiosco Raspberry Pi + Nube EIRA)

- **Nube EIRA:** Next.js en contenedor (AWS App Runner / ECS) + PostgreSQL (RDS) + **Valkey** (ElastiCache) + S3 privado cifrado + Twilio/SNS (SMS) + Resend/SES (Correo).
- **Nodo Comunitario:** Raspberry Pi 4/5 corriendo la misma app en modo Edge con Hotspot Wi-Fi local (`hostapd`), sincronización *Store-and-Forward* por 4G intermitente o *Sneakernet* cifrado, y módulo LoRa `SX1278` (433 MHz) para alertas pseudonimizadas a distancia sin señal.
- **Evolución Móvil (Fase 2):** Extraer el dominio compartido a un núcleo portable en **Rust (Tauri 2 / UniFFI)** para apps nativas de brigadistas en Android/iOS con lectura NFC y sincronización P2P (Nearby/Multipeer).

---

## 7. Preguntas abiertas y supuestos a validar con EIRA

- **CURP:** no aparece en el formato en papel. Con CURP el emparejamiento sería casi determinístico; hoy se usa puntaje multi-atributo con confirmación humana.
- **ID EIRA:** ¿quién lo asigna hoy y existe un padrón previo? Se asumió que `PAC-AAAA-NNN` lo genera el sistema y se imprime en la Cartilla EIRA.
- **Duplicados históricos (Excel/Google Forms):** requieren un importador con revisión humana por lotes; no está implementado.
- **Cola offline:** cifrarla en el navegador (WebCrypto) y borrarla al sincronizar; hoy está en `localStorage` sin cifrar.
- **Consentimiento / aviso de privacidad:** definir el texto para conservar el historial entre jornadas.
- **Dispositivos compartidos en jornada:** definir cierre de sesión y limpieza de la cola local entre promotoras.
