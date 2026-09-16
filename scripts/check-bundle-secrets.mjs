/**
 * "No secret keys in the bundle" (docs/DEMO.md checklist). Exports the
 * Android bundle and scans every file in it for the server-only values from
 * .env / .env.local (including Supabase and Privy server secrets) and for
 * anything shaped like a Supabase secret key. Only EXPO_PUBLIC_* values may
 * appear. Usage: node scripts/check-bundle-secrets.mjs [export-dir]
 * (without an export dir it runs `expo export` into a temp folder first).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function envValues() {
  const out = new Map();
  for (const file of ['.env', '.env.local']) {
    let text = '';
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[2]) out.set(m[1], m[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return out;
}

const dir = process.argv[2] ?? (() => {
  const d = mkdtempSync(join(tmpdir(), 'eob-export-'));
  console.log(`exporting to ${d} …`);
  const expoCli = join(root, 'node_modules', 'expo', 'bin', 'cli');
  execFileSync(process.execPath, [expoCli, 'export', '--platform', 'android', '--output-dir', d], { cwd: root, stdio: 'inherit' });
  return d;
})();

const files = [];
(function walk(p) {
  for (const name of readdirSync(p)) {
    const full = join(p, name);
    if (statSync(full).isDirectory()) walk(full); else files.push(full);
  }
})(dir);

const env = envValues();
const secrets = [...env].filter(
  ([k]) =>
    !k.startsWith('EXPO_PUBLIC_') &&
    /SECRET|SERVICE_ROLE|PASSWORD|TOKEN|PRIVATE_KEY|SOLANA_RPC_URL/i.test(k),
);
// Hermes packs strings back to back, so "…/grants" + "b_secret__internal…" reads as one; a real
// key is sb_secret_ followed by base64url that never starts with an underscore.
const shape = /sb_secret_[A-Za-z0-9][A-Za-z0-9_-]{9,}/g;
// supabase-js legitimately contains the literal prefix while Hermes stores the
// next string ("computeFrame…") immediately after it with no delimiter.
const hermesFalsePositive = 'sb_secret_computeFrame';
let bad = 0;
for (const file of files) {
  const buf = readFileSync(file);
  const text = buf.toString('latin1');
  for (const [k, v] of secrets) {
    if (v.length >= 8 && text.includes(v)) { console.error(`FAIL ${k} value found in ${file}`); bad++; }
  }
  for (const m of text.matchAll(shape)) {
    if (m[0].startsWith(hermesFalsePositive)) continue;
    console.error(`FAIL secret-shaped string ${m[0].slice(0, 14)}… in ${file}`); bad++;
  }
}
for (const [k, v] of env) if (k.startsWith('EXPO_PUBLIC_')) {
  const seen = files.some((f) => readFileSync(f).toString('latin1').includes(v));
  console.log(`${seen ? 'ok   ' : 'note '} ${k} ${seen ? 'is inlined (public by design)' : 'not found in the bundle'}`);
}
console.log(bad ? `\n${bad} secret(s) leaked into the bundle` : `\nok    no server secret in ${files.length} bundle files`);
process.exit(bad ? 1 : 0);
