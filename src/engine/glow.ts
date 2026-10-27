import * as THREE from 'three';
import type { V3 } from './lowpoly';

/**
 * Soft additive halos around light sources (point sprites). A cheap stand-in
 * for bloom: no extra full-screen passes, so nights cost the same as days.
 */
export class GlowSet {
  private pos: number[] = [];
  private col: number[] = [];
  private size: number[] = [];

  add(p: V3, color: THREE.ColorRepresentation, size: number): this {
    const c = new THREE.Color(color);
    this.pos.push(...p);
    this.col.push(c.r, c.g, c.b);
    this.size.push(size);
    return this;
  }

  build(): GlowPoints {
    return new GlowPoints(this.pos, this.col, this.size);
  }
}

/**
 * The halos' sizes are set for the big picture (see updateGlowUniforms). A
 * smaller view of the same scene, a console monitor, sets this shared factor
 * for its render (its height and field of view against the big picture's)
 * and back to 1 afterwards, or its lights would come out many times too big.
 */
export const GLOW_VIEW = { value: 1 };

/** additive halo sprites; attributes: position, aColor (rgb, may exceed 1), aSize (metres) */
export function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uIntensity: { value: 0 }, uScale: { value: 800 }, uView: GLOW_VIEW, uFogNear: { value: 1000 }, uFogFar: { value: 10000 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        uniform float uScale, uView, uFogNear, uFogFar;
        varying vec3 vColor; varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale * uView / -mv.z, 1.5, 256.0);
          vColor = aColor;
          vFade = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec3 vColor; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(1.0 - d, 0.0), 2.2);
          gl_FragColor = vec4(vColor * a * uIntensity * vFade, 1.0);
        }`,
    });
}

/** keep halo sizes in metres and fade with the fog */
export function updateGlowUniforms(mat: THREE.ShaderMaterial, intensity: number, camera: THREE.PerspectiveCamera, viewportHeight: number, fog: THREE.Fog) {
  const u = mat.uniforms;
  u.uIntensity.value = intensity;
  u.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  u.uFogNear.value = fog.near;
  u.uFogFar.value = fog.far;
}

export class GlowPoints extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  /** further halos of the same model (on its moving parts), updated along with this one */
  readonly linked: GlowPoints[] = [];

  constructor(pos: number[], col: number[], size: number[]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    super(g, glowMaterial());
    this.frustumCulled = false;
    this.renderOrder = 10;
  }

  /** intensity 0..1 (night factor); scale from the camera so sizes are in metres. */
  update(intensity: number, camera: THREE.PerspectiveCamera, viewportHeight: number, fog: THREE.Fog) {
    updateGlowUniforms(this.material, intensity, camera, viewportHeight, fog);
    this.visible = intensity > 0.01;
    for (const g of this.linked) g.update(intensity, camera, viewportHeight, fog);
  }
}
