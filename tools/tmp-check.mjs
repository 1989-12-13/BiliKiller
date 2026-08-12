// 临时校验脚本：语法检查全部 JS + 校验 manifest.json
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2]);
const results = [];

function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      walk(p);
    } else if (name.name.endsWith('.js')) {
      const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      results.push({ file: p, ok: r.status === 0, err: r.stderr });
    }
  }
}
walk(join(root, 'src'));

try {
  JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  results.push({ file: join(root, 'manifest.json'), ok: true });
} catch (e) {
  results.push({ file: join(root, 'manifest.json'), ok: false, err: String(e) });
}

let failed = false;
for (const r of results) {
  console.log((r.ok ? 'OK:   ' : 'FAIL: ') + r.file);
  if (!r.ok) {
    failed = true;
    console.log(r.err);
  }
}
process.exit(failed ? 1 : 0);
