// Packs the desktop app: node electron/pack.mjs mac|win  →  release/
// Only package.json, electron/ and the built game (dist/) go in; the sources and everything else
// stay out. Run `npm run build` first (the npm scripts do).
import { packager } from '@electron/packager';
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const target = process.argv[2] ?? 'mac';
const platforms = {
  // (Apple Silicon only: no Intel build is needed)
  mac: { platform: 'darwin', arch: 'arm64', icon: 'electron/icon.icns' },
  win: { platform: 'win32', arch: 'x64', icon: 'electron/icon.ico' },
};
const t = platforms[target];
if (!t) { console.error(`unknown target ${target} (mac | win)`); process.exit(1); }

const keep = (p) => p === '' || p === '/package.json' || p === '/electron' || p.startsWith('/electron/') || p === '/dist' || p.startsWith('/dist/');
const out = await packager({
  dir: root,
  name: 'Skerry',
  executableName: 'Skerry',
  platform: t.platform,
  arch: t.arch.split(','),
  icon: path.join(root, t.icon),
  out: path.join(root, 'release'),
  overwrite: true,
  asar: true,
  prune: false,
  electronVersion,
  ignore: (p) => !keep(p),
  appVersion: pkg.version,
  appBundleId: 'io.github.weikendo.skerry',
  appCategoryType: 'public.app-category.strategy-games',
  win32metadata: { CompanyName: 'Skerry', ProductName: 'Skerry', FileDescription: 'Skerry' },
});
// Electron's and Chromium's license texts go into the app itself, so they travel with it (the zip holds only the app)
for (const dir of out) {
  const res = t.platform === 'darwin' ? path.join(dir, 'Skerry.app', 'Contents', 'Resources') : path.join(dir, 'resources');
  for (const f of ['LICENSE', 'LICENSES.chromium.html']) copyFileSync(path.join(dir, f), path.join(res, f));
}
console.log(out.join('\n'));
