/* Constantes y ajustes del juego: proporciones, tiempos, volúmenes y rutas de assets */
export const P = 0.63;            // separación entre centros de baldosas (0.589 baldosa + ~0.04 hueco)
export const TILE = 0.589;        // ancho de la baldosa (el de Baldosa.glb)
export const COLS = 14, ROWS = 7; // cuadrícula (14 columnas: el centro cae entre 2 baldosas → el Guardián cabe simétrico)
export const CFG = {
  lumenSize: 0.34,         // ancho de Lumen (< TILE)
  lumenYaw: 0,             // si Lumen mira hacia atrás, prueba Math.PI
  guardianYaw: 0,          // ídem para Guardian.glb
  speed: 2.5,
  dashDist: 1.45, dashTime: 0.14, dashGap: 0.3,
  maxDash: 2, dashRespawn: 10,          // orbe Dash: +1 carga (máx 2), reaparece a los 10 s
  shieldRespawn: 5,                     // orbe Escudo: reaparece a los 5 s en otra baldosa
  lives: 3, invulAfterShield: 2,
  trapDelay: 1.0,
  laser: { charge: 7, fire: 2, cool: 3, warnFrom: 2.0, lock: 0.6, range: 16, hitDist: 0.16, y: 0.25 },
  texturePixelated: false, // true = texturas nítidas estilo pixel-art (filtro 'nearest')
  camElevationDeg: 70, camFov: 38,
  audio: { master: 0.9, sfx: 1.0, music: 0.35 },   // volúmenes (0..1). Tecla M = silenciar
  paths: { models: 'assets/models/', audio: 'assets/audio/' },
};
