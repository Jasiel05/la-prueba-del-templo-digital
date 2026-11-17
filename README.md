# La Prueba del Templo Digital

Juego en Three.js (vista cenital de caja abierta). 3 niveles: dash, escudo + láseres y el Guardián.

## Estructura

```
templo-digital/
├─ index.html              ← página principal (menú, HUD, carga de módulos)
├─ css/
│  └─ style.css            ← estilos de interfaz (colores en :root)
├─ js/
│  ├─ main.js              ← escena, cámara, luces, bucle y mecánicas
│  ├─ config.js            ← ajustes: tamaños, tiempos, volúmenes, rutas
│  ├─ levels.js            ← los 3 niveles (huecos, trampas, orbes, láseres, jefe)
│  ├─ loader.js            ← carga de .glb y texturas
│  └─ audio.js             ← efectos y música
├─ assets/
│  ├─ models/              ← Baldosa, Trampa, Paredes, Lumen, Dash, Escudo, Diamante, Guardian (.glb)
│  ├─ audio/               ← .wav de efectos + ambient.wav (puedes reemplazarlos con los tuyos, mismo nombre)
│  └─ img/                 ← logo.png (portada) y favicon.png
├─ .vscode/extensions.json ← recomienda Live Server
└─ .gitignore
```

## Cómo ejecutarlo en VS Code

**No abras `index.html` con doble clic**: los navegadores bloquean módulos y archivos locales desde `file://`. Usa un servidor local:

1. Instala la extensión **Live Server** (Ritwick Dey).
2. Abre la carpeta `templo-digital` en VS Code (`Archivo → Abrir carpeta`).
3. Clic derecho en `index.html` → **Open with Live Server** (o el botón *Go Live* abajo a la derecha).

Alternativa sin extensión (necesitas Python): en la terminal de VS Code, dentro de la carpeta,
`python -m http.server 8000` y abre `http://localhost:8000`.

Hace falta internet la primera vez: Three.js se descarga de un CDN (ver `index.html`).
Para usarlo sin conexión: `npm i three`, copia `node_modules/three/build/three.module.js` y la carpeta
`node_modules/three/examples/jsm/` dentro del proyecto y cambia las rutas del `importmap` en `index.html`.

## Flujo del juego

1. Portada con logo e historia → **Comenzar la prueba** entra directo al Nivel 1.
2. Al completar cada sala se pasa al siguiente nivel (botón o tecla Enter): 1 → 2 → 3.
3. Al superar el Nivel 3, Lumen se convierte en el nuevo Guardián y se **desbloquea el menú principal**, donde se puede elegir cualquier nivel.
   El desbloqueo se guarda en el navegador (`localStorage`, clave `templo-digital.unlocked`). Para volver a probar el flujo inicial: DevTools → Application → Local Storage → borra esa clave.
4. Durante la partida, `Esc` abre la pausa (continuar / reiniciar nivel / menú principal si ya está desbloqueado).

## Controles

WASD / flechas: mover · Espacio / Shift: dash (solo con cargas de orbe Dash, máx. 2) · R: reiniciar nivel · M: silenciar · Esc: pausa · Enter: continuar en las pantallas de fin

## Ajustes rápidos (`js/config.js`)

- `lumenYaw` / `guardianYaw`: pon `Math.PI` si el modelo mira hacia atrás.
- `texturePixelated: true`: texturas nítidas estilo pixel-art.
- `audio`: volúmenes (master, efectos, música).
- Niveles: `js/levels.js` (listas de huecos, trampas, orbes, láseres).

## Subirlo a GitHub (cuando llegue el momento)

- Es un sitio estático: sirve **GitHub Pages** (Settings → Pages → rama `main`, carpeta `/root`). No necesita build.
- Sube TODA la carpeta, incluidos `assets/models` y `assets/audio` (los `.glb` y `.wav` pesan poco).
- GitHub distingue mayúsculas: los nombres de archivo deben coincidir exactamente (`Baldosa.glb`, no `baldosa.glb`).
- Las rutas son relativas, así que funcionan también en `https://usuario.github.io/repositorio/`.
