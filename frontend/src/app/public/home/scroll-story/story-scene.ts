/**
 * MoonFix 3D scroll story - the Three.js part.
 *
 * Loaded on demand (dynamic import) only when the story section is near the screen, so the
 * home page itself stays light. Everything is built in code - no model files to download:
 *   - split AC (indoor unit) with an opening louver, LED display, air flow and snowflakes
 *   - double-door fridge whose doors open to a lit interior, with cold mist
 *   - front-load washing machine with a spinning drum behind a glass door, and bubbles
 * The scene is driven by `update(progress, seconds)`; see story-timeline.ts for the timeline.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { aside, CHAPTER_COLORS, CHAPTERS, ease, lerp, local, outroAt, seg } from './story-timeline';

export interface StoryScene {
  update(progress: number, seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 5, r);

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** LED-style text (e.g. "24°") for appliance displays */
function ledTexture(text: string, color = '#38bdf8') {
  return canvasTexture(256, 128, (x) => {
    x.fillStyle = '#05080f';
    x.fillRect(0, 0, 256, 128);
    x.font = '700 76px "Plus Jakarta Sans", system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = color;
    x.shadowBlur = 18;
    x.fillStyle = color;
    x.fillText(text, 128, 68);
  });
}

/** soft round dot (mist, bubbles) */
function dotTexture(ring = false) {
  return canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    if (ring) {
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.82, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  });
}

/** six-armed snowflake, like the one in the MoonFix logo */
function snowflakeTexture() {
  return canvasTexture(64, 64, (x) => {
    x.translate(32, 32);
    x.strokeStyle = 'rgba(255,255,255,0.95)';
    x.lineWidth = 3.2;
    x.lineCap = 'round';
    x.shadowColor = '#7dd3fc';
    x.shadowBlur = 6;
    for (let i = 0; i < 6; i++) {
      x.rotate(Math.PI / 3);
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(0, -26);
      x.moveTo(0, -14);
      x.lineTo(-7, -21);
      x.moveTo(0, -14);
      x.lineTo(7, -21);
      x.stroke();
    }
  });
}

/** stripes that slide along the air-flow tubes */
function flowTexture() {
  const t = canvasTexture(256, 8, (x) => {
    const g = x.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 8);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

/** perforated steel for the washing-machine drum */
function drumTexture() {
  const t = canvasTexture(256, 256, (x) => {
    x.fillStyle = '#9aa4b1';
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#2b323c';
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        x.beginPath();
        x.arc(c * 21.3 + (r % 2 ? 10 : 0) + 6, r * 21.3 + 10, 4.2, 0, Math.PI * 2);
        x.fill();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

/** particle cloud with per-particle speed/phase kept in plain arrays */
interface Particles {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  base: Float32Array;
  speed: Float32Array;
}
function particles(count: number, texture: THREE.Texture, size: number, color: number, spread: THREE.Vector3): Particles {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = (Math.random() - 0.5) * spread.x;
    base[i * 3 + 1] = Math.random() * spread.y;
    base[i * 3 + 2] = (Math.random() - 0.5) * spread.z;
    speed[i] = 0.5 + Math.random();
  }
  pos.set(base);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({
    map: texture, size, color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material, base, speed };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function makeMaterials() {
  return {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf3f6fa, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.22 }),
    offWhite: new THREE.MeshPhysicalMaterial({ color: 0xe3e8ee, roughness: 0.4, clearcoat: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.65 }),
    steel: new THREE.MeshPhysicalMaterial({ color: 0xd2d8df, metalness: 0.6, roughness: 0.32, clearcoat: 0.4 }),
    steelDark: new THREE.MeshPhysicalMaterial({ color: 0xb8c0ca, metalness: 0.65, roughness: 0.3, clearcoat: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x0b98ee, emissive: 0x0b98ee, emissiveIntensity: 1.8 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xbfe6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, side: THREE.DoubleSide,
    }),
    interior: new THREE.MeshStandardMaterial({ color: 0x5d7387, roughness: 0.75, emissive: 0xcfeeff, emissiveIntensity: 0 }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
function buildAC(m: Mats) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(rbox(3.4, 1.05, 0.82, 0.2), m.white);
  group.add(body);

  // fine groove across the front panel
  const groove = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.012, 0.012), m.offWhite);
  groove.position.set(0, 0.16, 0.41);
  group.add(groove);

  // air outlet (dark slot) under the front
  const vent = new THREE.Mesh(rbox(3.0, 0.2, 0.5, 0.06), m.dark);
  vent.position.set(0, -0.44, 0.2);
  group.add(vent);

  // louver flap, hinged along its top edge
  const louver = new THREE.Group();
  louver.position.set(0, -0.38, 0.43);
  const flap = new THREE.Mesh(rbox(3.02, 0.05, 0.32, 0.02), m.white);
  flap.position.set(0, -0.02, -0.12);
  louver.add(flap);
  group.add(louver);

  // logo-blue light line
  const line = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.022, 0.02), m.glow);
  line.position.set(-0.2, -0.27, 0.412);
  group.add(line);

  // LED display "24°"
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.23),
    new THREE.MeshBasicMaterial({ map: ledTexture('24°'), toneMapped: false }),
  );
  display.position.set(1.18, 0.04, 0.415);
  group.add(display);

  // air flow: glowing streams curling out of the outlet
  const flowMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc, alphaMap: flowTexture(), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const streams: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -1.25 + i * 0.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, -0.5, 0.42),
      new THREE.Vector3(x * 1.08, -0.95, 1.25),
      new THREE.Vector3(x * 1.2 + 0.15, -1.55, 1.95),
      new THREE.Vector3(x * 1.3 + 0.3, -2.25, 2.4),
    ]);
    const s = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.016 + (i % 2) * 0.008, 8, false), flowMat);
    streams.push(s);
    group.add(s);
  }

  const snow = particles(140, snowflakeTexture(), 0.2, 0xe0f2fe, new THREE.Vector3(4.6, 3.2, 2.6));
  snow.points.position.set(0, -3, 1.4);
  group.add(snow.points);

  return { group, louver, flowMat, snow };
}

function buildFridge(m: Mats) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(rbox(1.75, 3.4, 1.4, 0.12), m.steel);
  body.position.z = -0.08;
  group.add(body);

  // lit interior with shelves (seen when the doors open)
  // (sits just in front of the body's front face, behind the closed doors)
  const inside = new THREE.Mesh(new THREE.BoxGeometry(1.55, 3.15, 0.01), m.interior);
  inside.position.set(0, 0, 0.625);
  group.add(inside);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.55, roughness: 0.2 });
  for (const y of [-1.0, -0.2, 0.55, 1.2]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.025, 0.05), shelfMat);
    shelf.position.set(0, y, 0.64);
    group.add(shelf);
  }
  // a few bottles and boxes on the shelves
  const food = [
    { c: 0xf97316, x: -0.5, y: -0.2, kind: 'bottle' }, { c: 0x22c55e, x: -0.25, y: -0.2, kind: 'bottle' },
    { c: 0x38bdf8, x: 0.45, y: 0.55, kind: 'box' }, { c: 0xfacc15, x: -0.4, y: 0.55, kind: 'box' },
    { c: 0xef4444, x: 0.35, y: -1.0, kind: 'bottle' }, { c: 0xffffff, x: 0.05, y: 1.2, kind: 'box' },
  ];
  for (const it of food) {
    const geo = it.kind === 'bottle' ? new THREE.CylinderGeometry(0.06, 0.07, 0.34, 20) : rbox(0.26, 0.2, 0.03, 0.02);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: it.c, roughness: 0.45 }));
    mesh.position.set(it.x, it.y + (it.kind === 'bottle' ? 0.18 : 0.11), 0.645);
    group.add(mesh);
  }
  const light = new THREE.PointLight(0xbfe9ff, 0, 3);
  light.position.set(0, 0.6, 0.9);
  group.add(light);

  // doors hinge on the left edge
  const makeDoor = (h: number, y: number, display = false) => {
    const pivot = new THREE.Group();
    pivot.position.set(-0.875, y, 0.66);
    const door = new THREE.Mesh(rbox(1.75, h, 0.12, 0.05), m.steelDark);
    door.position.x = 0.875;
    pivot.add(door);
    const handle = new THREE.Mesh(rbox(0.06, Math.min(0.9, h * 0.55), 0.08, 0.025), m.chrome);
    handle.position.set(1.6, display ? h * 0.18 : -h * 0.15, 0.1);
    pivot.add(handle);
    if (display) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.21),
        new THREE.MeshBasicMaterial({ map: ledTexture('4°C', '#5eead4'), toneMapped: false }),
      );
      panel.position.set(0.5, h * 0.32, 0.065);
      pivot.add(panel);
    }
    group.add(pivot);
    return pivot;
  };
  const top = makeDoor(1.08, 1.13);
  const bottom = makeDoor(2.24, -0.58, true);

  const mist = particles(90, dotTexture(), 0.32, 0xccfbf1, new THREE.Vector3(2.2, 2.6, 1.2));
  mist.points.position.set(0.3, -1.9, 1.2);
  group.add(mist.points);

  return { group, doors: [top, bottom], light, interior: m.interior, mist };
}

function buildWasher(m: Mats) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(rbox(1.95, 2.15, 1.7, 0.14), m.white));

  // control strip: knob, display, buttons
  const strip = new THREE.Mesh(rbox(1.86, 0.36, 0.06, 0.03), m.offWhite);
  strip.position.set(0, 0.82, 0.85);
  group.add(strip);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 40), m.chrome);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.6, 0.82, 0.9);
  group.add(knob);
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.2),
    new THREE.MeshBasicMaterial({ map: ledTexture('1:05', '#a5b4fc'), toneMapped: false }),
  );
  display.position.set(-0.1, 0.82, 0.884);
  group.add(display);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), i === 0 ? m.glow : m.dark);
    b.position.set(-0.75 + i * 0.13, 0.82, 0.885);
    group.add(b);
  }

  // round door: chrome ring, glass, spinning drum behind it
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.075, 24, 72), m.chrome);
  ring.position.set(0, -0.15, 0.878);
  group.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.6, 64), m.glass);
  glass.position.set(0, -0.15, 0.888);
  group.add(glass);

  // dark recess (the opening), then the perforated drum and its paddles just in front of it
  const recess = new THREE.Mesh(new THREE.CircleGeometry(0.6, 64), new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.8 }));
  recess.position.set(0, -0.15, 0.853);
  group.add(recess);
  const drum = new THREE.Group();
  drum.position.set(0, -0.15, 0.858);
  const back = new THREE.Mesh(
    new THREE.CircleGeometry(0.54, 64),
    new THREE.MeshStandardMaterial({ map: drumTexture(), metalness: 0.75, roughness: 0.35 }),
  );
  drum.add(back);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), m.steel);
  hub.position.z = 0.002;
  drum.add(hub);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(rbox(0.1, 0.24, 0.02, 0.008), m.steel);
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.008);
    fin.rotation.z = a + Math.PI / 2;
    drum.add(fin);
  }
  // water line inside the drum
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.56, 48, Math.PI * 1.1, Math.PI * 0.8),
    new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  water.position.set(0, -0.15, 0.872);
  group.add(water);
  group.add(drum);

  const bubbles = particles(60, dotTexture(true), 0.14, 0xe0e7ff, new THREE.Vector3(1.0, 1.1, 0.004));
  bubbles.points.position.set(0, -0.72, 0.876);
  group.add(bubbles.points);

  return { group, drum, bubbles };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export function createStoryScene(canvas: HTMLCanvasElement): StoryScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.35, 10);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 6, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(CHAPTER_COLORS[0], 3.2);
  rim.position.set(-5, 2.5, -4);
  scene.add(rim);
  const under = new THREE.PointLight(CHAPTER_COLORS[0], 6, 12);
  under.position.set(0, -2.6, 2.2);
  scene.add(under);
  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x020617, 0.35));

  const m = makeMaterials();
  const ac = buildAC(m);
  const fridge = buildFridge(m);
  const washer = buildWasher(m);
  const models = [ac.group, fridge.group, washer.group];
  models.forEach((g) => scene.add(g));

  // layout depends on screen shape (portrait phones: appliance on top, cards below)
  let portrait = false;
  const colorA = new THREE.Color();
  const colorB = new THREE.Color();

  function resize(width: number, height: number) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    portrait = camera.aspect < 0.9;
    // keep the widest appliance (AC, ~3.4 units) comfortably on screen
    const visibleWidthPerUnitZ = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    camera.position.z = Math.max(10, (portrait ? 4.4 : 7.2) / visibleWidthPerUnitZ);
    camera.updateProjectionMatrix();
  }

  /** where each model sits for chapter-local time q (enter from below, move aside, leave upward) */
  function place(group: THREE.Group, i: number, p: number) {
    const q = local(p, i);
    const enter = i === 0 ? ease(seg(q, -0.02, 0.12)) : ease(seg(q, -0.08, 0.08));
    const leave = i < CHAPTERS - 1 ? ease(seg(q, 0.88, 1.0)) : 0;
    const visible = enter > 0.001 && leave < 0.999;
    group.visible = visible;
    if (!visible) return;

    const side = aside(q) * (i === CHAPTERS - 1 ? 1 - outroAt(p) : 1);
    const out = i === CHAPTERS - 1 ? outroAt(p) : 0;
    const asideX = portrait ? 0 : -1.75;
    const asideY = portrait ? 1.05 : 0;
    const restY = i === 0 ? 0.25 : 0.05;

    group.position.x = lerp(0, asideX, side) + out * (portrait ? 0 : 2.1);
    group.position.y = restY + lerp(0, asideY, side) - (1 - enter) * 3.4 + leave * 3.4 + out * (portrait ? 1.0 : 0);
    group.position.z = -leave * 2;
    const turn = lerp(-0.55, 0.5, seg(q, 0, 1));
    group.rotation.y = turn + (1 - enter) * Math.PI * 1.2 + leave * Math.PI;
    group.rotation.x = 0.1 + (1 - enter) * 0.5 - leave * 0.4;
    const s = (portrait ? 0.82 : 1) * lerp(0.55, 1, enter) * lerp(1, 0.4, leave) * lerp(1, 0.85, out);
    group.scale.setScalar(s);
  }

  function animateParticles(pt: Particles, t: number, fn: (i: number, b: Float32Array, out: Float32Array, t: number) => void) {
    const arr = (pt.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < pt.speed.length; i++) fn(i, pt.base, arr, t);
    pt.points.geometry.getAttribute('position').needsUpdate = true;
  }

  function update(p: number, t: number) {
    models.forEach((g, i) => place(g, i, p));

    // --- AC: louver opens, air flows, snow drifts out of the outlet ---
    const qa = local(p, 0);
    const airOn = seg(qa, 0.06, 0.16) * (1 - seg(qa, 0.86, 0.96));
    ac.louver.rotation.x = airOn * 0.95;
    ac.flowMat.opacity = airOn * 0.32;
    (ac.flowMat.alphaMap as THREE.Texture).offset.x = -t * 0.55;
    ac.snow.material.opacity = airOn * 0.9;
    if (ac.group.visible && airOn > 0) {
      animateParticles(ac.snow, t, (i, b, o) => {
        const k = ac.snow.speed[i];
        const y = (b[i * 3 + 1] + t * 0.45 * k) % 3.2; // 0 at the outlet -> 3.2 far away
        o[i * 3] = b[i * 3] * (0.4 + y * 0.35) + Math.sin(t * k + i) * 0.08;
        o[i * 3 + 1] = 2.6 - y * 1.0;
        o[i * 3 + 2] = b[i * 3 + 2] * 0.4 + y * 0.55;
      });
    }

    // --- Fridge: doors swing open, interior lights up, cold mist rolls out ---
    const qf = local(p, 1);
    const open = ease(seg(qf, 0.16, 0.3)) * (1 - ease(seg(qf, 0.72, 0.86)));
    fridge.doors[0].rotation.y = -open * 1.15;
    fridge.doors[1].rotation.y = -open * 1.0;
    fridge.light.intensity = open * 3;
    fridge.interior.emissiveIntensity = open * 0.22;
    fridge.mist.material.opacity = open * 0.22;
    if (fridge.group.visible && open > 0) {
      animateParticles(fridge.mist, t, (i, b, o) => {
        const k = fridge.mist.speed[i];
        const y = (b[i * 3 + 1] + t * 0.3 * k) % 2.6;
        o[i * 3] = b[i * 3] + y * 0.35;
        o[i * 3 + 1] = 2.4 - y;
        o[i * 3 + 2] = b[i * 3 + 2] + y * 0.5;
      });
    }

    // --- Washer: drum spins with time and scroll, bubbles rise behind the glass ---
    const qw = local(p, 2);
    const spinning = seg(qw, 0.04, 0.2);
    washer.drum.rotation.z = -(t * 2.2 * spinning + p * 18);
    washer.bubbles.material.opacity = spinning * 0.8 * (1 - outroAt(p) * 0.6);
    if (washer.group.visible && spinning > 0) {
      animateParticles(washer.bubbles, t, (i, b, o) => {
        const k = washer.bubbles.speed[i];
        const y = (b[i * 3 + 1] + t * 0.35 * k) % 1.1;
        const r = Math.hypot(b[i * 3], y - 0.55);
        const inside = r < 0.52 ? 1 : 0.52 / r; // keep bubbles inside the round window
        o[i * 3] = b[i * 3] * inside + Math.sin(t * 2 * k + i) * 0.03;
        o[i * 3 + 1] = (y - 0.55) * inside + 0.55;
        o[i * 3 + 2] = b[i * 3 + 2];
      });
    }

    // --- light colour follows the chapter (blue -> teal -> indigo) ---
    // same moments as the page's colour wipe (end of each chapter)
    colorA.setHex(CHAPTER_COLORS[0]).lerp(colorB.setHex(CHAPTER_COLORS[1]), seg(p, 0.27, 0.31));
    colorA.lerp(colorB.setHex(CHAPTER_COLORS[2]), seg(p, 0.57, 0.61));
    rim.color.copy(colorA);
    under.color.copy(colorA);

    renderer.render(scene, camera);
  }

  function dispose() {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
        mm.dispose();
      }
    });
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
  }

  return { update, resize, dispose };
}
