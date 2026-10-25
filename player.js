/* The Bailey and Charlie Show: the player. Plain JavaScript, no build step, no framework.
   Order of this file: helpers, dates and words, the script parser, the weather, building the show, music,
   the desk and the dogs' faces, the scenes, the runner, the voices (choosing and preparing), the screens. */
(function () {
'use strict';

/* ================= helpers ================= */
var $ = function (id) { return document.getElementById(id); };
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
var store = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};
var P = new URLSearchParams(location.search);
var FAST = P.has('fast');

/* ================= the run log ================= */
/* What happens on each morning is noted in localStorage "ms.log", so Rose can see what went wrong. An entry is
   {t: time in ms, e: kind, m: what happened, x: a long text (a pasted reply), n: how long that text really was}.
   Entries are queued and written a moment later; every storage access is guarded. The log can fail, the show cannot. */
var LOG_KEY = 'ms.log', LOG_DAYS = 30, LOG_CAP = 1000000, LOG_TEXT_MAX = 20000, REPORT_DAYS = 7;
var logQueue = [], logTimer = 0, errCount = {}, errKinds = 0, lastScreenMsg = '';
function logRead() { var v = store.get(LOG_KEY, []); return Array.isArray(v) ? v : []; }
/* oldest first; nothing older than 30 days; about 1 MB at most, the oldest days going first */
function logPrune(list, now) {
  var oldest = now - LOG_DAYS * 864e5, day = function (x) { return Math.floor(x.t / 864e5); };
  list = list.filter(function (x) { return x && typeof x === 'object' && isFinite(x.t) && x.t >= oldest && typeof x.e === 'string'; });
  list.sort(function (a, b) { return a.t - b.t; });
  if (!list.length || JSON.stringify(list).length <= LOG_CAP) return list;
  var sizes = list.map(function (x) { return JSON.stringify(x).length + 1; }), total = sizes.reduce(function (a, b) { return a + b; }, 2), start = 0, last = day(list[list.length - 1]);
  while (total > LOG_CAP && start < list.length && day(list[start]) !== last) {
    var d = day(list[start]);
    while (start < list.length && day(list[start]) === d) total -= sizes[start++];
  }
  while (total > LOG_CAP && start < list.length - 1) total -= sizes[start++];   // one day is still too much: its oldest entries go
  return list.slice(start);
}
function logFlush() {
  clearTimeout(logTimer); logTimer = 0;
  if (!logQueue.length) return;
  try {
    var list = logPrune(logRead().concat(logQueue), Date.now());
    if (store.set(LOG_KEY, list) || store.set(LOG_KEY, list.slice(Math.floor(list.length / 2)))) logQueue = [];
    else if (logQueue.length > 500) logQueue = logQueue.slice(-500);   // nowhere to keep it: the latest stay in memory for the report
  } catch (e) {}
}
function log(kind, msg, text, at) {
  try {
    var x = {t: at || Date.now(), e: kind, m: String(msg == null ? '' : msg).slice(0, 2000)};
    if (text != null) { text = String(text); x.n = text.length; x.x = text.length > LOG_TEXT_MAX ? text.slice(0, LOG_TEXT_MAX) : text; }
    logQueue.push(x);
    if (!logTimer) logTimer = setTimeout(logFlush, 400);
  } catch (e) {}
}
/* a message on the screen that is not a toast */
function screenMsg(where, text) {
  var m = where + ': ' + text;
  if (m === lastScreenMsg) return;
  lastScreenMsg = m; log('message', m);
}
function stackLine(e) {
  var lines = String(e && e.stack || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean), at = lines.filter(function (l) { return /^at /.test(l); })[0];
  return at || (lines.length > 1 ? lines[0] : '');
}
/* an error is noted the first time, then again at 10, 100 and 1000 times (a broken frame would otherwise fill the log) */
function logError(msg, e) {
  try {
    msg = String(msg);
    if (!(msg in errCount)) { if (errKinds >= 200) return; errKinds++; }
    var n = errCount[msg] = (errCount[msg] || 0) + 1;
    if (n === 1) { var s = stackLine(e); log('error', msg + (s ? ' | ' + s : '')); }
    else if (n === 10 || n === 100 || n === 1000) log('error', msg + ' (' + n + ' times so far)');
  } catch (err) {}
}
var errors = [];
function noteError(msg) { msg = String(msg); logError(msg); if (errors.indexOf(msg) < 0 && errors.length < 50) errors.push(msg); }
window.addEventListener('error', function (ev) {
  errors.push(String(ev.message));
  logError(String(ev.message) + (ev.filename ? ' (' + String(ev.filename).split('/').pop().split('?')[0] + ':' + ev.lineno + ')' : ''), ev.error);
});
window.addEventListener('unhandledrejection', function (ev) {
  errors.push('rejection: ' + String(ev.reason && ev.reason.message || ev.reason));
  logError('Unhandled rejection: ' + String(ev.reason && ev.reason.message || ev.reason), ev.reason);
});
window.addEventListener('pagehide', function () { try { if (typeof logLeaving === 'function') logLeaving(); } catch (e) {} logFlush(); });
document.addEventListener('visibilitychange', function () { if (document.hidden) logFlush(); });

/* ================= dates and words ================= */
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
var ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
  'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'twenty-first',
  'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh', 'twenty-eighth',
  'twenty-ninth', 'thirtieth', 'thirty-first'];
function numWords(n) {
  n = Math.round(n);
  if (n < 0) return 'minus ' + numWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return String(n);
}
function todayISO() {
  try { var s = new Date().toLocaleDateString('en-CA', {timeZone: 'Australia/Melbourne'}); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; } catch (e) {}
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function parseISO(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1) return null;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return null;
  return {y: +m[1], m: +m[2] - 1, d: +m[3], dow: d.getUTCDay()};
}
/* YYYY-MM-DD (perhaps followed by a time) or D/M/YYYY, as YYYY-MM-DD; '' when it is not a real date */
function looseDate(v) {
  var t = typeof v === 'string' ? v.trim() : '', m, iso = '';
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/.exec(t))) iso = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) iso = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return parseISO(iso) ? iso : '';
}
function dayMonth(iso) { var p = parseISO(iso); return p ? p.d + ' ' + MONTHS[p.m] : ''; }
function dateLabel(iso) { var p = parseISO(iso); return p ? DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] : ''; }
function dateWords(iso) { var p = parseISO(iso); return p ? DAYS[p.dow] + ' the ' + ORD[p.d] + ' of ' + MONTHS[p.m] : ''; }

/* ================= settings and state ================= */
var DV = Voices.DEFAULTS;
var DEF_SET = {
  showName: 'The Bailey and Charlie Show',
  loc: {name: 'Wangaratta', lat: -36.355, lon: 146.313},
  engine: 'auto',
  voices: {
    Bailey: {kokoro: DV.Bailey.kokoro, browser: '', lift: DV.Bailey.lift},
    Charlie: {kokoro: DV.Charlie.kokoro, browser: '', lift: DV.Charlie.lift}
  },
  captions: true, music: true, think: 10
};
function loadSettings() {
  var s = JSON.parse(JSON.stringify(DEF_SET)), v = store.get('ms.settings', null);
  if (v && typeof v === 'object') {
    if (typeof v.showName === 'string' && v.showName.trim()) s.showName = v.showName.slice(0, 60);
    if (v.loc && isFinite(v.loc.lat) && isFinite(v.loc.lon)) s.loc = {name: String(v.loc.name || 'School'), state: String(v.loc.state || ''), lat: +v.loc.lat, lon: +v.loc.lon};
    if (['auto', 'kokoro', 'browser', 'captions'].indexOf(v.engine) >= 0) s.engine = v.engine;
    ['Bailey', 'Charlie'].forEach(function (d) {
      var x = v.voices && v.voices[d];
      if (x) {
        if (typeof x.kokoro === 'string') s.voices[d].kokoro = x.kokoro;
        if (typeof x.browser === 'string') s.voices[d].browser = x.browser;
        if (isFinite(x.lift)) s.voices[d].lift = clamp(+x.lift, 1, Voices.LIFT_MAX);
      }
    });
    if (typeof v.captions === 'boolean') s.captions = v.captions;
    if (typeof v.music === 'boolean') s.music = v.music;
    if (isFinite(v.think)) s.think = clamp(Math.round(v.think), 5, 20);
  }
  return s;
}
var S = {
  set: loadSettings(), script: null, wx: null, wxPromise: null, wxAt: 0, wxDay: '', wxFetching: null, pres: null, ctx: null, voiceOut: null, screen: 'home',
  engine: null, usedEngine: '', kokoroFailed: false, kokoroSkipped: '', prep: 0, last: null, sample: null, pasted: false, readyNote: '',
  version: (document.querySelector('meta[name="ms-version"]') || {}).content || ''
};
function saveSettings() { return store.set('ms.settings', S.set); }

/* ================= the script parser ================= */
function cleanText(s) { return String(s).replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/\s+/g, ' ').trim(); }
/* the index of the bracket that closes the one at i, or -1. With strings: brackets inside "..." do not count. */
function closeOf(text, i, strings) {
  var stack = [], inStr = false, esc2 = false;
  for (var j = i; j < text.length; j++) {
    var c = text[j];
    if (inStr) { if (esc2) esc2 = false; else if (c === '\\') esc2 = true; else if (c === '"') inStr = false; continue; }
    if (c === '"' && strings) inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { if (stack.pop() !== c) return -1; if (!stack.length) return j; }
  }
  return -1;
}
/* every place the show might be in a reply: the inside of each ``` block first, then each balanced {...} or [...].
   list.cut is true when a { never closes (a reply cut off part way). */
function extractJSON(text) {
  text = String(text || '');
  var out = [], re = /```[^\n`]*\n?([\s\S]*?)```/g, m, i = 0;
  while ((m = re.exec(text))) if (m[1].trim()) out.push(m[1]);
  out.cut = false;
  while (i < text.length) {
    var c = text[i];
    if (c !== '{' && c !== '[') { i++; continue; }
    var end = closeOf(text, i, true);
    if (end < 0) end = closeOf(text, i, false);   // a bare " inside a line upsets the string count; the brackets still match
    if (end < 0) { if (c === '{') { out.cut = true; break; } i++; continue; }
    out.push(text.slice(i, end + 1));
    i = end + 1;
  }
  return out;
}
function stripComments(t) {
  var out = '', inStr = false, i, c;
  for (i = 0; i < t.length; i++) {
    c = t[i];
    if (inStr) { out += c; if (c === '\\') { out += t[i + 1] || ''; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && t[i + 1] === '*') { var e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 1; out += ' '; }
    else out += c;
  }
  return out;
}
function noTrailingCommas(t) { return t.replace(/,\s*([}\]])/g, '$1'); }
/* a " inside a line that Claude forgot to escape: a quote only ends a string when , : } or ] comes next */
function escapeInnerQuotes(t) {
  var out = '', inStr = false, i, c;
  for (i = 0; i < t.length; i++) {
    c = t[i];
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (c === '\\') { out += c + (t[i + 1] || ''); i++; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c !== '"') { out += c; continue; }
    var j = i + 1;
    while (j < t.length && /\s/.test(t[j])) j++;
    if (j >= t.length || ',:}]'.indexOf(t[j]) >= 0) { inStr = false; out += c; } else out += '\\"';
  }
  return out;
}
function parseLoose(str) {
  var a = String(str).replace(/﻿/g, '').replace(/[  ]/g, ' ');
  var b = stripComments(a), c = noTrailingCommas(b), d = noTrailingCommas(c.replace(/[“”]/g, '"'));
  var tries = [a, b, c, d, escapeInnerQuotes(c), escapeInnerQuotes(d)];
  for (var i = 0; i < tries.length; i++) {
    if (i && tries[i] === tries[i - 1]) continue;
    try { return JSON.parse(tries[i]); } catch (e) {}
  }
  return null;
}
/* markers: {meaning}, { meaning }, {#1}, {{tip}} all count; any other {...} or stray brace is dropped from the words */
function stripMarkers(raw) {
  raw = String(raw).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, '{$1}').replace(/\{\s*#?\s*([A-Za-z]+|\d+)\s*:?\s*\}/g, '{$1}')
    .replace(/\{[A-Za-z0-9]+\}|\{[^{}]{0,24}\}|[{}]/g, function (m) { return /^\{[A-Za-z0-9]+\}$/.test(m) ? m : ''; })
    .replace(/[ \t]{2,}/g, ' ');
  var out = '', markers = [], re = /\{([A-Za-z0-9]+)\}/g, last = 0, m, piece;
  while ((m = re.exec(raw))) {
    piece = raw.slice(last, m.index);
    if (out.slice(-1) === ' ' && piece.charAt(0) === ' ') piece = piece.slice(1);
    out += piece;
    markers.push({name: m[1].toLowerCase(), pos: out.length});
    last = re.lastIndex;
  }
  piece = raw.slice(last);
  if (out.slice(-1) === ' ' && piece.charAt(0) === ' ') piece = piece.slice(1);
  out += piece;
  var lead = out.length - out.replace(/^\s+/, '').length;
  out = out.replace(/^\s+/, '').replace(/\s+$/, '');
  markers.forEach(function (k) { k.pos = clamp(k.pos - lead, 0, out.length); });
  return {text: out, markers: markers};
}
/* lines are {dog, text}, or a string such as "Bailey: Good morning!" */
function normLines(arr, max, firstDog) {
  var out = [], prev = firstDog || 'Charlie';
  if (typeof arr === 'string' || (arr && typeof arr === 'object' && !Array.isArray(arr) && 'text' in arr)) arr = [arr];   // one line on its own
  if (!Array.isArray(arr)) return out;
  for (var i = 0; i < arr.length && out.length < max; i++) {
    var l = arr[i], raw = '', who = '';
    if (typeof l === 'string') {
      var pm = /^\s*(Bailey|Charlie)\s*:\s*/i.exec(l);
      who = pm ? pm[1] : ''; raw = cleanText(pm ? l.slice(pm[0].length) : l);
    } else if (l && typeof l === 'object') {
      raw = typeof l.text === 'string' ? cleanText(l.text) : ''; who = l.dog;
    } else continue;
    if (!stripMarkers(raw).text) continue;
    var d = String(who || '').toLowerCase(), dog;
    if (d.indexOf('bailey') >= 0) dog = 'Bailey'; else if (d.indexOf('charlie') >= 0) dog = 'Charlie';
    else dog = prev === 'Bailey' ? 'Charlie' : 'Bailey';
    out.push({dog: dog, text: raw});
    prev = dog;
  }
  return out;
}
function str(v) { return typeof v === 'string' ? cleanText(v) : (typeof v === 'number' && isFinite(v) ? String(v) : ''); }
function isTrue(v) { return v === true || v === 1 || (typeof v === 'string' && /^\s*(true|yes)\s*$/i.test(v)); }
/* 900 is 9:00 */
function timeStr(v) {
  if (typeof v === 'number' && v % 1 === 0 && v >= 100 && v <= 2359 && v % 100 < 60) return Math.floor(v / 100) + ':' + ('0' + v % 100).slice(-2);
  return str(v);
}
/* flags show as two letters on Windows, so a flag becomes the segment's own emoji */
function emo(v, d) { var e = str(v); return e && !/[\u{1F1E6}-\u{1F1FF}]/u.test(e) ? e : d; }
/* the fact pictures in assets/real/facts/, named by the script's "picture" (or guessed from an obvious emoji) */
var PICS = ['rocket', 'planets', 'moon', 'sun', 'earth', 'ocean', 'coral-reef', 'whale', 'shark', 'octopus', 'turtle', 'heart', 'brain',
  'bones', 'teeth', 'eye', 'kangaroo', 'koala', 'wombat', 'platypus', 'emu', 'echidna', 'kookaburra', 'penguin', 'elephant', 'frog', 'owl',
  'bee', 'butterfly', 'ant', 'dinosaur', 'rainbow', 'storm', 'snow', 'volcano', 'mountain', 'crystals', 'tree', 'flower', 'seedling',
  'lightbulb', 'pyramid'];
var PIC_ALIAS = {tooth: 'teeth', eyes: 'eye', reef: 'coral-reef', coral: 'coral-reef', 'sea-turtle': 'turtle', 'solar-system': 'planets',
  planet: 'planets', dino: 'dinosaur', skeleton: 'bones', 'light-bulb': 'lightbulb', sprout: 'seedling', seed: 'seedling', plant: 'seedling',
  lightning: 'storm', thunderstorm: 'storm', snowflake: 'snow', sea: 'ocean', crystal: 'crystals', space: 'rocket', bird: 'kookaburra'};
var PIC_EMOJI = {'🚀': 'rocket', '🪐': 'planets', '🌙': 'moon', '🌕': 'moon', '🌛': 'moon', '🌜': 'moon', '☀': 'sun', '🌞': 'sun', '🌍': 'earth',
  '🌏': 'earth', '🌎': 'earth', '🌊': 'ocean', '🪸': 'coral-reef', '🐋': 'whale', '🐳': 'whale', '🦈': 'shark', '🐙': 'octopus', '🐢': 'turtle',
  '🫀': 'heart', '🧠': 'brain', '🦴': 'bones', '🦷': 'teeth', '👁': 'eye', '👀': 'eye', '🦘': 'kangaroo', '🐨': 'koala', '🐧': 'penguin',
  '🐘': 'elephant', '🐸': 'frog', '🦉': 'owl', '🐝': 'bee', '🦋': 'butterfly', '🐜': 'ant', '🦕': 'dinosaur', '🦖': 'dinosaur', '🌈': 'rainbow',
  '⛈': 'storm', '🌩': 'storm', '❄': 'snow', '☃': 'snow', '🌨': 'snow', '🌋': 'volcano', '⛰': 'mountain', '🏔': 'mountain', '💎': 'crystals',
  '🌳': 'tree', '🌲': 'tree', '🌸': 'flower', '🌻': 'flower', '🌷': 'flower', '🌺': 'flower', '🌱': 'seedling', '💡': 'lightbulb'};
function picKey(v, emoji) {
  var k = str(v).toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z-]/g, '').replace(/^-+|-+$/g, '');
  if (k) {
    if (PICS.indexOf(k) >= 0) return k;
    if (PIC_ALIAS[k]) return PIC_ALIAS[k];
    if (/s$/.test(k) && PICS.indexOf(k.slice(0, -1)) >= 0) return k.slice(0, -1);
    if (PICS.indexOf(k + 's') >= 0) return k + 's';
  }
  return PIC_EMOJI[String(emoji || '').replace(/[\uFE0E\uFE0F]/g, '')] || '';
}
function picSrc(key) { return 'assets/real/facts/' + key + '.webp'; }
/* countdown units, and how they read for one ("1 sleep") */
function cdUnit(v) {
  var u = str(v).toLowerCase();
  return /school/.test(u) ? 'school days' : /week/.test(u) ? 'weeks' : /day/.test(u) ? 'days' : 'sleeps';
}
function cdUnitLabel(unit, n) { return n === 1 ? unit.replace(/s$/, '') : unit; }
function isoDays(a, b) {
  var p = parseISO(a), q = parseISO(b);
  return p && q ? Math.round((Date.UTC(q.y, q.m, q.d) - Date.UTC(p.y, p.m, p.d)) / 86400000) : null;
}
/* how many units from the show's day to the event's day; school days count Monday to Friday after the show's day */
function cdCount(fromIso, toIso, unit) {
  var n = isoDays(fromIso, toIso), p = parseISO(fromIso);
  if (n == null || n < 0) return null;
  if (unit === 'weeks') return Math.round(n / 7);
  if (unit !== 'school days') return n;
  var c = 0;
  for (var i = 1; i <= n; i++) { var dow = (p.dow + i) % 7; if (dow && dow !== 6) c++; }
  return c;
}
/* fills in each countdown's count from its date where it has none, drops the ones that are over or have no number,
   and says where Claude's number and the date disagree (the screen keeps Claude's, which the dogs say) */
function fixCountdowns(segs, iso) {
  var notes = [];
  segs.forEach(function (s) {
    if (s.type !== 'countdown') return;
    s.items = s.items.filter(function (it) {
      var byDate = it.date ? cdCount(iso, it.date, it.unit) : null;
      if (it.date && byDate == null && isoDays(iso, it.date) != null) return false;   // already happened
      if (it.count == null) it.count = byDate;
      else if (byDate != null && byDate !== it.count && (it.unit === 'sleeps' || it.unit === 'days'))
        notes.push('The countdown to ' + it.until + ' says ' + it.count + ', but by its date it is ' + byDate + '.');
      return it.count != null;
    });
  });
  return {segs: segs.filter(function (s) { return s.type !== 'countdown' || s.items.length; }), notes: notes};
}
var SEG_ALIAS = {puzzle: 'puzzle', riddle: 'puzzle', joke: 'puzzle', brainteaser: 'puzzle', quiz: 'puzzle',
  schedule: 'schedule', timetable: 'schedule', ourday: 'schedule', plan: 'schedule', fact: 'fact', funfact: 'fact',
  news: 'news', classnews: 'news', announcements: 'news', notices: 'news', word: 'word', vocab: 'word', vocabulary: 'word',
  tip: 'tip', tipoftheday: 'tip', dogstip: 'tip',
  star: 'star', stars: 'star', starofweek: 'star', starsoftheweek: 'star', shoutout: 'star', shoutouts: 'star', award: 'star', awards: 'star',
  countdown: 'countdown', countdowns: 'countdown', sleeps: 'countdown', daysuntil: 'countdown', sleepsuntil: 'countdown'};
var SEG_ORDER = ['word', 'fact', 'puzzle', 'tip', 'news', 'countdown', 'star', 'schedule'];
/* the segment type it names ('riddle' is a puzzle), or '' */
function namedKind(s) {
  var t = String(s && s.type || '').toLowerCase().replace(/[\s_'’-]/g, '');
  return SEG_ALIAS[t] || SEG_ALIAS[t.replace('oftheday', '')] || SEG_ALIAS[t.replace('oftheweek', '')] || '';
}
function itemsHave(s, keys) {
  return Array.isArray(s.items) && s.items.some(function (it) { return it && typeof it === 'object' && keys.some(function (k) { return it[k] != null; }); });
}
function inferKind(s) {
  if (s.question != null) return 'puzzle';
  if (s.word != null) return 'word';
  if (itemsHave(s, ['name', 'reason'])) return 'star';
  if (itemsHave(s, ['count', 'until', 'sleeps'])) return 'countdown';
  if (Array.isArray(s.items)) return s.items.some(function (it) { return it && typeof it === 'object' && it.time != null; }) ? 'schedule' : 'news';
  if (s.title != null) return 'fact';
  if (s.text != null) return 'tip';
  return '';
}
function normSegment(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  var t = namedKind(s) || inferKind(s), lines;
  if (t === 'puzzle') {
    var q = str(s.question), ask = normLines(s.ask && s.ask.length ? s.ask : s.lines, 4), reveal = normLines(s.reveal, 4, ask.length ? ask[ask.length - 1].dog : 'Charlie');
    if (!q || !ask.length) return null;
    var ch = Array.isArray(s.choices) ? s.choices.map(str).filter(Boolean).slice(0, 3) : [], an = str(s.answer);
    if (!reveal.length && an) {
      // no reveal lines: the other dog says the answer
      var said = an.replace(/[.!?]+$/, '').replace(/^(A|An|The)\b/, function (w) { return w.toLowerCase(); });
      reveal = [{dog: ask[ask.length - 1].dog === 'Bailey' ? 'Charlie' : 'Bailey', text: "It's " + said + '!'}];
    }
    return {type: 'puzzle', question: q, answer: an, choices: ch.length >= 2 ? ch : [], ask: ask, reveal: reveal};
  }
  lines = normLines(s.lines, 4);
  if (!lines.length) return null;
  if (t === 'word') {
    var w = str(s.word);
    return w ? {type: 'word', word: w, meaning: str(s.meaning), sentence: str(s.sentence), lines: lines} : null;
  }
  if (t === 'fact') {
    var title = str(s.title);
    if (!title) return null;
    var num = null;
    if (s.number && typeof s.number === 'object' && s.number.value != null && String(s.number.value) !== '') num = {value: s.number.value, label: str(s.number.label)};
    var fe = emo(s.emoji, '✨');
    return {type: 'fact', title: title, emoji: fe, picture: picKey(s.picture || s.image || s.pic, fe), number: num, lines: lines};
  }
  if (t === 'star') {
    var stars = (Array.isArray(s.items) ? s.items : s.name ? [s] : []).map(function (it) {
      if (typeof it === 'string') return {name: str(it), reason: ''};
      return it && typeof it === 'object' ? {name: str(it.name || it.names), reason: str(it.reason || it.for || it.why)} : null;
    }).filter(function (it) { return it && it.name; }).slice(0, 4);
    var stTitle = str(s.title);
    return stars.length ? {type: 'star', title: stTitle.length <= 24 ? stTitle : '', items: stars, lines: lines} : null;
  }
  if (t === 'countdown') {
    var cds = (Array.isArray(s.items) ? s.items : [s]).map(function (it) {
      if (!it || typeof it !== 'object') return null;
      var raw = it.count != null ? it.count : it.days != null ? it.days : it.sleeps, n = parseInt(raw, 10);
      var until = str(it.until || it.what || it.event || it.label).replace(/^until\s+/i, '');
      return {count: isFinite(n) && n >= 0 && n < 1000 ? n : null, unit: cdUnit(it.unit), until: until, date: looseDate(it.date), emoji: emo(it.emoji, '⏳')};
    }).filter(function (it) { return it && it.until && (it.count != null || it.date); }).slice(0, 3);
    return cds.length ? {type: 'countdown', items: cds, lines: lines} : null;
  }
  if (t === 'tip') {
    var tx = str(s.text);
    return tx ? {type: 'tip', text: tx, emoji: emo(s.emoji, '💡'), lines: lines} : null;
  }
  if (t === 'news') {
    var items = (Array.isArray(s.items) ? s.items : []).map(function (it) {
      return it && typeof it === 'object' ? {text: str(it.text), emoji: emo(it.emoji, '📣'), birthday: isTrue(it.birthday)} : null;
    }).filter(function (it) { return it && it.text; }).slice(0, 4);
    return items.length ? {type: 'news', items: items, lines: lines} : null;
  }
  if (t === 'schedule') {
    var its = (Array.isArray(s.items) ? s.items : []).map(function (it) {
      return it && typeof it === 'object' ? {time: timeStr(it.time), label: str(it.label), special: isTrue(it.special)} : null;
    }).filter(function (it) { return it && it.label; }).slice(0, 10);
    return its.length ? {type: 'schedule', items: its, note: str(s.note), lines: lines} : null;
  }
  return null;
}
function normScript(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !('hello' in obj || 'segments' in obj)) return null;
  var hello = normLines(obj.hello, 3, 'Charlie'), signoff = normLines(obj.signoff, 4, 'Bailey'), segs = [], dropped = 0;
  (Array.isArray(obj.segments) ? obj.segments : []).forEach(function (s) { var n = normSegment(s); if (n) segs.push(n); else dropped++; });
  if (!hello.length && !segs.length && !signoff.length) return null;
  var fd = looseDate(obj.for_date) || looseDate(obj.date) || looseDate(obj.show_date);
  var cd = fixCountdowns(segs, fd || todayISO());
  dropped += segs.length - cd.segs.length;
  return {for_date: fd, hello: hello, segments: cd.segs, signoff: signoff, dropped: dropped, notes: cd.notes};
}
function scriptLines(sc) {
  return sc.hello.length + sc.signoff.length + sc.segments.reduce(function (a, s) { return a + (s.lines || []).length + (s.ask || []).length + (s.reveal || []).length; }, 0);
}
/* a reply that is only one segment (or a list of them), each naming its type */
function partialSegments(v) {
  var list = Array.isArray(v) ? v : [v];
  if (!list.length || !list.every(function (s) { return s && typeof s === 'object' && !Array.isArray(s) && namedKind(s); })) return null;
  var out = list.map(normSegment).filter(Boolean);
  return out.length ? out : null;
}
/* {script} for a whole show, {parts} for some segments only, or {reason} when there is nothing to use */
function parseReply(text) {
  var raw = String(text || ''), cands = extractJSON(raw), best = null, score = null, parts = null;
  cands.forEach(function (c) {
    var v = parseLoose(c);
    if (v == null || typeof v !== 'object') return;
    var sc = normScript(v);
    if (sc) {
      var k = [v.show === 'morning-show/1' ? 1 : 0, sc.segments.length, scriptLines(sc)];
      if (!score || k[0] > score[0] || (k[0] === score[0] && (k[1] > score[1] || (k[1] === score[1] && k[2] > score[2])))) { best = sc; score = k; }
    } else if (!parts) parts = partialSegments(v);
  });
  if (best) return {script: best};
  if (parts) return {parts: parts};
  if (raw.indexOf('{') < 0) return {reason: 'none'};
  if ((cands.cut || !cands.length) && /hello|segments/i.test(raw)) return {reason: 'cut'};
  return {reason: 'bad'};
}
function parseScriptText(text) { return parseReply(text).script || null; }
var PASTE_SHORT = {none: 'No show in that', cut: 'The script is cut off', part: 'That is only part of the show', bad: "That doesn't look like a show script"};
var PASTE_SAYS = {
  none: "There's no show in that. Claude may have asked you something: reply Just send the show.",
  cut: 'The script is cut off at the end. In Claude, ask: please send the whole script again.',
  part: 'That is only part of the show. In Claude, ask: please send the whole script again.',
  bad: "That doesn't look like a show script. Copy the whole block from Claude and try again."
};

/* ================= the weather ================= */
function wxKind(code) {
  if (code === 0) return {k: 'clear', icon: 'sun', phrase: 'Sunny skies today'};
  if (code === 1 || code === 2) return {k: 'partly', icon: 'partly', phrase: 'A mix of sun and cloud today'};
  if (code === 3) return {k: 'cloud', icon: 'cloud', phrase: "It's a cloudy one today"};
  if (code === 45 || code === 48) return {k: 'fog', icon: 'fog', phrase: "It's a foggy start to the day"};
  if (code >= 51 && code <= 57) return {k: 'drizzle', icon: 'rain', phrase: "There's a little drizzle about"};
  if (code >= 61 && code <= 67) return {k: 'rain', icon: 'rain', phrase: "It's a rainy day"};
  if (code >= 80 && code <= 82) return {k: 'showers', icon: 'rain', phrase: 'There might be a few showers'};
  if (code >= 95) return {k: 'storm', icon: 'storm', phrase: 'We might get a storm later'};
  if (code >= 71 && code <= 86) return {k: 'cloud', icon: 'cloud', phrase: "It's a cold, grey day"};
  return {k: 'cloud', icon: 'cloud', phrase: "It's a mixed-up sort of day"};
}
/* how bad a weather code is for the school day: storm > rain > showers > drizzle > snow > fog > cloud > partly > clear */
function wxSeverity(c) {
  if (c >= 95) return 8;
  if (c >= 61 && c <= 67) return 7;
  if (c >= 80 && c <= 82) return 6;
  if (c >= 51 && c <= 57) return 5;
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 4;
  if (c === 45 || c === 48) return 3;
  if (c === 3) return 2;
  if (c === 1 || c === 2) return 1;
  return 0;
}
/* the worst weather from 8:00 to 15:00, else the weather right now */
function schoolDayCode(j, nowCode) {
  var h = j.hourly, worst = -1, code = nowCode;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.weather_code)) return nowCode;
  h.time.forEach(function (t, i) {
    var hr = +String(t).slice(11, 13), c = h.weather_code[i];
    if (hr >= 8 && hr <= 15 && c != null && isFinite(c) && wxSeverity(+c) > worst) { worst = wxSeverity(+c); code = +c; }
  });
  return code;
}
function fetchWeather(loc) {
  return new Promise(function (resolve) {
    var done = false, ac = typeof AbortController === 'function' ? new AbortController() : null;
    var why = '', timer = setTimeout(function () { if (!done) { done = true; fetchWeather.why = 'no answer within 6 seconds'; if (ac) ac.abort(); resolve(null); } }, 6000);
    function end(v) { if (done) return; done = true; clearTimeout(timer); fetchWeather.why = v ? '' : why || 'the answer was not a forecast'; resolve(v); }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(loc.lat) + '&longitude=' + encodeURIComponent(loc.lon) +
      '&current=temperature_2m,weather_code&hourly=weather_code,precipitation_probability' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max' +
      '&timezone=Australia%2FMelbourne&forecast_days=1';
    try {
      fetch(url, ac ? {signal: ac.signal} : {}).then(function (r) { if (!r.ok) why = 'the weather service answered ' + r.status; return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.current || !j.daily) return end(null);
        var d = j.daily, c = j.current;
        var wx = {now: +c.temperature_2m, code: schoolDayCode(j, +c.weather_code), nowCode: +c.weather_code, max: +d.temperature_2m_max[0], min: +d.temperature_2m_min[0],
          rain: d.precipitation_probability_max ? +d.precipitation_probability_max[0] || 0 : 0,
          uv: d.uv_index_max && d.uv_index_max[0] != null ? +d.uv_index_max[0] : NaN};
        end(isFinite(wx.now) && isFinite(wx.max) && isFinite(wx.min) ? wx : null);
      }).catch(function (e) { why = why || 'could not reach the weather service (' + String(e && e.message || e) + ')'; end(null); });
    } catch (e) { why = 'could not ask the weather service (' + String(e && e.message || e) + ')'; end(null); }
  });
}
/* the weather, fetched again when it is missing, older than maxAgeMin minutes (30 by default), or from another day */
function ensureWeather(maxAgeMin) {
  var fresh = S.wx && S.wxDay === todayISO() && Date.now() - (S.wxAt || 0) < (maxAgeMin || 30) * 60000;
  if (fresh) return Promise.resolve(S.wx);
  if (S.wxFetching) return S.wxFetching;
  var loc = S.set.loc;
  var p = S.wxFetching = S.wxPromise = fetchWeather(loc).then(function (w) {
    if (S.wxFetching === p) S.wxFetching = null;
    if (w) log('weather', 'Weather fetched for ' + loc.name + ': ' + Math.round(w.now) + ' degrees now, top ' + Math.round(w.max) + ', low ' + Math.round(w.min) + ', rain chance ' + w.rain + '%, weather code ' + w.code);
    else log('weather', 'Weather could not be fetched for ' + loc.name + ': ' + (fetchWeather.why || 'no reason given'));
    if (loc !== S.set.loc) return S.wx;
    if (w) { S.wx = w; S.wxAt = Date.now(); S.wxDay = todayISO(); }
    else if (S.wxDay !== todayISO()) S.wx = null;   // never yesterday's weather
    refreshHome();
    return S.wx;
  });
  return p;
}
function degrees(n) { n = Math.round(n); return numWords(n) + (Math.abs(n) === 1 ? ' degree' : ' degrees'); }
/* the UV forecast, or when the service gave none, the season: October to March means sun protection in Victoria */
function uvOrSeason(wx) {
  if (isFinite(wx.uv)) return wx.uv;
  var p = parseISO(todayISO()), m = p ? p.m : new Date().getMonth();
  return m >= 9 || m <= 2 ? 3 : 0;
}
function weatherSegment(wx) {
  if (!wx) return null;
  var kind = wxKind(wx.code), adv = [], sunny = kind.k === 'clear' || kind.k === 'partly', uv = uvOrSeason(wx);
  if (wx.rain >= 50) adv.push({text: 'It might rain later, so pop your raincoat in your bag.', chips: [{e: '☂️', l: 'Raincoat'}]});
  if (wx.max < 15) adv.push({text: "It's a chilly one, so bring your jumper.", chips: [{e: '🧥', l: 'Jumper'}]});
  if (uv >= 3) {
    adv.push(sunny
      ? {text: "It's hats, sunscreen and sunnies when you go outside.", chips: [{e: '🧢', l: 'Hat'}, {e: '🧴', l: 'Sunscreen'}, {e: '🕶️', l: 'Sunnies'}]}
      : {text: 'The sun can still be strong, so hats and sunscreen on when you go outside.', chips: [{e: '🧢', l: 'Hat'}, {e: '🧴', l: 'Sunscreen'}]});
  }
  if (wx.max >= 30) adv.push({text: "It's a hot one, so drink lots of water.", chips: [{e: '💧', l: 'Water'}]});
  if (kind.k === 'storm') adv.unshift({text: "If there's thunder, we'll stay inside where it's safe and cosy.", chips: []});
  var l1 = Math.round(wx.now) >= Math.round(wx.max)
    ? '{temp}It\'s ' + degrees(wx.now) + " right now, and that's about as warm as it gets today."
    : '{temp}It\'s ' + degrees(wx.now) + " right now, and it'll get up to " + numWords(wx.max) + ' today.';
  var l2 = (adv.length ? '{c0}' : '') + kind.phrase + '. ' + (adv.length ? adv[0].text : 'A good day to be outside.');
  var lines = [{dog: 'Bailey', text: l1}, {dog: 'Charlie', text: l2}];
  if (adv.length > 1) {
    lines.push({dog: 'Bailey', text: adv.slice(1, 4).map(function (a, i) { return '{c' + (i + 1) + '}' + a.text; }).join(' ')});
  }
  var chips = [];
  adv.forEach(function (a, i) { a.chips.forEach(function (c) { chips.push({e: c.e, l: c.l, n: i}); }); });
  // at most four chips fit: Sunnies goes first (the line still says it)
  if (chips.length > 4) chips = chips.filter(function (c) { return c.l !== 'Sunnies'; });
  chips = chips.slice(0, 4);
  return {type: 'weather', icon: kind.icon, now: Math.round(wx.now), max: Math.round(wx.max), min: Math.round(wx.min), chips: chips, lines: lines};
}
function wxEmoji(icon) { return {sun: '☀️', partly: '⛅', cloud: '☁️', rain: '🌧️', storm: '⛈️', fog: '🌫️'}[icon] || '☀️'; }

/* ================= building the show ================= */
var SEG_INFO = {
  hello: {layout: 'studio'}, signoff: {layout: 'studio'},
  weather: {layout: 'card', emoji: '🌤️', label: 'Weather'},
  word: {layout: 'card', emoji: '📖', label: 'Word of the day'},
  fact: {layout: 'card', emoji: '🧠', label: 'Fact of the day'},
  puzzle: {layout: 'card', emoji: '🧩', label: 'Puzzle time'},
  tip: {layout: 'card', emoji: '🐾', label: "Dog's tip"},
  news: {layout: 'card', emoji: '📣', label: 'Class news'},
  schedule: {layout: 'card', emoji: '🗓️', label: 'Our day'},
  star: {layout: 'card', emoji: '⭐', label: 'Star of the week'},
  countdown: {layout: 'card', emoji: '⏳', label: 'Countdown'}
};
function pickFromBank(type) {
  var list = (window.BANK && BANK[type]) || [], hist = store.get('ms.hist', {}), h = Array.isArray(hist[type]) ? hist[type] : [];
  if (!list.length) return null;
  function id(s) { return s.word || s.title || s.question || s.text || ''; }
  var keep = Math.min(6, Math.floor(list.length / 2)), pool = list.filter(function (s) { return h.indexOf(id(s)) < 0; });
  if (!pool.length) pool = list;
  var s = pool[Math.floor(Math.random() * pool.length)];
  h.push(id(s));
  hist[type] = h.slice(-keep);
  store.set('ms.hist', hist);
  return normSegment(JSON.parse(JSON.stringify(s)));
}
function surpriseScript() {
  var iso = todayISO(), name = S.set.showName.replace(/^The\s+/, 'the ');
  var segs = ['word', 'fact', 'puzzle', 'tip'].map(pickFromBank).filter(Boolean);
  return {
    for_date: iso, surprise: true,
    hello: [
      {dog: 'Bailey', text: "Good morning, everyone! It's " + dateWords(iso) + '.'},
      {dog: 'Charlie', text: "I'm Charlie, and this is Bailey. Welcome to " + name + '.'},
      {dog: 'Bailey', text: "Let's get started!"}
    ],
    segments: segs,
    signoff: [
      {dog: 'Charlie', text: "Before we go, let's take three slow breaths together. In, and out."},
      {dog: 'Bailey', text: "Now we're calm, and ready to learn. Have a brilliant day, everyone!"},
      {dog: 'Charlie', text: 'See you next time. Bye!'}
    ]
  };
}
/* "Breathe in.", "And breathe out.", "In, and out.", "One more time." */
function breathCue(sentence) {
  var s = sentence.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/^(and |now )?breathe\b/.test(s)) return true;
  var words = s.split(' ');
  // "Take a deep breath in."
  if (/\bbreathe?\b/.test(s) && words.length <= 7) return true;
  return words.every(function (w) { return ['in', 'out', 'and', 'again', 'one', 'more', 'time', 'slowly', 'nose', 'mouth', 'through', 'your'].indexOf(w) >= 0; });
}
function estimateSeconds(show) {
  var chars = 0, sec = 3, lines = 0;
  show.segs.forEach(function (s) {
    s.lines.forEach(function (l) { chars += l.text.length; lines++; if (l.hold) sec += l.hold; });
    sec += 1.3;
    if (s.kind === 'puzzle') sec += S.set.think + 0.9;
    if (s.kind === 'signoff') sec += 2.6;
  });
  return chars / 14.5 + lines * 0.3 + sec;
}
function lengthText(sec) {
  if (sec < 90) return 'About a minute';
  var m = Math.round(sec / 60);
  return 'About ' + m + ' minutes';
}
function buildShow(script, wx) {
  var segs = [], iso = script.for_date || todayISO();
  function add(kind, src, extra) {
    var info = SEG_INFO[kind] || SEG_INFO.tip, lines = [], askCount = 0;
    if (kind === 'puzzle') { lines = src.ask.concat(src.reveal); askCount = src.ask.length; } else lines = src.lines || src;
    if (!lines.length) return;
    var seg = {kind: kind, layout: info.layout, data: extra || src, askCount: askCount, lines: []};
    lines.forEach(function (l) {
      if (kind === 'signoff') {
        // one sentence at a time, so a breathing cue can be followed by a quiet moment
        Voices.sentences(l.text).forEach(function (s) {
          var raw = s.t.trim(), m = stripMarkers(raw);
          if (!m.text) return;
          var cue = breathCue(m.text), marks = m.markers.map(function (k) { return {name: k.name, frac: m.text.length ? k.pos / m.text.length : 0}; });
          if (cue) {
            var re = /\b(in|out)\b/gi, w;
            while ((w = re.exec(m.text))) marks.push({name: 'b' + w[1].toLowerCase(), frac: w.index / m.text.length});
            seg.breath = true;
          }
          seg.lines.push({dog: l.dog, text: m.text, raw: raw, markers: marks, hold: cue ? 2.5 : 0});
        });
      } else {
        var m2 = stripMarkers(l.text);
        seg.lines.push({dog: l.dog, text: m2.text, raw: l.text,
          markers: m2.markers.map(function (k) { return {name: k.name, frac: m2.text.length ? k.pos / m2.text.length : 0}; })});
      }
    });
    segs.push(seg);
  }
  if (script.hello.length) add('hello', script.hello, {iso: iso});
  var w = weatherSegment(wx);
  if (w) add('weather', w);
  script.segments.forEach(function (s) {
    if (s.type === 'fact' && s.picture) { var im = new Image(); im.src = picSrc(s.picture); }   // ready before the card appears
    add(s.type, s);
  });
  if (script.signoff.length) add('signoff', script.signoff);
  var flat = [];
  segs.forEach(function (s) { s.lines.forEach(function (l) { l.gi = flat.length; flat.push({dog: l.dog, text: l.text}); }); });
  return {segs: segs, flat: flat, iso: iso};
}

/* ================= music, made in code ================= */
var Music = {
  master: null,
  ok: function () { return S.set.music && S.ctx && S.ctx.state === 'running'; },
  bus: function () {
    if (!this.master || this.master.context !== S.ctx) { this.master = S.ctx.createGain(); this.master.gain.value = 0.15; this.master.connect(S.ctx.destination); }
    return this.master;
  },
  tone: function (f, t, dur, type, vol, atk) {
    var c = S.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (atk || 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.bus());
    o.start(t); o.stop(t + dur + 0.05);
  },
  jingle: function () {
    if (!this.ok()) return;
    var t = S.ctx.currentTime + 0.05, n = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 783.99, 1046.5, 1318.5, 1568], i;
    for (i = 0; i < n.length; i++) this.tone(n[i], t + i * 0.19, 0.38, 'triangle', 0.55, 0.015);
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { Music.tone(f, t + 2.05, 0.95, 'sine', 0.35, 0.03); });
  },
  sting: function () {
    if (!this.ok()) return;
    var t = S.ctx.currentTime + 0.02;
    this.tone(784, t, 0.25, 'triangle', 0.45, 0.01); this.tone(1175, t + 0.12, 0.35, 'triangle', 0.4, 0.01);
  },
  tick: function (alt) {
    if (!this.ok()) return;
    this.tone(alt ? 660 : 880, S.ctx.currentTime + 0.01, 0.09, 'sine', 0.5, 0.004);
  },
  padOn: function () {
    if (!this.ok() || this.pad) return;
    var c = S.ctx, g = c.createGain(), os = [130.8, 196, 261.6].map(function (f) { var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(); return o; });
    g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.linearRampToValueAtTime(0.18, c.currentTime + 1.2);
    g.connect(this.bus());
    this.pad = {g: g, os: os};
  },
  padOff: function () {
    var p = this.pad;
    if (!p) return;
    this.pad = null;
    try {
      var c = S.ctx, now = c.currentTime;
      p.g.gain.cancelScheduledValues(now); p.g.gain.setValueAtTime(p.g.gain.value, now); p.g.gain.linearRampToValueAtTime(0.0001, now + 0.4);
      p.os.forEach(function (o) { o.stop(now + 0.5); });
    } catch (e) {}
  },
  ding: function () {
    if (!this.ok()) return;
    var t = S.ctx.currentTime + 0.02;
    this.tone(1318.5, t, 0.5, 'triangle', 0.45, 0.005); this.tone(1975.5, t + 0.08, 0.7, 'sine', 0.3, 0.005);
  },
  /* a short round of clapping (bursts of filtered noise) with a sparkle on top */
  applause: function () {
    if (!this.ok()) return;
    var c = S.ctx, t0 = c.currentTime + 0.03, i;
    if (!this.noise || this.noise.sampleRate !== c.sampleRate) {
      var len = Math.floor(c.sampleRate * 0.06), b = c.createBuffer(1, len, c.sampleRate), ch = b.getChannelData(0);
      for (i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      this.noise = b;
    }
    for (i = 0; i < 46; i++) {
      var at = t0 + Math.pow(Math.random(), 1.4) * 1.9, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = rand(900, 2600); f.Q.value = 0.9;
      g.gain.value = rand(0.35, 0.8) * (1 - (at - t0) / 2.4);
      src.connect(f); f.connect(g); g.connect(this.bus()); src.start(at);
    }
    [1568, 1975.5, 2349.3, 3136].forEach(function (fr, k) { Music.tone(fr, t0 + k * 0.09, 0.4, 'sine', 0.22, 0.005); });
  },
  chord: function () {
    if (!this.ok()) return;
    var t = S.ctx.currentTime + 0.05;
    [261.6, 329.6, 392, 493.9, 659.3].forEach(function (f, i) { Music.tone(f, t + i * 0.05, 3.4, 'sine', 0.3, 0.6); });
  }
};
/* the sound, made if needed but never woken: only a press (Play, Start, Try, Paste, Again, unpause) wakes it */
function audioCtx() {
  try {
    if (!S.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      S.ctx = new AC({latencyHint: 'interactive'});
      S.voiceOut = S.ctx.createGain(); S.voiceOut.connect(S.ctx.destination);
    }
  } catch (e) {}
  return S.ctx;
}
function unlockAudio() {
  var c = audioCtx();
  try { if (c && c.state !== 'running') c.resume().catch(function () {}); } catch (e) {}
  return c;
}

/* ================= the desk and the dogs' faces ================= */
var DEFAULT_PRES = {
  desk: {src: 'assets/desk.svg', w: 1600, h: 900}, wave: 'assets/wave.svg', tag_y: 0.76,
  dogs: {
    Bailey: {eyes: [415, 415, 545, 465], mouth: [435, 466, 525, 552], tag_x: 0.30, sprites: {ah: 'assets/bailey-ah.svg', grin: 'assets/bailey-grin.svg', blink: 'assets/bailey-blink.svg'}},
    Charlie: {eyes: [1000, 385, 1176, 450], mouth: [1030, 451, 1146, 565], tag_x: 0.68, sprites: {ah: 'assets/charlie-ah.svg', grin: 'assets/charlie-grin.svg', blink: 'assets/charlie-blink.svg'}}
  }
};
function validPres(j) {
  return j && j.desk && j.desk.src && j.desk.w > 0 && j.desk.h > 0 && j.dogs && j.dogs.Bailey && j.dogs.Charlie;
}
function loadPresenters() {
  function get(u) { return fetch(u, {cache: 'no-cache'}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  return get('assets/real/presenters.json').then(function (j) {
    if (validPres(j)) return j;
    return get('assets/presenters.json').then(function (k) { return validPres(k) ? k : DEFAULT_PRES; });
  });
}
var FACE = {};       // per dog: layers and timing
var TAGS = {};
var DESKW = 1, DESKH = 1;
function buildDesk(pres) {
  S.pres = pres; DESKW = pres.desk.w; DESKH = pres.desk.h;
  var desk = $('desk'), base = $('deskbase'), layer = $('deskfaces'), tags = $('tags');
  desk.style.setProperty('--ar', (DESKW / DESKH).toFixed(5));
  base.src = pres.desk.src;
  layer.innerHTML = ''; tags.innerHTML = '';
  ['Bailey', 'Charlie'].forEach(function (dog) {
    var d = pres.dogs[dog], F = FACE[dog] = {ok: true, mouth: 'shut', mouthSince: 0, blinkAt: 0, blinkUntil: 0, grinUntil: 0, imgs: {}, shown: {mouth: '', eyes: ''}};
    function box(b, name) {
      var l = el('div', 'fl'); l.style.left = (b[0] / DESKW * 100) + '%'; l.style.top = (b[1] / DESKH * 100) + '%';
      l.style.width = ((b[2] - b[0]) / DESKW * 100) + '%'; l.style.height = ((b[3] - b[1]) / DESKH * 100) + '%'; l.dataset.part = name;
      layer.appendChild(l); return l;
    }
    try {
      var ml = box(d.mouth, 'mouth'), eyl = box(d.eyes, 'eyes');
      [['ah', ml], ['grin', ml], ['blink', eyl]].forEach(function (p) {
        var src = d.sprites && d.sprites[p[0]], im = el('img');
        if (!src) { F.ok = false; return; }
        im.alt = ''; im.decoding = 'async'; im.draggable = false;
        im.onerror = function () { F.ok = false; ml.style.display = 'none'; eyl.style.display = 'none'; };
        im.src = src; p[1].appendChild(im); F.imgs[p[0]] = im;
      });
    } catch (e) { F.ok = false; }
    if (!F.ok) layer.querySelectorAll('.fl').forEach(function (n) { n.style.display = 'none'; });
    var tag = el('div', 'tag ' + dog.toLowerCase(), dog);
    tag.style.left = (d.tag_x * 100) + '%'; tag.style.top = ((pres.tag_y || 0.78) * 100) + '%';
    tags.appendChild(tag); TAGS[dog] = tag;
  });
  buildPoses(pres);
}
/* whole-scene pictures of the same desk (surprised, laughing, thinking) laid over it, and a quiet loop for the home screen */
var POSE = {imgs: {}, timer: 0, idle: null};
function buildPoses(pres) {
  var desk = $('desk'), faces = $('deskfaces');
  desk.querySelectorAll('.pose, #deskidle').forEach(function (n) { n.remove(); });
  POSE.imgs = {}; POSE.idle = null;
  var ps = pres.poses && typeof pres.poses === 'object' ? pres.poses : {};
  Object.keys(ps).forEach(function (name) {
    if (typeof ps[name] !== 'string') return;
    var im = el('img', 'pose');
    im.alt = ''; im.draggable = false; im.decoding = 'async';
    im.onerror = function () { delete POSE.imgs[name]; im.remove(); };
    im.src = ps[name]; desk.insertBefore(im, faces); POSE.imgs[name] = im;
  });
  var idle = pres.idle, still = false;
  try { still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (idle && (idle.webm || idle.mp4) && !still && !P.has('noidle')) {
    var v = el('video');
    v.id = 'deskidle'; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(function (f) {
      if (!idle[f[0]]) return;
      var so = el('source'); so.src = idle[f[0]]; so.type = f[1]; v.appendChild(so);
    });
    // it shows only once it can play, so a missing or broken file leaves the still desk with its blinks
    v.addEventListener('playing', function () { if (POSE.idle === v) desk.classList.toggle('idling', idleWanted()); });
    v.addEventListener('error', dropIdle, true);
    desk.insertBefore(v, faces); POSE.idle = v;
  }
}
function dropIdle() { var v = POSE.idle; POSE.idle = null; if (v) { try { v.pause(); } catch (e) {} v.remove(); } $('desk').classList.remove('idling'); }
function idleWanted() { return S.screen === 'home' || S.screen === 'ready'; }
function idleFollow() {
  var v = POSE.idle;
  if (!v) return;
  if (idleWanted()) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { dropIdle(); }); }
  else { v.pause(); $('desk').classList.remove('idling'); }
}
/* name: surprised, laughing or thinking; sec: how long (none: until unpose) */
function pose(name, sec) {
  var im = POSE.imgs[name];
  if (!im || S.screen !== 'show' || !im.complete || !im.naturalWidth) return;
  Object.keys(POSE.imgs).forEach(function (k) { POSE.imgs[k].classList.toggle('on', k === name); });
  $('desk').classList.add('posing');
  clearTimeout(POSE.timer);
  if (sec) POSE.timer = setTimeout(unpose, sec * 1000 * (FAST ? 0.25 : 1));
}
function unpose() {
  clearTimeout(POSE.timer);
  Object.keys(POSE.imgs).forEach(function (k) { POSE.imgs[k].classList.remove('on'); });
  $('desk').classList.remove('posing');
}
var LAUGH_RE = /\b(ha ?ha|hee ?hee|he he|hehe)\b/i;
function setBase(wave) { if (S.pres) $('deskbase').src = wave && S.pres.wave ? S.pres.wave : S.pres.desk.src; }
function setLayout(l) {
  var d = $('desk');
  d.classList.toggle('studio', l === 'studio'); d.classList.toggle('corner', l !== 'studio');
  $('stage').classList.toggle('studio-on', l === 'studio');
  $('card').hidden = l === 'studio';
}
/* which sprite, now. speaker: who is talking; level: his mouth; force: 'grin' to smile */
function updateFaces(now, speaker, level, force) {
  ['Bailey', 'Charlie'].forEach(function (dog) {
    var F = FACE[dog];
    if (!F || !F.ok) return;
    var lv = dog === speaker ? level : 0;
    var cand = lv < 0.15 ? 'shut' : lv < 0.55 ? 'ah' : 'grin';
    if (force || F.grinUntil > now) cand = 'grin';
    if (cand !== F.mouth && now - F.mouthSince >= 80) { F.mouth = cand; F.mouthSince = now; }
    var blink = false;
    if (!F.blinkAt) F.blinkAt = now + rand(2500, 5500);
    if (now < F.blinkUntil) blink = true;
    else if (now >= F.blinkAt && F.mouth !== 'grin' && !force) { F.blinkUntil = now + 140; F.blinkAt = now + 140 + rand(2500, 5500); blink = true; }
    var wantM = F.mouth === 'shut' ? '' : F.mouth, wantE = blink ? 'blink' : '';
    if (wantM !== F.shown.mouth) { if (F.shown.mouth && F.imgs[F.shown.mouth]) F.imgs[F.shown.mouth].classList.remove('on'); if (wantM && F.imgs[wantM]) F.imgs[wantM].classList.add('on'); F.shown.mouth = wantM; }
    if (wantE !== F.shown.eyes) { if (F.imgs.blink) F.imgs.blink.classList.toggle('on', !!wantE); F.shown.eyes = wantE; }
  });
}
function lightTag(dog) { ['Bailey', 'Charlie'].forEach(function (d) { if (TAGS[d]) TAGS[d].classList.toggle('lit', d === dog); }); }

/* ================= effects ================= */
function stagePct(node) {
  var r = node.getBoundingClientRect(), s = $('stage').getBoundingClientRect();
  return {x: (r.left + r.width / 2 - s.left) / s.width * 100, y: (r.top + r.height / 2 - s.top) / s.height * 100};
}
function burst(x, y, n, colors) {
  var fx = $('fx');
  for (var i = 0; i < n; i++) {
    var s = el('i', 'spark'), a = Math.random() * Math.PI * 2, r = rand(6, 16);
    s.style.left = x + '%'; s.style.top = y + '%'; s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', Math.cos(a) * r + 'cqw'); s.style.setProperty('--dy', Math.sin(a) * r + 'cqw');
    fx.appendChild(s); setTimeout(function (n2) { n2.remove(); }, 1300, s);
  }
}
function confetti() {
  var fx = $('fx'), cols = ['#ff5d73', '#ffd54a', '#4fc3f7', '#66bb6a', '#b388ff', '#ff9f43'];
  for (var i = 0; i < 70; i++) {
    var c = el('i', 'conf');
    c.style.left = rand(8, 92) + '%'; c.style.top = rand(-4, 12) + '%'; c.style.background = cols[i % cols.length];
    c.style.setProperty('--dx', rand(-12, 12) + 'cqw'); c.style.setProperty('--dy', rand(40, 70) + 'cqh'); c.style.setProperty('--rot', rand(-720, 720) + 'deg');
    c.style.animationDelay = rand(0, 0.5) + 's';
    fx.appendChild(c); setTimeout(function (n2) { n2.remove(); }, 3200, c);
  }
}
var tweens = [];
function tween(dur, fn) { tweens.push({t: 0, dur: dur, fn: fn}); }
function runTweens(dt) {
  for (var i = tweens.length - 1; i >= 0; i--) {
    var w = tweens[i]; w.t += dt;
    var p = Math.min(1, w.t / w.dur);
    w.fn(p);
    if (p >= 1) tweens.splice(i, 1);
  }
}

/* ================= scenes ================= */
function syllables(w) {
  var low = w.toLowerCase(), m = low.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/g);
  if (!m || m.join('') !== low) return [w];
  var out = [], i = 0;
  m.forEach(function (p) { out.push(w.substr(i, p.length)); i += p.length; });
  return out;
}
function mkCard(kind, noHead) {
  var info = SEG_INFO[kind], card = $('card');
  card.innerHTML = '';
  var box = el('div', 'cbox'), hd = el('div', 'hd', '<span class="e">' + info.emoji + '</span>' + esc(info.label)), bd = el('div', 'bd');
  if (!noHead) box.appendChild(hd);
  box.appendChild(bd); card.appendChild(box);
  var badge = el('div', 'badge', info.emoji);
  card.appendChild(badge);
  return {box: box, bd: bd, badge: badge};
}
/* shrink a card's words (the --fit multiplier on .bd, down to 0.6) until nothing spills out of it.
   It measures the layout with nothing moved or scaled, so words still waiting to appear count too. */
function fitCard(box) {
  var bd = box && box.isConnected && box.querySelector('.bd');
  if (!bd) return;
  var fit = 1;
  box.classList.add('fit-measure');
  bd.style.setProperty('--fit', '1');
  function spills() {
    if (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1 || bd.scrollHeight > bd.clientHeight + 1 || bd.scrollWidth > bd.clientWidth + 1) return true;
    // a news item or timetable row is a fixed share of its list, so its own words can spill out of it
    return [].some.call(box.querySelectorAll('.n-list li, .s-list li'), function (li) { return li.scrollHeight > li.clientHeight + 1; });
  }
  while (spills() && fit > 0.6) {
    fit = Math.round((fit - 0.05) * 100) / 100;
    bd.style.setProperty('--fit', String(fit));
  }
  box.classList.remove('fit-measure'); box.classList.add('fit-settle');
  void box.offsetHeight;
  box.classList.remove('fit-settle');
}
function fitNow() {
  var box = document.querySelector('#card .cbox');
  if (box) fitCard(box);
}
function on(n) { if (n) n.classList.add('on'); }
/* 150000000 is "150 million"; while counting up only the 150 moves */
function fmtNum(v, frac) {
  var n = +v;
  if (!isFinite(n)) return String(v);
  var a = Math.abs(n);
  if (a >= 1e6) {
    var u = a >= 1e12 ? [1e12, 'trillion'] : a >= 1e9 ? [1e9, 'billion'] : [1e6, 'million'], m = n / u[0];
    var mv = Number.isInteger(Math.round(m * 10) / 10) ? Math.round(m * frac) : Math.round(m * frac * 10) / 10;
    return mv.toLocaleString('en-AU', {maximumFractionDigits: 1}) + ' ' + u[1];
  }
  var val = frac * n;
  return (Number.isInteger(n) ? Math.round(val) : Math.round(val * 10) / 10).toLocaleString('en-AU');
}

var Scenes = {};
Scenes.word = function (seg) {
  var d = seg.data, c = mkCard('word'), len = Math.max(1, d.word.length);
  var wd = el('div', 'w-word'), fs = Math.min(11.5, 86 / len);
  wd.style.fontSize = 'calc(' + fs + 'cqw * var(--fit, 1))';
  syllables(d.word).forEach(function (s, i) { var sp = el('span', 'syl', esc(s)); sp.style.animationDelay = (0.15 + i * 0.18) + 's'; wd.appendChild(sp); });
  c.bd.appendChild(wd);
  var mean = null, sent = null;
  if (d.meaning) { mean = el('div', 'w-mean rise', '<small>means</small>' + esc(d.meaning)); c.bd.appendChild(mean); }
  if (d.sentence) {
    var re = new RegExp('\\b(' + escRe(d.word) + '\\w*)', 'i'), h = esc(d.sentence);
    sent = el('div', 'w-sent rise', re.test(h) ? h.replace(re, '<mark>$1</mark>') : h); c.bd.appendChild(sent);
  }
  return {
    start: function (p) { if (!p.meaning) on(mean); if (!p.sentence) on(sent); },
    marker: function (n) { if (n === 'meaning') on(mean); else if (n === 'sentence') on(sent); }
  };
};
Scenes.fact = function (seg) {
  var d = seg.data, c = mkCard('fact');
  var row = el('div', 'f-row'), side = el('div', 'f-side');
  var pic = el('div', 'f-emoji', esc(d.emoji));
  if (d.picture) {
    // the picture in a frame; the emoji comes back if it does not load
    var img = el('img');
    img.alt = ''; img.draggable = false; img.decoding = 'async';
    img.onerror = function () { pic.className = 'f-emoji'; pic.innerHTML = esc(d.emoji); };
    pic.className = 'f-pic'; pic.innerHTML = ''; pic.appendChild(img); img.src = picSrc(d.picture);
  }
  row.appendChild(pic);
  var ft = el('div', 'f-title', esc(d.title)), tl = d.title.length;
  ft.style.fontSize = 'calc(' + (tl <= 30 ? 4.2 : tl <= 46 ? 3.5 : 2.9) + 'cqw * var(--fit, 1))';
  side.appendChild(ft);
  var num = null, nEl = null;
  if (d.number) {
    num = el('div', 'f-num rise', '<span class="n">0</span><span class="l">' + esc(d.number.label) + '</span>'); nEl = num.querySelector('.n'); side.appendChild(num);
    // sized from the final words ("150 million"), so the number always fits beside the picture
    nEl.style.fontSize = 'calc(' + clamp(30 / (0.62 * fmtNum(d.number.value, 1).length), 3.5, 10).toFixed(2) + 'cqw * var(--fit, 1))';
    if (d.number.label.length > 24) num.querySelector('.l').style.fontSize = 'calc(2.4cqw * var(--fit, 1))';
  }
  row.appendChild(side); c.bd.appendChild(row);
  function show() {
    if (!num || num.classList.contains('on')) return;
    on(num); nEl.textContent = fmtNum(d.number.value, 0);
    tween(1.3, function (p) { nEl.textContent = fmtNum(d.number.value, 1 - Math.pow(1 - p, 3)); });
  }
  return {start: function (p) { if (!p.number) show(); }, marker: function (n) { if (n === 'number') { if (num && !num.classList.contains('on')) pose('surprised', 1.6); show(); } }};
};
/* "It's a towel!" matches the choice "A towel" */
function normAnswer(t) {
  return String(t).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/^\s*(it's|it is|the answer is)\s+/, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the) /, '');
}
function matchChoice(answer, choices) {
  var a = normAnswer(answer), hit = -1, n = 0;
  if (!a) return -1;
  choices.forEach(function (c, i) { if (normAnswer(c) === a) hit = i; });
  if (hit >= 0) return hit;
  choices.forEach(function (c, i) {
    var ch = normAnswer(c);
    if (ch && ((' ' + a + ' ').indexOf(' ' + ch + ' ') >= 0 || (' ' + ch + ' ').indexOf(' ' + a + ' ') >= 0)) { hit = i; n++; }
  });
  return n === 1 ? hit : -1;
}
Scenes.puzzle = function (seg) {
  var d = seg.data, c = mkCard('puzzle');
  var pq = el('div', 'p-q', esc(d.question));
  pq.style.fontSize = 'calc(' + (d.question.length <= 50 ? 3.9 : d.question.length <= 80 ? 3.3 : 2.8) + 'cqw * var(--fit, 1))';
  c.bd.appendChild(pq);
  var tiles = [], chWrap = null;
  if (d.choices.length) {
    chWrap = el('div', 'p-choices');
    d.choices.forEach(function (t, i) {
      var tile = el('div', 'p-tile rise', '<b>' + 'ABC'.charAt(i) + '</b><span>' + esc(t) + '</span>'); chWrap.appendChild(tile); tiles.push(tile);
    });
    c.bd.appendChild(chWrap);
  }
  var zone = el('div', 'p-zone'), R0 = 45, C = 2 * Math.PI * R0;
  var ring = el('div', 'p-ring', '<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="45"></circle><circle class="arc" cx="50" cy="50" r="45" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="0"></circle></svg><div class="num"></div>');
  var ans = el('div', 'p-ans', '<small>The answer</small><span class="pa">' + esc(d.answer || '') + '</span>');
  function ansSize(t) { ans.style.fontSize = 'calc(' + (t.length <= 16 ? 5.4 : t.length <= 28 ? 4.2 : 3.2) + 'cqw * var(--fit, 1))'; }
  ansSize(d.answer || '');
  zone.appendChild(ring); zone.appendChild(ans); c.bd.appendChild(zone);
  var arc = ring.querySelector('.arc'), numEl = ring.querySelector('.num');
  function showChoices() { tiles.forEach(on); }
  return {
    start: function (p) { if (!p.choices) showChoices(); },
    marker: function (n) { if (n === 'choices') showChoices(); },
    thinkOn: function (total) { showChoices(); on(ring); numEl.textContent = Math.ceil(total); },
    thinkTick: function (left, total) { arc.setAttribute('stroke-dashoffset', (C * (1 - left / total)).toFixed(2)); numEl.textContent = Math.max(0, Math.ceil(left)); },
    thinkOff: function () { ring.classList.remove('on'); },
    reveal: function () {
      var win = matchChoice(d.answer || '', d.choices);
      if (win >= 0) {
        // the tile's own words become the big answer
        ans.querySelector('.pa').textContent = d.choices[win]; ansSize(d.choices[win]);
        if (d.choices[win] !== d.answer) fitCard(c.box);
        tiles.forEach(function (t, i) { t.classList.add(i === win ? 'win' : 'lose'); });
      }
      setTimeout(function () { on(ans); var q = stagePct(ans); burst(q.x, q.y, 28, ['#ffd54a', '#ff8a65', '#4fc3f7', '#66bb6a', '#b388ff']); }, 120);
    }
  };
};
Scenes.tip = function (seg) {
  var d = seg.data, c = mkCard('tip', true);
  var card = el('div', 't-card', '<div class="t-paw"><svg viewBox="0 0 64 64"><ellipse cx="32" cy="42" rx="15" ry="12"/><ellipse cx="14" cy="28" rx="6" ry="8"/><ellipse cx="26" cy="18" rx="6" ry="8"/><ellipse cx="38" cy="18" rx="6" ry="8"/><ellipse cx="50" cy="28" rx="6" ry="8"/></svg>Dog\'s tip</div><div class="t-emoji">' + esc(d.emoji) + '</div>');
  var tx = el('div', 't-text rise', esc(d.text)); card.appendChild(tx); c.bd.appendChild(card);
  return {start: function (p) { if (!p.tip) on(tx); }, marker: function (n) { if (n === 'tip') on(tx); }};
};
Scenes.news = function (seg) {
  var d = seg.data, c = mkCard('news'), ul = el('ul', 'n-list'), lis = [], shown = [];
  d.items.forEach(function (it) {
    // a birthday's balloon is there from the start (hidden), so the words are sized with room for it
    var li = el('li', it.birthday ? 'bday' : '', '<span class="n-e">' + esc(it.emoji) + '</span><span class="n-t">' + esc(it.text) + '</span>' +
      (it.birthday ? '<span class="n-e n-b">🎈</span>' : ''));
    ul.appendChild(li); lis.push(li);
  });
  var nn = d.items.length, longest = Math.max.apply(null, d.items.map(function (x) { return x.text.length; }));
  ul.style.setProperty('--nsz', (nn <= 3 ? 3.2 : nn === 4 ? 2.8 : 2.4) * (longest > 45 ? 0.88 : 1) + 'cqw');
  c.bd.appendChild(ul);
  function showItem(k) {
    var li = lis[k];
    if (!li || shown[k]) return;
    shown[k] = true; on(li);
    if (d.items[k].birthday) { li.classList.add('pop'); confetti(); pose('laughing', 1.6); }
  }
  return itemCues(seg, lis.length, showItem);
};
/* items shown on their markers {1} to {4}, or spread across the lines when a marker is missing (news, stars, countdowns) */
function itemCues(seg, count, showItem) {
  var dflt = [], L = seg.lines.length;
  return {
    start: function (p) { for (var k = 0; k < count; k++) if (!p[String(k + 1)]) dflt[k] = Math.floor(k * L / count); },
    lineStart: function (li) { for (var k = 0; k < count; k++) if (dflt[k] === li) showItem(k); },
    marker: function (n) { if (/^\d$/.test(n)) showItem(+n - 1); }
  };
}
var STAR_SVG = '<svg viewBox="0 0 100 100"><defs><linearGradient id="stg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#ffb300"/></linearGradient></defs>' +
  '<path d="M50 6 L62 37 L95 38 L69 59 L78 92 L50 73 L22 92 L31 59 L5 38 L38 37 Z" fill="url(#stg)" stroke="#e08600" stroke-width="5" stroke-linejoin="round"/>' +
  '<path d="M50 20 L56 39 L44 41 Z" fill="#fff6c8" opacity="0.85"/></svg>';
Scenes.star = function (seg) {
  var d = seg.data, c = mkCard('star'), n = d.items.length, wrap = el('div', 'st-row n' + n), cells = [], shown = [];
  if (d.title) c.box.querySelector('.hd').lastChild.textContent = d.title;
  // one star large, two side by side, three or four as rows; a long name may take two lines before it gets smaller
  var longest = Math.max.apply(null, d.items.map(function (x) { return x.name.length; }));
  var room = n === 1 ? 50 : n === 2 ? 24 : 38, base = n === 1 ? 7.2 : n === 2 ? 5 : 3.6;
  if (n >= 3) wrap.classList.add('rows');
  wrap.style.setProperty('--stn', Math.min(base, (n >= 3 ? 1 : 2) * room / (0.56 * Math.max(4, longest))).toFixed(2) + 'cqw');
  d.items.forEach(function (it) {
    var cell = el('div', 'st-cell', '<div class="st-art"><i class="st-rays"></i>' + STAR_SVG + '</div><div class="st-words"><div class="st-name">' + esc(it.name) + '</div>' +
      (it.reason ? '<div class="st-why">' + esc(it.reason) + '</div>' : '') + '</div>');
    wrap.appendChild(cell); cells.push(cell);
  });
  c.bd.appendChild(wrap);
  function showItem(k) {
    if (!cells[k] || shown[k]) return;
    shown[k] = true; on(cells[k]);
    var q = stagePct(cells[k].querySelector('.st-art'));
    burst(q.x, q.y, 34, ['#ffd54a', '#ffe98a', '#ffb300', '#fff3b0', '#ff9f43']);
    Music.applause(); pose('laughing', 1.6);
  }
  return itemCues(seg, n, showItem);
};
Scenes.countdown = function (seg) {
  var d = seg.data, c = mkCard('countdown'), n = d.items.length, wrap = el('div', 'cd-row n' + n), tiles = [], shown = [], landed = 0;
  // long event names get smaller words, so the tiles stay in the card
  var lu = Math.max.apply(null, d.items.map(function (x) { return x.until.length + 6; })) * (n === 1 ? 0.5 : n === 2 ? 0.8 : 1);
  wrap.style.setProperty('--cdk', lu > 60 ? 0.62 : lu > 42 ? 0.74 : lu > 28 ? 0.86 : 1);
  d.items.forEach(function (it) {
    var today = it.count === 0, what = today ? it.until.charAt(0).toUpperCase() + it.until.slice(1) : 'until ' + it.until;
    var t = el('div', 'cd-tile' + (today ? ' today' : ''), '<div class="cd-e">' + esc(it.emoji) + '</div><div class="cd-n"></div>' +
      (today ? '' : '<div class="cd-u">' + esc(cdUnitLabel(it.unit, it.count)) + '</div>') + '<div class="cd-until">' + esc(what) + '</div>');
    wrap.appendChild(t); tiles.push(t);
  });
  c.bd.appendChild(wrap);
  function showItem(k) {
    var it = d.items[k], t = tiles[k];
    if (!t || shown[k]) return;
    shown[k] = true; on(t);
    // the number flips down from a few higher and lands on the day's count
    var nEl = t.querySelector('.cd-n'), from = it.count + (it.count ? 5 : 3), last = null;
    nEl.textContent = String(from);
    tween(1.3, function (p) {
      var v = Math.round(from - (from - it.count) * (1 - Math.pow(1 - p, 2)));
      if (v !== last) {
        last = v;
        nEl.textContent = v === 0 && it.count === 0 ? 'Today!' : String(v);
        nEl.classList.remove('flip'); void nEl.offsetWidth; nEl.classList.add('flip');
        if (p < 1) Music.tick(v % 2);
      }
      if (p >= 1) {
        t.classList.add('land'); Music.ding();
        var q = stagePct(nEl); burst(q.x, q.y, 22, ['#4dd0c4', '#ffd54a', '#7fb8ff', '#ff8a65']);
        if (!landed++) pose('surprised', 1.6);
      }
    });
  }
  return itemCues(seg, n, showItem);
};
Scenes.schedule = function (seg) {
  var d = seg.data, c = mkCard('schedule', true), n = d.items.length;
  c.bd.style.justifyContent = 'flex-start';
  c.bd.appendChild(el('div', 's-title', 'Our day'));
  var ul = el('ul', 's-list'), lis = [];
  var longest = Math.max.apply(null, d.items.map(function (x) { return x.label.length + (x.special ? 3 : 0); }));
  ul.style.setProperty('--sz', Math.max(1.7, Math.min(n <= 4 ? 3.4 : n <= 6 ? 3 : n <= 7 ? 2.7 : 2.4, 34 / (0.56 * longest))) + 'cqw');
  d.items.forEach(function (it) {
    var li = el('li', it.special ? 'special' : '', '<span class="s-time">' + esc(it.time) + '</span><span class="s-dot"></span><span class="s-label">' + esc(it.label) + '</span>');
    ul.appendChild(li); lis.push(li);
  });
  c.bd.appendChild(ul);
  if (d.note) c.bd.appendChild(el('div', 's-note', '📌 ' + esc(d.note)));
  var pulsed = -1;
  return {
    start: function () {
      lis.forEach(function (li, k) { li.style.transitionDelay = (k * 0.15) + 's'; });
      requestAnimationFrame(function () { requestAnimationFrame(function () { lis.forEach(on); }); });
    },
    marker: function (nm) {
      if (!/^\d$/.test(nm)) return;
      if (pulsed >= 0 && lis[pulsed]) lis[pulsed].classList.remove('pulse');
      pulsed = +nm - 1;
      if (lis[pulsed]) lis[pulsed].classList.add('pulse');
    },
    lineEnd: function () { if (pulsed >= 0 && lis[pulsed]) lis[pulsed].classList.remove('pulse'); pulsed = -1; }
  };
};
function wxIconSVG(kind) {
  var sun = '<g class="wx-sun-rays">' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return '<rect x="47" y="2" width="6" height="16" rx="3" fill="#ffb300" transform="rotate(' + a + ' 50 50)"/>'; }).join('') + '</g><circle cx="50" cy="50" r="22" fill="#ffd54a"/>';
  var cloud = function (fill) { return '<g class="wx-cloud" stroke="#9fb2d6" stroke-width="0"><ellipse cx="38" cy="62" rx="22" ry="15" fill="' + fill + '"/><ellipse cx="62" cy="58" rx="22" ry="18" fill="' + fill + '"/><ellipse cx="50" cy="48" rx="18" ry="17" fill="' + fill + '"/><rect x="22" y="58" width="58" height="19" rx="9" fill="' + fill + '"/></g>'; };
  var inner = '';
  if (kind === 'sun') inner = sun;
  else if (kind === 'partly') inner = '<g transform="translate(-14 -14) scale(0.8) translate(12 6)">' + sun + '</g><g transform="translate(8 6)">' + cloud('#e3ecfa') + '</g>';
  else if (kind === 'cloud') inner = cloud('#c9d8f0');
  else if (kind === 'rain') inner = cloud('#a9b9d6') + [30, 50, 70].map(function (x) { return '<rect class="wx-drop" x="' + x + '" y="72" width="5" height="12" rx="2.5" fill="#3b8ee0"/>'; }).join('');
  else if (kind === 'storm') inner = cloud('#7f8db0') + '<path class="wx-bolt" d="M54 66 L42 86 L51 86 L46 100 L64 78 L55 78 Z" fill="#ffd54a"/>';
  else inner = cloud('#d3ddee') + [74, 82, 90].map(function (y, i) { return '<rect class="wx-fog" x="' + (22 + i * 4) + '" y="' + y + '" width="56" height="5" rx="2.5" fill="#b7c3da"/>'; }).join('');
  return '<svg class="wx-icon" viewBox="0 0 100 104">' + inner + '</svg>';
}
Scenes.weather = function (seg) {
  var d = seg.data, c = mkCard('weather');
  var row = el('div', 'wx-row', wxIconSVG(d.icon));
  var tp = el('div', 'wx-temp rise', '<div class="t">' + d.now + '°</div><div class="hl">Top ' + d.max + '°, low ' + d.min + '°</div>');
  row.appendChild(tp); c.bd.appendChild(row);
  var chips = el('div', 'wx-chips'), els = [], nc = d.chips.length;
  chips.style.setProperty('--chf', (nc <= 2 ? 3.1 : nc <= 4 ? 2.6 : 2.3) + 'cqw');
  c.bd.appendChild(el('div', 'wx-head', 'What to wear'));
  d.chips.forEach(function (ch) { var e = el('div', 'chip', '<span class="ce">' + ch.e + '</span>' + esc(ch.l)); chips.appendChild(e); els.push({e: e, n: ch.n}); });
  if (!els.length) chips.appendChild(el('div', 'wx-none', 'A good day for whatever you like!'));
  c.bd.appendChild(chips);
  var k = 0;
  function showChips(n) { els.forEach(function (x) { if (x.n === n) { x.e.style.transitionDelay = (k++ % 3) * 0.15 + 's'; on(x.e); } }); }
  return {
    start: function (p) { if (!p.temp) on(tp); },
    marker: function (n) { if (n === 'temp') on(tp); else if (/^c\d$/.test(n)) showChips(+n.slice(1)); }
  };
};
function wordsSpans(text, cls) { return text.split(' ').map(function (w) { return '<span class="wd ' + cls + '">' + esc(w) + '</span>'; }).join(' '); }
Scenes.hello = function (seg) {
  var T = $('studioTitle'), t1 = 'Good morning!', t2 = dateLabel(seg.data.iso || todayISO());
  T.className = ''; T.hidden = false;
  T.innerHTML = '<span class="t1">' + wordsSpans(t1, 'a') + '</span><span class="t2">' + wordsSpans(t2, 'b') + '</span>';
  var ws = T.querySelectorAll('.wd'), shown = 0;
  function upTo(n) { while (shown < n && shown < ws.length) { ws[shown].classList.add('on'); shown++; } }
  return {
    start: function () { upTo(1); },
    tick: function (li, p) { if (li === 0) upTo(Math.floor(clamp(p / 0.85, 0, 1) * ws.length) + 1); else upTo(ws.length); },
    lineStart: function (li) { if (li > 0) upTo(ws.length); },
    lineEnd: function () { upTo(ws.length); }
  };
};
Scenes.signoff = function (seg) {
  var T = $('studioTitle'), B = $('breath'), bt = B.querySelector('.bt');
  T.className = 'calm'; T.hidden = false;
  T.innerHTML = '<span class="t1">Ready to learn</span>';
  // with breathing cues in the words the circle follows them; otherwise it just breathes by itself
  B.className = seg.breath ? 'cue' : 'idle'; bt.textContent = '';
  B.hidden = false;
  return {
    start: function () {},
    marker: function (n) {
      if (!seg.breath) return;
      if (n === 'bin') { B.classList.remove('out'); B.classList.add('in'); bt.textContent = 'in'; }
      else if (n === 'bout') { B.classList.remove('in'); B.classList.add('out'); bt.textContent = 'out'; }
    }
  };
};
function destroyScene() {
  unpose();
  $('card').innerHTML = ''; $('studioTitle').hidden = true; $('studioTitle').innerHTML = ''; $('breath').hidden = true;
  tweens.length = 0;
  $('fx').innerHTML = '';
}

/* ================= captions ================= */
function chunkLine(text) {
  var out = [];
  Voices.sentences(text).forEach(function (s) {
    var t = s.t.replace(/\s+$/, ''), off = s.s;
    while (t.length > 110) {
      var mid = Math.floor(t.length / 2), best = -1, bd = 1e9, i;
      for (i = 30; i < t.length - 30; i++) {
        var ch = t.charAt(i);
        if (ch === ' ' || ch === ',') {
          var dist = Math.abs(i - mid) - (t.charAt(i - 1) === ',' ? 15 : 0);
          if (dist < bd) { bd = dist; best = i + 1; }
        }
      }
      if (best < 0) break;
      out.push({s: off, e: off + best, t: t.slice(0, best).trim()});
      t = t.slice(best); off += best;
    }
    out.push({s: off, e: off + t.length + 1, t: t.trim()});
  });
  return out;
}

/* ================= the runner ================= */
var R = {token: 0, abort: Promise.resolve(), abortRes: null, paused: false, timers: [], seg: -1, li: -1, scene: null, speaker: null, playing: false,
  markers: [], chunks: [], capIdx: -1, clock: 0, segStart: 0, think: null, active: false, show: null, engine: null, lineAt: 0, wake: null,
  lineEng: null, late: 0, target: null, unpause: null, unpauseRes: null};
/* resolves when the show is no longer paused (or a new run starts) */
function whenUnpaused() {
  if (!R.paused) return Promise.resolve();
  if (!R.unpause) R.unpause = new Promise(function (r) { R.unpauseRes = r; });
  return R.unpause;
}
function releaseUnpause() { var r = R.unpauseRes; R.unpause = null; R.unpauseRes = null; if (r) r(); }
function newRun() {
  R.token++;
  if (R.abortRes) R.abortRes();
  R.abort = new Promise(function (r) { R.abortRes = r; });
  var t = R.timers; R.timers = [];
  t.forEach(function (x) { x.res(); });
  releaseUnpause();
  if (R.engine) R.engine.stop();
  if (R.lineEng) { try { R.lineEng.stop(); } catch (e) {} R.lineEng = null; }
  R.think = null; R.playing = false; R.speaker = null; R.markers = [];
  if (Music.pad) Music.padOff();
  $('hold').hidden = true;
  return {tok: R.token, abort: R.abort};
}
function alive(ctl) { return ctl.tok === R.token; }
function sleep(sec) { return new Promise(function (res) { R.timers.push({left: sec * (FAST ? 0.25 : 1), res: res}); }); }
async function step(p, ctl) {
  await Promise.race([Promise.resolve(p).catch(function () {}), ctl.abort]);
  return alive(ctl);
}
function setCaption(line) {
  R.chunks = chunkLine(line.text); R.capIdx = -1; R.capLine = line;
  drawCaption(0);
}
function drawCaption(p) {
  var line = R.capLine, cap = $('captions');
  if (!line || !S.set.captions || !R.chunks.length) { cap.classList.remove('on'); return; }
  var pos = clamp(p, 0, 0.999) * line.text.length, idx = R.chunks.length - 1, i;
  for (i = 0; i < R.chunks.length; i++) if (pos < R.chunks[i].e) { idx = i; break; }
  if (idx !== R.capIdx || !cap.classList.contains('on')) {
    R.capIdx = idx;
    var who = cap.querySelector('.who'); who.textContent = line.dog; who.className = 'who ' + line.dog.toLowerCase();
    cap.querySelector('.txt').textContent = R.chunks[idx].t;
    cap.classList.add('on');
  }
}
function fireMarkers(p) {
  var sc = R.scene;
  R.markers.forEach(function (m) {
    if (m.fired) return;
    if (m.frac < 0.15 || p >= m.frac) {
      m.fired = true;
      if (m.name === 'laugh') pose('laughing', 1.6);
      else if (sc && sc.marker) sc.marker(m.name, R.li);
    }
  });
}
function seekWipe() {
  var w = $('wipe');
  w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
  setTimeout(function () { w.classList.remove('go'); }, 560);
}
function enterSegment(seg, i) {
  destroyScene();
  R.seg = i; R.li = -1; R.target = null;
  log('segment', 'Segment ' + (i + 1) + ' of ' + R.show.segs.length + ' started: ' + seg.kind + ' (' + seg.lines.length + ' lines)');
  var st = $('stage');
  st.dataset.seg = seg.kind;
  setLayout(seg.layout);
  setBase(false);
  R.capLine = null; $('captions').classList.remove('on');
  R.scene = Scenes[seg.kind] ? Scenes[seg.kind](seg) : {start: function () {}};
  if (seg.layout === 'card') {
    fitNow();
    var box = document.querySelector('#card .cbox');
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (box && box.isConnected) fitCard(box); }); } catch (e) {}
  }
  var present = {};
  seg.lines.forEach(function (l) { l.markers.forEach(function (m) { present[m.name] = true; }); });
  R.scene.start && R.scene.start(present);
}
/* after a second line that was not ready in time, the rest of the show uses this computer's voices */
function switchToSimpler() {
  var k = R.engine, st = k && k.stats && k.stats();
  if (st) st.cancelled = true;
  var b = getEngine('browser');
  R.engine = b.available() ? b : getEngine('captions');
  R.engine.prepare(R.show.flat);
  if (S.last && S.last.show === R.show) S.last.engine = R.engine;
  setVoiceStatus(R.engine);
  log('engine', 'Switched to simpler voices during the show: two lines were not ready in time. Now using ' + describeEngine(R.engine) + '.');
  toast('Switched to simpler voices');
}
async function playLine(seg, li, ctl) {
  var line = seg.lines[li], eng = R.engine, late = false;
  R.li = li;
  if (!eng.isReady(line.gi)) {
    $('hold').hidden = false;
    // "One moment..." for at most 8 seconds of show time; then this line is said by the simpler voices
    var ok = await step(Promise.race([eng.whenReady(line.gi), sleep(8).then(function () { late = true; })]), ctl);
    $('hold').hidden = true;
    if (!ok) return false;
    if (late && eng.isReady(line.gi)) late = false;
  }
  while (R.paused) { if (!await step(whenUnpaused(), ctl)) return false; }
  var fb = null;
  if (late) {
    R.late++;
    log('engine', 'A voice line was not ready after 8 seconds (segment ' + (R.seg + 1) + ', line ' + (li + 1) + '), so the simpler voices said it. Late lines so far: ' + R.late + '.');
    fb = voiceEnv().fallback();
    if (fb.id === 'captions') fb.prepare([{dog: line.dog, text: line.text}]);
  }
  R.speaker = line.dog; lightTag(line.dog); setCaption(line);
  var sc = R.scene;
  if (sc && sc.lineStart) sc.lineStart(li);
  R.markers = line.markers.map(function (m) { return {name: m.name, frac: m.frac, fired: false}; });
  fireMarkers(0);
  R.playing = true; R.lineAt = R.clock;
  R.lineEng = fb;
  var okp = await step(fb ? (fb.id === 'captions' ? fb.play(0) : fb.say(line.dog, line.text)) : eng.play(line.gi), ctl);
  if (fb && R.lineEng === fb) R.lineEng = null;
  if (!okp) return false;
  if (fb && R.late >= 2 && R.engine === eng && eng.id === 'kokoro') switchToSimpler();
  fireMarkers(2);
  if (sc && sc.tick) sc.tick(li, 1);
  if (sc && sc.lineEnd) sc.lineEnd(li);
  R.playing = false; R.speaker = null; lightTag(null);
  if (/!["')]*\s*$/.test(line.text) && FACE[line.dog]) FACE[line.dog].grinUntil = performance.now() + 500;
  if (LAUGH_RE.test(line.text) && !line.markers.some(function (m) { return m.name === 'laugh'; })) pose('laughing', 1.6);
  return true;
}
async function thinkPause(seg, ctl) {
  var total = S.set.think * (FAST ? 0.25 : 1), sc = R.scene;
  var th = R.think = {left: total, total: total, shown: Math.ceil(total), done: null};
  var p = new Promise(function (res) { th.done = res; });
  if (sc && sc.thinkOn) sc.thinkOn(S.set.think);
  Music.padOn(); pose('thinking');
  var ok = await step(p, ctl);
  Music.padOff(); unpose();
  if (!ok) return false;
  R.think = null;
  if (sc && sc.thinkOff) sc.thinkOff();
  return true;
}
async function playSegment(i, ctl, startLine, intro) {
  var seg = R.show.segs[i];
  R.segStart = R.clock;
  if (intro) {
    // the show name over the studio picture, with the jingle
    destroyScene(); setLayout('studio'); setBase(false); $('stage').dataset.seg = 'hello';
    var T = $('studioTitle');
    T.className = 'intro'; T.hidden = false; T.innerHTML = '<span class="t1">' + esc(S.set.showName) + '</span>';
    T.firstChild.style.fontSize = Math.min(5.2, 170 / Math.max(1, S.set.showName.length)).toFixed(2) + 'cqw';
    Music.jingle();
    if (!await step(sleep(S.set.music && S.ctx && S.ctx.state === 'running' ? 3 : 0.8), ctl)) return false;
  } else if (R.seg >= 0 || R.scene) {
    seekWipe(); Music.sting();
    if (!await step(sleep(0.25), ctl)) return false;
  }
  R.segStart = R.clock;
  enterSegment(seg, i);
  if (!intro) await step(sleep(0.25), ctl);
  if (!alive(ctl)) return false;
  var revealed = false;
  for (var li = startLine; li < seg.lines.length; li++) {
    if (!await playLine(seg, li, ctl)) return false;
    if (seg.lines[li].hold && !await step(sleep(seg.lines[li].hold), ctl)) return false;
    if (seg.kind === 'puzzle' && li === seg.askCount - 1) {
      if (!await thinkPause(seg, ctl)) return false;
      revealed = true;
      R.scene.reveal && R.scene.reveal();
      pose('surprised', 1.6);
      if (!await step(sleep(0.9), ctl)) return false;
    } else if (li < seg.lines.length - 1) {
      if (!await step(sleep(0.3), ctl)) return false;
    }
  }
  if (seg.kind === 'puzzle' && !revealed) { R.scene.reveal && R.scene.reveal(); pose('surprised', 1.6); if (!await step(sleep(1.6), ctl)) return false; }
  if (seg.kind === 'signoff') { Music.chord(); if (!await step(sleep(2.6), ctl)) return false; }
  return step(sleep(0.8), ctl);
}
async function runFrom(si, li0, intro) {
  var ctl = newRun(), i = si;
  R.active = true;
  try {
    for (; i < R.show.segs.length; i++) {
      var ok = await playSegment(i, ctl, i === si ? (li0 || 0) : 0, intro && i === si);
      if (!alive(ctl) || !ok) return;
    }
    if (alive(ctl)) endScreen();
  } catch (e) {
    noteError('run: ' + (e && e.message || e)); console.warn(e);
    // a segment that breaks is skipped, not the end of the show
    if (alive(ctl)) jumpTo(i + 1);
  }
}
function jumpTo(si) {
  if (!R.show) return;
  si = clamp(si, 0, R.show.segs.length);
  R.target = si;   // where a quick second press counts from, until the segment starts
  if (R.paused) setPaused(false);
  if (si >= R.show.segs.length) { newRun(); endScreen(); return; }
  runFrom(si, 0, false);
}
function setPaused(v, quiet) {
  R.paused = v;
  try { if (S.ctx) { if (v) S.ctx.suspend(); else S.ctx.resume(); } } catch (e) {}
  if (R.engine) { if (v) R.engine.pause(); else R.engine.resume(); }
  if (R.lineEng && R.lineEng !== R.engine) { try { if (v) R.lineEng.pause(); else R.lineEng.resume(); } catch (e) {} }
  if (!v) releaseUnpause();
  var b = $('cPlay'); b.innerHTML = v ? '&#9654;' : '&#10074;&#10074;'; b.setAttribute('aria-label', v ? 'Play' : 'Pause');
  if (!quiet) pokeControls();
}
function skipThink() { if (R.think) R.think.left = 0; }
function nextSeg() {
  if (R.think) { if (R.paused) setPaused(false); return skipThink(); }
  jumpTo((R.target != null ? R.target : R.seg) + 1);
}
function prevSeg() {
  if (R.target != null) return jumpTo(R.target - 1);
  jumpTo(R.clock - R.segStart > 2 || R.seg <= 0 ? R.seg : R.seg - 1);
}

var lastTs = 0;
function frame(ts) {
  try { frameBody(ts); } catch (e) { noteError('frame: ' + (e && e.message || e)); } finally { requestAnimationFrame(frame); }
}
function frameBody(ts) {
  // up to half a second a frame, so a slow computer's show clock still keeps up with the wall clock
  var dt = lastTs ? Math.min(0.5, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;
  var now = performance.now();
  if (!R.paused) {
    var ticked = [];
    [ENG.kokoro, ENG.browser, ENG.captions, R.engine, R.lineEng].forEach(function (e) {
      if (e && e.tick && ticked.indexOf(e) < 0) { ticked.push(e); e.tick(dt); }
    });
    runTweens(dt);
  }
  if (S.screen === 'show' && !R.paused) {
    R.clock += dt;
    var ti = R.timers; R.timers = [];
    ti.forEach(function (x) { x.left -= dt; if (x.left <= 0) x.res(); else R.timers.push(x); });
    if (R.think) {
      var th = R.think; th.left -= dt;
      if (R.scene && R.scene.thinkTick) R.scene.thinkTick(Math.max(0, th.left), th.total);
      var sh = Math.ceil(Math.max(0, th.left));
      if (sh !== th.shown) { th.shown = sh; if (sh > 0) Music.tick(sh % 2); }
      if (th.left <= 0 && th.done) { var dn = th.done; th.done = null; dn(); }
    }
    if (R.playing && (R.lineEng || R.engine)) {
      var p = (R.lineEng || R.engine).progress();
      fireMarkers(p);
      if (R.scene && R.scene.tick) R.scene.tick(R.li, p);
      drawCaption(p);
    }
  }
  var le = R.lineEng || R.engine;
  var level = (S.screen === 'show' && R.playing && !R.paused && le) ? le.level() : 0;
  var force = S.screen === 'end' && !(S.pres && S.pres.wave);
  updateFaces(now, S.screen === 'show' ? R.speaker : null, level, force);
}

/* ================= controls and screens ================= */
var ctlTimer = 0;
function pokeControls() {
  var c = $('controls');
  if (S.screen !== 'show') { c.classList.remove('on'); return; }
  c.classList.add('on'); $('stage').classList.remove('nocursor');
  clearTimeout(ctlTimer);
  ctlTimer = setTimeout(function () {
    if (R.paused && S.screen === 'show') return;   // a paused show keeps its controls showing
    c.classList.remove('on'); if (S.screen === 'show') $('stage').classList.add('nocursor');
  }, 3000);
}
function showScreen(n) {
  S.screen = n;
  [['home', 'home'], ['ready', 'ready'], ['show', 'showui'], ['end', 'endscreen']].forEach(function (p) { $(p[1]).hidden = p[0] !== n; });
  var st = $('stage');
  st.classList.toggle('notags', n !== 'show');
  st.classList.remove('nocursor');
  if (n !== 'show') {
    destroyScene(); setLayout('studio'); setBase(n === 'end'); delete st.dataset.seg;
    $('captions').classList.remove('on'); $('hold').hidden = true; $('controls').classList.remove('on');
    lightTag(null);
  }
  $('deskfaces').style.display = n === 'end' && S.pres && S.pres.wave ? 'none' : '';
  idleFollow();
  if (n === 'home') refreshHome();
}
function toast(msg, bad, ms) {
  var t = $('toast');
  log('message', (bad ? 'Warning on screen: ' : 'Message on screen: ') + msg);
  if (S.pasteMsgs) S.pasteMsgs.push(msg);
  t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, ms || 3500);
}
/* where the show is, in words, for the log */
function showPlace() {
  var segs = R.show ? R.show.segs : [], sg = segs[R.seg];
  return sg ? 'segment ' + (R.seg + 1) + ' of ' + segs.length + ' (' + sg.kind + '), line ' + (R.li + 1) + ', ' + Math.round(R.clock) + ' seconds into the show' : 'before the first segment';
}
function logLeaving() { if (S.screen === 'show' && R.active) log('show', 'The page was closed, reloaded or lost during the show, at ' + showPlace()); }
function endScreen() {
  if (S.screen === 'show') log('show', 'Show finished: ' + (R.show ? R.show.segs.length : 0) + ' segments, ' + Math.round(R.clock) + ' seconds of show time, voices ' + (S.usedEngine || 'unknown'));
  R.active = false; R.playing = false; R.speaker = null; releaseWake();
  Music.padOff();
  showScreen('end');
}
function stopShow() {
  if (S.screen === 'show') log('show', 'Left the show early at ' + showPlace());
  // unpause first, so the browser's voices and the sound are awake again for Try
  setPaused(false, true);
  newRun(); R.active = false; releaseWake();
  showScreen('home');
}
function requestWake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { R.wake = w; }).catch(function () {}); } catch (e) {} }
function releaseWake() { try { if (R.wake) R.wake.release(); } catch (e) {} R.wake = null; }
function toggleFull() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  } catch (e) {}
}
function startShow(startSeg, startLine, withIntro) {
  log('show', 'Show started: ' + (R.show ? R.show.segs.length : 0) + ' segments, voices ' + (R.engine ? R.engine.id : 'unknown') + (startSeg ? ', from segment ' + (startSeg + 1) : ''));
  showScreen('show');
  R.paused = false; setPaused(false, true);
  R.seg = -1; R.scene = null; R.clock = 0; R.late = 0; R.target = null;
  // the controls stay out of the way until the mouse really moves
  clearTimeout(ctlTimer); $('controls').classList.remove('on'); $('stage').classList.add('nocursor');
  requestWake();
  runFrom(startSeg || 0, startLine || 0, withIntro);
}

/* ================= voices: choosing and preparing ================= */
var ENG = {kokoro: null, browser: null, captions: null};
function voiceEnv() {
  return {
    force: P.get('kdevice') || '', getCtx: function () { return audioCtx(); }, out: function () { audioCtx(); return S.voiceOut; },
    baseUrl: document.baseURI, version: S.version,
    settings: function () { return {Bailey: S.set.voices.Bailey, Charlie: S.set.voices.Charlie}; },
    isPaused: function () { return R.paused; },
    fallback: function () { var b = getEngine('browser'); return b.available() ? b : getEngine('captions'); },
    onDead: function (why) {
      ENG.kokoro = null; S.kokoroFailed = true; S.kokoroError = why; kokoroRecord('failed');
      log('engine', 'The dog voices stopped working: ' + why);
      if (S.screen === 'show') toast('Switched to simpler voices');
    },
    note: function (t) { toast(t); }
  };
}
function getEngine(kind) {
  if (ENG[kind]) return ENG[kind];
  if (kind === 'kokoro') ENG.kokoro = Voices.makeKokoro(voiceEnv());
  else if (kind === 'browser') ENG.browser = Voices.makeBrowser(voiceEnv());
  else ENG.captions = Voices.makeCaptions({speed: FAST ? 4 : 1});
  return ENG[kind];
}
function wantedEngine() { return FAST ? 'captions' : (S.oneShot || P.get('engine') || S.set.engine); }
/* ui: {loading(k), download(frac, mb), note(text)} */
async function gpuAdapter() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}
async function hasWebGPU() {
  if (P.get('kdevice') === 'wasm') return false;
  return gpuAdapter();
}
/* What happened the last time the dog voices were tried on this computer, kept between visits:
   ms.kokoro = {state: 'trying' | 'ok' | 'failed' | 'slow', phase: 'load' | 'init' | 'loaded', at, ratio}.
   'trying' with phase 'init' left behind means the tab died while the engine was starting. */
function kokoroRecord(state, phase, ratio) {
  var r = {state: state, phase: phase || '', at: Date.now()};
  if (ratio != null) r.ratio = Math.round(ratio * 100) / 100;
  store.set('ms.kokoro', r);
}
/* why Auto leaves the dog voices alone: 'crash', 'failed', 'slow', or '' to try them */
function kokoroSkip() {
  var r = store.get('ms.kokoro', null);
  if (!r || typeof r !== 'object') return '';
  if (r.state === 'trying' && r.phase === 'init') return 'crash';
  if ((r.state === 'failed' || r.state === 'slow') && Date.now() - (+r.at || 0) < 7 * 864e5) return r.state;
  return '';
}
function kokoroRetry() { store.del('ms.kokoro'); S.kokoroFailed = false; S.kokoroSkipped = ''; }
/* what the voice record says, in words, for the log and the report */
function kokoroRecordText() {
  var r = store.get('ms.kokoro', null);
  if (!r || typeof r !== 'object') return 'none yet';
  return String(r.state) + (r.phase ? ' (' + r.phase + ')' : '') + (r.ratio != null ? ', speed ' + r.ratio + ' times real time' : '') + (r.at ? ', ' + stamp(r.at) : '');
}
/* where the engine setting came from */
function wantedWhy(want) {
  if (FAST) return 'the quick test mode uses captions only';
  if (S.oneShot) return 'simpler voices were chosen for this show';
  if (P.get('engine')) return 'the address asks for ' + want;
  return 'Settings say ' + ({kokoro: 'Kokoro (the dog voices)', browser: 'Browser voices', captions: 'Captions only', auto: 'Auto'}[want] || want);
}
/* {yes: Play would use the dog voices without asking, why: in words} */
async function kokoroChoice(want) {
  var base = wantedWhy(want);
  if (want === 'kokoro') return {yes: true, why: base};
  if (want !== 'auto') return {yes: false, why: base};
  if (S.kokoroFailed) return {yes: false, why: 'Auto: the dog voices failed earlier on this visit' + (S.kokoroError ? ' (' + S.kokoroError + ')' : '')};
  var why = kokoroSkip(), k = ENG.kokoro, live = k && (k.loaded || k.loadPromise);
  // a 'trying' or 'slow' record written by this visit's own engine does not count against it
  if (why && !(live && why !== 'failed')) { S.kokoroSkipped = why; return {yes: false, why: 'Auto: the last try of the dog voices on this computer ended as "' + why + '" (record: ' + kokoroRecordText() + ')'}; }
  var gpu = await hasWebGPU();
  return {yes: gpu, why: gpu ? 'Auto: this computer has WebGPU and the dog voices have not failed here' : 'Auto: no WebGPU on this computer' + (P.get('kdevice') === 'wasm' ? ' (the address turns it off)' : '')};
}
/* true when Play would use the dog voices without asking */
async function kokoroWanted(want) { return (await kokoroChoice(want)).yes; }
/* load the dog voices, keeping ms.kokoro up to date; a failure turns them off for this visit */
async function loadKokoro(k, want, onDownload) {
  if (k.loaded) return k;
  if (!k.loadPromise) kokoroRecord('trying', 'load');
  S.kokoroLoading = true;
  var initNoted = false, mile = 0, t0 = performance.now();
  log('voices', 'Loading the dog voices (setting: ' + want + ')');
  function dl(d) {
    // the download is done: the engine is starting, which is when a weak graphics driver can take the tab down
    if (!initNoted && d && d.fraction >= 0.999) { initNoted = true; kokoroRecord('trying', 'init'); }
    if (d && isFinite(d.fraction) && Math.floor(d.fraction * 4) * 25 > mile) {
      mile = Math.floor(d.fraction * 4) * 25;
      log('voices', 'Dog voices ' + (k.loadInfo && k.loadInfo.downloading ? 'downloading' : 'loading') + ': ' + mile + '%' + (d.mb ? ' of about ' + Math.round(d.mb) + ' MB' : ''));
    }
    if (onDownload) onDownload(d);
  }
  try {
    await k.load(dl, {webgpuOnly: want === 'auto'});
  } catch (e) {
    log('voices', 'The dog voices did not load after ' + ((performance.now() - t0) / 1000).toFixed(1) + ' seconds: ' + (e && e.cancelled ? 'cancelled' : e && e.noGpu ? 'no WebGPU' : String(e && e.message || e)));
    S.kokoroLoading = false;
    if (!(e && (e.cancelled || e.noGpu))) {
      if (ENG.kokoro === k) ENG.kokoro = null;
      S.kokoroFailed = true; S.kokoroError = String(e && e.message || e); kokoroRecord('failed');
    }
    throw e;
  }
  S.kokoroLoading = false;
  log('voices', 'The dog voices loaded in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' seconds (' + (k.backend || 'unknown') + ' backend)');
  var r = store.get('ms.kokoro', null);
  if (!r || r.state === 'trying') kokoroRecord('trying', 'loaded');
  return k;
}
/* the first line made means the dog voices work here */
function kokoroProgress(st) {
  if (!S.kokoroOk && st && st.items && st.items.some(Boolean)) { S.kokoroOk = true; kokoroRecord('ok'); }
}
/* when every line has been made, note a computer that makes them slower than they play */
function kokoroWatch(eng, st) {
  if (!st || !st.promise) return;
  st.promise.then(function () {
    if (st.cancelled || st.dead) { log('voices', 'Making the dog voice lines stopped early: ' + (st.dead ? 'the voice engine stopped' + (st.firstError ? ' (' + st.firstError + ')' : '') : 'cancelled') + ', ' + st.done + ' of ' + st.total + ' made'); return; }
    var ratio = eng.speedRatio ? eng.speedRatio() : 0;
    log('voices', 'Made ' + st.done + ' of ' + st.total + ' lines' + (st.failed ? ', ' + st.failed + ' failed' + (st.firstError ? ' (' + st.firstError + ')' : '') : '') +
      (st.genSec > 0 ? ': ' + st.genSec.toFixed(1) + ' seconds of work for ' + st.playSec.toFixed(1) + ' seconds of speech, ' + ratio.toFixed(1) + ' times faster than it plays' : ' (all from the saved copies)'));
    if (st.genSec > 0 && ratio < 1) kokoroRecord('slow', '', ratio);
  });
}
/* the voice engine is chosen: say which, and why */
function engineChosen(eng, why) {
  log('engine', 'Voice engine chosen: ' + describeEngine(eng) + ' [' + eng.id + ']. Why: ' + why + '. Settings engine: ' + S.set.engine + '. Dog voices record: ' + kokoroRecordText() + '.');
  return eng;
}
async function resolveEngine(ui) {
  var want = wantedEngine();
  if (want === 'captions') return engineChosen(getEngine('captions'), wantedWhy(want));
  // Auto: the dog voices only when there is a graphics card to make them quickly; otherwise this computer's own voices.
  var ch = await kokoroChoice(want), why = ch.why;
  if (ch.yes) {
    try {
      var k = getEngine('kokoro');
      if (want === 'auto' && k.loaded && k.backend !== 'webgpu') throw new Error('standard-only');
      if (!k.loaded) { if (ui && ui.loading) ui.loading(k); await loadKokoro(k, want, ui && ui.download); }
      return engineChosen(k, why);
    } catch (e) {
      if (e && e.message === 'standard-only') { e = null; why = 'Auto: the dog voices were already loaded without WebGPU, which is too slow'; }
      else why = (e && e.cancelled ? 'Loading the dog voices was cancelled' : 'The dog voices could not load (' + String(e && (e.noGpu ? 'no WebGPU' : e.message) || e) + ')') + ', so simpler voices were used';
      if (e && ui && ui.note) ui.note(e.cancelled ? 'Using simpler voices.' : 'The dog voices could not load, so we are using simpler voices.');
    }
  }
  var b = getEngine('browser');
  if (b.available() || await b.waitForVoices(5000)) return engineChosen(b, why);
  if (ui && ui.note) ui.note("This computer's voices aren't ready, so it's captions only today.");
  return engineChosen(getEngine('captions'), why + ". This computer's voices were not ready after 5 seconds, so captions only");
}
function homeWarm(t) { var w = $('homeWarm'); w.textContent = t || ''; w.hidden = !t; }
/* Get the dog voices ready quietly while the show waits on the home screen (after a paste, or when today's show
   is already saved), only when Play would use them without asking. status(text) says how it is going. */
async function warmUp(status, asked) {
  if (FAST) return;
  var say = status || homeWarm;
  // everything but the progress counts is noted in the log
  status = function (t) { if (t && !/^(Downloading|Getting)/.test(t)) screenMsg('Home', t); say(t); };
  var tok = S.prep, script = S.script;
  try { await S.wxPromise; } catch (e) {}
  var want = wantedEngine();
  if (want === 'captions' || want === 'browser' || !(await kokoroWanted(want))) {
    if (asked) status('This computer uses simpler voices, so there is nothing to get ready.');
    return;
  }
  var k = getEngine('kokoro');
  if (want === 'auto' && k.loaded && k.backend !== 'webgpu') return;
  try {
    if (!k.loaded) {
      status('Getting the dog voices ready');
      await loadKokoro(k, want, function (d) {
        status(k.loadInfo && k.loadInfo.downloading && d.fraction < 0.98 ? 'Downloading the dog voices: ' + Math.round(d.fraction * 100) + '%' : 'Getting the dog voices ready');
      });
    }
  } catch (e) {
    status(e && (e.cancelled || e.noGpu) ? '' : 'The dog voices could not load on this computer, so the show will use simpler voices.');
    return;
  }
  if (asked) setVoiceStatus(k);
  // Play was pressed, or the show changed, while loading: Play makes the lines itself
  if (tok !== S.prep || !script || script !== S.script || S.screen !== 'home') { status(asked ? 'Voices: ' + describeEngine(k) + '. The dog voices are ready.' : ''); return; }
  var st = k.prepare(buildShow(script, S.wx).flat, function (s2) {
    if (tok !== S.prep) return;
    kokoroProgress(s2);
    status(s2.done >= s2.total ? 'The dog voices are ready.' : 'Getting the dog voices ready: ' + s2.done + ' of ' + s2.total);
  });
  kokoroWatch(k, st);
}
function describeEngine(e) { return e.describe ? e.describe() : e.label; }
function setVoiceStatus(e) {
  S.usedEngine = e ? e.id : '';
  var t = e ? 'Voices: ' + describeEngine(e) : 'Voices: not loaded yet. They load when you press Play, or Try.';
  $('sVoiceStatus').textContent = t;
}

function homeStatusText() {
  var s = S.script, today = todayISO();
  if (S.sample) return "Today's show is ready (sample)";
  if (!s) return "No show yet: press Play for a surprise show from the dogs";
  if (!s.for_date || s.for_date === today) return S.pasted ? "Today's show is saved. Press Play when you're ready." : "Today's show is ready";
  var p = parseISO(s.for_date);
  return 'This is ' + DAYS[p.dow] + "'s show (for " + dayMonth(s.for_date) + ')';
}
function refreshHome() {
  var name = S.set.showName;
  $('homeName').textContent = name;
  $('homeName').style.fontSize = Math.min(4.6, 150 / Math.max(1, name.length)).toFixed(2) + 'cqw';
  document.title = name;
  $('homeDate').textContent = dateLabel(todayISO());
  var st = $('homeStatus');
  if (!st.classList.contains('bad')) st.textContent = homeStatusText();
  var w = $('homeWeather');
  if (S.wx) { w.hidden = false; w.textContent = ', ' + wxEmoji(wxKind(S.wx.code).icon) + ' ' + Math.round(S.wx.now) + '° in ' + S.set.loc.name; } else w.hidden = true;
}
/* a pasted show that does not match its own date: "The dogs say Monday, but the show is dated Tuesday 27 October." */
function dateWarning(sc, stamped) {
  var p = parseISO(sc.for_date);
  if (!p) return '';
  var m = new RegExp('\\b(' + DAYS.join('|') + ')\\b', 'i').exec(sc.hello.map(function (l) { return l.text; }).join(' '));
  var said = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : '';
  if (said && said !== DAYS[p.dow]) return 'The dogs say ' + said + ', but the show is dated ' + dateLabel(sc.for_date) + '. Check with Claude.';
  if (!stamped && (p.dow === 0 || p.dow === 6)) return 'This show is dated ' + dateLabel(sc.for_date) + ', which is a weekend. Check with Claude.';
  return '';
}
var PART_NAMES = {word: 'word of the day', fact: 'fact', puzzle: 'puzzle', tip: 'tip', news: 'class news', schedule: 'timetable', star: 'star of the week', countdown: 'countdown'};
/* new segments from a partial reply replace the same kind in a copy of the saved show (or go in their usual place) */
function mergeParts(base, parts) {
  var sc = JSON.parse(JSON.stringify(base));
  parts.forEach(function (seg) {
    var at = -1;
    sc.segments.forEach(function (s, i) { if (s.type === seg.type) at = i; });
    if (at >= 0) { sc.segments[at] = seg; return; }
    var rank = SEG_ORDER.indexOf(seg.type), pos = sc.segments.length;
    for (var i = 0; i < sc.segments.length; i++) if (SEG_ORDER.indexOf(sc.segments[i].type) > rank) { pos = i; break; }
    sc.segments.splice(pos, 0, seg);
  });
  var cd = fixCountdowns(sc.segments, sc.for_date || todayISO());
  sc.segments = cd.segs; sc.notes = cd.notes; sc.dropped = 0;
  return sc;
}
function pasteFail(reason) {
  var st = $('homeStatus');
  st.classList.add('bad'); st.textContent = PASTE_SAYS[reason] || PASTE_SAYS.bad;
  if (S.pasteMsgs) S.pasteMsgs.push(st.textContent);
  toast(PASTE_SHORT[reason] || PASTE_SHORT.bad, true);
  return false;
}
/* a paste is noted whole: accepted or refused, the words shown, and the text itself */
function handlePasted(text) {
  var ok = false, shown = [];
  S.pasteMsgs = shown;
  try { ok = handlePastedWork(text); }
  finally {
    S.pasteMsgs = null;
    log('paste', (ok ? 'Accepted.' : 'Refused.') + (shown.length ? ' Shown: ' + shown.map(function (m) { return '"' + m + '"'; }).join(' then ') : '') +
      (ok && S.script ? ' Show is for ' + (S.script.for_date || 'no date') + ' with ' + S.script.segments.length + ' segments.' : ''), text);
  }
  return ok;
}
function handlePastedWork(text) {
  var res = parseReply(text), st = $('homeStatus'), script = res.script, stamped = false;
  if (!script && res.parts) {
    if (!S.script || S.sample) return pasteFail('part');
    script = mergeParts(S.script, res.parts);
    S.script = script; S.last = null; S.pasted = true;
    var kept0 = store.set('ms.script', {script: script, savedAt: Date.now()});
    st.classList.remove('bad'); refreshHome();
    if (script.notes && script.notes.length) toast(script.notes[0] + ' Check with Claude.', true, 8000);
    else toast('Updated the ' + res.parts.map(function (s) { return PART_NAMES[s.type] || s.type; }).join(' and ') + " in today's show" +
      (kept0 ? '' : " (this computer won't remember it after closing)"));
    warmUp();
    return true;
  }
  if (!script) return pasteFail(res.reason);
  if (!script.for_date) { script.for_date = todayISO(); stamped = true; }
  S.script = script; S.sample = null; S.last = null; S.pasted = true;
  var kept = store.set('ms.script', {script: script, savedAt: Date.now()});
  st.classList.remove('bad'); refreshHome();
  var hs = homeStatusText(), msg = kept ? 'Got it! ' + hs + (/[.!?)]$/.test(hs) ? '' : '.') : "Got it (this computer won't remember it after closing)";
  var lost = script.dropped ? ' ' + (script.dropped === 1 ? '1 part' : script.dropped + ' parts') + ' could not be read.' : '';
  var warn = dateWarning(script, stamped) || (script.notes && script.notes.length ? script.notes[0] + ' Check with Claude.' : '');
  if (warn) toast(warn + lost, true, 8000); else toast(msg + lost, false, lost ? 6000 : 3500);
  warmUp();
  return true;
}
async function onPasteBtn() {
  unlockAudio();
  var text = '';
  try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
  if (text && text.trim()) handlePasted(text);
  else { log('paste', 'The clipboard could not be read or was empty, so the paste box was opened'); $('pastebox').hidden = false; $('pasteArea').focus(); }
}
function askChoice(text, a, b) {
  return new Promise(function (res) {
    $('chooseText').textContent = text; $('chooseOld').textContent = a; $('chooseNew').textContent = b;
    var d = $('choose'); d.hidden = false;
    function done(v) { d.hidden = true; $('chooseOld').onclick = $('chooseNew').onclick = null; res(v); }
    $('chooseOld').onclick = function () { done('old'); };
    $('chooseNew').onclick = function () { done('new'); };
    d.dataset.cancel = '1'; d._cancel = function () { done(null); };
  });
}

/* the ready screen */
function readyUI(title, frac, count, eng) {
  if (title != null) $('readyTitle').textContent = title;
  if (frac != null) $('readyFill').style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  if (count != null) $('readyCount').textContent = count;
  if (eng != null) $('readyEngine').textContent = eng;
}
async function onPlay(auto, again) {
  if (!auto) unlockAudio();
  var script = S.script, useScript = script;
  if (again) useScript = again.script;
  else if (S.sample) useScript = S.sample;
  else if (script && script.for_date && script.for_date !== todayISO()) {
    var p = parseISO(script.for_date), future = script.for_date > todayISO();
    var c = await askChoice(future ? 'Play ' + DAYS[p.dow] + "'s show now, or a surprise show?" : 'Play ' + DAYS[p.dow] + "'s show again, or a surprise show?",
      DAYS[p.dow] + "'s show", 'A surprise show');
    log('play', 'Asked "' + (future ? 'Play ' + DAYS[p.dow] + "'s show now, or a surprise show?" : 'Play ' + DAYS[p.dow] + "'s show again, or a surprise show?") + '" and the answer was ' + (c === 'old' ? 'the saved show' : c === 'new' ? 'a surprise show' : 'nothing (closed the question)'));
    if (!c) return;
    if (c === 'new') useScript = null;
  }
  // a surprise show is picked once, so changing to simpler voices keeps the same word, fact and puzzle
  var script2 = useScript || surpriseScript();
  var which = script2.surprise ? 'surprise' : S.sample && script2 === S.sample ? 'sample' : S.pasted ? 'pasted' : 'saved';
  log('play', (auto ? 'Show started from the address. ' : 'Play pressed. ') + 'Show: ' + which + ', for_date ' + (script2.for_date || 'none') + ', ' + script2.segments.length + ' segments' +
    (again ? ' (starting again with simpler voices)' : ''));
  var token = ++S.prep, t0 = performance.now();
  showScreen('ready');
  $('startBtn').hidden = true; $('simplerBtn').hidden = true;
  readyUI('Getting the show ready', 0, '', '');
  $('readyLen').textContent = '';
  S.readyNote = (again && again.note) || '';
  function simpler(label) { var b = $('simplerBtn'); b.textContent = label; b.hidden = false; }
  var ui = {
    loading: function () { if (token === S.prep) { readyUI('Getting the dog voices ready', 0.02, '', ''); simpler('Start now with simpler voices'); } },
    download: function (d) {
      if (token !== S.prep) return;
      var k = ENG.kokoro, dl = !!(k && k.loadInfo && k.loadInfo.downloading) && d.fraction < 0.98;
      var slowDay = performance.now() - t0 > 120000 && d.fraction < 0.5;
      if (slowDay) screenMsg('Getting ready', 'This is slow today. You can start with simpler voices and the dog voices will keep downloading for next time.');
      readyUI(dl ? 'Downloading the dog voices (about 310 MB, first time only)' : 'Getting the dog voices ready', d.fraction,
        dl ? Math.round(d.fraction * 100) + '%' + (d.mb ? ' of about ' + Math.round(d.mb) + ' MB' : '') : '',
        slowDay ? 'This is slow today. You can start with simpler voices and the dog voices will keep downloading for next time.' : '');
    },
    note: function (t) { S.readyNote = t; screenMsg('Getting ready', t); if (token === S.prep) readyUI(null, null, null, t); }
  };
  $('simplerBtn').onclick = function () {
    if (token !== S.prep) return;
    log('play', 'Pressed "' + $('simplerBtn').textContent + '"');
    var k = ENG.kokoro;
    $('simplerBtn').hidden = true;
    if (k && k.loaded) {
      // the voices are loaded but being made slowly: stop making them and use the browser's own voices for this show
      var st = k.stats && k.stats();
      if (st) st.cancelled = true;
    }
    // still downloading: the download carries on in the background for next time
    S.oneShot = 'browser';
    onPlay(false, {script: script2});
  };
  var enginePromise = resolveEngine(ui);
  S.oneShot = '';
  var wx = S.wx;
  try { wx = await ensureWeather(30); } catch (e) { wx = S.wx; }
  var eng = await enginePromise;
  if (token !== S.prep) return;
  $('simplerBtn').textContent = 'Use simpler voices instead';
  $('simplerBtn').hidden = eng.id !== 'kokoro';
  R.engine = eng; S.engine = eng; setVoiceStatus(eng);
  var show = R.show = buildShow(script2, wx);
  if (!show.segs.length) { toast('Nothing to play yet', true); showScreen('home'); return; }
  S.last = {show: show, engine: eng};
  $('readyLen').textContent = lengthText(estimateSeconds(show));
  var early = show.segs[1] ? show.segs[1].lines[show.segs[1].lines.length - 1].gi : show.segs[0].lines[show.segs[0].lines.length - 1].gi;
  function engLine() { return S.readyNote || 'Voices: ' + describeEngine(eng); }
  readyUI('Getting the show ready', 0, '', engLine());
  var startedAt = performance.now(), started = false, readyNoted = false;
  function begin() {
    if (started || token !== S.prep) return;
    started = true; $('simplerBtn').hidden = true;
    log('ready', 'Getting ready took ' + ((performance.now() - t0) / 1000).toFixed(1) + ' seconds before the show began (voices: ' + eng.id + ')');
    var t = P.get('t');
    startShow(t != null ? clamp(+t || 0, 0, show.segs.length - 1) : 0, P.has('l') ? +P.get('l') || 0 : 0, t == null);
    if (S.readyNote) toast(S.readyNote, false, 6000);
  }
  /* the dog voices are failing (dead, two of the opening lines, or more than one line in five): this show uses simpler voices */
  function failing(st) {
    if (st.dead) return true;
    var early2 = 0;
    for (var i = 0; i <= early && i < st.total; i++) if (st.ready[i] && !st.items[i]) early2++;
    return early2 >= 2 || (st.done >= 5 && st.failed > st.done * 0.2);
  }
  function check(st) {
    if (token !== S.prep || started) return;
    if (eng.id === 'kokoro' && st && st.items) {
      kokoroProgress(st);
      if (!st.cancelled && failing(st)) {
        st.cancelled = true; started = true;
        var note = 'The dog voices could not be made today, so we are using simpler voices.';
        log('engine', 'The dog voices are failing (' + st.done + ' of ' + st.total + ' lines done, ' + st.failed + ' failed' + (st.firstError ? ': ' + st.firstError : '') + '), so this show uses simpler voices');
        screenMsg('Getting ready', note);
        readyUI(null, null, null, note);
        S.oneShot = 'browser';
        onPlay(false, {script: script2, note: note});
        return;
      }
    }
    var total = st && st.total || show.flat.length, done = st && st.done != null ? st.done : total;
    var slow = eng.id === 'kokoro' && done >= 2 && eng.speedRatio && eng.speedRatio() < 1;
    if (slow) screenMsg('Getting ready', 'This computer is slow at making the voices.');
    readyUI('Getting the show ready', total ? done / total : 1, 'Getting the show ready: ' + done + ' of ' + total + ' lines' + (slow ? '. This computer is slow at making the voices.' : ''), engLine());
    if (eng.canStart(early)) {
      if (!readyNoted) { readyNoted = true; log('ready', 'Ready to start after ' + ((performance.now() - t0) / 1000).toFixed(1) + ' seconds: ' + done + ' of ' + total + ' lines made' + (eng.speedRatio && eng.speedRatio() ? ', making them ' + eng.speedRatio().toFixed(1) + ' times faster than they play' : '')); }
      if (eng.id !== 'kokoro') return begin();
      $('startBtn').hidden = false;
      readyUI(done >= total ? 'The show is ready' : 'Ready when you are', null, done >= total ? 'All ' + total + ' lines are ready' : 'The last lines are still being made while you watch', null);
    }
  }
  $('startBtn').onclick = function () { unlockAudio(); begin(); };
  var st0 = eng.prepare(show.flat, check);
  S.prepStats = st0;
  check(st0);
  if (eng.id === 'kokoro' && st0.promise) {
    st0.promise.then(function () { S.genDoneMs = performance.now() - startedAt; });
    kokoroWatch(eng, st0);
  }
}

/* ================= settings ================= */
function fillVoiceLists() {
  var kv = (ENG.kokoro && ENG.kokoro.voices) || Voices.KOKORO_VOICES, bv = getEngine('browser').list();
  document.querySelectorAll('.s-dog').forEach(function (box) {
    var dog = box.dataset.dog, sel = box.querySelector('.sVoice'), cfg = S.set.voices[dog];
    sel.innerHTML = '';
    var g1 = el('optgroup'); g1.label = 'Dog voices (Kokoro)';
    kv.forEach(function (v) { var o = el('option'); o.value = 'k:' + v; o.textContent = Voices.kokoroLabel(v); g1.appendChild(o); });
    sel.appendChild(g1);
    var g2 = el('optgroup'); g2.label = 'Browser voices';
    var oa = el('option'); oa.value = 'b:'; oa.textContent = 'Automatic'; g2.appendChild(oa);
    bv.forEach(function (v) { var o = el('option'); o.value = 'b:' + v.name; o.textContent = v.name.replace(/^Microsoft\s+/, '') + ' (' + v.lang + ')'; g2.appendChild(o); });
    sel.appendChild(g2);
    sel.value = (S.usedEngine === 'browser' ? 'b:' + cfg.browser : 'k:' + cfg.kokoro);
    if (sel.value !== (S.usedEngine === 'browser' ? 'b:' + cfg.browser : 'k:' + cfg.kokoro)) sel.value = 'k:' + cfg.kokoro;
    box.querySelector('.sLift').value = cfg.lift;
  });
}
function locLine(l) { return l.name + (l.state ? ', ' + l.state : '') + ' (' + (+l.lat).toFixed(2) + ', ' + (+l.lon).toFixed(2) + ')'; }
/* the line under Voices when Auto has stopped trying the dog voices on this computer */
function showSkipLine() {
  var why = S.set.engine === 'auto' ? kokoroSkip() : '';
  if (why === 'crash' && S.kokoroLoading) why = '';
  $('sKokoroSkip').hidden = !why;
}
function openSettings() {
  log('settings', 'Settings opened');
  $('reportbox').hidden = true; $('sReportOut').textContent = '';
  $('sName').value = S.set.showName;
  $('sLocName').textContent = locLine(S.set.loc);
  $('sFindOut').textContent = ''; $('sFind').value = '';
  $('sEngine').value = S.set.engine;
  $('sCaps').checked = S.set.captions; $('sMusic').checked = S.set.music;
  $('sThink').value = S.set.think; $('sThinkVal').textContent = S.set.think;
  setVoiceStatus(S.engine && S.usedEngine ? S.engine : null);
  fillVoiceLists();
  showSkipLine();
  $('settings').hidden = false;
  if (R.active && S.screen === 'show' && !R.paused) { R.pausedForSettings = true; setPaused(true); }
}
function closeSettings() {
  $('settings').hidden = true;
  S.set.showName = $('sName').value.trim() || DEF_SET.showName;
  saveSettings(); refreshHome();
  if (R.pausedForSettings) { R.pausedForSettings = false; setPaused(false); }
}
async function findTown() {
  var q = $('sFind').value.trim(), out = $('sFindOut');
  if (!q) return;
  out.textContent = 'Looking…';
  var ac = typeof AbortController === 'function' ? new AbortController() : null, tm = setTimeout(function () { if (ac) ac.abort(); }, 8000);
  try {
    var r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=10&countryCode=AU&language=en', ac ? {signal: ac.signal} : {});
    if (!r.ok) throw new Error('search ' + r.status);
    var j = await r.json(), res = (j && j.results || []).filter(function (t) { return t && (!t.country_code || t.country_code === 'AU') && isFinite(t.latitude) && isFinite(t.longitude); });
    clearTimeout(tm);
    out.innerHTML = '';
    if (!res.length) { out.textContent = 'No town found. Try another spelling.'; return; }
    res.forEach(function (t) {
      var b = el('button', '', esc(t.name + (t.admin1 ? ', ' + t.admin1 : '')));
      b.onclick = function () {
        S.set.loc = {name: t.name, state: String(t.admin1 || ''), lat: +t.latitude, lon: +t.longitude}; saveSettings();
        logSetting('School location', locLine(S.set.loc));
        $('sLocName').textContent = locLine(S.set.loc);
        out.textContent = 'Saved. The weather will use ' + t.name + '.';
        S.wx = null; S.wxDay = ''; S.wxAt = 0; S.wxFetching = null; ensureWeather();
      };
      out.appendChild(b);
    });
  } catch (e) { clearTimeout(tm); out.textContent = "Couldn't search just now. Check the internet and try again."; screenMsg('Settings', out.textContent + ' (' + String(e && e.message || e) + ')'); }
}
async function tryVoice(dog, btn) {
  unlockAudio();
  var old = btn.textContent;
  btn.disabled = true; btn.textContent = 'One moment…';
  var status = $('sVoiceStatus');
  try {
    var eng = await resolveEngine({
      loading: function () { status.textContent = 'First time only: downloading the dog voices…'; },
      download: function (d) { status.textContent = 'First time only: downloading the dog voices: ' + Math.round(d.fraction * 100) + '%'; },
      note: function (t) { status.textContent = t; }
    });
    R.engine = R.active ? R.engine : eng;
    S.engine = eng; setVoiceStatus(eng); fillVoiceLists();
    await eng.say(dog, dog === 'Bailey' ? "Good morning, everyone! I'm Bailey, and I love snuggles." : "Good morning, everyone. I'm Charlie, and I'm very gentle.");
  } catch (e) { status.textContent = 'That voice could not play just now.'; screenMsg('Settings', status.textContent + ' (' + String(e && e.message || e) + ')'); }
  btn.disabled = false; btn.textContent = old;
}
function wireSettings() {
  $('gearBtn').onclick = openSettings;
  $('sClose').onclick = closeSettings;
  $('settings').addEventListener('mousedown', function (e) { if (e.target === $('settings')) closeSettings(); });
  $('sName').oninput = function () { var v = $('sName').value.trim(); if (v) { S.set.showName = v; refreshHome(); saveSettings(); } };
  $('sName').onchange = function () { logSetting('Show name', JSON.stringify(S.set.showName)); };
  $('sFindBtn').onclick = findTown;
  $('sFind').onkeydown = function (e) { if (e.key === 'Enter') findTown(); };
  $('sEngine').onchange = function () { S.set.engine = $('sEngine').value; if (S.set.engine === 'kokoro') kokoroRetry(); saveSettings(); showSkipLine(); logSetting('Voice engine', S.set.engine); };
  $('sKokoroRetry').onclick = function () { kokoroRetry(); showSkipLine(); $('sVoiceStatus').textContent = 'The dog voices will be tried next time you press Play.'; logSetting('Try the dog voices again', 'pressed'); };
  $('sWarm').onclick = function () {
    var b = $('sWarm'); b.disabled = true;
    logSetting('Get the dog voices ready now', 'pressed');
    warmUp(function (t) { $('sVoiceStatus').textContent = t; }, true).then(function () { b.disabled = false; showSkipLine(); }, function () { b.disabled = false; });
  };
  $('sCaps').onchange = function () { S.set.captions = $('sCaps').checked; saveSettings(); if (!S.set.captions) $('captions').classList.remove('on'); logSetting('Captions', S.set.captions ? 'on' : 'off'); };
  $('sMusic').onchange = function () { S.set.music = $('sMusic').checked; saveSettings(); logSetting('Music', S.set.music ? 'on' : 'off'); };
  $('sThink').oninput = function () { S.set.think = +$('sThink').value; $('sThinkVal').textContent = S.set.think; saveSettings(); };
  $('sThink').onchange = function () { logSetting('Puzzle thinking time', S.set.think + ' seconds'); };
  document.querySelectorAll('.s-dog').forEach(function (box) {
    var dog = box.dataset.dog;
    box.querySelector('.sVoice').onchange = function (e) {
      var v = e.target.value;
      if (v.slice(0, 2) === 'k:') S.set.voices[dog].kokoro = v.slice(2); else S.set.voices[dog].browser = v.slice(2);
      saveSettings();
      logSetting(dog + "'s voice", v.slice(0, 2) === 'k:' ? 'dog voice ' + v.slice(2) : 'browser voice ' + (v.slice(2) || 'Automatic'));
    };
    box.querySelector('.sLift').oninput = function (e) { S.set.voices[dog].lift = +e.target.value; saveSettings(); };
    box.querySelector('.sLift').onchange = function (e) { logSetting(dog + ' younger slider', e.target.value); };
    box.querySelector('.sTry').onclick = function (e) { tryVoice(dog, e.currentTarget); };
  });
  $('sClear').onclick = function () {
    store.del('ms.script'); S.script = null; S.last = null; $('homeStatus').classList.remove('bad'); refreshHome(); toast('Saved show cleared.');
  };
  $('sReportCopy').onclick = copyReport;
  $('sReportSave').onclick = saveReport;
  $('reportDone').onclick = function () { $('reportbox').hidden = true; };
}

/* ================= the report for Rose ================= */
function logSetting(what, val) { log('settings', what + ' changed to ' + val); }
/* 2026-10-26 08:45:12, in Melbourne time */
function stamp(t) {
  try {
    var p = {};
    new Intl.DateTimeFormat('en-CA', {timeZone: 'Australia/Melbourne', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
      .formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
  } catch (e) { return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }
}
function reportHeader(now, kept, total) {
  var set = S.set, sv = S.script, rec = [];
  ['Bailey', 'Charlie'].forEach(function (d) { var v = set.voices[d]; rec.push('  ' + d + ': dog voice ' + v.kokoro + ', browser voice ' + (v.browser || 'Automatic') + ', younger ' + v.lift); });
  return [
    'THE BAILEY AND CHARLIE SHOW: REPORT FOR ROSE',
    '============================================',
    'Made: ' + stamp(now) + ' (Melbourne time)',
    'Site version: ' + (S.version || 'none (a local copy)'),
    'Browser: ' + navigator.userAgent,
    'Window: ' + innerWidth + 'x' + innerHeight + ', screen ' + (screen.width || 0) + 'x' + (screen.height || 0) + ', pixel ratio ' + (window.devicePixelRatio || 1),
    'WebGPU adapter: ' + (S.gpu || 'not checked yet'),
    'Settings:',
    '  Show name: ' + set.showName,
    '  School location: ' + locLine(set.loc),
    '  Voice engine: ' + set.engine,
    '  Captions: ' + (set.captions ? 'on' : 'off') + ', music: ' + (set.music ? 'on' : 'off') + ', puzzle thinking time: ' + set.think + ' seconds',
    rec.join('\n'),
    'Voice engine record (what happened the last time the dog voices were tried): ' + kokoroRecordText(),
    'Voices in use now: ' + (S.usedEngine || 'none yet') + (S.kokoroFailed ? ' (the dog voices failed this visit' + (S.kokoroError ? ': ' + S.kokoroError : '') + ')' : ''),
    'Saved show: ' + (sv ? 'for ' + (sv.for_date || 'no date') + ', ' + sv.segments.length + ' segments (' + sv.segments.map(function (x) { return x.type; }).join(', ') + ')' + (S.pasted ? ', pasted on this visit' : ', kept from an earlier visit') : 'none'),
    'Events below: ' + kept + ' from the last ' + REPORT_DAYS + ' days, newest first (' + total + ' kept in all, over up to ' + LOG_DAYS + ' days).',
    'Times are Melbourne time. A pasted reply is shown in full between its two marker lines.',
    ''
  ].join('\n');
}
function reportEvent(x) {
  var kind = String(x.e).toUpperCase(), line = '[' + stamp(x.t) + '] ' + (kind + '        ').slice(0, 8) + ' ' + x.m;
  if (x.x == null) return line;
  var cut = x.n > x.x.length;
  return line + '\n      (' + x.n + ' characters pasted' + (cut ? '; only the first ' + x.x.length + ' were kept' : '') + ')\n' +
    '----- pasted text starts -----\n' + x.x + '\n----- pasted text ends' + (cut ? ' (cut here)' : '') + ' -----\n';
}
function buildReport() {
  var now = Date.now(), all = logPrune(logRead().concat(logQueue), now), from = now - REPORT_DAYS * 864e5;
  var recent = all.filter(function (x) { return x.t >= from; }).reverse();
  var out = reportHeader(now, recent.length, all.length);
  out += recent.length ? recent.map(reportEvent).join('\n') : 'Nothing has been logged yet.';
  return out + '\n';
}
function reportOut(t) { $('sReportOut').textContent = t; if (t) screenMsg('Settings', t); }
async function copyReport() {
  var text = buildReport(), done = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); done = true; } } catch (e) {}
  log('report', done ? 'The report was copied (' + text.length + ' characters)' : 'Copying the report did not work, so it was shown in a box (' + text.length + ' characters)');
  if (done) { reportOut('Copied. Paste it into a message to Rose.'); return; }
  reportOut('');
  var a = $('reportArea');
  a.value = text; $('reportbox').hidden = false; a.focus(); a.select();
}
function saveReport() {
  var text = buildReport(), name = 'morning-show-report-' + todayISO() + '.txt';
  try {
    var url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'})), a = el('a');
    a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 3000);
    log('report', 'The report was saved as ' + name + ' (' + text.length + ' characters)');
    reportOut('Saved as ' + name + '. Send that file to Rose.');
  } catch (e) {
    log('report', 'Saving the report failed: ' + String(e && e.message || e));
    reportOut("The file couldn't be saved. Try \"Copy a report for Rose\" instead.");
  }
}

/* ================= wiring and start ================= */
function anyModalOpen() { return !$('settings').hidden || !$('pastebox').hidden || !$('reportbox').hidden || !$('confirm').hidden || !$('choose').hidden; }
function askLeave() {
  if (R.active && !R.paused) { R.pausedForLeave = true; setPaused(true); }
  $('confirm').hidden = false;
}
function closeLeave(leave) {
  $('confirm').hidden = true;
  if (leave) { R.pausedForLeave = false; stopShow(); }
  else if (R.pausedForLeave) { R.pausedForLeave = false; setPaused(false); }
}
function wire() {
  $('playBtn').onclick = function () { onPlay(false); };
  $('pasteBtn').onclick = onPasteBtn;
  $('pasteDone').onclick = function () { if (handlePasted($('pasteArea').value)) { $('pastebox').hidden = true; $('pasteArea').value = ''; } };
  $('pasteCancel').onclick = function () { $('pastebox').hidden = true; };
  // Back leaves the dog voices downloading and being made: they warm the cache for the next Play
  $('readyBack').onclick = function () { log('ready', 'Pressed Back while the show was getting ready'); S.prep++; showScreen('home'); };
  $('againBtn').onclick = function () {
    unlockAudio();
    log('play', 'Play again pressed' + (S.last && S.last.show ? ' (the same show)' : ''));
    if (S.last && S.last.show) { R.show = S.last.show; R.engine = S.last.engine; startShow(0, 0, true); } else onPlay(false);
  };
  $('homeBtn').onclick = function () { showScreen('home'); };
  $('stayBtn').onclick = function () { closeLeave(false); };
  $('leaveBtn').onclick = function () { closeLeave(true); };
  var stage = $('stage'), tapHidden = false, mouseAt = null;
  // a tap where a hidden button sits only shows the controls; it does not press the button
  stage.addEventListener('pointerdown', function () { tapHidden = !$('controls').classList.contains('on'); }, true);
  document.addEventListener('keydown', function () { tapHidden = false; }, true);
  function ctlBtn(id, fn) {
    $(id).onclick = function (e) {
      e.currentTarget.blur();
      if (tapHidden) { tapHidden = false; pokeControls(); return; }
      fn();
    };
  }
  ctlBtn('cPrev', function () { prevSeg(); pokeControls(); });
  ctlBtn('cNext', function () { nextSeg(); pokeControls(); });
  ctlBtn('cPlay', function () { setPaused(!R.paused); });
  ctlBtn('cFull', toggleFull);
  ctlBtn('cHome', askLeave);
  // only a mouse that really moves brings the controls back (not a page change under a still mouse)
  document.addEventListener('mousemove', function (e) {
    var moved = !mouseAt || Math.abs(e.screenX - mouseAt[0]) + Math.abs(e.screenY - mouseAt[1]) >= 3;
    mouseAt = [e.screenX, e.screenY];
    if (moved && S.screen === 'show') pokeControls();
  });
  stage.addEventListener('pointerdown', pokeControls);
  stage.addEventListener('touchstart', pokeControls, {passive: true});
  wireSettings();
  var fitTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitNow, 150); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (S.screen === 'show' && R.active && !R.paused) { R.pausedForHidden = true; setPaused(true); log('show', 'The tab was hidden during the show, so it was paused, at ' + showPlace()); }
      return;
    }
    // back on this tab: the show stays paused with its controls showing, for the teacher to press Play
    refreshHome();
    ensureWeather();
    if (S.screen === 'show') { requestWake(); pokeControls(); }
  });

  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (S.screen !== 'home' || anyModalOpen() || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var text = e.clipboardData && e.clipboardData.getData('text');
    if (text) { e.preventDefault(); handlePasted(text); }
  });
  function typing(t) { return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName); }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Escape') {
      if (!$('pastebox').hidden) { $('pastebox').hidden = true; return; }
      if (!$('reportbox').hidden) { $('reportbox').hidden = true; return; }
      if (!$('settings').hidden) { closeSettings(); return; }
      if (!$('confirm').hidden) { closeLeave(false); return; }
      if (!$('choose').hidden) { var c = $('choose'); if (c._cancel) c._cancel(); return; }
      if (S.screen === 'show') askLeave();
      else if (S.screen === 'ready') $('readyBack').click();
      else if (S.screen === 'end') showScreen('home');
      return;
    }
    if (anyModalOpen() || typing(e.target)) return;
    if (S.screen === 'show') {
      if (k === ' ') { e.preventDefault(); setPaused(!R.paused); pokeControls(); }
      else if (k === 'p' || k === 'P') setPaused(!R.paused);
      else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); nextSeg(); pokeControls(); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prevSeg(); pokeControls(); }
      else if (k === 'f' || k === 'F') toggleFull();
      else if (k === 'c' || k === 'C') { S.set.captions = !S.set.captions; saveSettings(); logSetting('Captions', (S.set.captions ? 'on' : 'off') + ' (key C)'); if (!S.set.captions) $('captions').classList.remove('on'); else if (R.capLine) { R.capIdx = -1; drawCaption(R.playing && (R.lineEng || R.engine) ? (R.lineEng || R.engine).progress() : 0); } }
    } else if (S.screen === 'home' && (k === 'f' || k === 'F')) toggleFull();
  });
  document.addEventListener('keyup', function (e) { if (e.key === ' ' && S.screen === 'show' && !anyModalOpen() && !typing(e.target)) e.preventDefault(); });
  document.addEventListener('fullscreenchange', function () { });
}

/* the first thing in the log of each visit: where and on what the show is running */
function logLoad() {
  var at = Date.now();
  Promise.race([gpuAdapter(), new Promise(function (r) { setTimeout(function () { r(null); }, 2000); })]).then(function (ok) {
    S.gpu = ok == null ? 'unknown (no answer in 2 seconds)' : ok ? 'yes' : 'no';
    log('load', 'Page loaded. Site version ' + (S.version || 'none (a local copy)') + '. WebGPU adapter: ' + S.gpu + '. Window ' + innerWidth + 'x' + innerHeight +
      ', screen ' + (screen.width || 0) + 'x' + (screen.height || 0) + ' at ' + (window.devicePixelRatio || 1) + 'x' + (location.search ? '. Address options: ' + location.search : '') +
      '. Browser: ' + navigator.userAgent, null, at);
  });
}
async function init() {
  logLoad();
  var saved = store.get('ms.script', null);
  if (saved && saved.script) { var again = normScript(saved.script); if (again) S.script = again; }
  log('load', S.script ? 'Saved show found on this computer: for_date ' + (S.script.for_date || 'none') + ', ' + S.script.segments.length + ' segments, saved ' + (saved.savedAt ? stamp(saved.savedAt) : 'at an unknown time') : 'No saved show on this computer');
  var pres = await loadPresenters();
  buildDesk(pres);
  wire();
  showScreen('home');
  if (!(window.CSS && CSS.supports && CSS.supports('width', '1cqw'))) {
    var hs = $('homeStatus'); hs.classList.add('bad'); hs.textContent = 'This browser is too old for the show. Please update Chrome or Edge.';
    screenMsg('Home', hs.textContent);
  }
  getEngine('browser');   // starts listening for this computer's voices, which can take a few seconds to appear
  ensureWeather();
  if (P.has('sample')) {
    try {
      var r = await fetch('sample.json'), j = await r.json(), sc = normScript(j);
      if (sc) { S.sample = sc; S.script = sc; refreshHome(); }
    } catch (e) { noteError('sample: ' + e.message); }
  }
  requestAnimationFrame(frame);
  if ((P.has('t') || P.has('fast') || P.has('autoplay')) && !P.has('hold')) onPlay(true);
  else if (S.script && !S.sample && S.script.for_date === todayISO()) warmUp();
}
window.__MS = {
  state: function () { return {screen: S.screen, seg: R.seg, li: R.li, kind: R.show && R.show.segs[R.seg] ? R.show.segs[R.seg].kind : '', segs: R.show ? R.show.segs.length : 0,
    lines: R.show && R.show.segs[R.seg] ? R.show.segs[R.seg].lines.length : 0, think: !!R.think, paused: R.paused, playing: R.playing, engine: S.usedEngine, errors: errors.slice()}; },
  S: S, R: R, ENG: ENG, parse: parseScriptText, jump: function (i) { jumpTo(i); }, weatherSegment: weatherSegment, buildShow: buildShow, surprise: surpriseScript,
  setWeather: function (w) { S.wx = w; S.wxAt = Date.now(); S.wxDay = todayISO(); S.wxPromise = Promise.resolve(w); refreshHome(); },
  parseReply: parseReply, stripMarkers: stripMarkers, breathCue: breathCue, normSegment: normSegment, fmtNum: fmtNum, matchChoice: matchChoice,
  handlePasted: handlePasted, report: buildReport, log: log
};
init().catch(function (e) { noteError('init: ' + (e && e.message || e)); console.error(e); });
})();
