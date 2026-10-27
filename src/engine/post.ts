import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RainGlassShader } from './rainGlass';

/**
 * Bloom is by far the most expensive per-pixel step, so it only runs when it is
 * wanted (lights at night). Otherwise the scene renders straight to the canvas,
 * which has its own MSAA. Rain on the window the camera looks through is a pass
 * of its own, also only while it is wanted.
 */
export class Post {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  /** the scene through a wet window: its uniforms (uRain, uAngle, uRun, uFlow, uBlow, uCentre, uTime, uLight) are set by the game */
  readonly glass: ShaderPass;
  private glassComposer: EffectComposer;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    const glassTarget = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.glassComposer = new EffectComposer(renderer, glassTarget);
    this.glassComposer.addPass(new RenderPass(scene, camera));
    this.glass = new ShaderPass(RainGlassShader);
    this.glassComposer.addPass(this.glass);
    this.glassComposer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.glassComposer.setPixelRatio(pixelRatio);
    this.glassComposer.setSize(w, h);
    this.glass.uniforms.uAspect.value = w / Math.max(1, h);
  }

  /** `wet`: rain on the window (then without bloom: the two are not combined) */
  render(withBloom: boolean, wet = false) {
    if (wet) this.glassComposer.render();
    else if (withBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
