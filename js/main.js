/* La Prueba del Templo Digital — punto de entrada: escena, cámara, luces, bucle de juego y mecánicas.
   Módulos: config.js (ajustes) · levels.js (niveles) · loader.js (modelos y texturas) · audio.js (sonido) */
import * as THREE from 'three';
import { P, TILE, COLS, ROWS, CFG } from './config.js';
import { LEVELS } from './levels.js';
import { sfx, initAudio, music, toggleMute, audioStatus } from './audio.js';
import { loadAll, TEX } from './loader.js';

const PROTO = {};          // prototipos de modelos (se rellenan al cargar los .glb)
let wallsRoot = null;      // Paredes.glb (para colocar los diamantes con raycast)

/* =====================================================================
   ESCENA BASE
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a120e);          // verde musgo casi negro
scene.fog = new THREE.FogExp2(0x0a120e, 0.018);

const camera = new THREE.PerspectiveCamera(CFG.camFov, 1, 0.1, 100);
const camTarget = new THREE.Vector3(0, 0.15, 0.25);
let shake = 0;

function fitCamera() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const needW = 11.2, needH = 7.6;                       // marco + paredes visibles
  const d = Math.max((needW / 2) / Math.tan(hf / 2), (needH / 2) / Math.tan(vf / 2));
  const el = THREE.MathUtils.degToRad(CFG.camElevationDeg);
  camera.userData.base = new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(d).add(camTarget);
}
addEventListener('resize', fitCamera);

// Luces
scene.add(new THREE.HemisphereLight(0xb8d4b0, 0x1b2a1a, 1.6));
const sun = new THREE.DirectionalLight(0xffe9c2, 3.0);
sun.position.set(-3, 7, 5);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x3fa58a, 1.0);
rim.position.set(4, 3, -5);
scene.add(rim);

// Abismo
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128,128,0,128,128,128);
  gr.addColorStop(0,'#2f5a3a'); gr.addColorStop(.35,'#12261a'); gr.addColorStop(1,'#040806');
  g.fillStyle = gr; g.fillRect(0,0,256,256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
  abyss.rotation.x = -Math.PI / 2; abyss.position.y = -3.6;
  scene.add(abyss);
}
// Motas de luz que suben del abismo
const motes = (() => {
  const n = 160, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i*3] = (Math.random()-.5)*11; pos[i*3+1] = -3 + Math.random()*4.5; pos[i*3+2] = (Math.random()-.5)*7; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe3d27a, size: 0.05, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts); return pts;
})();


/* =====================================================================
   NIVEL: construcción + sistema de baldosas (normal / trampa / hueco / jefe)
   ===================================================================== */
const cellX = c => (c - (COLS - 1) / 2) * P;
const cellZ = r => (r - (ROWS - 1) / 2) * P;
let levelGroup = new THREE.Group(); scene.add(levelGroup);
let tiles = [], orbs = [], lasers = [], exitObj = null, boss = null, curLevel = 0, LV = null;
const W = { t: 0, nextSwap: 0, roaring: false, roarT: 0, nextLaser: 0, over: false };

const isSolid = t => !!t && (t.kind === 'normal' || t.kind === 'trap') && (t.state === 'ok' || t.state === 'shaking');
const cloneMats = m => m.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone(); });

function placeTile(t, proto) {
  const m = proto.clone(true);
  m.position.set(cellX(t.c), -proto.userData.h, cellZ(t.r));   // tope de la baldosa en y = 0
  t.mesh = m; t.baseY = m.position.y; levelGroup.add(m);
}

/** Cambia el tipo de una baldosa ('normal' | 'trap'): reemplaza el modelo (Baldosa.glb ⇄ Trampa.glb). */
function setTileKind(t, kind, pop = false) {
  if (t.mesh) levelGroup.remove(t.mesh);
  placeTile(t, kind === 'trap' ? PROTO.trap : PROTO.tile);
  if (kind === 'trap') cloneMats(t.mesh);
  t.kind = kind; t.state = 'ok'; t.t = 0; t.vy = 0; t.pop = pop ? 0.35 : 0;
}
/** Sistema de trampas por código: las coordenadas de la lista del nivel se reemplazan por Trampa.glb */
function replaceWithTrap(c, r) {
  const t = tiles[r][c];
  if (!t || t.kind !== 'normal') { console.warn('Trampa sobre casilla inválida', c, r); return; }
  setTileKind(t, 'trap');
}

/** Punto interior de la pared (por raycast contra Paredes.glb) para colgar un diamante. */
function wallMount(wall, idx) {
  const y = CFG.laser.y;
  let o, d;
  if (wall === 'left')  { o = new THREE.Vector3(0, y, cellZ(idx)); d = new THREE.Vector3(-1, 0, 0); }
  if (wall === 'right') { o = new THREE.Vector3(0, y, cellZ(idx)); d = new THREE.Vector3(1, 0, 0); }
  if (wall === 'top')   { o = new THREE.Vector3(cellX(idx), y, 0); d = new THREE.Vector3(0, 0, -1); }
  let p = null;
  if (wallsRoot) { const hit = new THREE.Raycaster(o, d, 0, 20).intersectObject(wallsRoot, true)[0]; if (hit) p = hit.point.clone(); }
  if (!p) p = o.clone().addScaledVector(d, wall === 'top' ? 2.75 : 4.9);   // respaldo si no hay impacto
  p.addScaledVector(d, -0.16); p.y = y;
  return { p, d };
}

function buildLevel(i) {
  scene.remove(levelGroup);
  levelGroup = new THREE.Group(); scene.add(levelGroup);
  curLevel = i; LV = LEVELS[i];
  const holes = new Set(LV.holes.map(([c, r]) => c + ',' + r));
  const bossCells = new Set((LV.boss ? LV.boss.cells : []).map(([c, r]) => c + ',' + r));
  tiles = [];
  for (let r = 0; r < ROWS; r++) {
    tiles[r] = [];
    for (let c = 0; c < COLS; c++) {
      const k = c + ',' + r;
      const t = { c, r, kind: holes.has(k) ? 'hole' : bossCells.has(k) ? 'boss' : 'normal', state: 'ok', t: 0, vy: 0, spin: 0, pop: 0, mesh: null };
      if (t.kind !== 'hole') placeTile(t, PROTO.tile);      // 'boss' = peana decorativa bajo el Guardián
      tiles[r][c] = t;
    }
  }
  LV.traps.forEach(([c, r]) => replaceWithTrap(c, r));

  // Orbes
  orbs = [];
  LV.dashOrbs.forEach(([c, r]) => { const o = makeOrb('dash'); o.home = [c, r]; activateOrb(o, c, r); orbs.push(o); });
  if (LV.shield) { const o = makeOrb('shield'); o.respawnT = 0.6; orbs.push(o); }

  // Salida
  exitObj = null;
  if (LV.exit) {
    const ex = new THREE.Group(); ex.position.set(cellX(LV.exit[0]), 0.02, cellZ(LV.exit[1]));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 40), new THREE.MeshBasicMaterial({ color: 0x6fe7ff }));
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.3, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 0.65;
    const pl = new THREE.PointLight(0x6fe7ff, 1.4, 2.2); pl.position.y = 0.5;
    ex.add(ring, beam, pl); levelGroup.add(ex); exitObj = { g: ex, ring, beam };
  }

  // Láseres fijos
  lasers = [];
  LV.lasers.forEach(d => lasers.push(makeLaser(d.wall, d.idx, d.delay || 0, false)));

  // Guardián
  boss = null;
  if (LV.boss) {
    const g = new THREE.Group(), m = PROTO.guardian.clone(true);
    cloneMats(m); g.add(m);
    const cs = LV.boss.cells, cx = cs.reduce((a, [c]) => a + cellX(c), 0) / cs.length, cz = cs.reduce((a, [, r]) => a + cellZ(r), 0) / cs.length;
    g.position.set(cx, 0, cz); m.rotation.y = CFG.guardianYaw;
    const light = new THREE.PointLight(0xff3355, 0, 5); light.position.y = 1.2; g.add(light);
    levelGroup.add(g);
    const hw = Math.max(...cs.map(([c]) => Math.abs(cellX(c) - cx))) + TILE / 2, hd = Math.max(...cs.map(([, r]) => Math.abs(cellZ(r) - cz))) + TILE / 2;
    boss = { g, m, light, rect: { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd } };
  }
  Object.assign(W, { t: 0, nextSwap: LV.boss ? LV.boss.swapEvery : 1e9, roaring: false, roarT: 0, nextLaser: LV.boss ? LV.boss.laserFirst : 1e9, over: false });
}

/* =====================================================================
   ORBES (Dash / Escudo)
   ===================================================================== */
function makeOrb(type) {
  const mesh = PROTO[type].clone(true); levelGroup.add(mesh);
  const light = new THREE.PointLight(type === 'dash' ? 0x7c5cff : 0xffd166, 0, 1.8); levelGroup.add(light);
  mesh.visible = false;
  return { type, mesh, light, active: false, cell: null, home: null, respawnT: 0, ph: Math.random() * 6 };
}
function activateOrb(o, c, r) {
  o.cell = [c, r]; o.active = true; o.mesh.visible = true;
  o.mesh.position.set(cellX(c), 0.22, cellZ(r)); o.light.position.set(cellX(c), 0.45, cellZ(r)); o.light.intensity = 0.9;
}
function deactivateOrb(o, delay) { o.active = false; o.mesh.visible = false; o.light.intensity = 0; o.respawnT = delay; }
function randomCell(exclude) {
  const c = [];
  for (const row of tiles) for (const t of row) {
    if (t.kind !== 'normal' || t.state !== 'ok') continue;
    if (LV.exit && t.c === LV.exit[0] && t.r === LV.exit[1]) continue;
    if (exclude && t.c === exclude[0] && t.r === exclude[1]) continue;
    if (Math.hypot(cellX(t.c) - L.pos.x, cellZ(t.r) - L.pos.y) < 0.9) continue;
    c.push(t);
  }
  return c.length ? c[Math.floor(Math.random() * c.length)] : null;
}
function pickOrb(o) {
  if (o.type === 'dash') {
    if (L.dash >= CFG.maxDash) return;
    L.dash++; deactivateOrb(o, CFG.dashRespawn); sfx.orb(); toast(`Orbe Dash · cargas ${L.dash}/${CFG.maxDash}`);
  } else {
    if (L.shield) return;
    L.shield = true; deactivateOrb(o, CFG.shieldRespawn); sfx.shield(); toast('Escudo activo · te protege de un rayo');
  }
}
function updateOrbs(dt, t) {
  for (const o of orbs) {
    if (o.active) {
      const tile = tiles[o.cell[1]][o.cell[0]];
      if (!isSolid(tile)) { deactivateOrb(o, o.type === 'dash' ? CFG.dashRespawn : CFG.shieldRespawn); continue; }
      o.mesh.position.y = 0.22 + 0.05 * Math.sin(t * 2.4 + o.ph); o.mesh.rotation.y = t * 1.6 + o.ph;
      o.light.intensity = 0.7 + 0.3 * Math.sin(t * 3 + o.ph);
      if (mode === 'play' && !L.falling && L.y < 0.25 && Math.hypot(o.mesh.position.x - L.pos.x, o.mesh.position.z - L.pos.y) < 0.3) pickOrb(o);
    } else {
      o.respawnT -= dt;
      if (o.respawnT <= 0) {
        let tile = o.type === 'dash' ? tiles[o.home[1]][o.home[0]] : randomCell(o.cell);
        if (o.type === 'dash' && !isSolid(tile)) tile = randomCell(null);
        if (tile) activateOrb(o, tile.c, tile.r); else o.respawnT = 1;
      }
    }
  }
}

/* =====================================================================
   DIAMANTES LÁSER (Diamante.glb) — siguen a Lumen: carga 7 s → rayo 2 s → enfriamiento 3 s → repite
   ===================================================================== */
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
function makeLaser(wall, idx, delay, temp) {
  const { p, d } = wallMount(wall, idx);
  const g = new THREE.Group(); g.position.copy(p);
  const m = PROTO.crystal.clone(true); cloneMats(m); m.position.y = -PROTO.crystal.userData.h / 2; g.add(m);
  const glow = new THREE.PointLight(0xff2244, 0, 2.2); g.add(glow);
  levelGroup.add(g);
  const mk = (r, color, op, add) => { const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending })); b.scale.set(r, r, CFG.laser.range); b.visible = false; b.position.copy(p); levelGroup.add(b); return b; };
  const L_ = {
    wall, idx, temp, mount: p, g, m, glow, state: 'idle', t: 0, clock: 0, delay,
    aim: new THREE.Vector2(-d.x, -d.z).normalize(), dead: false, beepT: 0, locked: false,
    tele: mk(0.012, 0xff3b55, 0, true), halo: mk(0.1, 0xff1133, 0.35, true), core: mk(0.04, 0xffffff, 1, false),
  };
  return L_;
}
function removeLaser(s) { s.dead = true; levelGroup.remove(s.g, s.tele, s.halo, s.core); }
const segDist = (px, pz, ax, az, dx, dz, len) => { const t = THREE.MathUtils.clamp((px - ax) * dx + (pz - az) * dz, 0, len); return Math.hypot(px - (ax + dx * t), pz - (az + dz * t)); };

function updateLasers(dt, t) {
  const C = CFG.laser;
  for (const s of lasers) {
    if (s.dead) continue;
    s.clock += dt;
    if (s.state === 'idle') { if (s.clock >= s.delay) { s.state = 'charge'; s.t = 0; s.locked = false; } else continue; }
    s.t += dt;
    const dx = L.pos.x - s.mount.x, dz = L.pos.y - s.mount.z, len = Math.hypot(dx, dz) || 1;
    const mats = []; s.m.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => mats.push(x)); });
    const setGlow = k => mats.forEach(x => { if (x.emissive) x.emissiveIntensity = k; });

    if (s.state === 'charge') {
      if (s.t < C.charge - C.lock) s.aim.lerp(new THREE.Vector2(dx / len, dz / len), Math.min(1, dt * 7)).normalize();   // sigue a Lumen
      const k = s.t / C.charge, warn = s.t >= C.charge - C.warnFrom;
      setGlow(1.4 + 3.5 * k * k + (warn && Math.sin(t * 30) > 0 ? 2 : 0)); s.glow.intensity = 0.4 + 2.2 * k;
      // línea de mira que se intensifica
      s.tele.visible = s.t > 1.5; s.tele.material.opacity = Math.min(1, (s.t - 1.5) / 4) * (warn ? (Math.sin(t * 30) > 0 ? 0.95 : 0.3) : 0.5);
      s.tele.scale.x = s.tele.scale.y = 0.012 + 0.02 * k;
      // sonido de aviso: pitidos cada vez más rápidos, y tono fijo al bloquear el objetivo
      if (warn) {
        s.beepT -= dt;
        if (s.beepT <= 0) { const p = (s.t - (C.charge - C.warnFrom)) / C.warnFrom; sfx.warn(900 + 500 * p); s.beepT = 0.5 - 0.38 * p; }
      }
      if (!s.locked && s.t >= C.charge - C.lock) { s.locked = true; sfx.lock(); }
      if (s.t >= C.charge) { s.state = 'fire'; s.t = 0; s.tele.visible = false; sfx.laser(); shake = Math.max(shake, 0.02); }
    } else if (s.state === 'fire') {
      setGlow(5); s.glow.intensity = 3;
      const fl = 0.8 + 0.2 * Math.sin(t * 60);
      s.halo.visible = s.core.visible = true; s.halo.scale.x = s.halo.scale.y = 0.1 * fl; s.core.scale.x = s.core.scale.y = 0.04 * fl;
      if (mode === 'play' && L.invul <= 0 && L.dashT <= 0 && !L.falling && L.y < 0.3 &&
          segDist(L.pos.x, L.pos.y, s.mount.x, s.mount.z, s.aim.x, s.aim.y, C.range) < C.hitDist) laserHit(s);
      if (s.t >= C.fire && s.state === 'fire') endFire(s);
    } else if (s.state === 'cool') {
      setGlow(0.5); s.glow.intensity = 0.1;
      if (s.t >= C.cool) { if (s.temp) { removeLaser(s); continue; } s.state = 'charge'; s.t = 0; s.locked = false; s.beepT = 0; }
    }
    // orientación visual del diamante y del rayo
    const yaw = Math.atan2(s.aim.x, s.aim.y);
    s.g.rotation.y = yaw;
    for (const b of [s.tele, s.halo, s.core]) { b.rotation.y = yaw; b.position.copy(s.mount); }
  }
}
function endFire(s) { s.state = 'cool'; s.t = 0; s.halo.visible = s.core.visible = false; }
function laserHit(s) {
  endFire(s);                                   // el rayo desaparece y entra en enfriamiento
  if (L.shield) {                               // el escudo se consume: sobrevive + 2 s de inmunidad
    L.shield = false; L.invul = CFG.invulAfterShield; L.shieldBreak = 0.4; sfx.shieldBreak(); shake = 0.05; toast('¡El escudo absorbió el rayo!');
  } else {
    killLumen();
  }
}

/* =====================================================================
   LUMEN
   ===================================================================== */
const L = {
  root: new THREE.Group(), model: null, pos: new THREE.Vector2(), y: 0, vy: 0,
  facing: new THREE.Vector2(0, -1), yaw: 0, dashT: 0, dashCD: 0, dashDir: new THREE.Vector2(), dashSpeed: 0,
  falling: false, lives: 3, dash: 0, shield: false, invul: 0, shieldBreak: 0, fallPos: new THREE.Vector2(), deathPos: new THREE.Vector2(), dyingT: 0, falls: 0,
};
scene.add(L.root);
const blob = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(0,0,0,.55)'); gr.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0,0,64,64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; scene.add(m); return m;
})();
const lumenLight = new THREE.PointLight(0x7c5cff, 1.6, 2.6); lumenLight.position.y = 0.45; L.root.add(lumenLight);
// Aura amarilla del escudo
const aura = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
aura.position.y = 0.14; aura.visible = false; L.root.add(aura);
const auraLight = new THREE.PointLight(0xffc933, 0, 1.8); auraLight.position.y = 0.3; L.root.add(auraLight);

// estela del dash
const trail = Array.from({ length: 18 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8f7bff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.visible = false; scene.add(m); return { m, life: 0 };
});
let trailI = 0;
const spawnTrail = () => { const t = trail[trailI++ % trail.length]; t.m.position.set(L.pos.x, L.y + 0.14, L.pos.y); t.life = 0.3; t.m.visible = true; };

function resetLumen() {
  if (L.model) L.root.remove(L.model);
  L.model = PROTO.lumen.clone(true); L.root.add(L.model);
  L.pos.set(cellX(LV.start[0]), cellZ(LV.start[1]));
  L.y = 0; L.vy = 0; L.dashT = 0; L.dashCD = 0; L.falling = false; L.invul = 0; L.shieldBreak = 0; L.dyingT = 0;
  L.facing.set(0, -1); L.yaw = Math.PI;
  L.lives = CFG.lives; L.dash = 0; L.shield = false; L.falls = 0;
  L.root.scale.setScalar(1);
}

/* =====================================================================
   INPUT
   ===================================================================== */
const KEYS = {};
const mv = new THREE.Vector2();
addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  KEYS[e.code] = true;
  if (e.code === 'KeyM') toggleMute();
  if (mode === 'play') {
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
    if (e.code === 'KeyR') restart();
  }
  if (e.code === 'Escape') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); else if (mode === 'end' && unlocked) showMenu(); }
  if (e.code === 'Enter' && mode === 'end') endEnter();
});
addEventListener('keyup', e => { KEYS[e.code] = false; });
addEventListener('blur', () => { for (const k in KEYS) KEYS[k] = false; });
function readMove() {
  mv.set(
    ((KEYS.KeyD || KEYS.ArrowRight) ? 1 : 0) - ((KEYS.KeyA || KEYS.ArrowLeft) ? 1 : 0),
    ((KEYS.KeyS || KEYS.ArrowDown) ? 1 : 0) - ((KEYS.KeyW || KEYS.ArrowUp) ? 1 : 0)
  );
  if (mv.lengthSq() > 0) mv.normalize();
  return mv;
}

/* =====================================================================
   MECÁNICAS
   ===================================================================== */
let mode = 'loading';   // loading | menu | play | dying | falling | restarting | end
const $ = id => document.getElementById(id);
let toastT = 0;
function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); toastT = 1.8; }

/** El dash solo existe si hay cargas (orbe Dash): consume 1 carga por uso. */
function tryDash() {
  if (L.dashT > 0 || L.dashCD > 0 || L.falling || L.dash <= 0) { if (L.dash <= 0 && !L.falling) toast('Sin cargas de Dash · busca un orbe'); return; }
  const d = readMove().lengthSq() > 0 ? mv.clone() : L.facing.clone();
  L.dash--; L.dashDir.copy(d); L.dashT = CFG.dashTime; L.dashSpeed = CFG.dashDist / CFG.dashTime; L.dashCD = CFG.dashGap; L.facing.copy(d);
  sfx.dash();
}

const clampPos = () => {
  L.pos.x = THREE.MathUtils.clamp(L.pos.x, cellX(0) - TILE / 2 - 0.02, cellX(COLS - 1) + TILE / 2 + 0.02);
  L.pos.y = THREE.MathUtils.clamp(L.pos.y, cellZ(0) - TILE / 2 - 0.02, cellZ(ROWS - 1) + TILE / 2 + 0.02);
  if (boss) {                                   // el Guardián es sólido
    const r = 0.12, b = boss.rect;
    if (L.pos.x > b.x0 - r && L.pos.x < b.x1 + r && L.pos.y > b.z0 - r && L.pos.y < b.z1 + r) {
      const dl = L.pos.x - (b.x0 - r), dr = (b.x1 + r) - L.pos.x, dt_ = L.pos.y - (b.z0 - r), db = (b.z1 + r) - L.pos.y;
      const m = Math.min(dl, dr, dt_, db);
      if (m === db) L.pos.y = b.z1 + r; else if (m === dl) L.pos.x = b.x0 - r; else if (m === dr) L.pos.x = b.x1 + r; else L.pos.y = b.z0 - r;
    }
  }
};

function tileAt(x, z) {
  const c = Math.round(x / P + (COLS - 1) / 2), r = Math.round(z / P + (ROWS - 1) / 2);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  const t = tiles[r][c];
  return (t && (t.kind === 'normal' || t.kind === 'trap') && t.state !== 'falling' && t.state !== 'gone') ? t : null;
}
function nearestSafeTile(x, z) {
  let best = null, bd = 1e9;
  for (const kinds of [['normal'], ['normal', 'trap']]) {
    for (const row of tiles) for (const t of row) {
      if (!kinds.includes(t.kind) || t.state !== 'ok') continue;
      const d = Math.hypot(cellX(t.c) - x, cellZ(t.r) - z);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) break;
  }
  return best;
}

function triggerTrap(t) { t.state = 'shaking'; t.t = 0; shake = Math.max(shake, 0.012); sfx.rumble(); }

function startFall() {
  if (L.falling) return;
  L.falling = true; L.vy = -1; L.dashT = 0; mode = 'falling'; L.fallPos.copy(L.pos); L.falls++; sfx.fall();
}
function killLumen() {          // golpe de láser sin escudo
  if (mode !== 'play') return;
  mode = 'dying'; L.dyingT = 0; L.deathPos.copy(L.pos); sfx.die(); shake = 0.06;
}
function loseLife(fromPos) {
  L.lives--;
  if (L.lives <= 0) { gameOver(); return; }
  respawn(fromPos);
}
/** Reaparece en la baldosa segura más cercana a donde murió (no al inicio del nivel). */
function respawn(fromPos) {
  const t = nearestSafeTile(fromPos.x, fromPos.y);
  if (!t) { gameOver(); return; }
  const f = $('fade'); f.textContent = ''; f.style.opacity = 0.9; setTimeout(() => { f.style.opacity = 0; }, 140);
  L.pos.set(cellX(t.c), cellZ(t.r)); L.y = 0; L.vy = 0; L.falling = false; L.dashT = 0; L.dyingT = 0;
  L.root.scale.setScalar(1); if (L.model) L.model.rotation.set(0, L.yaw, 0);
  L.invul = Math.max(L.invul, CFG.invulAfterShield);       // inmunidad a láseres tras reaparecer (no protege de caídas)
  mode = 'play';
}
function restart() {
  const f = $('fade'); f.textContent = ''; f.style.opacity = 1;
  mode = 'restarting';
  setTimeout(() => { startLevel(curLevel); f.style.opacity = 0; }, 260);
}

/* Progreso: el menú principal (elegir cualquier nivel) se desbloquea al superar el nivel 3 y se guarda en el navegador. */
const SAVE_KEY = 'templo-digital.unlocked';
let unlocked = false, endKind = 'win';
try { unlocked = localStorage.getItem(SAVE_KEY) === '1'; } catch (e) { /* sin almacenamiento: solo dura la sesión */ }
function unlockMenu() { if (unlocked) return; unlocked = true; try { localStorage.setItem(SAVE_KEY, '1'); } catch (e) {} }

function endScreen(title, sub, canNext, kind) {
  mode = 'end'; endKind = kind;
  $('endTitle').textContent = title; $('endSub').textContent = sub;
  $('btnNext').style.display = canNext ? '' : 'none';
  $('btnAgain').style.display = kind === 'final' ? 'none' : '';
  $('btnToMenu').style.display = unlocked ? '' : 'none';
  $('menuCard').classList.add('hidden'); $('pauseCard').classList.add('hidden'); $('endCard').classList.remove('hidden'); $('screen').classList.remove('hidden');
}
function endEnter() {                                    // Enter en la pantalla final: continuar
  if (endKind === 'win') startLevel(curLevel + 1); else if (endKind === 'over') startLevel(curLevel); else showMenu();
}
function winLevel() {
  sfx.win();
  const last = curLevel === LEVELS.length - 1;
  if (last) {
    unlockMenu();
    endScreen('¡NUEVO GUARDIÁN!', `Lumen superó las tres pruebas y se convierte en el próximo Guardián de la mazmorra. · caídas: ${L.falls} · vidas: ${L.lives}`, false, 'final');
  } else {
    endScreen('SALA COMPLETADA', `${LV.name} · caídas: ${L.falls} · vidas: ${L.lives}`, true, 'win');
  }
}
function gameOver() { sfx.die(); endScreen('SIN VIDAS', 'Se acabó el nivel. ¿Lo intentas otra vez?', false, 'over'); }

/* =====================================================================
   JEFE: el Guardián invierte las baldosas cada 10 s (con rugido)
   ===================================================================== */
function updateBoss(dt, t) {
  if (!LV.boss) return;
  const B = LV.boss;
  W.t += dt;
  // rugido justo antes del cambio
  if (!W.roaring && W.t >= W.nextSwap - B.roar) { W.roaring = true; W.roarT = 0; sfx.roar(); }
  if (W.roaring) {
    W.roarT += dt; shake = Math.max(shake, 0.03);
    const k = Math.sin(Math.min(1, W.roarT / B.roar) * Math.PI);
    boss.g.scale.setScalar(1 + 0.1 * k); boss.light.intensity = 6 * k;
    boss.m.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => { if (x.emissive) { x.emissive.setRGB(1, 0.1, 0.15); x.emissiveIntensity = 1.8 * k; } }); });
  }
  if (W.t >= W.nextSwap) {
    W.nextSwap += B.swapEvery; W.roaring = false; boss.g.scale.setScalar(1); boss.light.intensity = 0; shake = 0.06;
    for (const row of tiles) for (const tl of row) {
      if (tl.state !== 'ok') continue;
      if (tl.kind === 'normal') setTileKind(tl, 'trap', true); else if (tl.kind === 'trap') setTileKind(tl, 'normal', true);
    }
    toast('¡El Guardián invirtió las baldosas!');
  }
  boss.g.position.y = 0.03 * Math.sin(t * 1.6);
  // diamantes láser ocasionales
  if (W.t >= W.nextLaser) {
    W.nextLaser += B.laserEvery;
    if (lasers.filter(s => !s.dead).length < B.maxLasers) {
      const opts = [];
      for (let r = 0; r <= 5; r++) { opts.push(['left', r]); opts.push(['right', r]); }
      for (const c of [1, 2, 3, 4, 9, 10, 11, 12]) opts.push(['top', c]);
      const [w, i] = opts[Math.floor(Math.random() * opts.length)];
      lasers.push(makeLaser(w, i, 0, true)); toast('¡Un diamante láser se activa!');
    }
  }
  if (W.t >= B.duration) { W.t = B.duration; winLevel(); }
}

/* =====================================================================
   FLUJO DE PANTALLAS
   ===================================================================== */
function startLevel(i) {
  buildLevel(i); resetLumen();
  mode = 'play'; music(true);
  $('screen').classList.add('hidden');
  ['hud', 'topright', 'hint'].forEach(id => $(id).classList.remove('hidden'));
  $('bosshud').classList.toggle('hidden', !LV.boss);
  $('lvlname').textContent = LV.name;
  hudKey = '';
}
function pauseGame() {
  mode = 'paused';
  $('btnPauseMenu').style.display = unlocked ? '' : 'none';
  $('menuCard').classList.add('hidden'); $('endCard').classList.add('hidden'); $('pauseCard').classList.remove('hidden'); $('screen').classList.remove('hidden');
}
function resumeGame() {
  for (const k in KEYS) KEYS[k] = false;
  mode = 'play'; $('pauseCard').classList.add('hidden'); $('screen').classList.add('hidden');
}
function showMenu() {
  mode = 'menu'; music(false);
  $('screen').classList.remove('hidden'); $('menuCard').classList.remove('hidden'); $('endCard').classList.add('hidden'); $('pauseCard').classList.add('hidden');
  $('levelPick').classList.toggle('hidden', !unlocked);                       // elegir nivel solo tras superar el nivel 3
  $('btnStart').textContent = unlocked ? '▶ Nueva partida (desde el nivel 1)' : '▶ Comenzar la prueba';
  ['hud', 'topright', 'hint', 'bosshud'].forEach(id => $(id).classList.add('hidden'));
}
$('btnStart').onclick = () => { initAudio(); startLevel(0); };               // la partida empieza directo en el nivel 1
document.querySelectorAll('.lbtn[data-lvl]').forEach(b => b.addEventListener('click', () => { if (!unlocked) return; initAudio(); startLevel(+b.dataset.lvl); }));
$('btnRestart').onclick = () => { if (mode === 'play') restart(); };
$('btnMenu').onclick = () => { if (mode === 'play') pauseGame(); };
$('btnResume').onclick = resumeGame;
$('btnPauseRestart').onclick = () => { $('pauseCard').classList.add('hidden'); restart(); };
$('btnPauseMenu').onclick = showMenu;
$('btnToMenu').onclick = showMenu;
$('btnAgain').onclick = () => startLevel(curLevel);
$('btnNext').onclick = () => startLevel(curLevel + 1);

/* =====================================================================
   HUD
   ===================================================================== */
let hudKey = '';
function updateHUD() {
  const k = [L.lives, L.dash, L.shield, orbs.length].join('|');
  if (k !== hudKey) {
    hudKey = k;
    $('hearts').textContent = '♥'.repeat(Math.max(0, L.lives)) + '♡'.repeat(Math.max(0, CFG.lives - L.lives));
    $('dashpips').textContent = '✦'.repeat(L.dash) + '◇'.repeat(CFG.maxDash - L.dash);
    $('chips').innerHTML = `<span class="chip" style="${L.shield ? 'border-color:#ffd34d;color:#ffd34d' : 'opacity:.55'}">🛡 Escudo ${L.shield ? 'ACTIVO' : '—'}</span>`;
  }
  $('stats').textContent = `Caídas ${L.falls}${L.invul > 0 ? ' · inmune ' + L.invul.toFixed(1) + 's' : ''}`;
  if (LV.boss) {
    const left = Math.max(0, LV.boss.duration - W.t), toSwap = Math.max(0, W.nextSwap - W.t);
    $('bosstime').textContent = `SOBREVIVE  ${Math.floor(left / 60)}:${String(Math.ceil(left) % 60).padStart(2, '0')}`;
    $('bossswap').textContent = `CAMBIO DE BALDOSAS EN ${Math.ceil(toSwap)}s`;
  }
}

/* =====================================================================
   BUCLE
   ===================================================================== */
const clock = new THREE.Clock();
function updateTiles(dt) {
  for (const row of tiles) for (const t of row) {
    if (!t.mesh) continue;
    if (t.pop > 0) { t.pop -= dt; t.mesh.scale.setScalar(1 + 0.1 * Math.sin(Math.max(0, t.pop) / 0.35 * Math.PI)); if (t.pop <= 0) t.mesh.scale.setScalar(1); }
    if (t.state === 'shaking') {
      t.t += dt;
      const k = t.t / CFG.trapDelay, amp = 0.004 + 0.02 * k;
      t.mesh.position.set(cellX(t.c) + (Math.random() - .5) * amp * 2, t.baseY - 0.01 * Math.sin(t.t * 60) * k, cellZ(t.r) + (Math.random() - .5) * amp * 2);
      const pulse = 1.2 + 3.2 * k * (0.5 + 0.5 * Math.sin(t.t * 40));
      t.mesh.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.emissive) { m.emissive.setRGB(1, 0.1, 0.1); m.emissiveIntensity = pulse * 0.5; } }); });
      if (t.t >= CFG.trapDelay) { t.state = 'falling'; t.vy = 0; t.spin = (Math.random() - .5) * 3; sfx.tileFall(); shake = Math.max(shake, 0.03); }
    } else if (t.state === 'falling') {
      t.vy -= 16 * dt; t.mesh.position.y += t.vy * dt;
      t.mesh.rotation.x += t.spin * dt; t.mesh.rotation.z += t.spin * .6 * dt;
      if (t.mesh.position.y < -5) { t.state = 'gone'; t.mesh.visible = false; }
    }
  }
}

function updateLumen(dt) {
  if (L.invul > 0) L.invul -= dt;
  if (L.dashCD > 0) L.dashCD -= dt;

  if (mode === 'dying') {                                   // muerte por láser
    L.dyingT += dt; L.root.scale.setScalar(Math.max(0.01, 1 - L.dyingT / 0.6)); L.model.rotation.y += 14 * dt;
    if (L.dyingT >= 0.6) loseLife(L.deathPos);
    return;
  }
  if (L.falling) {
    L.vy -= 20 * dt; L.y += L.vy * dt;
    L.root.scale.multiplyScalar(1 - 0.7 * dt); L.model.rotation.x += 3 * dt;
    if (L.y < -2.2) loseLife(L.fallPos);
    return;
  }

  const dir = readMove();
  if (L.dashT > 0) {
    const step = Math.min(dt, L.dashT);
    L.pos.addScaledVector(L.dashDir, L.dashSpeed * step);
    L.dashT -= dt; clampPos();
    L.y = 0.16 * Math.sin(Math.PI * (1 - Math.max(L.dashT, 0) / CFG.dashTime));
    spawnTrail();
    if (L.dashT <= 0) L.y = 0;
  } else {
    if (dir.lengthSq() > 0) { L.pos.addScaledVector(dir, CFG.speed * dt); L.facing.copy(dir); clampPos(); }
    L.y = 0;
    const t = tileAt(L.pos.x, L.pos.y);
    if (!t) startFall();
    else if (t.kind === 'trap' && t.state === 'ok') triggerTrap(t);
  }

  const target = Math.atan2(L.facing.x, L.facing.y) + CFG.lumenYaw;
  let d = target - L.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); L.yaw += d * Math.min(1, dt * 16);

  if (exitObj && L.dashT <= 0 && !L.falling && Math.hypot(exitObj.g.position.x - L.pos.x, exitObj.g.position.z - L.pos.y) < 0.26) winLevel();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const live = mode === 'play' || mode === 'dying' || mode === 'falling';

  if (live) { updateTiles(dt); updateLasers(dt, t); updateOrbs(dt, t); updateBoss(dt, t); updateLumen(dt); updateHUD(); }
  else if (mode === 'menu') { updateTiles(dt); updateOrbs(dt, t); }

  // Lumen: posición y aspecto
  L.root.position.set(L.pos.x, L.y + ((L.falling || mode === 'dying') ? 0 : 0.015 * Math.sin(t * 4) + 0.01), L.pos.y);
  if (L.model && !L.falling && mode !== 'dying') L.model.rotation.set(0, L.yaw, 0);
  if (L.model) L.model.visible = !(L.invul > 0) || Math.floor(t * 14) % 2 === 0;
  lumenLight.intensity = 1.6;
  aura.visible = L.shield || L.shieldBreak > 0;
  if (L.shieldBreak > 0) { L.shieldBreak -= dt; const k = 1 - L.shieldBreak / 0.4; aura.scale.setScalar(1 + 2.2 * k); aura.material.opacity = 0.5 * (1 - k); auraLight.intensity = 3 * (1 - k); }
  else if (L.shield) { aura.scale.setScalar(1 + 0.06 * Math.sin(t * 6)); aura.material.opacity = 0.3 + 0.08 * Math.sin(t * 6); auraLight.intensity = 1.0; }
  else auraLight.intensity = 0;
  blob.position.set(L.pos.x, 0.012, L.pos.y); blob.visible = !L.falling; blob.scale.setScalar(1 - Math.min(0.5, L.y * 2));

  if (exitObj) { exitObj.ring.rotation.z = t; exitObj.beam.material.opacity = 0.12 + 0.05 * Math.sin(t * 3); }

  for (const p of trail) if (p.life > 0) { p.life -= dt; p.m.material.opacity = Math.max(0, p.life / 0.3) * 0.7; p.m.scale.setScalar(0.6 + p.life * 2); if (p.life <= 0) p.m.visible = false; }

  const pa = motes.geometry.attributes.position;
  for (let i = 0; i < pa.count; i++) { let y = pa.getY(i) + dt * 0.18; if (y > 1.6) y = -3; pa.setY(i, y); }
  pa.needsUpdate = true;

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }

  shake *= Math.pow(0.02, dt);
  const b = camera.userData.base;
  camera.position.set(b.x + (Math.random() - .5) * shake, b.y + (Math.random() - .5) * shake, b.z + (Math.random() - .5) * shake);
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
}

/* =====================================================================
   ARRANQUE
   ===================================================================== */
fitCamera();
loadAll(renderer, (n, t) => { $('loadmsg').textContent = `Cargando modelos… ${n}/${t}`; }).then(({ PROTO: protos, walls }) => {
  Object.assign(PROTO, protos);
  scene.add(walls); wallsRoot = walls;
  buildLevel(0); resetLumen();                 // vista previa detrás del menú
  const lm = $('loadmsg');
  lm.textContent = TEX.errors.length ? '⚠ Texturas con error (' + TEX.errors.length + '): ' + TEX.errors[0] : '✔ Texturas aplicadas: ' + TEX.n + '/' + TEX.expected;
  lm.style.color = TEX.errors.length ? '#ff4d6d' : '#7ee0a0';
  document.querySelectorAll('.lbtn[data-lvl]').forEach(b => b.disabled = false);
  $('btnStart').disabled = false;
  showMenu();
}).catch(err => { console.error(err); $('loadmsg').textContent = 'Error cargando modelos: ' + err.message + ' (¿sin conexión a la CDN de Three.js?)'; });
animate();
window.__game = { audio: audioStatus, get unlocked() { return unlocked; }, L, LEVELS, CFG, startLevel, cellX, cellZ, W, get tiles() { return tiles; }, get lasers() { return lasers; }, get orbs() { return orbs; }, get mode() { return mode; }, get boss() { return boss; } };   // depuración desde la consola
