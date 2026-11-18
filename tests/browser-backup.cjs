const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
// Usage: NODE_PATH=<directory containing Playwright> node tests/browser-backup.cjs [index.html] [output directory]
// Fresh browser profile, synthetic credentials, and every external request mocked. No real transactions.
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '../index.html'));
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'qoree-browser-backup-'));
fs.mkdirSync(OUT, { recursive: true });
const SEED = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
const PASSWORD = 'Synthetic_review_only_83!River';
const results = [], outbound = [], logs = [];
const secretForms = (s) => [s, s.toUpperCase(), Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64')];
const forbidden = [...secretForms(SEED), ...secretForms(PASSWORD)];
const hasSecret = (s) => forbidden.some((v) => String(s).includes(v));
function check(name, ok, detail) {
  results.push({ name, pass: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
async function stores(page) {
  return page.evaluate(async () => {
    const local = Object.fromEntries(Object.entries(localStorage));
    const session = Object.fromEntries(Object.entries(sessionStorage));
    const indexed = {};
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((yes, no) => { const r = indexedDB.open(info.name); r.onsuccess = () => yes(r.result); r.onerror = no; });
      try {
        indexed[info.name] = {};
        for (const name of db.objectStoreNames) indexed[info.name][name] = await new Promise((yes, no) => {
          const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => yes(r.result); r.onerror = no;
        });
      } finally { db.close(); }
    }
    return { local, session, indexed };
  });
}
(async () => {
  const pageBytes = fs.readFileSync(PAGE);
  const server = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    for (const line of fs.readFileSync(path.join(__dirname, '../cloudflare/_headers'), 'utf8').split('\n')) {
      const match = line.match(/^  ([^:]+): (.+)$/); if (match) headers[match[1]] = match[2];
    }
    res.writeHead(200, headers); res.end(pageBytes);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mockNetwork = async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin === origin) { await route.continue(); return; }
      outbound.push({ url: req.url(), method: req.method(), body: req.postData() || '' });
      let data = {};
      if (url.pathname.endsWith('/tick-info')) data = { tickInfo: { tick: 90000000, epoch: 200 } };
      else if (url.pathname.includes('/balances/')) data = { balance: { id: url.pathname.split('/').at(-1), balance: '1000000', validForTick: 90000000, incomingAmount: '1000000', outgoingAmount: '0', latestIncomingTransferTick: 1, latestOutgoingTransferTick: 0 } };
      else if (url.pathname.includes('/assets/')) data = { ownedAssets: [] };
      else if (url.pathname.endsWith('/getTransactionsForIdentity')) data = { hits: { total: 0 }, transactions: [], validForTick: 90000000 };
      else if (url.pathname.endsWith('/getLastProcessedTick')) data = { tickNumber: 90000000 };
      else if (url.hostname === 'static.qubic.org') data = [];
      else if (url.pathname.includes('/simple/price')) data = { 'qubic-network': { usd: 0.000001, usd_24h_change: 0, usd_market_cap: 1, last_updated_at: Math.floor(Date.now()/1000) } };
      else if (url.pathname.includes('market_chart')) data = { prices: [] };
      else if (url.hostname === 'api.gateio.ws') data = { currency: 'QUBIC', deposit_disabled: false, withdraw_disabled: false };
      if (url.pathname.endsWith('/broadcast-transaction')) throw new Error('No broadcast permitted in seed review');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
    };
    await context.route('**/*', mockNetwork);
    const page = await context.newPage();
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(String(e)));
    page.setDefaultTimeout(20000);
    const response = await page.goto(origin);
    const headers = response.headers();
    check('Packaged security headers are served with the production page',
      headers['content-security-policy'] === "frame-ancestors 'none'" && headers['x-frame-options'] === 'DENY'
      && headers['strict-transport-security'] === 'max-age=31536000' && headers['x-content-type-options'] === 'nosniff'
      && headers['referrer-policy'] === 'no-referrer' && headers['cross-origin-opener-policy'] === 'same-origin'
      && headers['cache-control'] === 'no-cache, no-transform');
    await page.getByRole('button', { name: 'Import seed', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Import seed', exact: true }).click();
    await page.getByRole('textbox', { name: 'Seed', exact: true }).fill(SEED);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('textbox', { name: 'Repeat password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Import wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
    check('Production page imports and encrypts synthetic seed', true);
    check('Seed and password absent from persistent browser storage', !hasSecret(JSON.stringify(await stores(page))));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await page.getByRole('button', { name: /^Encrypted backup/ }).click();
    await page.getByRole('button', { name: 'Download backup', exact: true }).click();
    const before = await stores(page);
    const currentPw = page.getByRole('textbox', { name: 'Current password', exact: true });
    await currentPw.fill('wrong password');
    await page.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    await page.locator('.hint.err').filter({ hasText: /password/i }).waitFor();
    check('Wrong export password offers no download', await page.getByRole('link', { name: 'Download backup', exact: true }).count() === 0);
    await currentPw.fill(PASSWORD);
    await page.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    const link = page.getByRole('link', { name: 'Download backup', exact: true });
    await link.waitFor();
    const downloadPromise = page.waitForEvent('download');
    await link.click();
    const downloaded = await downloadPromise;
    const backupPath = path.join(OUT, downloaded.suggestedFilename());
    await downloaded.saveAs(backupPath);
    const fileText = fs.readFileSync(backupPath, 'utf8');
    check('Production CSP permits encrypted file download', JSON.parse(fileText).format === 'qoree-encrypted-backup' && !(await downloaded.failure()));
    check('Downloaded file contains no seed or password', !hasSecret(fileText));
    check('Export leaves the saved vault unchanged', (await stores(page)).local['qubic-wallet.vault.v1'] === before.local['qubic-wallet.vault.v1']);
    await page.getByRole('button', { name: 'Check backup file', exact: true }).click();
    await page.getByLabel('Backup file', { exact: true }).setInputFiles(backupPath);
    await page.getByRole('textbox', { name: 'Backup password', exact: true }).fill('wrong password');
    await page.getByRole('button', { name: 'Check backup file', exact: true }).click();
    await page.getByText('The backup could not be opened. Check the password and use an intact qoree backup file.', { exact: true }).waitFor();
    check('Downloaded-file verification rejects wrong password', await page.getByText('Backup verified', { exact: true }).count() === 0);
    await page.getByRole('textbox', { name: 'Backup password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Check backup file', exact: true }).click();
    await page.getByText('Backup verified', { exact: true }).waitFor();
    check('Saved file verifies and matches current accounts', await page.getByText('All current accounts and saved addresses match this backup.', { exact: true }).isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'backup-verified-mobile.png'), fullPage: true });
    check('Mobile backup screen fits viewport', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await fresh.route('**/*', mockNetwork);
    const recovery = await fresh.newPage(); recovery.setDefaultTimeout(20000);
    recovery.on('pageerror', (e) => logs.push(String(e)));
    await recovery.goto(origin);
    await recovery.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await recovery.getByLabel('Backup file', { exact: true }).setInputFiles(backupPath);
    const recoveryPw = recovery.getByRole('textbox', { name: 'Backup password', exact: true });
    await recoveryPw.fill(PASSWORD);
    await recovery.getByRole('button', { name: 'Check backup file', exact: true }).click();
    await recovery.getByRole('button', { name: 'Restore wallet', exact: true }).waitFor();
    check('Restore checks the file before asking to save', !(await stores(recovery)).local['qubic-wallet.vault.v1']);
    await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
    check('Cancelling restore leaves browser empty', !(await stores(recovery)).local['qubic-wallet.vault.v1']);
    await recoveryPw.fill(PASSWORD);
    await recovery.getByRole('button', { name: 'Check backup file', exact: true }).click();
    await recovery.getByRole('button', { name: 'Restore wallet', exact: true }).click();
    await recovery.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    check('Downloaded file restores into a fresh browser', !!(await stores(recovery)).local['qubic-wallet.vault.v1']);
    check('Restored storage contains no plaintext seed or password', !hasSecret(JSON.stringify(await stores(recovery))));
    await recovery.reload();
    await recovery.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await recovery.getByRole('button', { name: 'Unlock', exact: true }).click();
    await recovery.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    check('Restored wallet unlocks after a full reload', true);
    await recovery.getByRole('button', { name: 'Settings', exact: true }).click();
    await recovery.getByRole('button', { name: 'Security', exact: true }).click();
    await recovery.getByRole('button', { name: /^Encrypted backup/ }).click();
    await recovery.getByRole('button', { name: 'Download backup', exact: true }).click();
    await recovery.getByRole('textbox', { name: 'Current password', exact: true }).fill(PASSWORD);
    await recovery.evaluate(() => { document.querySelector('.sheet-body form').requestSubmit(); window.dispatchEvent(new Event('blur')); });
    await recovery.getByRole('button', { name: 'Prepare backup', exact: true }).waitFor({ state: 'visible' });
    await recovery.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent === 'Prepare backup')?.disabled);
    check('Focus loss cancels an in-progress export', await recovery.getByRole('link', { name: 'Download backup', exact: true }).count() === 0);
    const sessionContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await sessionContext.route('**/*', mockNetwork);
    const sessionPage = await sessionContext.newPage(); sessionPage.setDefaultTimeout(20000);
    await sessionPage.goto(origin);
    await sessionPage.getByRole('button', { name: 'Import seed', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Seed', exact: true }).fill(SEED);
    await sessionPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await sessionPage.getByRole('radio', { name: /This session only/ }).click();
    await sessionPage.getByRole('button', { name: 'Import wallet', exact: true }).click();
    await sessionPage.getByRole('button', { name: 'Settings', exact: true }).click();
    await sessionPage.getByRole('button', { name: 'Security', exact: true }).click();
    await sessionPage.getByRole('button', { name: /^Encrypted backup/ }).click();
    await sessionPage.getByRole('button', { name: 'Download backup', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Backup password', exact: true }).fill(PASSWORD);
    await sessionPage.getByRole('textbox', { name: 'Repeat password', exact: true }).fill('different');
    await sessionPage.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    check('Session backup requires matching passwords', await sessionPage.getByText('The passwords don’t match.', { exact: true }).isVisible());
    await sessionPage.getByRole('textbox', { name: 'Repeat password', exact: true }).fill(PASSWORD);
    await sessionPage.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    await sessionPage.getByRole('link', { name: 'Download backup', exact: true }).waitFor();
    check('Session-only export does not enable browser storage', !(await stores(sessionPage)).local['qubic-wallet.vault.v1']);
    await sessionPage.waitForTimeout(600);
    await sessionPage.screenshot({ path: path.join(OUT, 'backup-download-mobile.png'), fullPage: true });
    check('No seed, password, or encrypted backup sent to network', !hasSecret(JSON.stringify(outbound)) && !JSON.stringify(outbound).includes(JSON.parse(fileText).data));
    check('No seed or password in browser logs', !hasSecret(JSON.stringify(logs)));
    check('No browser runtime errors', !logs.some((s) => /ReferenceError|TypeError|SyntaxError|render error/i.test(s)));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(pageBytes).digest('hex'), results, logs }, null, 2));
    console.log(`Results: ${OUT}`);
  } finally { if (browser) await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 2; });
