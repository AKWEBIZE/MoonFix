/**
 * "Booking confirmed" moment: a glossy 3D tick badge spins in and a burst of 3D confetti
 * flies out, tumbles and falls with gravity. Runs for a few seconds, then stops drawing.
 */
import * as THREE from 'three';
import { createRenderer, disposeAll } from './kit';

export interface ConfirmScene {
  /** draws a frame; returns false once the animation has finished */
  frame(t: number): boolean;
  /** canvas size and where (in canvas pixels) the badge should sit */
  resize(width: number, height: number, badgeX: number, badgeY: number, badgePx?: number): void;
  dispose(): void;
}

const CONFETTI = 170;
const COLORS = [0x0b98ee, 0x2fb2f2, 0x00b8f0, 0x10b981, 0xfacc15, 0xf472b6, 0xffffff, 0x6366f1];
const DURATION = 6.5;

/** smooth overshoot, like a spring settling */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export function createConfirmScene(canvas: HTMLCanvasElement): ConfirmScene {
  const { renderer, scene, pmrem } = createRenderer(canvas, 1.75);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xdbeafe, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x0b98ee, 2.5);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  // ---------- badge: green disc, logo-blue metal ring, white tick ----------
  const badge = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.26, 72),
    new THREE.MeshPhysicalMaterial({ color: 0x12b981, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 }),
  );
  disc.rotation.x = Math.PI / 2;
  badge.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.06, 0.09, 24, 96),
    new THREE.MeshStandardMaterial({ color: 0x0b98ee, metalness: 0.85, roughness: 0.2 }),
  );
  badge.add(ring);
  const tickMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1 });
  const tickPts = [new THREE.Vector3(-0.45, 0.02, 0.16), new THREE.Vector3(-0.13, -0.3, 0.16), new THREE.Vector3(0.48, 0.33, 0.16)];
  const tick = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tickPts, false, 'catmullrom', 0.02), 48, 0.105, 16, false), tickMat);
  badge.add(tick);
  for (const p of [tickPts[0], tickPts[2]]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), tickMat);
    cap.position.copy(p);
    badge.add(cap);
  }
  badge.scale.setScalar(0.001);
  scene.add(badge);

  // ---------- confetti: one instanced mesh, simple physics per piece ----------
  const pieces = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.16, 0.26),
    new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }),
    CONFETTI,
  );
  pieces.frustumCulled = false;
  const pos: THREE.Vector3[] = [];
  const vel: THREE.Vector3[] = [];
  const axis: THREE.Vector3[] = [];
  const spin: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < CONFETTI; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 0.35 + Math.random() * 0.65; // mostly upward and outward
    const speed = 4 + Math.random() * 6;
    pos.push(new THREE.Vector3());
    vel.push(new THREE.Vector3(Math.cos(a) * speed * (1 - up * 0.4), up * speed, (Math.random() - 0.3) * 3));
    axis.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize());
    spin.push(4 + Math.random() * 10);
    pieces.setColorAt(i, color.setHex(COLORS[i % COLORS.length]));
  }
  scene.add(pieces);
  const dummy = new THREE.Object3D();
  const BURST_AT = 0.28;
  let lastT = 0;

  function resize(width: number, height: number, bx: number, by: number, badgePx = 92) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    // put the badge where the page wants it (pixel position -> world position on the z=0 plane)
    const vh = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const vw = vh * camera.aspect;
    badge.position.set((bx / width - 0.5) * vw, (0.5 - by / height) * vh, 0);
    // badge about badgePx pixels across
    badge.userData['size'] = (badgePx / height) * vh / 2.2;
  }

  function frame(t: number) {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;

    // badge: springs in while spinning, then floats and sways
    const size = (badge.userData['size'] as number) || 1;
    const k = Math.min(1, t / 0.85);
    badge.scale.setScalar(Math.max(0.001, easeOutBack(k)) * size);
    badge.rotation.y = (1 - easeOutBack(k)) * -Math.PI * 2 + Math.sin(t * 1.6) * 0.18 * k;
    badge.rotation.x = Math.sin(t * 1.2) * 0.08 * k;

    // confetti bursts from behind the badge, slows down (air), falls (gravity), tumbles
    const since = t - BURST_AT;
    for (let i = 0; i < CONFETTI; i++) {
      if (since < 0) {
        dummy.scale.setScalar(0);
      } else {
        const v = vel[i];
        v.y -= 9.5 * dt * 0.55;
        v.multiplyScalar(1 - 1.6 * dt);
        pos[i].addScaledVector(v, dt);
        dummy.position.copy(badge.position).add(pos[i]);
        dummy.quaternion.setFromAxisAngle(axis[i], since * spin[i]);
        const fade = 1 - Math.max(0, (since - 3.6) / 1.4);
        dummy.scale.setScalar(Math.max(0, fade) * size * 1.1);
      }
      dummy.updateMatrix();
      pieces.setMatrixAt(i, dummy.matrix);
    }
    pieces.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
    return t < DURATION;
  }

  return {
    frame,
    resize,
    dispose() {
      disposeAll(scene, pmrem, renderer);
    },
  };
}
