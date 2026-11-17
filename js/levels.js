/* Niveles definidos por datos. [col, fila]  col: 0..13 (izq→der)  fila: 0..6 (fondo→frente)
   holes    : casillas sin baldosa (abismo)
   traps    : baldosas normales que el código REEMPLAZA por Trampa.glb
   dashOrbs : casillas con orbe Dash (reaparece a los 10 s en el mismo sitio)
   shield   : true → hay un orbe Escudo que reaparece cada 5 s en otra baldosa
   lasers   : diamantes fijos en pared {wall:'left'|'right'|'top', idx, delay}
   boss     : Guardián (nivel 3) */
import { ROWS, COLS } from './config.js';

const rowRange = (r, c0, c1) => Array.from({ length: c1 - c0 + 1 }, (_, i) => [c0 + i, r]);
export const LEVELS = [
  { // Enfocado en el DASH: dos filas de abismo → la salida solo se alcanza con dash
    name: 'NIVEL 1 · EL UMBRAL',
    start: [6, 6], exit: [6, 0],
    holes: [...rowRange(4, 0, 13), ...rowRange(1, 0, 13)],
    traps: [[3,5],[4,5],[9,5],[10,5],[3,3],[4,3],[9,3],[10,3],[5,2],[8,2],[2,2],[11,2],[3,0],[10,0]],
    dashOrbs: [[1,6],[12,6],[1,3],[12,3]],
    shield: false, lasers: [], boss: null,
  },
  { // Enfocado en ESCUDO + LÁSERES: una fila de abismo → salida solo con dash
    name: 'NIVEL 2 · SALA DE CRISTALES',
    start: [6, 6], exit: [6, 0],
    holes: [...rowRange(3, 0, 13), [3,5],[10,5],[3,1],[10,1]],
    traps: [[5,4],[8,4],[4,6],[9,6],[6,5],[7,5],[5,2],[8,2],[6,1],[7,1],[4,0],[9,0],[2,2],[11,2]],
    dashOrbs: [[1,5],[12,5]],
    shield: true,
    lasers: [{ wall: 'left', idx: 2, delay: 0 }, { wall: 'right', idx: 5, delay: 2.5 }, { wall: 'top', idx: 3, delay: 5 }],
    boss: null,
  },
  { // SOBREVIVIR 1 minuto: sin huecos al inicio, Guardián invierte baldosas cada 10 s
    name: 'NIVEL 3 · EL GUARDIÁN',
    start: [6, 6], exit: null,
    holes: [],
    traps: (() => { const t = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 1 && !(c >= 6 && c <= 7 && r <= 1)) t.push([c, r]); return t; })(),
    dashOrbs: [[1,6],[12,6]],
    shield: true, lasers: [],
    boss: { cells: [[6,0],[7,0],[6,1],[7,1]], duration: 60, swapEvery: 10, roar: 0.9, laserFirst: 3, laserEvery: 9, maxLasers: 2 },
  },
];
