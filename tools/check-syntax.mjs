// 校验脚本：语法检查 src 下全部 JS + 校验 manifest.json
// 用法：
//   node tools/check-syntax.mjs            # 默认以仓库根目录（本文件所在目录的上级）为根
//   node tools/check-syntax.mjs <root>     # 指定项目根目录
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
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
console.log(failed ? 'SYNTAX FAILED' : 'SYNTAX OK (' + results.length + ' files)');
process.exit(failed ? 1 : 0);
