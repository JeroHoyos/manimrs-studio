// Builds the window of the app into apps/studio/dist/, the folder that Tauri puts in the program.
//
//   npm run build
//
// 1. TypeScript checks the code and writes one JavaScript file for each source file.
// 2. The page, the styles, the fonts and the two vendor libraries are copied as they are.
// 3. The page gets one <script> for each file of src/, in the order of their names.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(frontend, 'apps', 'studio');
const dist = join(app, 'dist');
const MARK = '<!-- build:scripts -->';

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const tsc = join(frontend, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', app], { stdio: 'inherit' });

cpSync(join(app, 'public'), dist, { recursive: true });
cpSync(join(app, 'src', 'styles'), dist, { recursive: true });

// The libraries first (they only declare types, so their files are almost empty), then the app.
const scripts = [];
for (const folder of ['libs', 'apps/studio/src']) {
  const from = join(dist, 'js', folder);
  for (const file of readdirSync(from, { recursive: true }).map(String).sort()) {
    if (file.endsWith('.js')) scripts.push(`js/${folder}/${file.replaceAll('\\', '/')}`);
  }
}
const page = readFileSync(join(app, 'index.html'), 'utf8');
if (!page.includes(MARK)) throw new Error(`index.html has no ${MARK} line`);
const tags = scripts.map((s) => `<script src="${s}"></script>`).join('\n');
writeFileSync(join(dist, 'index.html'), page.replace(MARK, tags));

console.log(`Built ${scripts.length} scripts into ${dist}`);
