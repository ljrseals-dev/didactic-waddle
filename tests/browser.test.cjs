const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const file = process.argv[2] || path.join(__dirname, "../index.html"), shots = path.join(__dirname, "..");
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(fs.readFileSync(file)); });
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1100 }, colorScheme: "dark" })).newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_|fonts\./.test(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__vr && window.__vr.ready() >= 1, null, { timeout: 120000 });
  await page.screenshot({ path: path.join(shots, "shot-dark.png"), fullPage: true });

  const R = await page.evaluate(async () => {
    const { S, renderRoom, sceneNow, roomStats } = window.__vr, SR = 44100, out = {};
    const base = () => Object.assign(sceneNow(), { W: 12, D: 16, H: 6, alpha: 0.25, lx: 6, ly: 13, rev: "hall", mix: 1, roll: 1 });
    const at = (sc, dist, azDeg) => { const a = (azDeg * Math.PI) / 180; sc.sx = sc.lx + dist * Math.sin(a); sc.sy = sc.ly - dist * Math.cos(a); return sc; };
    const energy = (r) => { let e = 0; for (let i = 0; i < r.L.length; i++) e += r.L[i] * r.L[i] + r.R[i] * r.R[i]; return e; };
    const voice = S.src; // demo phrase, mono
    // 1. direct to reverberant ratio vs distance
    const drr = {};
    for (const d of [1.5, 3, 6, 11]) {
      const dry = await renderRoom(voice, Object.assign(at(base(), d, 0), { rev: "off" })), tot = await renderRoom(voice, at(base(), d, 0));
      const ed = energy(dry), et = energy(tot); drr[d] = 10 * Math.log10(ed / Math.max(et - ed, 1e-12));
    }
    out.drr = drr;
    // 2. azimuth: ILD and ITD with a dry render
    const lag = (r) => { let best = 0, bl = 0; const maxLag = Math.round(0.0012 * SR), n = Math.min(r.L.length, 60000);
      for (let l = -maxLag; l <= maxLag; l++) { let c = 0; for (let i = maxLag; i < n - maxLag; i++) c += r.L[i] * r.R[i + l]; if (c > best) { best = c; bl = l; } } return (bl / SR) * 1000; }; // + ms means R lags L
    const lev = (r) => { let l = 0, rr = 0; for (let i = 0; i < r.L.length; i++) { l += r.L[i] ** 2; rr += r.R[i] ** 2; } return 10 * Math.log10(rr / l); }; // + dB means right louder
    const az = {};
    for (const a of [-90, -45, 0, 45, 90]) { const r = await renderRoom(voice, Object.assign(at(base(), 3, a), { rev: "off" })); az[a] = { ild: lev(r), itdMs: lag(r) }; }
    out.az = az;
    // 3. RT60 from the impulse response (Schroeder backward integration, T30 extrapolated), hall vs size
    const click = new AudioBuffer({ length: 4410, numberOfChannels: 1, sampleRate: SR }); const cd = new Float32Array(4410); cd[0] = 1; click.copyToChannel(cd, 0);
    const rt = {};
    const rooms = { small: [6, 8, 3], medium: [12, 16, 6], large: [30, 40, 14] };
    for (const [name, [W, D, H]] of Object.entries(rooms)) {
      const measure = async (damp) => { const sc = Object.assign(base(), { W, D, H, lx: W / 2, ly: D * 0.8, alpha: 0.25, damp }); at(sc, Math.min(2, D / 4), 0);
        const r = await renderRoom(click, sc); const n = r.L.length, e = new Float64Array(n); let acc = 0;
        for (let i = n - 1; i >= 0; i--) { acc += r.L[i] ** 2 + r.R[i] ** 2; e[i] = acc; }
        const db = (i) => 10 * Math.log10(e[i] / e[0] + 1e-30); let t5 = -1, t35 = -1; for (let i = 0; i < n; i++) { if (t5 < 0 && db(i) < -5) t5 = i; if (t35 < 0 && db(i) < -35) { t35 = i; break; } }
        return t35 > 0 ? (2 * (t35 - t5)) / SR : null; };
      // Eyring assumes frequency-independent absorption, so compare it with the undamped hall; damping is extra high-frequency loss and should shorten the decay.
      rt[name] = { measured: await measure(0), damped: await measure(0.25), formula: roomStats(W, D, H, 0.25).rt };
    }
    out.rt = rt;
    // 4. plate and dry both render; plate tail longer than dry
    const pl = await renderRoom(voice, Object.assign(at(base(), 4, 20), { rev: "plate" })), dr = await renderRoom(voice, Object.assign(at(base(), 4, 20), { rev: "off" }));
    out.plate = { len: pl.L.length / SR, dryLen: dr.L.length / SR };
    return out;
  });
  console.log(JSON.stringify(R, (k, v) => typeof v === "number" ? +v.toPrecision(4) : v));
  const d = R.drr; assert(d[1.5] > d[3] && d[3] > d[6] && d[6] > d[11], "direct/reverb falls as the voice moves away: " + JSON.stringify(d));
  assert(d[1.5] - d[11] > 10, "and by a lot (about 17 dB expected by 1/r): " + (d[1.5] - d[11]));
  const a = R.az;
  assert(a[90].ild > 3 && a[-90].ild < -3 && Math.abs(a[0].ild) < 1.5, "interaural level difference follows azimuth: " + JSON.stringify([a[-90].ild, a[0].ild, a[90].ild]));
  assert(a[90].itdMs < -0.25 && a[-90].itdMs > 0.25 && Math.abs(a[0].itdMs) < 0.1 && Math.abs(a[90].itdMs) < 1.0 && Math.abs(a[90].itdMs) > 0.4, "interaural time difference follows azimuth (negative: right ear first, matching the louder right ear): " + JSON.stringify([a[-90].itdMs, a[0].itdMs, a[90].itdMs]));
  assert(a[45].ild > 1 && a[-45].ild < -1, "45 degrees gives a smaller difference with the same sign");
  const r = R.rt; assert(r.small.measured && r.medium.measured && r.large.measured, "RT measured");
  assert(r.small.measured < r.medium.measured && r.medium.measured < r.large.measured, "RT60 grows with room size: " + JSON.stringify(r));
  for (const k of Object.keys(r)) { assert(Math.abs(r[k].measured / r[k].formula - 1) < 0.15, `${k} undamped RT60 within 15% of Eyring: ${JSON.stringify(r[k])}`); assert(r[k].damped < r[k].measured * 0.97, `${k} damping shortens the decay: ${JSON.stringify(r[k])}`); }
  assert(R.plate.len > R.plate.dryLen + 1, "plate adds a tail");
  // UI: drag the voice marker farther; readouts change; dry button; phone overflow
  const read = () => page.evaluate(() => ({ dist: document.getElementById("roDist").textContent, rev: document.getElementById("hdRev").textContent }));
  const before = await read();
  const r0 = await page.evaluate(() => window.__vr.ready());
  await page.fill("#dist", "12"); await page.dispatchEvent("#dist", "input"); await page.waitForFunction((b) => window.__vr.ready() > b, r0, { timeout: 120000 });
  const after = await read(); assert.notEqual(before.dist, after.dist, "distance readout moves: " + JSON.stringify([before, after]));
  await page.click("#play"); await page.waitForTimeout(600); await page.click("#stop");
  await page.screenshot({ path: path.join(shots, "shot-far.png"), fullPage: true });
  const ph = await (await browser.newContext({ viewport: { width: 400, height: 900 }, colorScheme: "light" })).newPage();
  await ph.goto(`http://127.0.0.1:${server.address().port}/`); await ph.waitForFunction(() => window.__vr && window.__vr.ready() >= 1, null, { timeout: 120000 });
  await ph.screenshot({ path: path.join(shots, "shot-phone.png"), fullPage: true });
  assert((await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "no horizontal overflow");
  assert.equal(errs.length, 0, errs.join("\n"));
  console.log("vocoder in a room browser tests ok; save button:", !!(await page.$("#dl")));
  await browser.close(); server.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
