# WENDY — Asistente de voz con cámara (tipo Alexa)

Wendy escucha, habla, toma fotos y te dice qué está viendo. Funciona **gratis**:

1. **Base de datos propia** (`data/conocimiento.json`): responde primero con lo que ella sabe, la hora, la fecha y cuentas.
2. **Google Gemini** (opcional, gratis con límites): si no sabe algo, le pregunta a Gemini. También lo usa para describir fotos en detalle.
3. **Visión sin IA** (TensorFlow.js + COCO-SSD): si Gemini no está o se acaba el límite, reconoce unos 80 tipos de objetos dentro del navegador («Veo una persona, una taza y un celular»).

## Requisitos
- Node.js 20 o superior
- **Google Chrome o Microsoft Edge** (no el navegador interno de VS Code)
- Micrófono, bocinas y cámara
- Internet (la primera vez que uses la cámara descarga el modelo de visión, unos 5 MB)

## La forma más fácil de abrirla
Haz doble clic en **`Iniciar Wendy.bat`**. Arranca el servidor y abre Wendy en su propia ventana de Chrome (o Edge),
ya escuchando y con permiso para hablar sin que toques nada. La primera vez te pedirá permiso para el micrófono y la cámara.
Puedes crear un acceso directo de ese archivo en tu escritorio.

## Instalación
1. En la terminal de VS Code: `npm.cmd install`
2. Copia `.env.example` como `.env`.
3. (Opcional) Saca una clave gratis en https://aistudio.google.com/apikey y ponla en `GEMINI_API_KEY` dentro de `.env`.
   Sin clave, Wendy funciona igual pero solo con su base de datos y la visión sin IA.
4. `npm.cmd start`
5. Abre **http://localhost:3000** en Chrome y acepta micrófono y cámara.

> Si `npm start` da error de «ejecución de scripts deshabilitada», usa `npm.cmd start` o ejecuta una vez:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

## Cómo usar a Wendy
Al abrir la página, Wendy queda escuchando. Di **«Ey Wendy»** y luego tu pregunta. Después de que te responda,
puedes seguir hablando **sin repetir su nombre** durante unos 20 segundos.

| Qué quieres | Qué decir |
|---|---|
| Empezar | «Ey Wendy» o «Ey Wendy, ¿qué hora es?» |
| Terminar (apaga el micrófono) | «Gracias Wendy, con esto terminamos», «eso es todo», «adiós», «deja de escuchar» |
| Que vea algo | «¿Qué estás viendo?», «Toma una foto», «¿Qué tengo en la mano?» |
| Descripción en vivo | «Modo en vivo» (lo muestra en pantalla), «Narra lo que ves» (también lo dice en voz alta), «Deja de narrar», «Detén el modo en vivo» |
| Ubicación | «¿Dónde estoy?» |
| Clima | «¿Qué clima hace?», «¿Va a llover mañana?», «Clima en Antigua Guatemala», «¿Qué temperatura hace en Xela?» |
| Crear imágenes | «Dibújame un gato astronauta», «Crea una imagen de un dragón estilo anime», «Genera un logo para mi tienda» |
| Cámara | «Abre la cámara», «Quiero la cámara», «Cambia la cámara», «Cierra la cámara» |
| Repetir | «Repite», «¿Qué dijiste?» |
| Velocidad | «Habla más lento», «Habla más rápido», «Habla normal» |
| Volumen | «Más fuerte», «Más bajo» |
| Su voz | «Desactiva tu voz», «Activa tu voz» |
| Callarla | «Silencio» o tecla `Esc` |
| Empezar de cero | «Nueva conversación» |
| Cuentas | «¿Cuánto es 25 por 4?», «El 15 por ciento de 200» |
| Enseñarle | «Wendy, aprende que mi color favorito es el morado» |

Si terminas la conversación y quieres volver a hablarle, toca el botón **👂 Ey Wendy** o el 🎤, o recarga la página.

Debajo de cada respuesta verás de dónde salió: **base de datos**, **Gemini** o **visión sin IA**.

## Modo en vivo (más preciso)
- Usa el modelo de objetos completo (más preciso que el ligero) y sigue cada objeto entre cuadros:
  solo aparece si se ve en varios cuadros seguidos, así no salen etiquetas que parpadean.
- El modelo sin IA conoce unos 80 tipos de objetos (persona, celular, taza, libro…). **No conoce cosas como
  lapiceros o correctores**, por eso a veces se equivoca. Con Gemini activado, cada 8 a 25 segundos Gemini revisa
  la escena y pone el nombre correcto (✨ en rosa). Si Gemini no confirma algo, se muestra como «¿celular?».

## Alertas rápidas (modo en vivo + narrar)
Wendy detecta la postura de hasta 6 personas varias veces por segundo, sin IA y sin internet (modelo MoveNet):
- **«¡Alerta! Persona a menos de 1 metro.»** (la distancia también aparece junto a cada persona: 📏)
- **«Persona con las manos levantadas.»**, «Persona con una mano levantada.», «Persona saludando.»
- **«Persona acercándose.»**
- **«¡Alerta! Persona en el suelo, posible caída.»**

Las alertas salen en un aviso rojo sobre el video. Si está **narrando**, las dice al instante y más rápido,
interrumpiendo lo que estaba diciendo. Con Gemini, cada 5 segundos también describe **qué está haciendo** cada persona
y avisa si ve algo urgente (fuego, humo, alguien pidiendo ayuda…).

La distancia es un **estimado** (usa el ancho de los hombros y el torso). Si en tu cámara sale siempre de más o de menos,
puedes ajustarla: abre la consola del navegador (F12) y escribe, por ejemplo,
`localStorage.setItem("wendy_calibracion_distancia", "0.8")` (menos de 1 = distancias más cortas).

## Modo en vivo — detalles
Con la cámara abierta toca **🔴 En vivo** (o dilo). Wendy marca los objetos sobre el video con su nombre y escribe
abajo lo que ve, actualizándose varias veces por segundo (reconoce unos 80 tipos de objetos, sin IA y gratis).
Si tienes Gemini, cada 10 a 30 segundos agrega una descripción más completa (✨), solo cuando la escena cambia,
para no gastar el límite gratuito. Con **🗣️ Narrar** te lo dice en voz alta cuando algo cambia.

## Ubicación y clima
- La ubicación la da tu navegador (te pedirá permiso la primera vez). En computadoras de escritorio es aproximada.
  Si no funciona, activa la ubicación de Windows: *Configuración → Privacidad y seguridad → Ubicación*.
- El clima viene de **Open-Meteo** (gratis, sin clave). Si no quieres compartir ubicación, pon tu ciudad en `.env`:
  `WENDY_CIUDAD=Ciudad de Guatemala`

## Crear imágenes
Wendy usa **Pollinations** (gratis, sin clave): una imagen cada 15 segundos y a veces tarda hasta un minuto.
Si tienes Gemini, primero mejora tu pedido para que la imagen salga mejor. La imagen se carga directo en el chat
y tiene un botón **⬇ Descargar**. No crea contenido sexual, violento ni de odio.

## Wendy aprende de Gemini
Cuando Gemini responde algo que no cambia con el tiempo (por ejemplo «¿qué es un agujero negro?»), Wendy lo guarda
en su base de datos con `"origen": "gemini"`. La próxima vez contesta al instante, sin esperar a Gemini.
No guarda cosas que cambian (hora, clima, noticias, precios, presidentes) ni preguntas personales.
Si alguna respuesta guardada está mal, corrígela o bórrala en `data/conocimiento.json`.

## Memoria (sin mostrar historial)
La pantalla solo muestra la conversación actual, pero Wendy **recuerda** lo que platicaron y las alertas que vio
(últimos 30 días, solo en ese navegador). Pregúntale: «¿Qué hice ayer?», «¿De qué hablamos hoy?»,
«¿Qué viste el lunes?», «¿Te acuerdas de lo que te conté?». Para borrarla: «Borra tu memoria».
Con Gemini responde de forma natural; sin Gemini da un resumen de lo que le dijiste.

## Editar la base de datos
Abre `data/conocimiento.json`. Cada tema tiene:
```json
{
  "preguntas": ["que hora es", "dime la hora"],
  "respuestas": ["Son las {hora}."]
}
```
- `preguntas`: distintas formas de preguntarlo (sin importar mayúsculas ni tildes).
- `respuestas`: Wendy elige una al azar. Puedes usar `{hora}`, `{fecha}` y `{dia}`.
- Lo que le enseñas por voz se guarda aquí con `"origen": "voz"` y lo que aprende de Gemini con `"origen": "gemini"`.
- Wendy recarga el archivo sola al guardarlo.

## Archivos
- `Iniciar Wendy.bat`: abre todo con doble clic.
- `server.js`: servidor; decide si responde la base de datos o Gemini.
- `brain.js`: cerebro local (búsqueda, hora, fecha, cálculos, aprender).
- `api.js`: todas las funciones del servidor (se usa en tu computadora y en Netlify).
- `stores.js`: dónde se guarda lo aprendido (archivo JSON o Supabase).
- `services.js`: clima, ubicación y creación de imágenes.
- `netlify.toml` y `netlify/functions/api.mjs`: configuración para publicar en Netlify.
- `supabase/crear-tabla.sql`: la tabla de Supabase.
- `scripts/`: copiar las librerías de visión y subir lo aprendido a Supabase.
- `data/conocimiento.json`: la base de datos de Wendy.
- `public/index.html`, `public/estilos.css`: la página.
- `public/script.js`: chat, voz, modo «Wendy» y cámara.
- `public/vision.js`: reconocimiento de objetos sin IA.
- `public/app.js` y `public/styles.css`: copias viejas que no se usan; puedes borrarlas.

No compartas tu archivo `.env`. Con la clave gratuita de Gemini, Google puede usar lo que le envías para mejorar sus productos.


## Publicar en internet (Netlify) para usarla desde cualquier lado
En internet Wendy funciona igual, y además en el celular (Netlify da `https`, que la cámara y el micrófono necesitan).

### 1. Base de datos en Supabase (para que siga aprendiendo en internet)
En Netlify el servidor no puede guardar archivos, así que lo que Wendy aprende se guarda en Supabase.
1. Crea una cuenta gratis en https://supabase.com y un proyecto nuevo.
2. Ve a **SQL Editor → New query**, pega el contenido de `supabase/crear-tabla.sql` y presiona **Run**.
3. Ve a **Project Settings → API Keys** y copia la **Secret key** (empieza con `sb_secret_`).
   La **Project URL** (parece `https://xxxx.supabase.co`) aparece al tocar el botón **Connect** arriba,
   o en **Project Settings**.
4. (Opcional) Pon esos dos datos también en tu `.env` y ejecuta `npm.cmd run subir-supabase` para subir
   lo que Wendy ya aprendió en tu computadora. Desde ese momento tu computadora y la web comparten la misma memoria.

Los temas base siguen en `data/conocimiento.json`; en Supabase solo se guarda lo aprendido.
Sin Supabase, la versión web funciona pero olvida lo aprendido cada cierto tiempo.

### 2. Subir a Netlify
1. Crea una cuenta gratis en https://netlify.com
2. En la terminal de VS Code, dentro de la carpeta del proyecto:
   ```
   npm.cmd install
   npx.cmd netlify-cli login
   npm.cmd run publicar
   ```
   La primera vez te preguntará si quieres crear un proyecto nuevo: elige **Create & configure a new project**
   y ponle un nombre (por ejemplo `wendy-madelynn`). Al final te da el enlace `https://...netlify.app`.
3. En Netlify, entra a tu proyecto → **Project configuration → Environment variables** y agrega:
   | Variable | Valor |
   |---|---|
   | `GEMINI_API_KEY` | tu clave de Gemini |
   | `SUPABASE_URL` | la Project URL de Supabase |
   | `SUPABASE_SECRET_KEY` | la Secret key de Supabase |
   | `WENDY_CODIGO` | un código que tú inventes (recomendado) |
   | `WENDY_CIUDAD` | opcional, por ejemplo `Ciudad de Guatemala` |
4. Vuelve a publicar para que tome las variables: `npm.cmd run publicar`

### ¿Por qué el código de acceso?
Si tu Wendy es pública, cualquiera con el enlace podría usar tu límite gratuito de Gemini.
Con `WENDY_CODIGO`, la página pide el código una vez en cada navegador. Compártelo solo con quien quieras.

## Manos libres: cómo controlar a Wendy solo con la voz

- **Despertarla:** «Ey Wendy…» y luego tu pedido. Después tienes 20 segundos para seguir hablando sin repetir su nombre.
- **Callarla en cualquier momento** (aunque esté hablando o narrando, sin decir «Wendy»): «para», «basta», «silencio», «cállate», «deja de hablar».
- **Apagar la cámara:** «apaga la cámara», «cierra la cámara», «ya no veas», «apaga todo».
- **Dejar de narrar pero seguir viendo:** «deja de narrar».
- **Cancelar algo que tarda** (por ejemplo una imagen): «Wendy, cancela».
- **Imágenes:** «crea / dibújame / hazme / ¿me puedes hacer… una imagen de…». Wendy avisa enseguida que la está dibujando.
- La narración en vivo solo habla cuando la escena cambia de verdad y no repite lo mismo en 90 segundos.
- Opcional: con `POLLINATIONS_KEY` en `.env` (clave pública gratis de https://enter.pollinations.ai) las imágenes salen más rápido.
