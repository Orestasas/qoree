// The deployed page (live network): its address serves this checkout's index.html byte for byte, with every header
// cloudflare/_headers lists, and its plain-http address redirects to https. Run it after a deploy:
//   ./test.sh --live --only deployed          QOREE_URL=<address> checks another deployment than https://qoree.app/
// Usage: node deployed.cjs <repo root>
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { check, finish, harnessError, skip } = require('./lib/check.cjs');
const ROOT = path.resolve(process.argv[2]);
const ADDRESS = process.env.QOREE_URL || 'https://qoree.app/';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  let res;
  try { res = await fetch(ADDRESS, { cache: 'no-store', redirect: 'error' }); } catch (e) { skip(`${ADDRESS} can't be reached (${e.message})`); }
  const served = Buffer.from(await res.arrayBuffer());
  const here = fs.readFileSync(path.join(ROOT, 'index.html'));
  check(`${ADDRESS} serves this checkout's index.html byte for byte`, res.status === 200 && sha256(served) === sha256(here),
    `status ${res.status}, served ${sha256(served).slice(0, 16)}…, here ${sha256(here).slice(0, 16)}…`);
  // Every "  Name: value" line of the header rules, served exactly.
  const rules = fs.readFileSync(path.join(ROOT, 'cloudflare', '_headers'), 'utf8').split('\n').filter((l) => /^\s+[A-Za-z-]+:/.test(l))
    .map((l) => { const at = l.indexOf(':'); return [l.slice(0, at).trim(), l.slice(at + 1).trim()]; });
  for (const [name, value] of rules) check(`header ${name}: ${value}`, res.headers.get(name) === value, `served: ${res.headers.get(name) ?? 'none'}`);
  let plain = null;
  try { plain = await fetch(ADDRESS.replace(/^https:/, 'http:'), { cache: 'no-store', redirect: 'manual' }); } catch { /* reported below */ }
  const to = plain ? plain.headers.get('location') || '' : '';
  check('the plain-http address redirects to https', Boolean(plain) && [301, 302, 307, 308].includes(plain.status) && to.startsWith('https://'),
    plain ? `${plain.status}${to ? ` to ${to}` : ''}` : 'unreachable');
  finish('deployed page');
})().catch(harnessError);
