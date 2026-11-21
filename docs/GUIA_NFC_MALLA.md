# Guía de piloto: llavero NFC, ciclo de contacto y malla sin internet (Briar / Bridgefy)

Propuesta unificada para que **ninguna paciente se quede sin su resultado**, tenga o no celular, haya o no internet.

## 1. La idea en una tabla

| Capa | Qué usa la paciente | Qué pasa por detrás | Estado en el prototipo |
|---|---|---|---|
| **Entrada sin celular** | Un **llavero NFC** (o QR en su talón) que recibe el día de la toma | El llavero guarda solo un enlace con un código al azar. Al acercarlo al celular del voluntario o al kiosco se abre su pantalla | **Funciona** (`src/core/reto4/llavero.ts`, pantalla `/t/<código>`) |
| **Segundo factor** | Su fecha de nacimiento | Llavero (algo que tiene) + fecha (algo que sabe) abre una sesión de 15 min | **Funciona** (5 intentos, luego bloqueo) |
| **Aviso escalonado** | Nada: le llega por el medio que tenga | Cada 72 h sin consulta se prueba el siguiente medio: Telegram → SMS → correo → malla Bluetooth → persona | **Funciona la lógica**; los envíos están simulados (`src/core/reto4/contacto.ts`, `src/sim/proveedores.ts`) |
| **Transporte sin internet** | Nada (transparente) | Una "mula" (voluntario con celular) lleva el aviso neutro por Bluetooth/Wi-Fi local hasta la comunidad | **Demo con apps** (Briar / Bridgefy, 0 código); en el back se registra como medio `malla` |
| **Cierre humano** | Una llamada o visita | Si nada funcionó, el caso cae en "entrega asistida" con alerta en el panel | **Funciona** |

Reglas que no cambian: los avisos **nunca llevan diagnóstico**, el PDF solo se ve con sesión de la titular, y todo queda en la bitácora encadenada.

## 2. Llavero NFC: paso a paso (10 minutos)

### Qué necesitas
- El llavero NFC que te dieron (normalmente es NTAG213/215; cualquiera que acepte un registro de tipo URL sirve).
- Un celular Android con NFC y Chrome (para grabar). Para leer sirve cualquier Android con NFC o un iPhone XS o posterior.
- La plataforma abierta en una **dirección HTTPS pública** (el celular debe poder abrirla). En `localhost` no funciona desde el celular.

### Grabar el llavero
1. Entra como `admin` → **Pacientes** → botón **Llavero NFC** de la paciente (para la demo usa `EIRA-00507`, que no tiene teléfono ni correo).
2. Aparece el enlace del llavero (`https://.../t/<código>`). Ese enlace es lo único que se graba.
3. Opción A (más rápida, Chrome en Android): toca **Grabar en el llavero** y acerca el llavero a la parte trasera del celular.
4. Opción B (cualquier celular): toca **Copiar enlace**, abre la app **NFC Tools** → *Escribir* → *Añadir un registro* → *URL/URI* → pega el enlace → *Escribir* → acerca el llavero.
5. Respaldo sin NFC: imprime el QR que aparece en la misma pantalla.

### Usarlo en el punto EIRA (kiosco o celular del voluntario)
1. El voluntario desbloquea su celular y la paciente acerca su llavero.
2. Se abre sola la pantalla: "Hola, Rosa. Tu documento está listo" (o "sigue en revisión" / "te lo entregamos en persona").
3. La paciente escribe su **fecha de nacimiento** y toca **Ver mi documento**.
4. Ve su PDF. El estudio pasa a "Consultado" y queda en la bitácora como `LOGIN_PACIENTE_LLAVERO_NFC`.
5. Al terminar: **Salir**. Si se olvida, la sesión se cierra sola a los 15 minutos.

### Por qué es seguro (para el jurado)
- El llavero **no guarda nombre, folio ni resultado**: solo un código al azar. En la base se guarda solo su hash.
- Si se pierde, quien lo encuentre ve como mucho un nombre de pila y "listo / en revisión"; sin la fecha de nacimiento no abre nada, y a los 5 intentos se bloquea.
- Reponerlo desactiva el anterior al instante.
- Un resultado que la médica marcó como "entrega acompañada" **no se descarga** ni con llavero: la pantalla ofrece la cita.

## 3. Ciclo de contacto (el "loop")

Cada vez que se ejecuta, revisa los estudios autorizados que nadie ha consultado. Si pasaron **72 horas** desde el último intento, usa el siguiente medio que esa paciente tenga:

1. **Telegram** (internet, costo cero)
2. **SMS** (red celular, sin datos)
3. **Correo**
4. **Malla Bluetooth** (Bridgefy / Briar / Nearby, llevada por una mula al punto comunitario de su municipio)
5. **Persona** (llamada o visita): marca "requiere entrega asistida" y aparece en las alertas

Si un medio está caído, salta al siguiente en la misma pasada. En cuanto la paciente consulta, el ciclo se detiene.

### Demo del ciclo (2 minutos)
1. Como `admin` en el **Panel**, sección *Controles de demo*: toca **+3 días** (simula 72 h).
2. Toca **Ejecutar ciclo ahora**. Arriba aparece qué folio escaló y a qué medio.
3. Repite **+3 días** → **Ejecutar ciclo ahora**: verás el siguiente medio, hasta llegar a "asistida".
4. En **Bandeja SMS/Correo** se ven los avisos (todos neutros) y en **Bitácora** cada `CONTACTO_ESCALADO`.
5. Opcional: toca **Simular bloqueo** de un proveedor y ejecuta el ciclo: registra el fallo y pasa al siguiente.

También por API: `POST /api/v1/reto4/contacto/ciclo` (en producción lo llama un cron cada hora).

## 4. Malla sin internet con apps listas (0 código)

El mensaje que viaja por la malla es **solo el aviso neutro** ("tienes un documento disponible, acerca tu llavero en el punto EIRA"). El resultado nunca viaja por Bluetooth: se consulta en el punto EIRA con el llavero.

### Briar (recomendada: cifrada de extremo a extremo, sin servidores)
Solo Android. Sincroniza entre contactos por Bluetooth o Wi-Fi local, sin internet.
1. Instala **Briar** en dos celulares (coordinación EIRA y voluntaria/mula).
2. En ambos: crear cuenta local (apodo + contraseña; no pide teléfono ni correo).
3. *Añadir contacto* → *Añadir contacto cercano* → cada una escanea el QR de la otra.
4. Pon ambos en **modo avión** y enciende solo Bluetooth.
5. Escribe el aviso neutro en un celular: llega al otro sin internet.
6. Guion: "la mula sale de la oficina con el aviso en su celular y, al llegar a la comunidad, se sincroniza sola con el celular del punto EIRA".

### Bridgefy (malla que salta entre celulares, ~100 m por salto)
Android y iPhone.
1. Instala **Bridgefy** en 2 o 3 celulares y ábrela una vez con internet para activarla.
2. Activa Bluetooth, pon modo avión y vuelve a encender Bluetooth.
3. Usa el chat cercano / difusión para enviar el aviso neutro.
4. Con 3 celulares en línea (A–B–C), A y C fuera de alcance entre sí: el mensaje salta por B.
5. Úsala para avisos generales ("hoy hay entrega de resultados en la plaza"); para avisos individuales prefiere Briar.

### Pantalla "Malla sin internet" (`/staff/malla`, administración)
Lista los avisos que el ciclo de contacto mandó al medio `malla`. Cada uno trae el aviso neutro con una referencia opaca (sin nombre, folio ni diagnóstico), un botón para copiarlo a Briar/Bridgefy y un QR para pasarlo de celular a celular sin internet. Al volver, se registra quién lo llevó y con qué app ("Entregado por mula"); queda en la bitácora como `MALLA_ENTREGA_CONFIRMADA`. API: `GET /api/v1/reto4/malla` y `POST /api/v1/reto4/malla/:id/entrega`. La plataforma no transmite por Bluetooth: ese salto lo hace la app de malla.

**Ruta por Briar, ida y regreso.** En la misma pantalla, "Ruta por Briar" junta en un solo mensaje los avisos pendientes de cada punto comunitario (ID EIRA y clave opaca; sin nombres, folios de muestra ni términos clínicos) para mandarlo a la promotora. Ella contesta en Briar `RECIBIDO <clave>`; al volver se pega su respuesta y solo esas claves quedan como entregadas (las desconocidas o repetidas se reportan). API: `GET /api/v1/reto4/malla/rutas` y `POST /api/v1/reto4/malla/acuse`. Copiar y pegar entre Briar y la plataforma lo hace una persona.

### Siguiente paso técnico (no está en el prototipo)
Google **Nearby Connections** (Android) / Apple **Multipeer**: app propia del voluntario que descarga la cola de avisos en la oficina y la entrega al llegar al punto comunitario. El back ya está listo para eso: el medio `malla` del ciclo y la sincronización offline idempotente del Reto 1 (`POST /api/v1/reto1/sync`).

## 5. Por qué vale la pena

- **Ataca el problema real de EIRA**: hoy todo depende de una cuenta de WhatsApp que se bloquea. Aquí hay cinco medios y el último siempre es una persona.
- **Incluye a quien no tiene celular**: un llavero es barato, no necesita batería ni que la paciente sepa usar una app.
- **Funciona sin internet en la comunidad**: el aviso llega por malla y el resultado se consulta en el punto EIRA.
- **No baja la privacidad**: ni el llavero ni la malla llevan datos clínicos.
- **Es medible**: cada intento, medio y consulta queda registrado; se puede reportar el % de resultados entregados y por qué medio.

## 6. Qué es real y qué es simulado

| Real en el prototipo | Simulado |
|---|---|
| Emisión, lectura y acceso con llavero (con pruebas automáticas) | Envío por Telegram, SMS, correo y malla (se guardan en la bandeja simulada) |
| Lógica del ciclo de 72 h y escalera de medios (con pruebas) | El paso del tiempo (reloj de demo) |
| Bitácora, bloqueo por intentos, desactivación al reponer | La mula: se demuestra con Briar/Bridgefy fuera de la plataforma |

## 7. Guion de demo de 3 minutos
1. "Rosa no tiene celular. El día de la toma le damos este llavero." → grabar llavero de `EIRA-00507`.
2. "Su resultado ya fue autorizado. El sistema intenta avisarle…" → +3 días, **Ejecutar ciclo**: no hay teléfono ni correo → malla → persona.
3. "El aviso viaja sin internet" → Briar en modo avión entre dos celulares.
4. "Rosa llega al punto EIRA" → acerca el llavero al celular del voluntario → fecha de nacimiento → ve su documento.
5. "Y todo quedó registrado" → Bitácora: cadena íntegra.
