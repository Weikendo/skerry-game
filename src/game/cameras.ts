import * as THREE from 'three';

export type CamGroup = 'Träger' | 'Walrus' | 'Manta' | 'Drohne' | 'Insel';

/**
 * A camera that exists in the game world: mounted on a vehicle, on the carrier
 * or on an island structure. The player sits on the carrier bridge and only
 * ever sees the world through these (as in the original).
 */
export interface CamDef {
  id: string;
  label: string;
  group: CamGroup;
  anchor: THREE.Object3D;
  eye: THREE.Vector3;       // in anchor coordinates
  look: THREE.Vector3;      // in anchor coordinates
  fov?: number;
  /** gimbal: 'yaw' keeps only the heading (ground vehicles), 'yawPitch' also follows climbs (aircraft) */
  stabilised?: 'yaw' | 'yawPitch';
  /** rig lag in 1/s (0 = rigid) */
  lag?: number;
  /** automatic pan in rad/s (island survey cameras) */
  survey?: number;
  /** head tilt limits in radians (default -0.6 .. 0.5); a drone gimbal looks straight down */
  tiltRange?: [number, number];
  /** head tilt after selecting / resetting */
  tilt0?: number;
  /** head pan limit either way in radians (default 2.2); Infinity turns all the way round (the laser turret) */
  panRange?: number;
  /** how far it zooms in (default 6) */
  maxZoom?: number;
  /** world eye point from a moving part (e.g. the lens of a sensor ball) instead of `eye` */
  eyeAt?: () => THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

export class CameraSystem {
  readonly cams: CamDef[] = [];
  current: CamDef | null = null;
  private pan = 0;          // pan/tilt/zoom of the remote camera head (mouse)
  private tilt = 0;
  private zoom = 1;
  private surveyAngle = 0;
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private fresh = true;
  private drag: { x: number; y: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private enabled: () => boolean) {
    dom.addEventListener('pointerdown', (e) => { if (this.enabled()) this.drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', () => { this.drag = null; });
    addEventListener('pointermove', (e) => {
      if (!this.drag || !this.enabled()) return;
      this.look(-(e.clientX - this.drag.x) * 0.004, -(e.clientY - this.drag.y) * 0.003);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled()) return;
      this.zoomBy(Math.exp(-e.deltaY * 0.0012));
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('dblclick', () => { if (this.enabled()) this.resetHead(); });
  }

  /** turn the camera head (mouse, gamepad stick, drone gimbal keys) */
  look(dPan: number, dTilt: number) {
    const [lo, hi] = this.current?.tiltRange ?? [-0.6, 0.5];
    const range = this.current?.panRange ?? 2.2, pan = this.pan + dPan / this.zoom;
    this.pan = range === Infinity ? Math.atan2(Math.sin(pan), Math.cos(pan)) : THREE.MathUtils.clamp(pan, -range, range);
    this.tilt = THREE.MathUtils.clamp(this.tilt + dTilt / this.zoom, lo, hi);
  }

  /** zoom factor change (wheel, triggers) */
  zoomBy(factor: number) {
    this.zoomLevel = this.zoom * factor;
  }

  get zoomLevel(): number { return this.zoom; }
  set zoomLevel(z: number) { this.zoom = THREE.MathUtils.clamp(z, 1, this.current?.maxZoom ?? 6); }

  /** current head angles, e.g. for the drone's gimbal readout */
  get head(): { pan: number; tilt: number; zoom: number } {
    return { pan: this.pan, tilt: this.tilt, zoom: this.zoom };
  }

  add(def: CamDef) {
    this.cams.push(def);
  }

  /** drop cameras whose id starts with `prefix` (an island changed hands); true if the current one went */
  remove(prefix: string): boolean {
    let lost = false;
    for (let i = this.cams.length - 1; i >= 0; i--) {
      if (!this.cams[i].id.startsWith(prefix)) continue;
      if (this.current === this.cams[i]) { this.current = null; lost = true; }
      this.cams.splice(i, 1);
    }
    return lost;
  }

  resetHead() {
    this.pan = 0; this.tilt = this.current?.tilt0 ?? 0; this.zoom = 1;
  }

  select(id: string) {
    const c = this.cams.find(x => x.id === id);
    if (!c) return;
    this.current = c;
    this.resetHead();
    this.surveyAngle = 0;
    this.fresh = true;
  }

  /** step through the cameras of one group */
  cycle(group: CamGroup, dir = 1) {
    const list = this.cams.filter(c => c.group === group);
    if (!list.length) return;
    const i = this.current ? list.indexOf(this.current) : -1;
    this.select(list[(i + dir + list.length) % list.length].id);
  }

  /** put `cam` where camera `id` looks, without the head or the rig lag (map picture) */
  placeRigid(id: string, cam: THREE.PerspectiveCamera): boolean {
    const c = this.cams.find(x => x.id === id);
    if (!c) return false;
    const frame = this.frameOf(c);
    const eye = c.eyeAt ? c.eyeAt() : c.eye.clone().applyMatrix4(frame);
    const dir = c.look.clone().sub(c.eye);
    if (c.tilt0) dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, UP).normalize(), c.tilt0);
    const look = c.eye.clone().add(dir).applyMatrix4(frame).sub(c.eye.clone().applyMatrix4(frame)).add(eye);
    cam.position.copy(eye);
    cam.lookAt(look);
    const fov = c.fov ?? 55;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return true;
  }

  /** like placeRigid, on another anchor of the same kind (a monitor for each Otter or Skua) */
  placeRigidOn(id: string, anchor: THREE.Object3D, cam: THREE.PerspectiveCamera): boolean {
    const c = this.cams.find(x => x.id === id);
    if (!c) return false;
    const keep = c.anchor;
    c.anchor = anchor;
    try { return this.placeRigid(id, cam); } finally { c.anchor = keep; }
  }

  private frameOf(c: CamDef): THREE.Matrix4 {
    c.anchor.updateMatrixWorld();
    if (!c.stabilised) return c.anchor.matrixWorld;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    c.anchor.matrixWorld.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const keep = new THREE.Euler(c.stabilised === 'yawPitch' ? e.x : 0, e.y, 0, 'YXZ');
    return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(keep), s);
  }

  update(dt: number) {
    const c = this.current;
    if (!c) return;
    const frame = this.frameOf(c);
    if (c.survey) this.surveyAngle += c.survey * dt;

    // look direction in anchor space, turned by survey pan + the mouse head
    const dir = c.look.clone().sub(c.eye);
    dir.applyAxisAngle(UP, this.surveyAngle + this.pan);
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    dir.applyAxisAngle(side, this.tilt);
    const frameEye = c.eye.clone().applyMatrix4(frame);
    const eye = c.eyeAt ? c.eyeAt() : frameEye;
    const look = c.eye.clone().add(dir).applyMatrix4(frame).sub(frameEye).add(eye);

    if (this.fresh || !c.lag) {
      this.smoothPos.copy(eye);
      this.smoothLook.copy(look);
      this.fresh = false;
    } else {
      const k = 1 - Math.exp(-c.lag * dt);
      this.smoothPos.lerp(eye, k);
      this.smoothLook.lerp(look, Math.min(1, k * 1.5));
    }
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
    const fov = (c.fov ?? 55) / this.zoom;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
