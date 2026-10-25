/* voices.js: the voice engines for the Bailey and Charlie show.

   One interface for three engines (Kokoro, browser voices, captions only):
     engine.id, engine.label
     engine.prepare(lines, onProgress)   lines: [{dog, text}] in show order; instant for the simple engines
     engine.isReady(i), engine.whenReady(i)
     engine.canStart(lastIndex)          true when the show may begin (see the early start rule)
     engine.play(i)                      promise, resolves when line i has finished
     engine.level()                      mouth openness 0 to 1 while playing
     engine.progress()                   share of the current line spoken, 0 to 1
     engine.tick(dt)                     called by the player every frame while not paused
     engine.stop(), engine.pause(), engine.resume()
     engine.say(dog, text)               one-off sample (the Settings Try button)

   Classic script (no modules) so the page also opens from a plain folder; Kokoro runs in a Web Worker made
   from a Blob that imports vendor/kokoro.web.js, so the page never freezes while a line is being made.

   The environment (env) the player passes in: getCtx(), out(), settings(), baseUrl, force, version (the deploy's
   commit, so a new deploy loads a new vendor/kokoro.web.js), and optionally
   isPaused() (true while the show is paused), fallback() (a usable browser engine, else the captions engine),
   onDead(reason) (called once when Kokoro is declared dead) and note(text) (a one-line message on screen).

   vendor/kokoro.web.js is kokoro-js with hand edits; repeat them if it is ever re-vendored:
     1. KokoroTTS.from_pretrained (class Ef): both jg.from_pretrained and Hg.from_pretrained get
        revision:"1939ad2a8e416c0acfeecc08a694d14ef25f2231" so the model never changes under us.
     2. The voice loader (function yf): resolve/main/voices became resolve/<that revision>/voices; a cached
        voice that is not a whole number of 256-float rows (1024 bytes) is deleted and fetched again; it tries
        vendor/voices/<name>.bin (bm_fable and bm_george are vendored, from that revision) before Hugging Face;
        a failed or wrong-sized download throws instead of being cached.
   vendor/ort/ holds ort-wasm-simd-threaded.jsep.mjs and .wasm from @huggingface/transformers@3.5.1/dist, and
   the worker points the runtime there (env.wasmPaths) instead of cdn.jsdelivr.net. */
(function (root) {
'use strict';

/* ---- how to say names and titles (spoken text only; captions keep the spelling) ---- */
var PRONOUNCE = {
  'Auslan': 'Oz-lan',
  'Wangaratta': 'Wonga-ratta',
  'Mrs': 'Missus',
  'Ms': 'Miz',
  'Mr': 'Mister'
};
function speakable(text) {
  var out = String(text);
  Object.keys(PRONOUNCE).forEach(function (k) {
    out = out.replace(new RegExp('\\b' + k + '\\b' + (k.length <= 3 ? '\\.?' : ''), 'g'), PRONOUNCE[k]);
  });
  // emoji and symbols would be read aloud ("birthday cake"), so they go; keycaps (1 then U+20E3) go whole
  try {
    out = out.replace(/[0-9#*]?\uFE0F?\u20E3/g, '')
      .replace(/\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu, '');
  } catch (e) {}
  return out.replace(/\s&\s/g, ' and ').replace(/[ \t]+([.,!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/* ---- the defaults live here ---- */
var DEFAULTS = {
  Bailey:  {kokoro: 'bm_fable',  lift: 1.6,  speed: 1.05, pitch: 1.5},
  Charlie: {kokoro: 'bm_george', lift: 1.45, speed: 0.95, pitch: 1.3}
};
var LIFT_MAX = 1.7;
var MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
var KOKORO_VOICES = ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova',
  'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
  'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];

function kokoroLabel(id) {
  var m = /^([ab])([fm])_(.+)$/.exec(id);
  if (!m) return id;
  var name = m[3].charAt(0).toUpperCase() + m[3].slice(1);
  return name + ' (' + (m[1] === 'a' ? 'American' : 'British') + ', ' + (m[2] === 'f' ? 'female' : 'male') + ')';
}
/* the Younger slider is a Kokoro lift (1.0 to 1.7); browser pitch follows it from the dog's default */
function liftToPitch(dog, lift) {
  var d = DEFAULTS[dog], p = d.pitch + (lift - d.lift) * (0.8 / 0.35);
  return Math.max(0.5, Math.min(2, p));
}

/* split text into sentences with their character ranges */
function sentences(text) {
  var out = [], re = /[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g, m;
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push({s: m.index, e: m.index + m[0].length, t: m[0]});
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

/* a gentle talking mouth for engines that have no audio to measure */
function makeMouth() {
  var m = {ph: 0, kick: 0, t: 0, v: 0};
  m.tick = function (dt, speaking) {
    m.t += dt;
    if (!speaking) { m.v = 0; m.kick = 0; return; }
    var rate = 6 * (1 + 0.35 * Math.sin(m.t * 1.9) + 0.2 * Math.sin(m.t * 4.3));
    m.ph += dt * rate * Math.PI * 2;
    m.kick = Math.max(0, m.kick - dt * 8);
    var base = 0.5 + 0.5 * Math.sin(m.ph);
    m.v = Math.min(1, base * (0.65 + 0.25 * Math.sin(m.t * 2.7)) + m.kick * 0.35 + 0.05);
  };
  return m;
}

function envelopeOf(data, sr) {
  var step = Math.round(sr * 0.04), n = Math.max(1, Math.ceil(data.length / step)), env = new Float32Array(n), i, j;
  for (i = 0; i < n; i++) {
    var a = i * step, b = Math.min(data.length, a + step), s = 0;
    for (j = a; j < b; j++) s += data[j] * data[j];
    env[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  var sorted = Array.prototype.slice.call(env).sort(function (x, y) { return x - y; });
  var ref = (sorted[Math.floor(n * 0.9)] || 0.001) * 1.3;
  for (i = 0; i < n; i++) env[i] = Math.min(1, env[i] / ref);
  return env;
}
function trimSilence(data, sr) {
  var lo = 0, hi = data.length - 1, th = 0.008;
  while (lo < hi && Math.abs(data[lo]) < th) lo++;
  while (hi > lo && Math.abs(data[hi]) < th) hi--;
  lo = Math.max(0, lo - Math.round(sr * 0.04));
  hi = Math.min(data.length, hi + Math.round(sr * 0.1));
  return hi - lo > sr * 0.05 ? data.subarray(lo, hi) : data;
}

/* a shared piece for engines that need no generation */
/* generated Kokoro audio kept in IndexedDB (about 300 lines, oldest out), so a reload plays at once.
   Every call is wrapped: if the store is unavailable the player simply generates as before.
   Opening and reading give up after 1.5 s (a stuck store must not hold the show); after a failed open, or two
   slow reads, the store is left alone for the rest of the session. */
function within(p, ms) {
  return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(null); }, ms); })]);
}
var AudioStore = {
  max: 300, db: null, opening: null, off: false, slow: 0,
  open: function () {
    var self = this;
    if (self.db) return Promise.resolve(self.db);
    if (self.off) return Promise.resolve(null);
    if (self.opening) return self.opening;
    self.opening = within(new Promise(function (res) {
      try {
        var rq = indexedDB.open('ms-audio', 1);
        rq.onupgradeneeded = function () {
          var s = rq.result.createObjectStore('a', {keyPath: 'k'});
          s.createIndex('ts', 'ts');
        };
        rq.onsuccess = function () { if (self.off) { try { rq.result.close(); } catch (e) {} return res(null); } self.db = rq.result; res(self.db); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    }), 1500).then(function (db) {
      if (!db) self.off = true;
      self.opening = null;
      return db;
    });
    return self.opening;
  },
  get: function (key) {
    var self = this;
    return this.open().then(function (db) {
      if (!db) return null;
      var answered = false;
      return within(new Promise(function (res) {
        try {
          var rq = db.transaction('a', 'readonly').objectStore('a').get(key);
          rq.onsuccess = function () { answered = true; res(rq.result || null); };
          rq.onerror = function () { answered = true; res(null); };
        } catch (e) { answered = true; res(null); }
      }), 1500).then(function (v) {
        if (!answered && ++self.slow >= 2) { self.off = true; self.db = null; }
        return v || null;
      });
    }).catch(function () { return null; });
  },
  put: function (key, pcm, sr) {
    var self = this;
    if (self.off) return Promise.resolve();
    return this.open().then(function (db) {
      if (!db) return;
      return new Promise(function (res) {
        try {
          var i16 = new Int16Array(pcm.length), i;
          for (i = 0; i < pcm.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
          var tx = db.transaction('a', 'readwrite'), os = tx.objectStore('a');
          os.put({k: key, a: i16, sr: sr, ts: Date.now()});
          var cnt = os.count();
          cnt.onsuccess = function () {
            var extra = cnt.result - self.max;
            if (extra > 0) {
              var cur = os.index('ts').openCursor();
              cur.onsuccess = function () {
                var c = cur.result;
                if (c && extra > 0) { c.delete(); extra--; c.continue(); }
              };
            }
          };
          tx.oncomplete = function () { res(); };
          tx.onerror = function () { res(); };
          tx.onabort = function () { res(); };
        } catch (e) { res(); }
      });
    }).catch(function () {});
  }
};

function instantEngine(E) {
  E.isReady = function () { return true; };
  E.whenReady = function () { return Promise.resolve(); };
  E.canStart = function () { return true; };
  E.pause = function () {};
  E.resume = function () {};
}

/* ================= Kokoro ================= */

/* runs inside the worker (or, as a last resort, on the page): it is turned into text, so it must stand alone */
function kokoroWorkerBody(scope, load) {
  var tts = null;
  // the speech runtime prints harmless graphics-placement warnings as errors; keep the console clean
  ['error', 'warn'].forEach(function (k) {
    var orig = console[k];
    console[k] = function () { if (/onnxruntime/i.test(String(arguments[0]))) return; return orig.apply(console, arguments); };
  });
  function slim(p) { return {status: p.status, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress}; }
  scope.onmessage = async function (ev) {
    var m = ev.data;
    try {
      if (m.op === 'init') {
        var mod = await load(m.url);
        // the speech runtime comes from vendor/ort/ next to the bundle, not from a CDN
        try { if (mod.env) mod.env.wasmPaths = new URL('ort/', m.url).href; } catch (e) {}
        tts = await mod.KokoroTTS.from_pretrained(m.model, {
          dtype: m.dtype, device: m.device,
          progress_callback: function (p) { try { scope.postMessage({type: 'progress', data: slim(p)}); } catch (e) {} }
        });
        scope.postMessage({type: 'done', id: m.id, voices: Object.keys(tts.voices)});
      } else if (m.op === 'gen') {
        var out = await tts.generate(m.text, {voice: m.voice, speed: m.speed});
        scope.postMessage({type: 'done', id: m.id, audio: out.audio, sr: out.sampling_rate}, [out.audio.buffer]);
      }
    } catch (e) {
      scope.postMessage({type: 'error', id: m.id, message: String(e && e.message || e)});
    }
  };
}

function makeKokoro(env) {
  /* env: see the top of this file */
  var E = {id: 'kokoro', label: 'Kokoro', backend: '', voices: KOKORO_VOICES.slice(), loaded: false, loadMs: 0, dead: false,
    loadInfo: {fraction: 0, mb: 0, startedAt: 0, downloading: false}};
  var host = null, nextId = 1, pending = {}, onProg = null, lastProg = 0, files = {}, topFrac = 0;
  var cache = {}, st = null, cur = null, cancelLoad = false, mouth = makeMouth();
  // one line is made at a time: Try requests go to the front of the queue, the show's lines to the back
  var genQueue = [], genBusy = false, inflight = {}, queued = {}, sayKeys = [], deadNoted = false;

  function failAll(err) {
    Object.keys(pending).forEach(function (k) { var p = pending[k]; delete pending[k]; p.rej(err); });
  }
  function onMsg(m) {
    if (m.type === 'progress') {
      lastProg = Date.now();
      var d = m.data;
      if (d && d.file && d.total) files[d.file] = {loaded: d.loaded || 0, total: d.total};
      // reading the model back from the browser's cache also reports progress, but it is over in a second or two
      if (d && d.total > 20971520 && (d.loaded || 0) < d.total && Date.now() - E.loadInfo.startedAt > 3000) E.loadInfo.downloading = true;
      var l = 0, t = 0;
      Object.keys(files).forEach(function (k) { l += files[k].loaded; t += files[k].total; });
      if (t > 20971520) { topFrac = Math.max(topFrac, l / t); E.loadInfo.fraction = topFrac; E.loadInfo.mb = t / 1048576; }
      if (onProg && t > 20971520) onProg({fraction: topFrac, mb: t / 1048576});
      return;
    }
    var p = pending[m.id];
    if (!p) return;
    delete pending[m.id];
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  }
  function call(op, payload) {
    return new Promise(function (res, rej) {
      if (!host) return rej(new Error('Kokoro is not running'));
      var id = nextId++;
      pending[id] = {res: res, rej: rej};
      var msg = {op: op, id: id};
      Object.keys(payload || {}).forEach(function (k) { msg[k] = payload[k]; });
      try { host.send(msg); } catch (e) { delete pending[id]; rej(e); }
    });
  }
  function startHost(kind) {
    var h = {kind: kind};
    if (kind === 'worker') {
      var src = 'const __load=function(u){return import(u)};(' + kokoroWorkerBody.toString() + ')(self,__load);';
      var url = URL.createObjectURL(new Blob([src], {type: 'text/javascript'}));
      var w = new Worker(url, {type: 'module'});
      w.onmessage = function (ev) { onMsg(ev.data); };
      w.onerror = function (ev) { failAll(new Error('worker: ' + (ev && ev.message || 'could not start'))); };
      h.send = function (m) { w.postMessage(m); };
      h.kill = function () { try { w.terminate(); } catch (e) {} try { URL.revokeObjectURL(url); } catch (e2) {} };
    } else {
      var scope = {onmessage: null, postMessage: function (m) { setTimeout(function () { onMsg(m); }, 0); }};
      kokoroWorkerBody(scope, function (u) { return import(u); });
      h.send = function (m) { setTimeout(function () { scope.onmessage({data: m}); }, 0); };
      h.kill = function () {};
    }
    return h;
  }
  /* stop the worker; every call still waiting is rejected (a hung graphics queue does not recover) */
  function killHost(err) {
    var h = host;
    host = null;
    if (h && h.kill) h.kill();
    failAll(err || new Error('Kokoro stopped'));
  }
  /* reject if nothing moves for 60 s; a slow download is fine for as long as it keeps moving */
  function guard(p) {
    return new Promise(function (res, rej) {
      var iv = setInterval(function () {
        if (cancelLoad) { clearInterval(iv); var c = new Error('cancelled'); c.cancelled = true; rej(c); }
        else if (Date.now() - lastProg > 60000) {
          clearInterval(iv); var e = new Error('Kokoro took too long to load'); e.stalled = true; rej(e);
        }
      }, 1000);
      p.then(function (v) { clearInterval(iv); res(v); }, function (e) { clearInterval(iv); rej(e); });
    });
  }

  E.cancelLoad = function () { cancelLoad = true; };
  E.load = function (onProgress, opts) {
    onProg = onProgress || null;
    opts = opts || {};
    if (E.loadPromise) return E.loadPromise;
    cancelLoad = false;
    E.loadInfo = {fraction: 0, mb: 0, startedAt: Date.now(), downloading: false};
    E.loadPromise = (async function () {
      var t0 = performance.now(), attempts = [], gpu = false, lastErr = null;
      try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
      if (env.force === 'wasm') gpu = false;
      if (gpu) attempts.push({kind: 'worker', device: 'webgpu', dtype: 'fp32'});
      if (opts.webgpuOnly) {
        // Auto mode: graphics-card voices or none. The caller then uses the browser's own voices.
        if (!attempts.length) { E.loadPromise = null; var ne = new Error('no WebGPU'); ne.noGpu = true; throw ne; }
      } else {
        attempts.push({kind: 'worker', device: 'wasm', dtype: 'q8'});
        attempts.push({kind: 'main', device: 'wasm', dtype: 'q8'});
      }
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        try {
          lastProg = Date.now(); files = {}; topFrac = 0; E.loadInfo.fraction = 0;
          host = startHost(a.kind);
          var res = await guard(call('init', {url: new URL('vendor/kokoro.web.js' + (env.version ? '?v=' + encodeURIComponent(env.version) : ''), env.baseUrl || document.baseURI).href, model: MODEL, device: a.device, dtype: a.dtype}));
          E.backend = a.device; E.host = a.kind; E.voices = res.voices; E.loaded = true; E.dead = false; deadNoted = false;
          E.loadMs = Math.round(performance.now() - t0);
          // ask the browser to keep the 300 MB download when the disk gets full
          try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e2) {}
          return E;
        } catch (e) {
          lastErr = e;
          killHost(e);
          if (e.stalled || e.cancelled) break;
        }
      }
      E.loadPromise = null;
      throw lastErr || new Error('Kokoro could not load');
    })();
    return E.loadPromise;
  };

  E.describe = function () { return E.backend === 'webgpu' ? 'Kokoro (fast graphics)' : 'Kokoro (standard)'; };

  function cfgFor(dog) {
    var c = env.settings()[dog] || {}, d = DEFAULTS[dog] || DEFAULTS.Bailey;
    var want = c.kokoro || c.voice;
    var voice = want && E.voices.indexOf(want) >= 0 ? want : d.kokoro;
    return {voice: voice, lift: Math.max(1, Math.min(LIFT_MAX, +c.lift || d.lift)), base: d.speed};
  }
  function keyFor(dog, rawText) {
    var text = speakable(rawText), c = cfgFor(dog), speed = c.base / c.lift;
    return {text: text, c: c, speed: speed, key: c.voice + '|' + c.lift + '|' + speed.toFixed(3) + '|' + text};
  }
  function makeItem(data, sr, c, genSec) {
    var buf = new AudioBuffer({length: data.length, sampleRate: sr, numberOfChannels: 1});
    buf.copyToChannel(data, 0);
    return {buf: buf, env: envelopeOf(data, sr), lift: c.lift, dur: data.length / sr / c.lift, genSec: genSec};
  }
  /* a broken graphics driver can hand back silence or NaN; such a line counts as failed and is never kept */
  function checkAudio(data) {
    var peak = 0, i, v;
    for (i = 0; i < data.length; i++) {
      v = data[i];
      if (v !== v) throw new Error('silent audio');
      if (v < 0) v = -v;
      if (v > peak) peak = v;
    }
    if (peak < 0.01) throw new Error('silent audio');
  }
  /* one generate, given up after about 8 times the line's reading time (at least 20 s). The processor-only
     engine never hangs the way a graphics queue can, but on a slow laptop it can take longer than the line
     lasts, so it gets three times as long. */
  function timedGen(payload) {
    var ms = Math.max(20000, 8000 * payload.text.length / 14) * (E.backend === 'webgpu' ? 1 : 3);
    return new Promise(function (res, rej) {
      var over = false, tm = setTimeout(function () {
        over = true;
        var err = new Error('Kokoro took too long to make a line');
        err.timeout = true;
        killHost(err);
        rej(err);
      }, ms);
      call('gen', payload).then(function (r) { if (over) return; clearTimeout(tm); res(r); },
        function (e) { if (over) return; clearTimeout(tm); rej(e); });
    });
  }
  function runJob(job) {
    var k = job.k, t0 = performance.now();
    return timedGen({text: k.text, voice: k.c.voice, speed: k.speed}).then(function (r) {
      var data = trimSilence(r.audio, r.sr);
      checkAudio(data);
      var item = makeItem(data, r.sr, k.c, (performance.now() - t0) / 1000);
      cache[k.key] = item;
      AudioStore.put(k.key, data, r.sr);
      return {item: item, fresh: true};
    });
  }
  function pump() {
    if (genBusy || !genQueue.length) return;
    var job = genQueue.shift();
    delete queued[job.k.key];
    genBusy = true;
    runJob(job).then(job.res, function (e) {
      if (e && e.timeout) declareDead(e.message, e);
      job.rej(e);
    }).then(function () { genBusy = false; pump(); });
  }
  function enqueue(k, front) {
    return new Promise(function (res, rej) {
      var job = {k: k, res: res, rej: rej};
      queued[k.key] = job;
      if (front) genQueue.unshift(job); else genQueue.push(job);
      pump();
    });
  }
  function dropQueue(err) {
    genQueue.splice(0).forEach(function (job) { delete queued[job.k.key]; job.rej(err); });
  }
  function gen(dog, rawText, front) {
    var k = keyFor(dog, rawText), key = k.key;
    if (cache[key]) return Promise.resolve({item: cache[key], fresh: false});
    if (inflight[key]) {
      var q = queued[key], at = q ? genQueue.indexOf(q) : -1;
      if (front && at > 0) { genQueue.splice(at, 1); genQueue.unshift(q); }
      return inflight[key];
    }
    var p = AudioStore.get(key).then(function (hit) {
      if (hit && hit.a && hit.a.length) {
        try {
          var f = new Float32Array(hit.a.length), i;
          for (i = 0; i < f.length; i++) f[i] = hit.a[i] / 32767;
          var item = cache[key] = makeItem(f, hit.sr, k.c, 0);
          return {item: item, fresh: false, stored: true};
        } catch (e) { /* a damaged stored line: make it again */ }
      }
      if (E.dead) throw new Error('Kokoro stopped working');
      return enqueue(k, front);
    });
    inflight[key] = p;
    var done = function () { if (inflight[key] === p) delete inflight[key]; };
    p.then(done, done);
    return p;
  }

  /* every line still waiting counts as failed and is marked ready, so nothing waits on a dead engine */
  function finishDead(s) {
    s.dead = true;
    if (!s.firstError) s.firstError = 'Kokoro stopped working';
    for (var j = 0; j < s.total; j++) if (!s.ready[j]) { s.failed++; s.mark(j); }
  }
  function declareDead(reason, err) {
    if (E.dead) return;
    E.dead = true; E.loaded = false; E.loadPromise = null;
    var e = err || new Error(String(reason || 'Kokoro stopped working'));
    killHost(e);
    dropQueue(e);
    var s = st && !st.cancelled ? st : null;
    if (s) { s.dead = true; if (!s.firstError) s.firstError = String(reason || e.message); }
    if (!deadNoted) {
      deadNoted = true;
      if (env.onDead) { try { env.onDead(s ? s.firstError : String(reason || e.message)); } catch (x) {} }
    }
    if (s) finishDead(s);
  }

  /* generate every line in show order in the background */
  E.prepare = function (lines, onProgress) {
    if (st) st.cancelled = true;
    // the memory cache keeps only this show's lines and the last few samples
    var keep = {};
    lines.forEach(function (l) { keep[keyFor(l.dog, l.text).key] = true; });
    sayKeys.forEach(function (k) { keep[k] = true; });
    Object.keys(cache).forEach(function (k) { if (!keep[k]) delete cache[k]; });
    var s = st = {lines: lines, items: new Array(lines.length), ready: lines.map(function () { return false; }), waiters: {},
      done: 0, total: lines.length, genSec: 0, playSec: 0, cancelled: false, failed: 0, firstError: '', consecutive: 0, dead: false};
    s.mark = function (i) {
      if (s.ready[i]) return;
      s.ready[i] = true; s.done++;
      var w = s.waiters[i]; if (w) { delete s.waiters[i]; w.forEach(function (f) { f(); }); }
      if (onProgress) { try { onProgress(s); } catch (e) {} }
    };
    s.promise = (async function () {
      await null;
      if (E.dead) { finishDead(s); return; }
      for (var i = 0; i < lines.length; i++) {
        if (s.cancelled || s.dead) return;
        if (s.ready[i]) continue;
        var r = null, err = null;
        try { r = await gen(lines[i].dog, lines[i].text, false); } catch (e) { err = e || new Error('failed'); }
        if (s.cancelled || s.dead) return;
        if (r) {
          s.items[i] = r.item; s.consecutive = 0;
          if (r.fresh) { s.genSec += r.item.genSec; s.playSec += r.item.dur; }
        } else {
          s.failed++; s.consecutive++;
          if (!s.firstError) s.firstError = String(err && err.message || err);
        }
        s.mark(i);
        if (err && (s.consecutive >= 2 || err.timeout)) { declareDead(s.firstError, err); return; }
      }
      s.finishedAt = performance.now();
    })();
    return s;
  };
  E.isReady = function (i) { return !!(st && st.ready[i]); };
  E.whenReady = function (i) {
    if (!st || E.isReady(i)) return Promise.resolve();
    return new Promise(function (res) { (st.waiters[i] = st.waiters[i] || []).push(res); });
  };
  E.speedRatio = function () { return st && st.genSec > 0 ? st.playSec / st.genSec : 0; };
  /* the early start rule: the opening segments are made AND we are making audio at least 1.3 times faster than it plays.
     Never true for a dead engine or a show where every line so far has failed. */
  E.canStart = function (lastIndex) {
    if (!st || st.dead || E.dead) return false;
    if (st.done > 0 && st.failed === st.done) return false;
    if (st.done >= st.total) return true;
    for (var i = 0; i <= lastIndex; i++) if (!st.ready[i]) return false;
    return E.speedRatio() >= 1.3;
  };
  E.stats = function () { return st; };
  E.cacheSize = function () { return Object.keys(cache).length; }; // for checks

  function isPaused() { try { return !!(env.isPaused && env.isPaused()); } catch (e) { return false; } }
  function silentRun(dur) { cur = {silent: true, t: 0, dur: dur, res: null}; return new Promise(function (res) { cur.res = res; }); }
  /* play one made line. While the show is paused it waits (without waking the sound) and starts from the top on Play. */
  function playItem(item) {
    if (cur) E.stop(); // a new line or sample never plays over an old one, and the old one's promise settles
    var gate = cur = {waiting: true, res: null};
    return new Promise(function (res) {
      gate.res = res;
      function asSilent() { cur = null; silentRun(Math.max(1, item.dur)).then(res); }
      function go() {
        if (cur !== gate) return res();
        if (isPaused()) { setTimeout(go, 100); return; }
        var ctx = env.getCtx();
        if (!ctx) return asSilent();
        var ready = ctx.state === 'running' ? Promise.resolve() : Promise.race([
          Promise.resolve().then(function () { return ctx.resume(); }).catch(function () {}),
          new Promise(function (r) { setTimeout(r, 800); })]);
        ready.then(function () {
          if (cur !== gate) return res();
          if (isPaused()) return go();
          if (ctx.state !== 'running') return asSilent();
          try {
            var src = ctx.createBufferSource();
            src.buffer = item.buf; src.playbackRate.value = item.lift;
            src.connect(env.out());
            var c = cur = {item: item, ctx: ctx, startT: ctx.currentTime, src: src, res: res, silent: false};
            src.onended = function () { if (cur === c) cur = null; res(); };
            src.start();
          } catch (e) { asSilent(); }
        });
      }
      go();
    });
  }
  E.play = function (i) {
    var item = st && st.items[i], line = (st && st.lines[i]) || {dog: 'Bailey', text: ''};
    if (item) return playItem(item);
    // this line could not be made: the browser's own voice says it, else it runs at reading pace with captions
    if (cur) E.stop();
    var fb = null;
    try { fb = env.fallback ? env.fallback() : null; } catch (e) { fb = null; }
    if (fb && fb !== E && fb.id !== 'captions' && fb.say) {
      var c = cur = {fb: fb};
      var clear = function () { if (cur === c) cur = null; };
      return Promise.resolve(fb.say(line.dog, line.text)).then(clear, clear);
    }
    return silentRun(Math.max(2.5, String(line.text).length / 14));
  };
  E.level = function () {
    if (!cur || cur.waiting) return 0;
    if (cur.fb) return cur.fb.level ? cur.fb.level() : 0;
    if (cur.silent) return mouth.v;
    var t = (cur.ctx.currentTime - cur.startT) * cur.item.lift, idx = Math.floor(t / 0.04), e = cur.item.env;
    if (idx < 0 || idx >= e.length) return 0;
    return Math.max(e[idx], idx + 1 < e.length ? e[idx + 1] * 0.8 : 0);
  };
  E.progress = function () {
    if (!cur || cur.waiting) return 0;
    if (cur.fb) return cur.fb.progress ? cur.fb.progress() : 0;
    if (cur.silent) return Math.min(1, cur.t / cur.dur);
    var t = (cur.ctx.currentTime - cur.startT) * cur.item.lift;
    return Math.max(0, Math.min(1, t / cur.item.buf.duration));
  };
  E.tick = function (dt) {
    // a fallback line needs nothing here: the player's frame loop already ticks the browser engine
    if (cur && cur.silent) {
      cur.t += dt; mouth.tick(dt, true);
      if (cur.t >= cur.dur) { var c = cur; cur = null; c.res(); }
    }
  };
  E.stop = function () {
    if (!cur) return;
    var c = cur; cur = null;
    if (c.fb) { try { c.fb.stop(); } catch (e) {} }
    else if (c.src) { try { c.src.stop(); } catch (e2) {} }
    if (c.res) c.res();
  };
  E.pause = function () { if (cur && cur.fb && cur.fb.pause) cur.fb.pause(); };
  E.resume = function () { if (cur && cur.fb && cur.fb.resume) cur.fb.resume(); };
  E.say = function (dog, text) {
    var key = keyFor(dog, text).key;
    sayKeys = sayKeys.filter(function (x) { return x !== key; });
    sayKeys.push(key);
    if (sayKeys.length > 10) sayKeys.shift();
    return gen(dog, text, true).then(function (r) { return playItem(r.item); });
  };
  return E;
}

/* ================= Browser voices ================= */

function makeBrowser(env) {
  var E = {id: 'browser', label: 'Browser voices'};
  var synth = root.speechSynthesis || null, voices = [], cur = null, lines = [], mouth = makeMouth();
  // for this session: voices that failed, the two voices chosen for the show, and how many lines in a row went silent
  var bad = {}, chosen = null, silentStreak = 0, allSilent = false, noted = false;
  instantEngine(E);
  function refresh() { try { voices = synth ? (synth.getVoices() || []) : []; } catch (e) { voices = []; } }
  if (synth) {
    refresh();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh); else synth.onvoiceschanged = refresh;
  }
  function tier(v) {
    var lang = String(v.lang || '').replace('_', '-').toLowerCase(), nat = /natural|online/i.test(v.name);
    if (lang === 'en-au') return nat ? 0 : 1;
    if (lang === 'en-gb') return nat ? 2 : 3;
    if (lang.indexOf('en') === 0) return nat ? 4 : 5;
    return 9;
  }
  /* within a tier: Natural voices first (they sound best), then voices on this computer, then network voices
     (which fail when the school network blocks them); men's voices first, as both dogs are boys */
  function cls(v) { return /natural/i.test(v.name) ? 0 : v.localService === true ? 1 : 2; }
  var MALE = /\b(William|James|Darren|Duncan|Neil|Ken|George|Ryan|Thomas|Daniel|Lee|David|Mark|Male)\b/i;
  function male(v) { return MALE.test(v.name) ? 0 : 1; }
  E.list = function () {
    refresh();
    return voices.filter(function (v) { return tier(v) < 9; }).sort(function (a, b) {
      return tier(a) - tier(b) || cls(a) - cls(b) || male(a) - male(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  };
  E.available = function () { return !!synth && E.list().length > 0; };
  E.waitForVoices = function (ms) {
    return new Promise(function (res) {
      if (!synth) return res(false);
      var t0 = Date.now();
      (function poll() {
        if (E.list().length) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(poll, 150);
      })();
    });
  };
  function byName(n) { for (var i = 0; i < voices.length; i++) if (voices[i].name === n) return voices[i]; return null; }
  function usable(v) { return !!v && !bad[v.name]; }
  function picked(dog) { var set = env.settings() || {}; return set[dog] && set[dog].browser ? byName(set[dog].browser) : null; }
  /* null means no voice is left that works: the line then runs at reading pace with captions */
  E.pick = function (dog) {
    var all = E.list().filter(usable), mine = picked(dog);
    if (usable(mine)) return mine;
    if (!all.length) return null;
    var theirs = picked(dog === 'Bailey' ? 'Charlie' : 'Bailey');
    var pool = all.filter(function (v) { return v !== theirs; });
    if (!pool.length) pool = all;
    return dog === 'Bailey' ? pool[0] : (pool[1] || pool[0]);
  };
  /* the next voice after a failure, different from the other dog's if possible */
  function rePick(dog) {
    var mine = picked(dog);
    if (usable(mine)) return mine;
    var o = chosen && chosen[dog === 'Bailey' ? 'Charlie' : 'Bailey'], pool = E.list().filter(usable);
    return pool.filter(function (v) { return v !== o; })[0] || pool[0] || null;
  }
  function voiceFor(dog) {
    if (!chosen) return E.pick(dog);
    if (!usable(chosen[dog])) chosen[dog] = chosen[dog] ? rePick(dog) : E.pick(dog);
    return chosen[dog];
  }
  E.describe = function () { return "this computer's voices"; };
  E.prepare = function (ls, onProgress) {
    lines = ls;
    // each dog keeps one voice for the whole show, even if the voice list changes part way through
    chosen = {Bailey: E.pick('Bailey'), Charlie: E.pick('Charlie')};
    var s = {done: ls.length, total: ls.length};
    if (onProgress) onProgress(s);
    return s;
  };

  /* reading pace with captions for the rest of the line (from character 'from') */
  function goSilent(c, from) {
    if (c.finished) return;
    c.silent = true; c.est = Math.max(2.5, (c.len - (from || 0)) / 14); c.waited = 0;
  }
  function speak(dog, text, c) {
    var ss = sentences(text), idx = 0, set = env.settings() || {}, lift = Math.max(1, +(set[dog] && set[dog].lift) || DEFAULTS[dog].lift);
    var v = voiceFor(dog), pitch = liftToPitch(dog, lift);
    c.dog = dog;
    if (allSilent || !v) return goSilent(c, 0);
    function use(nv) {
      v = nv; c.voice = nv; c.startLimit = nv.localService === false ? 4 : 1.5;
      if (chosen) chosen[dog] = nv;
    }
    use(v);
    function next() {
      if (c.finished || c.silent) return;
      if (idx >= ss.length) return c.finish();
      var s = ss[idx++], u = new root.SpeechSynthesisUtterance(s.t.trim());
      u.voice = v; u.lang = v.lang || 'en-AU';
      u.pitch = pitch; u.rate = 1.0;
      u.onstart = function () { if (c.utt === u) c.started = true; };
      u.onboundary = function (ev) { if (c.utt !== u) return; c.started = true; c.boundarySeen = true; c.bp = Math.min(1, (s.s + (ev.charIndex || 0)) / Math.max(1, text.length)); mouth.kick = 1; };
      u.onend = function () { if (c.utt !== u) return; c.bp = Math.max(c.bp, s.e / Math.max(1, text.length)); next(); };
      u.onerror = function (ev) { if (c.utt !== u) return; if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return; failed(s); };
      c.utt = u;
      try { synth.speak(u); } catch (e) { failed(s); }
    }
    /* a voice that fails before it has said anything is dropped and the next one tries the same sentence */
    function failed(s) {
      if (c.finished || c.silent) return;
      c.utt = null;
      if (!c.started) {
        bad[v.name] = true;
        var nv = rePick(dog);
        if (nv) { use(nv); c.waited = 0; idx--; next(); return; }
      }
      goSilent(c, s.s);
    }
    c.respeak = function (nv) { use(nv); c.utt = null; idx = 0; next(); };
    next();
  }
  function run(dog, rawText) {
    var text = speakable(rawText);
    if (cur && !cur.finished) { cur.stopped = true; cur.finish(); }
    return new Promise(function (res) {
      var c = cur = {text: text, len: text.length, bp: 0, boundarySeen: false, started: false, waited: 0, lastP: 0, finished: false,
        est: Math.max(2, text.length / 14), limit: text.length / 8 + 3, silent: false, utt: null, startLimit: 1.5, retried: false};
      c.finish = function () {
        if (c.finished) return;
        c.finished = true;
        c.utt = null;
        if (cur === c) cur = null;
        if (!c.stopped) {
          if (c.silent) {
            // two silent lines in a row: stop trying for this session and say so once
            if (++silentStreak >= 2 && !allSilent) {
              allSilent = true;
              if (!noted) { noted = true; if (env.note) { try { env.note("This computer's voices aren't working, so it's captions today."); } catch (e) {} } }
            }
          } else if (c.started) silentStreak = 0;
        }
        res();
      };
      if (!synth || !E.available()) { goSilent(c, 0); return; }
      try { if (synth.speaking || synth.pending) synth.cancel(); } catch (e) {}
      speak(dog, text, c);
    });
  }
  E.play = function (i) { return run(lines[i].dog, lines[i].text); };
  E.say = function (dog, text) { return run(dog, text); };
  E.tick = function (dt) {
    if (!cur) { mouth.tick(dt, false); return; }
    var c = cur;
    c.waited += dt;
    mouth.tick(dt, true);
    // a voice that never starts (4 s for a network voice, 1.5 s for one on this computer): one more voice, then silent
    if (!c.silent && !c.started && c.waited > c.startLimit) {
      try { synth.cancel(); } catch (e) {}
      if (c.voice) bad[c.voice.name] = true;
      var nv = !c.retried && c.dog && c.respeak ? rePick(c.dog) : null;
      if (nv) { c.retried = true; c.waited = 0; c.respeak(nv); }
      else goSilent(c, 0);
    }
    if (c.finished) return;
    if (c.silent) { if (c.waited >= c.est) c.finish(); return; }
    if (c.waited > c.limit) { try { synth.cancel(); } catch (e2) {} c.finish(); }
  };
  E.level = function () { return cur ? mouth.v : 0; };
  E.debug = function () { return cur ? {started: cur.started, silent: cur.silent, boundary: cur.boundarySeen, waited: cur.waited, bp: cur.bp, voice: cur.voice && cur.voice.name} : {bad: Object.keys(bad), allSilent: allSilent}; };
  E.progress = function () {
    if (!cur) return 0;
    var p = cur.silent ? cur.waited / cur.est : (cur.boundarySeen ? cur.bp : Math.min(0.95, cur.waited / cur.est));
    cur.lastP = Math.max(cur.lastP, Math.min(1, p));
    return cur.lastP;
  };
  E.stop = function () {
    var c = cur;
    if (synth) { try { synth.cancel(); } catch (e) {} }
    if (c) { c.stopped = true; c.finish(); }
  };
  E.pause = function () { if (synth) try { synth.pause(); } catch (e) {} };
  E.resume = function () { if (synth) try { synth.resume(); } catch (e) {} };
  return E;
}

/* ================= Captions only ================= */

function makeCaptions(env) {
  var E = {id: 'captions', label: 'Captions only'}, lines = [], cur = null, mouth = makeMouth(), mult = (env && env.speed) || 1;
  instantEngine(E);
  E.describe = function () { return 'Captions only'; };
  E.prepare = function (ls, onProgress) { lines = ls; var s = {done: ls.length, total: ls.length}; if (onProgress) onProgress(s); return s; };
  function run(text) {
    return new Promise(function (res) { cur = {t: 0, dur: Math.max(2.5, text.length / 14), res: res}; });
  }
  E.play = function (i) { return run(lines[i].text); };
  E.say = function () { return new Promise(function (r) { setTimeout(r, 900); }); };
  E.tick = function (dt) {
    if (!cur) { mouth.tick(dt, false); return; }
    cur.t += dt * mult;
    mouth.tick(dt * mult, true);
    if (cur.t >= cur.dur) { var c = cur; cur = null; c.res(); }
  };
  E.level = function () { return cur ? mouth.v : 0; };
  E.progress = function () { return cur ? Math.min(1, cur.t / cur.dur) : 0; };
  E.stop = function () { if (cur) { var c = cur; cur = null; c.res(); } };
  return E;
}

root.Voices = {
  PRONOUNCE: PRONOUNCE, speakable: speakable, AudioStore: AudioStore, DEFAULTS: DEFAULTS, LIFT_MAX: LIFT_MAX, MODEL: MODEL, KOKORO_VOICES: KOKORO_VOICES, kokoroLabel: kokoroLabel, liftToPitch: liftToPitch,
  sentences: sentences, makeKokoro: makeKokoro, makeBrowser: makeBrowser, makeCaptions: makeCaptions
};
})(window);
