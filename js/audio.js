/* Audio: efectos (.wav en assets/audio/) + música ambiente en bucle.
   Se inicia al primer clic (los navegadores no permiten sonido antes). Si falta un archivo, solo avisa en consola. */
import { CFG } from './config.js';

const NAMES = ['dash', 'rumble', 'tile_fall', 'fall', 'orb', 'shield', 'shield_break', 'warn', 'lock', 'laser', 'die', 'roar', 'win'];
let ctx = null, master = null, sfxGain = null, musicGain = null, musicSrc = null;
let muted = false, wantMusic = false;
const buffers = {};

async function load(name) {
  try {
    const r = await fetch(`${CFG.paths.audio}${name}.wav`);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer());
  } catch (e) { console.warn('Audio no cargado:', name, e.message || e); }
}
export async function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = muted ? 0 : CFG.audio.master; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = CFG.audio.sfx; sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = CFG.audio.music; musicGain.connect(master);
  await Promise.all([...NAMES, 'ambient'].map(load));
  applyMusic();
}
function play(name, { vol = 1, rate = 1 } = {}) {
  if (!ctx || !buffers[name]) return;
  const s = ctx.createBufferSource(); s.buffer = buffers[name]; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol; s.connect(g).connect(sfxGain); s.start();
}
function applyMusic() {
  if (!ctx || !buffers.ambient) return;
  if (wantMusic && !musicSrc) { musicSrc = ctx.createBufferSource(); musicSrc.buffer = buffers.ambient; musicSrc.loop = true; musicSrc.connect(musicGain); musicSrc.start(); }
  else if (!wantMusic && musicSrc) { musicSrc.stop(); musicSrc = null; }
}
export function music(on) { wantMusic = on; applyMusic(); }
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : CFG.audio.master; return muted; }
export const audioStatus = () => Object.keys(buffers);

export const sfx = {
  dash: () => play('dash'),
  rumble: () => play('rumble'),
  tileFall: () => play('tile_fall'),
  fall: () => play('fall'),
  orb: () => play('orb'),
  shield: () => play('shield'),
  shieldBreak: () => play('shield_break'),
  warn: f => play('warn', { rate: f / 900 }),     // pitido de aviso (más agudo y rápido al acercarse el disparo)
  lock: () => play('lock'),
  laser: () => play('laser'),
  die: () => play('die'),
  roar: () => play('roar'),
  win: () => play('win'),
};
