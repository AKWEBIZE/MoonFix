/**
 * 3D hero (top of the home page): AC on top blowing snowflakes over a fridge and a washing machine.
 * The whole group turns gently toward the mouse (or the phone's tilt). Loaded after the page has
 * finished loading, so the hero text appears instantly; the flat picture is shown until then.
 */
import * as THREE from 'three';
import { animateAC, animateFridge, animateWasher, buildAC, buildFridge, buildWasher, createRenderer, disposeAll, makeMaterials, setLed } from './kit';

export interface HeroScene {
  /** draw one frame; t = seconds */
  frame(t: number): void;
  resize(width: number, height: number): void;
  /** pointer position relative to the hero, -1..1 on both axes */
  look(x: number, y: number): void;
  setTemp(celsius: number): void;
  dispose(): void;
}

export function createHeroScene(canvas: HTMLCanvasElement): HeroScene {
  const { renderer, scene, pmrem } = createRenderer(canvas, 1.5);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x061a2e, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x0b98ee, 3);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  const glow = new THREE.PointLight(0x2fb2f2, 5, 10);
  glow.position.set(0, -0.5, 3);
  scene.add(glow);

  const m = makeMaterials();
  const ac = buildAC(m);
  const fridge = buildFridge(m);
  const washer = buildWasher(m);

  // composition like the flat hero picture: AC above, fridge + washer below
  const rig = new THREE.Group();
  ac.group.position.set(0, 1.45, 0);
  ac.group.scale.setScalar(0.78);
  fridge.group.position.set(-1.15, -1.0, -0.2);
  fridge.group.scale.setScalar(0.58);
  fridge.group.rotation.y = 0.35;
  washer.group.position.set(1.1, -1.35, 0.15);
  washer.group.scale.setScalar(0.62);
  washer.group.rotation.y = -0.3;
  rig.add(ac.group, fridge.group, washer.group);
  scene.add(rig);

  // pointer follow (eased), with a slow idle sway when nothing moves
  const target = { x: 0, y: 0 };
  let lastLook = -10;
  let lastT = 0;

  function resize(width: number, height: number) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    // fit roughly 3.9 x 4.6 units of composition
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const zForHeight = 4.6 / 2 / tanHalf;
    const zForWidth = 3.9 / 2 / (tanHalf * camera.aspect);
    camera.position.set(0, 0.1, Math.max(zForHeight, zForWidth) + 1);
    camera.lookAt(0, 0.05, 0);
    camera.updateProjectionMatrix();
  }

  function frame(t: number) {
    const dt = Math.min(0.1, t - lastT);
    lastT = t;
    const idle = t - lastLook > 3;
    const tx = idle ? Math.sin(t * 0.35) * 0.35 : target.x;
    const ty = idle ? Math.sin(t * 0.5) * 0.15 : target.y;
    const k = Math.min(1, dt * 3.5);
    rig.rotation.y += (tx * 0.5 - rig.rotation.y) * k;
    rig.rotation.x += (0.08 + ty * 0.18 - rig.rotation.x) * k;
    rig.position.y = Math.sin(t * 0.9) * 0.06; // gentle float

    animateAC(ac, 1, t);
    // fridge door opens a little now and then, showing the lit inside
    const peek = Math.max(0, Math.sin(t * 0.45 - 1)) ** 2;
    animateFridge(fridge, peek * 0.55, t);
    animateWasher(washer, t * 2.4, 1, t);

    renderer.render(scene, camera);
  }

  return {
    frame,
    resize,
    look(x: number, y: number) {
      target.x = Math.max(-1, Math.min(1, x));
      target.y = Math.max(-1, Math.min(1, y));
      lastLook = lastT;
    },
    setTemp(c: number) {
      setLed(ac.display, `${c}°`);
    },
    dispose() {
      disposeAll(scene, pmrem, renderer);
    },
  };
}
