/** Copies shared/form-engine.ts to the backend and frontend (each workspace compiles independently). */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

const src = new URL('../shared/form-engine.ts', import.meta.url);
const targets = ['backend/src/modules/forms/engine.ts', 'frontend/src/lib/form-engine.ts'];
const check = process.argv.includes('--check');
for (const t of targets) {
  const dest = new URL(`../${t}`, import.meta.url);
  if (check) {
    let same = false;
    try {
      same = readFileSync(dest, 'utf8') === readFileSync(src, 'utf8');
    } catch {
      same = false;
    }
    if (!same) {
      process.stderr.write(`${t} differs from shared/form-engine.ts. Run: npm run sync:shared\n`);
      process.exit(1);
    }
  } else {
    mkdirSync(new URL('./', dest), { recursive: true });
    copyFileSync(src, dest);
    process.stdout.write(`synced ${t}\n`);
  }
}
