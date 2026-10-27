import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// the version in the menu: package.json's, with the time of the build and the commit it was built from
// (a "+" after it: built with changes not yet committed), so every build can be told apart
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const commit = git('rev-parse --short HEAD');
const dirty = commit && git('status --porcelain -- src index.html public package.json') !== '';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  // src/models/glb.ts waits for the Blender models at the top level
  build: { target: 'es2022' },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __BUILD_ID__: JSON.stringify(commit + (dirty ? '+' : '')),
  },
});
