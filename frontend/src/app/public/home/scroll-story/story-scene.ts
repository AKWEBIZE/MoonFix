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
import { animateAC, animateFridge, animateWasher, buildAC, buildFridge, buildWasher, createRenderer, disposeAll, makeMaterials } from '../../three/kit';
import { aside, CHAPTER_COLORS, CHAPTERS, ease, lerp, local, outroAt, seg } from './story-timeline';

export interface StoryScene {
  update(progress: number, seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export function createStoryScene(canvas: HTMLCanvasElement): StoryScene {
  const { renderer, scene, pmrem } = createRenderer(canvas);

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

  function update(p: number, t: number) {
    models.forEach((g, i) => place(g, i, p));

    // AC: louver opens, air flows, snow drifts out of the outlet
    const qa = local(p, 0);
    animateAC(ac, seg(qa, 0.06, 0.16) * (1 - seg(qa, 0.86, 0.96)), t);

    // Fridge: doors swing open, interior lights up, cold mist rolls out
    const qf = local(p, 1);
    animateFridge(fridge, ease(seg(qf, 0.16, 0.3)) * (1 - ease(seg(qf, 0.72, 0.86))), t);

    // Washer: drum spins with time and scroll, bubbles rise behind the glass
    const spinning = seg(local(p, 2), 0.04, 0.2);
    animateWasher(washer, t * 2.2 * spinning + p * 18, spinning * (1 - outroAt(p) * 0.6), t);

    // --- light colour follows the chapter (blue -> teal -> indigo) ---
    // same moments as the page's colour wipe (end of each chapter)
    colorA.setHex(CHAPTER_COLORS[0]).lerp(colorB.setHex(CHAPTER_COLORS[1]), seg(p, 0.27, 0.31));
    colorA.lerp(colorB.setHex(CHAPTER_COLORS[2]), seg(p, 0.57, 0.61));
    rim.color.copy(colorA);
    under.color.copy(colorA);

    renderer.render(scene, camera);
  }

  function dispose() {
    disposeAll(scene, pmrem, renderer);
  }

  return { update, resize, dispose };
}
