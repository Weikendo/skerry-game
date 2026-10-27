// 2D simplex noise (Stefan Gustavson's algorithm) with a seeded permutation.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export class Noise2D {
  private perm = new Uint8Array(512);

  constructor(seed = 1) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Simplex noise in [-1, 1]. */
  get(x: number, y: number): number {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const corner = (gx: number, gy: number, g: number) => {
      let tt = 0.5 - gx * gx - gy * gy;
      if (tt < 0) return 0;
      tt *= tt;
      const gr = GRAD[g & 7];
      return tt * tt * (gr[0] * gx + gr[1] * gy);
    };
    const n0 = corner(x0, y0, this.perm[ii + this.perm[jj]]);
    const n1 = corner(x1, y1, this.perm[ii + i1 + this.perm[jj + j1]]);
    const n2 = corner(x2, y2, this.perm[ii + 1 + this.perm[jj + 1]]);
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal sum, roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.get(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged fractal in [0, 1] — sharp crests for mountains. */
  ridge(x: number, y: number, octaves = 5): number {
    let sum = 0, amp = 0.5, freq = 1, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.get(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      prev = n;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
