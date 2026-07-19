'use strict';
/* ============================================================
   KÜLLERDEN DOĞUŞ — v0.1 web prototipi
   Vanilla JS + Canvas 2D. Veri tabloları (CFG) Unity portunda
   ScriptableObject'lere birebir taşınacak şekilde ayrık tutuldu.
   ============================================================ */

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1, lightCv = null;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = VW * DPR; canvas.height = VH * DPR;
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
  if (VW > 0 && VH > 0) { lightCv = document.createElement('canvas'); lightCv.width = VW; lightCv.height = VH; }
}
window.addEventListener('resize', resize); resize();

// ---------- Utils ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Kayıt yuvası (0 = eski anahtar, geriye dönük uyumlu) + bölgeyi erkenden oku
let SAVE_SLOT = 0;
try { SAVE_SLOT = parseInt(localStorage.getItem('kd-slot') || '0') || 0; } catch (e) { }
// v3: yeni sistem — eski kayıtlar (v04) açılışta temizlenir, herkes taze başlar
const slotKey = n => n === 0 ? 'kullerden-dogus-v3' : 'kullerden-dogus-v3-s' + n;
try { ['kullerden-dogus-v04', 'kullerden-dogus-v04-s1', 'kullerden-dogus-v04-s2', 'kd-maps'].forEach(k => localStorage.removeItem(k)); } catch (e) { }

// ---------- ÇEVRİMİÇİ (Supabase): arkadaşlar · köy ziyareti · dostluk adası ----------
// Kimlik cihazda saklanır (id + gizli anahtar); tüm erişim RPC'lerle, tablolar dışa kapalı.
const NET_URL = 'https://kmfxcdnerqatjmklssli.supabase.co/rest/v1/rpc/';
const NET_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZnhjZG5lcnFhdGpta2xzc2xpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUyMzE0MDQsImV4cCI6MjA2MDgwNzQwNH0.rJMQ6zApunNdIJsy0wmWw2A21NLI5tHimixiOHybO9E';
let NETP = null; // {id, secret, code, name}
try { NETP = JSON.parse(localStorage.getItem('kd-net')); } catch (e) { }
// Ziyaret / ada modu: reload'lar arası sessionStorage ile taşınır; bu modlarda KENDİ kaydına asla yazılmaz
let VISIT = null;   // {host, name, village, remaining}
let ISLAND = null;  // {id, code, name, seed, state, members} + entry (kişisel kazanım taşıma)
try { VISIT = JSON.parse(sessionStorage.getItem('kd-visit')); } catch (e) { }
try { ISLAND = JSON.parse(sessionStorage.getItem('kd-island')); } catch (e) { }
async function rpc(fn, args) {
  const r = await fetch(NET_URL + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: NET_KEY, Authorization: 'Bearer ' + NET_KEY },
    body: JSON.stringify(args || {}),
  });
  const tx = await r.text();
  if (!r.ok) { let m = tx; try { m = JSON.parse(tx).message || tx; } catch (e) { } throw new Error(m); }
  return tx ? JSON.parse(tx) : null;
}
const rpcAuth = (fn, args) => rpc(fn, Object.assign({ p_id: NETP.id, p_secret: NETP.secret }, args));
const NET_ERR = {
  auth: 'Kimlik doğrulanamadı — çevrimiçi profilin bozulmuş olabilir',
  code_not_found: 'Bu kod bulunamadı — harfleri kontrol et',
  self_add: 'Kendini ekleyemezsin 🙂',
  not_friends: 'Bu oyuncuyla arkadaş değilsiniz',
  visit_exhausted: 'Bugünlük ziyaret süren doldu (günde 10 dk) — yarın yine gel',
  no_village: 'Arkadaşının köyü henüz buluta kaydedilmemiş (bir kez çevrimiçi oynaması yeter)',
  island_full: 'Ada dolu (en çok 8 yoldaş)',
  no_island: 'Bir adaya üye değilsin',
  'Failed to fetch': 'Bağlantı yok — internetini kontrol et',
  'Load failed': 'Bağlantı yok — internetini kontrol et',
};
const netErrMsg = e => NET_ERR[e && e.message] || (e && e.message) || 'Bağlantı hatası';
// Süre biçimi: 1 saatten uzunsa "2:05:30", kısaysa "9:59" (600:00 gibi belirsiz gösterim olmasın)
const fmtDur = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
    : m + ':' + String(sec).padStart(2, '0');
};

let SAVED0 = null;
try { SAVED0 = VISIT ? VISIT.village : JSON.parse(localStorage.getItem(slotKey(SAVE_SLOT))); } catch (e) { }
// Ana menü: oyun içi bilinçli reload'larda (göç, yuva değişimi) menü atlanır
let MENU_OPEN = true;
let MENU_RESUME = false;
try { MENU_RESUME = sessionStorage.getItem('kd-resume') === '1'; sessionStorage.removeItem('kd-resume'); } catch (e) { }
if (VISIT || ISLAND) MENU_RESUME = true; // ziyaret/ada: menüsüz doğrudan dünyaya

// ---------- Cihan Fethi: dünya haritası kampanyası ----------
// Vilayet sırası kanonik rotadır: eski kayıtların "Bölge N"i bu rotanın N. vilayetine denk gelir
// (layout = idx % yerleşik harita sayısı, seed = idx → eski kayıtlar aynı dünyayı üretmeye devam eder).
// FANTEZİ CİHANI: bölgeler + vilayetler + her vilayetin kendi IRK'ı (renk/silah/dövüş tarzı farklı)
const WORLD_COUNTRIES = {
  // Renkler cihan haritasındaki biyomlardır: çöl / bozkır / bataklık / volkanik dağ / buzul
  kul:   { name: 'Kül Yakası',  flag: '🔥', lx: 180, ly: 360, col: '#c9a15e', edge: '#8a6a35' },
  orta:  { name: 'Ortadüzlük',  flag: '🌾', lx: 490, ly: 230, col: '#7c9e4c', edge: '#4e6b2c' },
  sis:   { name: 'Sisbatak',    flag: '🌫️', lx: 720, ly: 450, col: '#5b8266', edge: '#33543f' },
  demir: { name: 'Demirdağlar', flag: '⛰️', lx: 340, ly: 40, col: '#8a5c45', edge: '#553326' },
  buz:   { name: 'Buzyaka',     flag: '❄️', lx: 670, ly: 30,  col: '#cfdfe8', edge: '#8ba7b8' },
};
const WORLD_PROVINCES = [
  // { id, name, country, race, wx/wy (cihan haritası), tier (zorluk), links (komşular) }
  { id: 'koryurt',   name: 'Köryurt',       country: 'kul',   race: 'barbar',    wx: 300, wy: 585, tier: 1,  links: ['kulpinar', 'kumtepe', 'yelovasi'] },
  { id: 'kulpinar',  name: 'Külpınar',      country: 'kul',   race: 'mizrakli',  wx: 210, wy: 500, tier: 2,  links: ['koryurt', 'kumtepe', 'demirkapi'] },
  { id: 'kumtepe',   name: 'Kumtepe',       country: 'kul',   race: 'col',       wx: 160, wy: 630, tier: 3,  links: ['koryurt', 'kulpinar'] },
  { id: 'yelovasi',  name: 'Yel Ovası',     country: 'orta',  race: 'atli',      wx: 470, wy: 455, tier: 4,  links: ['koryurt', 'gunbatar', 'arenakent'] },
  { id: 'gunbatar',  name: 'Günbatar',      country: 'orta',  race: 'samuray',   wx: 500, wy: 330, tier: 5,  links: ['yelovasi', 'demirkapi', 'buzhisar'] },
  { id: 'sazlik',    name: 'Sazlıkköy',     country: 'sis',   race: 'kurt',      wx: 640, wy: 600, tier: 5,  links: ['arenakent', 'karabatak'] },
  { id: 'arenakent', name: 'Arenakent',     country: 'orta',  race: 'gladyator', wx: 575, wy: 485, tier: 6,  links: ['yelovasi', 'sazlik'] },
  { id: 'karabatak', name: 'Karabatak',     country: 'sis',   race: 'golge',     wx: 790, wy: 570, tier: 6,  links: ['sazlik', 'yesilvadi'] },
  { id: 'demirkapi', name: 'Demirkapı',     country: 'demir', race: 'tasdev',    wx: 300, wy: 250, tier: 7,  links: ['kulpinar', 'gunbatar', 'korukale'] },
  { id: 'korukale',  name: 'Korukale',      country: 'demir', race: 'ates',      wx: 210, wy: 140, tier: 8,  links: ['demirkapi'] },
  { id: 'yesilvadi', name: 'Yeşilvadi',     country: 'sis',   race: 'orman',     wx: 860, wy: 400, tier: 8,  links: ['karabatak', 'kiragi'] },
  { id: 'buzhisar',  name: 'Buzhisar',      country: 'buz',   race: 'buz',       wx: 580, wy: 150, tier: 8,  links: ['gunbatar', 'kiragi', 'tahtkaya'] },
  { id: 'kiragi',    name: 'Kırağı Geçidi', country: 'buz',   race: 'buz',       wx: 760, wy: 150, tier: 9,  links: ['buzhisar', 'yesilvadi', 'tahtkaya'] },
  { id: 'tahtkaya',  name: 'Taht Kayası',   country: 'buz',   race: 'golge',     wx: 500, wy: 60,  tier: 10, links: ['buzhisar', 'kiragi'] },
];
// ---------- IRKLAR: her vilayetin halkı farklı savaşır (renk, silah, stat çarpanları) ----------
const RACES = {
  barbar:    { name: 'Barbarlar',       cloth: '#8a4a3a', weapon: 'sword' },
  mizrakli:  { name: 'Mızraklılar',     cloth: '#6a7a3a', weapon: 'spear',    rng: 1.45, hp: 0.9,  dmg: 1.1 },
  col:       { name: 'Çöl Akıncıları',  cloth: '#c09a4a', weapon: 'scimitar', spd: 1.25, hp: 0.9,  cdm: 0.85 },
  atli:      { name: 'Atlılar',         cloth: '#4a5a80', weapon: 'sword',    mount: true, spd: 1.5, hp: 1.1, dmg: 1.1 },
  samuray:   { name: 'Samuraylar',      cloth: '#8a2a3a', weapon: 'katana',   cdm: 0.65, hp: 0.85, dmg: 1.25, spd: 1.15 },
  kurt:      { name: 'Kurt Klanı',      cloth: '#5a6a72', weapon: 'claw',     spd: 1.3,  cdm: 0.8, hp: 0.8,  dmg: 0.9 },
  gladyator: { name: 'Gladyatörler',    cloth: '#b8862a', weapon: 'trident',  hp: 1.35, dmg: 1.1,  spd: 0.9 },
  golge:     { name: 'Gölge Tarikatı',  cloth: '#3a2a4a', weapon: 'dagger',   cdm: 0.7,  hp: 0.75, dmg: 1.3, spd: 1.2 },
  tasdev:    { name: 'Taş Soyu',        cloth: '#7a7a70', weapon: 'club',     hp: 1.8,  dmg: 1.4,  spd: 0.7, scl: 1.22 },
  ates:      { name: 'Ateş Rahipleri',  cloth: '#a83a1a', weapon: 'sword',    dmg: 1.2,  hp: 0.95 },
  orman:     { name: 'Orman Halkı',     cloth: '#3a6a3a', weapon: 'sword',    spd: 1.1,  hp: 0.85, cdm: 0.9 },
  buz:       { name: 'Buz Halkı',       cloth: '#5a8aa8', weapon: 'ice',      hp: 1.3,  spd: 0.85, dmg: 1.05, slow: true },
};
const PROV_BY_ID = {}; WORLD_PROVINCES.forEach((p, i) => { p.idx = i; PROV_BY_ID[p.id] = p; });
// Eski kayıt köprüsü: provinceId yoksa "Bölge N" → rotanın N. vilayeti, öncekiler fethedilmiş sayılır
function provFromLegacy(region) { return WORLD_PROVINCES[Math.min((region || 1) - 1, WORLD_PROVINCES.length - 1)]; }
const PROV0 = (SAVED0 && SAVED0.provinceId && PROV_BY_ID[SAVED0.provinceId]) || provFromLegacy(SAVED0 && SAVED0.region);
const WC0 = (SAVED0 && SAVED0.worldConquered) || WORLD_PROVINCES.slice(0, PROV0.idx).map(p => p.id);
const REGION0 = PROV0.tier; // zorluk katmanı: tüm eski "bölge" formülleri vilayet kademesinden beslenir

let rng = mulberry32(20260711 + PROV0.idx * 977); // ada modunda ISLAND.seed ile yeniden tohumlanır
const rr = (a, b) => a + rng() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
// Bölge temaları: her göçte farklı coğrafya hissi
const THEMES = [
  { name: 'Güney Kıyıları', gA: '#e0b054', gB: '#cf9d46', w0: '#1e8f96', w1: '#3fb8ae', leaf1: '#3f7a30', leaf2: '#4e9440' },
  { name: 'Kuzey Toprakları', gA: '#a9b06e', gB: '#879253', w0: '#1e6f86', w1: '#3fa0a8', leaf1: '#2f5a28', leaf2: '#3a7034' },
  { name: 'Kızıl Bozkır', gA: '#cf9058', gB: '#b37244', w0: '#207f8e', w1: '#45aaa2', leaf1: '#6a7a2e', leaf2: '#82973f' },
];
const THEME = THEMES[PROV0.idx % THEMES.length];

// ---------- SFX + müzik/ambiyans (tamamı prosedürel, MASTER üzerinden) ----------
let AC = null, MASTER = null, SFXG = null, MUSICG = null, musNoiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('kd-mute') === '1'; } catch (e) { }
// Ayarlar: ayrı müzik/efekt seviyesi + ekran sarsıntısı
const OPTS = { music: 1, sfx: 1, shake: true };
try { Object.assign(OPTS, JSON.parse(localStorage.getItem('kd-opts')) || {}); } catch (e) { }
function saveOpts() { try { localStorage.setItem('kd-opts', JSON.stringify(OPTS)); } catch (e) { } }
function applyOpts() {
  if (MUSICG) MUSICG.gain.value = OPTS.music;
  if (SFXG) SFXG.gain.value = OPTS.sfx;
}
function audio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    MASTER = AC.createGain();
    MASTER.gain.value = muted ? 0 : 0.6;
    MASTER.connect(AC.destination);
    SFXG = AC.createGain(); SFXG.connect(MASTER);
    MUSICG = AC.createGain(); MUSICG.connect(MASTER);
    applyOpts();
    startAmbience();
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, slide) {
  try {
    const ac = audio(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(SFXG); o.start(); o.stop(ac.currentTime + dur);
  } catch (e) { /* ses yoksa sessiz devam */ }
}
// Ambiyans: rüzgar (loop gürültü) + gece cırcırları; müzik: sakin pentatonik tıngırtı, savaşta davul + dron
const musT = { nextPluck: 0, nextKick: 0, nextCrick: 0, snare: false, droneG: null, windG: null };
const PENTA = [220, 261.6, 293.7, 329.6, 392, 440];
function startAmbience() {
  try {
    const ac = AC;
    const len = ac.sampleRate * 2;
    musNoiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = musNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = musNoiseBuf; src.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const wg = ac.createGain(); wg.gain.value = 0.05;
    src.connect(lp); lp.connect(wg); wg.connect(MUSICG); src.start();
    musT.windG = wg;
    const dr = ac.createOscillator(); dr.type = 'sawtooth'; dr.frequency.value = 55;
    const dlp = ac.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 220;
    const dg = ac.createGain(); dg.gain.value = 0;
    dr.connect(dlp); dlp.connect(dg); dg.connect(MUSICG); dr.start();
    musT.droneG = dg;
    setInterval(musicTick, 120);
  } catch (e) { /* ambiyans başlamazsa oyun sessiz sürer */ }
}
function pluck(f, vol) {
  const ac = AC, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = f;
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.3);
  o.connect(g).connect(MUSICG); o.start(); o.stop(ac.currentTime + 1.35);
}
function noiseHit(vol, dur, freq) {
  const ac = AC, src = ac.createBufferSource(); src.buffer = musNoiseBuf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  src.connect(bp); bp.connect(g); g.connect(MUSICG);
  src.start(0, rng() * 1.5, dur + 0.05);
}
function musicTick() {
  try {
    if (!AC || AC.state !== 'running') return;
    const now = AC.currentTime;
    musT.droneG.gain.setTargetAtTime(G.combat ? 0.045 : 0, now, 0.9);
    musT.windG.gain.setTargetAtTime(G.night ? 0.032 : 0.05, now, 1.5);
    if (G.combat) {
      if (now >= musT.nextKick) {
        musT.snare = !musT.snare;
        if (musT.snare) noiseHit(0.08, 0.1, 1900);
        else tone(150, 0.13, 'sine', 0.15, -100);
        musT.nextKick = Math.max(now, musT.nextKick) + 0.36;
      }
    } else {
      musT.nextKick = 0;
      if (now >= musT.nextPluck) {
        pluck(PENTA[ri(0, PENTA.length - 1)] * (rng() < 0.3 ? 0.5 : 1), 0.045);
        musT.nextPluck = now + rr(2.2, 5);
      }
      if (G.night && now >= musT.nextCrick) {
        tone(4200, 0.03, 'sine', 0.014, 150);
        setTimeout(() => tone(4400, 0.03, 'sine', 0.011, 150), 90);
        musT.nextCrick = now + rr(1.2, 3);
      }
    }
  } catch (e) { }
}
const SFX = {
  swing: () => tone(300, 0.08, 'sawtooth', 0.05, -150),
  hit: () => tone(160, 0.1, 'square', 0.08, -60),
  chop: () => tone(220, 0.07, 'triangle', 0.12, -120),
  hurt: () => tone(110, 0.2, 'sawtooth', 0.1, -60),
  coin: () => { tone(900, 0.07, 'sine', 0.09, 300); setTimeout(() => tone(1300, 0.09, 'sine', 0.08, 200), 60); },
  build: () => { tone(500, 0.12, 'triangle', 0.12, 100); setTimeout(() => tone(700, 0.14, 'triangle', 0.1, 150), 110); },
  boom: () => tone(70, 0.5, 'sawtooth', 0.22, -40),
  upgrade: () => { tone(520, 0.1, 'sine', 0.1, 100); setTimeout(() => tone(780, 0.16, 'sine', 0.1, 140), 100); },
  no: () => tone(180, 0.15, 'square', 0.07, -80),
  arrow: () => tone(1100, 0.06, 'square', 0.04, -500),
  horn: () => { tone(140, 0.5, 'sawtooth', 0.14, 20); setTimeout(() => tone(180, 0.7, 'sawtooth', 0.13, 25), 450); },
  dawn: () => { tone(440, 0.2, 'sine', 0.08, 60); setTimeout(() => tone(660, 0.3, 'sine', 0.07, 80), 180); },
};

// ---------- CFG: tüm oyun verisi ----------
// Büyük bölge haritası (M&B hissi): lokasyonlar birbirinden uzak, aralarında yollar
// Doğudaki 4800+ şeridi prosedürel mağara odası için ayrılmıştır (haritada görünmez)
// Mağara şeridi doğuda: zindan 3 kat büyüdüğü için dünya genişliği ona göre.
// (Bölge haritası OVERWORLD_W'yi kullandığından üst dünya görüntüsü değişmez.)
const WORLD = { w: 10400, h: 3800 };
let OVERWORLD_W = 6000; // üst dünya (yerleşkeler sığsın diye büyütüldü); ada modunda tüm haritaya genişler
// Zindan ~3 kat büyütüldü (oda ve koridor genişlikleri ordu geçemiyordu)
const CAVE_AREA = { x0: 6150, y0: 130, w: 4020, h: 3540 }; // prosedürel dungeon alanı
const CAMPFIRE = { x: 700, y: 1600 };                 // Köy (güneybatı, su kıyısına yakın)
const FOREST = { x: 1750, y: 720 };                   // Balta Ormanı (odun bölgesi)
const QUARRY = { x: 1500, y: 2550 };                  // Taş Ocağı (taş bölgesi)
const RUINS = { x: 2450, y: 1500 };                   // Eski Harabeler (hurda, merkez kavşak)
const MERCHANT = { x: 2520, y: 2350 };                // Göçebe Tüccar (güney yolu)
const CAMP1 = { x: 3350, y: 800 };                    // Barbar Kampı (tier 1)
const FORT = { cx: 4150, cy: 2450, x0: 3890, y0: 2250, x1: 4410, y1: 2650, gateY0: 2400, gateY1: 2500 }; // Taş Kale (tier 2, güneydoğu)

const RES_DEF = [
  ['wood', '🪵'], ['stone', '🪨'], ['scrap', '🔩'], ['iron', '⚙️'], ['meat', '🍖'], ['gold', '🪙'], ['gems', '💎'],
];
const COST = c => Object.entries(c).map(([k, v]) => v + RES_DEF.find(r => r[0] === k)[1]).join(' ');

const BUILDINGS = {
  sawmill:    { name: 'Bıçkıhane', icon: '🪚', cost: { wood: 20 }, desc: 'Pasif odun üretir (+1/8sn)', roof: '#b98d3e',
                lv2: { cost: { wood: 60, stone: 20 }, desc: '+2/8sn üretim' } },
  blacksmith: { name: 'Demirci', icon: '⚒️', cost: { wood: 30, stone: 20 }, desc: 'Hurda eritme, silah/zırh yükseltme', roof: '#7e3b2b' },
  barracks:   { name: 'Kışla', icon: '🛡️', cost: { wood: 40, stone: 30 }, desc: 'Asker eğit (peşinden savaşır)', roof: '#5c6e8a',
                lv2: { cost: { wood: 80, stone: 60, iron: 5 }, desc: 'Yeni birim açılır: 🏹 Okçu' },
                lv3: { cost: { wood: 140, stone: 110, iron: 12 }, desc: 'Yeni birim açılır: 🛡️ Kalkanlı' } },
  watchtower: { name: 'Gözcü Kulesi', icon: '🏹', cost: { wood: 50, stone: 25 }, desc: 'Yaklaşan düşmanlara ok atar', roof: '#77777d', multi: true,
                lv2: { cost: { wood: 90, stone: 60, iron: 4 }, desc: 'Menzil ve hasar artar' } },
  house:      { name: 'Köylü Evi', icon: '🏡', cost: { wood: 25, stone: 10 }, desc: 'Köylü barındırır — iş ver, pasif üretim', roof: '#c9a06a', multi: true,
                lv2: { cost: { wood: 40, stone: 20 }, desc: 'Üretim ×2' } },
  siege:      { name: 'Kuşatma Atölyesi', icon: '🏗️', cost: { wood: 60, stone: 40, iron: 8 }, desc: 'Mancınık üret', roof: '#8a5c33', req: 'blacksmith' },
  hunter:     { name: 'Avcı Kulübesi', icon: '🦌', cost: { wood: 35, stone: 10 }, desc: 'Pasif 🍖 et üretir → köy deposuna (+1/10sn)', roof: '#6e8a5e', multi: true,
                lv2: { cost: { wood: 70, stone: 30, gold: 40 }, desc: 'Üretim ×2' } },
  depot:      { name: 'Depo', icon: '🏬', cost: { wood: 45, stone: 30 }, desc: 'Köy deposu limiti +200 (her kaynak)', roof: '#8a7a55', multi: true,
                lv2: { cost: { wood: 90, stone: 60 }, desc: 'Limit +200 daha' } },
};
const TOWER = { range: [0, 250, 330], dmg: [0, 11, 17], rate: 0.9 };
const DAYLEN = { day: 150, night: 55 };   // saniye
// Köy suru: kamp ateşi merkezli ahşap çit halkası, doğuda kırılabilir kapı
const PAL = { r: 285, gapA: 0.14, cost: { wood: 80, stone: 40 }, gateHp: 500, repair: { wood: 30 } };
const PAL_GATE = { x: 0, y: 0 }; // genWorld'de doldurulur
// Karakol suru: sancak merkezli halka, kapısı köye bakan yönde.
// SADECE kendi taş suru olmayan karakollarda (kale/lejyonun zaten gerçek surları + onarılır kapıları var).
const OP_WALL = { r: 265, gapA: 0.17, cost: { wood: 120, stone: 60, gold: 40 }, gateHp: 450, repair: { wood: 40, stone: 20 } };
const OP_WALL_SITES = ['camp1'];
// Karakol seviye atladıkça suru köy gibi GENİŞLER — yeni arsa halkası açılsın diye.
// Sv.1: 265, Sv.2: 345, Sv.3: 425 (köyün 285 → 445 büyümesiyle aynı mantık).
const OP_RING_STEP = 80;
const opWallR = op => OP_WALL.r + (((op && op.lv) || 1) - 1) * OP_RING_STEP;
const opWallRAt = site => opWallR(G.outposts && G.outposts[site]);
// Sur büyürken kapı AÇIKLIĞI piksel olarak sabit kalsın (açısal yarıçap küçülür),
// yoksa Sv.3'te 145px'lik bir delik oluyor ama kapı çizimi 80px kalıyordu.
const opGapA = op => OP_WALL.gapA * OP_WALL.r / opWallR(op);
const angDiff = (a, b) => { let d = Math.abs(a - b) % TAU; return d > Math.PI ? TAU - d : d; };
// Lejyon karargâhı (tier 3, kuzeydoğu)
const LEG = { x0: 3550, y0: 250, x1: 4150, y1: 610, gx0: 3790, gx1: 3910, cx: 3850, cy: 430 };
// Harita lokasyonları (🗺️ ekranı + hızlı yolculuk hedefleri)
const LOCATIONS = [
  { id: 'village', name: 'Köy', icon: '🏠', x: CAMPFIRE.x, y: CAMPFIRE.y },
  { id: 'forest', name: 'Balta Ormanı', icon: '🌲', x: FOREST.x, y: FOREST.y },
  { id: 'quarry', name: 'Taş Ocağı', icon: '⛏️', x: QUARRY.x, y: QUARRY.y },
  { id: 'ruins', name: 'Eski Harabeler', icon: '🏛️', x: RUINS.x, y: RUINS.y },
  { id: 'merchant', name: 'Göçebe Tüccar', icon: '🐪', x: MERCHANT.x, y: MERCHANT.y },
  { id: 'camp1', name: 'Barbar Kampı', icon: '⛺', x: CAMP1.x - 60, y: CAMP1.y + 200 },
  { id: 'fort', name: 'Taş Kale', icon: '🏰', x: FORT.x0 - 200, y: (FORT.gateY0 + FORT.gateY1) / 2 },
  { id: 'legion', name: 'Lejyon Karargâhı', icon: '🦅', x: LEG.cx, y: LEG.y1 + 200 },
];
// Fethedilen yerler karakola dönüşür: sancak + garnizon + günlük vergi
const OUTPOSTS = {
  village: { name: 'Köy', income: 0, x: CAMPFIRE.x, y: CAMPFIRE.y }, // garnizon sistemi için (vergi yok)
  camp1:  { name: 'Barbar Kampı Karakolu', income: 15, x: CAMP1.x, y: CAMP1.y },
  fort:   { name: 'Taş Kale Karakolu', income: 40, x: FORT.cx, y: FORT.cy },
  legion: { name: 'Lejyon Karakolu', income: 80, x: LEG.cx, y: LEG.cy },
};
const garrisonCap = op => op.isVillage ? 1 + 2 * G.villageTier : 1 + 2 * (op.lv || 1); // karakol Sv / köy kademesiyle: 3, 5, 7
// Yollarda devriye gezen haydut çeteleri (harita canlı hissetsin)
const PATROLS = [
  { pts: [[FOREST.x, FOREST.y + 150], [RUINS.x, RUINS.y - 100], [CAMP1.x - 300, CAMP1.y + 250]], speed: 26 },
  { pts: [[QUARRY.x + 150, QUARRY.y - 100], [MERCHANT.x - 150, MERCHANT.y - 80], [RUINS.x, RUINS.y + 150]], speed: 26 },
];

// ---------- Harita düzenleri: bölge slotuna göre yerleşik/özel yerleşim ----------
// Her düzen 8 noktadan ibaret; kale/karargâh dikdörtgenleri merkezden türetilir.
const BUILTIN_MAPS = [
  { campfire: { x: 700, y: 1600 }, forest: { x: 1750, y: 720 }, quarry: { x: 1500, y: 2550 }, ruins: { x: 2450, y: 1500 },
    merchant: { x: 2520, y: 2350 }, camp1: { x: 3020, y: 1010 }, fort: { x: 4150, y: 2450 }, legion: { x: 3900, y: 400 }, cave: { x: 2900, y: 1950 } },
  { campfire: { x: 680, y: 900 }, forest: { x: 2250, y: 420 }, quarry: { x: 1350, y: 2250 }, ruins: { x: 2400, y: 1650 },
    merchant: { x: 1780, y: 2780 }, camp1: { x: 3400, y: 2600 }, fort: { x: 4150, y: 830 }, legion: { x: 3620, y: 1780 }, cave: { x: 2860, y: 2120 } },
  { campfire: { x: 720, y: 2300 }, forest: { x: 1450, y: 650 }, quarry: { x: 2620, y: 2830 }, ruins: { x: 2300, y: 1350 },
    merchant: { x: 3120, y: 1900 }, camp1: { x: 2950, y: 520 }, fort: { x: 4250, y: 1180 }, legion: { x: 4000, y: 2700 }, cave: { x: 1700, y: 1750 } },
];
const CAVE = { x: 2900, y: 1950 }; // Karanlık İn (mini zindan girişi)
// Yerleşkeler birbirine girmesin: çok yakın olan nokta, komşusundan uzağa itilir.
// Deterministik (aynı girdi → aynı çıktı), böylece co-op'ta iki bilgisayar aynı haritayı kurar.
// Yerleşke ayak izleri EN BÜYÜK hâlleriyle: köy kademe 3 suru (445), karakol
// Sv.3 suru (425), kale/lejyon ise taş kutu + Sv.3'te eklenen iki DIŞ KALE suru.
// Eski MIN tablosu bunları bilmiyordu (kale 780 sayılıyordu ama gerçek ayak izi
// 680x585) → barbar kampının kazık suru lejyonun taş surunun içinden geçiyordu.
// TEMBEL hesap: PAL/OP_WALL/KEEP_PAD gibi sabitler dosyada BURADAN SONRA
// tanımlı. Nesne olarak yazılırsa modül yüklenirken TDZ hatası verip oyunu
// komple çökertiyor (yaşandı). spaceOutSites ancak boot'un sonunda çağrılıyor.
const siteFoot = () => ({
  campfire: { r: PAL.r + EXPANSIONS.length * 80 },                    // 445
  camp1:    { r: OP_WALL.r + 2 * OP_RING_STEP },                      // 425
  fort:     { hw: 380 + 2 * KEEP_PAD, hh: 285 + 2 * KEEP_PAD },       // 680 x 585
  legion:   { hw: 430 + 2 * KEEP_PAD, hh: 255 + 2 * KEEP_PAD },       // 730 x 555
  merchant: { r: 170 }, ruins: { r: 210 }, forest: { r: 280 }, quarry: { r: 260 }, cave: { r: 170 },
});
// Merkezden VERİLEN YÖNDEKİ ayak izi (kutularda kenara olan uzaklık) — itme
// mesafesini hesaplarken kullanılır.
function siteReach(k, ang) {
  const f = siteFoot()[k] || { r: 260 };
  if (f.r) return f.r;
  const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
  return Math.min(c > 1e-4 ? f.hw / c : 1e9, sn > 1e-4 ? f.hh / sn : 1e9);
}
// İki yerleşkenin GERÇEK açıklığı (negatifse iç içeler).
// Işın tabanlı ölçü kutuların KÖŞELERİNDE iyimser davranıyordu: ışının kutudan
// çıkış noktasına bakıyor, hâlbuki daire köşeye daha yakın olabiliyor. Bu yüzden
// "0 çakışma" raporlanan bir düzende sur, taş duvarın içinden geçiyordu.
function siteGap(ka, a, kb, b) {
  const F = siteFoot(), fa = F[ka] || { r: 260 }, fb = F[kb] || { r: 260 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const kutuNokta = (hw, hh, px, py) =>
    Math.hypot(Math.max(Math.abs(px) - hw, 0), Math.max(Math.abs(py) - hh, 0));
  if (fa.r && fb.r) return Math.hypot(dx, dy) - fa.r - fb.r;
  if (fa.r) return kutuNokta(fb.hw, fb.hh, -dx, -dy) - fa.r;
  if (fb.r) return kutuNokta(fa.hw, fa.hh, dx, dy) - fb.r;
  return Math.max(Math.abs(dx) - fa.hw - fb.hw, Math.abs(dy) - fa.hh - fb.hh);
}
function spaceOutSites(g) {
  const PAY = 90;   // yerleşkeler arası nefes payı
  const keys = ['campfire', 'fort', 'legion', 'camp1', 'ruins', 'merchant', 'forest', 'quarry', 'cave'].filter(k => g[k]);
  // Üst dünya sınırları: WORLD.w artık mağara şeridini de kapsıyor (9100),
  // oraya itilen yerleşke haritanın dışında kalırdı.
  const x0 = 320, x1 = OVERWORLD_W - 320, y0 = 300, y1 = WORLD.h - 300;
  for (let tur = 0; tur < 16; tur++) {
    let itildi = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = g[keys[i]], b = g[keys[j]];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const acik = siteGap(keys[i], a, keys[j], b);        // GERÇEK açıklık
        if (acik >= PAY) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const gerek = d + (PAY - acik) + 20;                 // eksik kadar aç (+ pay)
        const a2 = d < 1 ? (i * 1.7 + j) : ang;   // üst üsteyse deterministik bir yöne aç
        // Normalde SONRAKİ nokta itilir. Ama itilecek yer harita sınırının
        // dışına düşüyorsa (kırpılıp yerinde sayardı) bunun yerine ÖNCEKİ nokta
        // ters yöne itilir — yoksa kenara sıkışan çift hiç açılmıyordu.
        const hx = a.x + Math.cos(a2) * gerek, hy = a.y + Math.sin(a2) * gerek;
        const sigmaz = hx < x0 || hx > x1 || hy < y0 || hy > y1;
        if (sigmaz && keys[i] !== 'campfire') {
          a.x = Math.round(clamp(b.x - Math.cos(a2) * gerek, x0, x1));
          a.y = Math.round(clamp(b.y - Math.sin(a2) * gerek, y0, y1));
        } else {
          b.x = Math.round(clamp(hx, x0, x1));
          b.y = Math.round(clamp(hy, y0, y1));
        }
        itildi = true;
      }
    }
    if (!itildi) break;
  }
  return g;
}
function applyGeography(g) {
  g = spaceOutSites(g);
  Object.assign(CAMPFIRE, g.campfire);
  Object.assign(FOREST, g.forest); Object.assign(QUARRY, g.quarry);
  Object.assign(RUINS, g.ruins); Object.assign(MERCHANT, g.merchant);
  Object.assign(CAMP1, g.camp1);
  FORT.cx = g.fort.x; FORT.cy = g.fort.y;
  FORT.x0 = FORT.cx - 380; FORT.x1 = FORT.cx + 380; FORT.y0 = FORT.cy - 285; FORT.y1 = FORT.cy + 285;
  FORT.gateY0 = FORT.cy - 65; FORT.gateY1 = FORT.cy + 65;
  LEG.cx = g.legion.x; LEG.cy = g.legion.y;
  LEG.x0 = LEG.cx - 430; LEG.x1 = LEG.cx + 430; LEG.y0 = LEG.cy - 255; LEG.y1 = LEG.cy + 255;
  LEG.gx0 = LEG.cx - 80; LEG.gx1 = LEG.cx + 80;
  // türetilenler
  for (const L of LOCATIONS) {
    const src = { village: CAMPFIRE, forest: FOREST, quarry: QUARRY, ruins: RUINS, merchant: MERCHANT }[L.id];
    if (src) { L.x = src.x; L.y = src.y; }
    else if (L.id === 'camp1') { L.x = CAMP1.x - 60; L.y = CAMP1.y + 200; }
    else if (L.id === 'fort') { L.x = FORT.x0 - 200; L.y = (FORT.gateY0 + FORT.gateY1) / 2; }
    else if (L.id === 'legion') { L.x = LEG.cx; L.y = LEG.y1 + 200; }
  }
  SIEGE_SITES[0].x = FORT.x0 - 170; SIEGE_SITES[0].y = (FORT.gateY0 + FORT.gateY1) / 2;
  SIEGE_SITES[1].x = LEG.cx; SIEGE_SITES[1].y = LEG.y1 + 170;
  OUTPOSTS.village.x = CAMPFIRE.x; OUTPOSTS.village.y = CAMPFIRE.y;
  OUTPOSTS.camp1.x = CAMP1.x; OUTPOSTS.camp1.y = CAMP1.y;
  OUTPOSTS.fort.x = FORT.cx; OUTPOSTS.fort.y = FORT.cy;
  OUTPOSTS.legion.x = LEG.cx; OUTPOSTS.legion.y = LEG.cy;
  Object.assign(CAVE, g.cave || { x: RUINS.x + 450, y: RUINS.y + 450 });
  PATROLS[0].pts = [[FOREST.x, FOREST.y + 150], [RUINS.x, RUINS.y - 100], [CAMP1.x - 300, CAMP1.y + 250]];
  PATROLS[1].pts = [[QUARRY.x + 150, QUARRY.y - 100], [MERCHANT.x - 150, MERCHANT.y - 80], [RUINS.x, RUINS.y + 150]];
  G.rival.x = RUINS.x + 650; G.rival.y = RUINS.y;
  G.player.x = CAMPFIRE.x + 60; G.player.y = CAMPFIRE.y + 40; // taze doğuş (kayıt üstüne yazar)
}
const geoSnapshot = () => ({
  campfire: { x: CAMPFIRE.x, y: CAMPFIRE.y }, forest: { x: FOREST.x, y: FOREST.y },
  quarry: { x: QUARRY.x, y: QUARRY.y }, ruins: { x: RUINS.x, y: RUINS.y },
  merchant: { x: MERCHANT.x, y: MERCHANT.y }, camp1: { x: CAMP1.x, y: CAMP1.y },
  fort: { x: FORT.cx, y: FORT.cy }, legion: { x: LEG.cx, y: LEG.cy },
  cave: { x: CAVE.x, y: CAVE.y },
});
// Kuşatma kampları: kapıların önünde işaretli alanlar; silahlar burada kurulur
const SIEGE_SITES = [
  { id: 'fort', name: 'Taş Kale Kuşatması', x: FORT.x0 - 170, y: (FORT.gateY0 + FORT.gateY1) / 2, gateKind: 'gate',
    slots: { catapult: [-45, -60], ballista: [-40, 62], ram: [45, 5] } },
  { id: 'legion', name: 'Lejyon Kuşatması', x: LEG.cx, y: LEG.y1 + 170, gateKind: 'lgate',
    slots: { catapult: [-80, 25], ballista: [80, 25], ram: [0, -50] } },
];
const buildingMaxHp = lv => 200 + 100 * (lv - 1);
const repairCost = type => Object.fromEntries(Object.entries(BUILDINGS[type].cost).map(([k, v]) => [k, Math.max(1, Math.ceil(v * 0.4))]));
// Ayakta ama hasarlı bina: bedel hasar oranıyla ölçülür (tam yıkığın onarımı = repairCost)
const bldKey = b => 'b' + Math.round(b.x) + '_' + Math.round(b.y);
const bldHurt = b => b && !b.ruined && BUILDINGS[b.type] && b.hp < b.maxHp - 1;
const fixCost = b => Object.fromEntries(Object.entries(repairCost(b.type))
  .map(([k, v]) => [k, Math.max(1, Math.ceil(v * (1 - b.hp / b.maxHp)))]));
const SWORD_LV = [
  { dmg: 10 },
  { dmg: 15, cost: { iron: 3, gold: 40 } },
  { dmg: 22, cost: { iron: 6, gold: 90 } },
  { dmg: 32, cost: { iron: 10, gold: 160 } },
  { dmg: 45, cost: { iron: 14, gold: 260, gems: 6 } },   // bölge 2+ için (mücevher yatırımı)
  { dmg: 62, cost: { iron: 20, gold: 400, gems: 12 } },
];
const ARMOR_LV = [
  { hp: 100 },
  { hp: 140, cost: { iron: 4, gold: 50 } },
  { hp: 190, cost: { iron: 8, gold: 120 } },
  { hp: 260, cost: { iron: 12, gold: 220, gems: 8 } },
];
// ---------- Kuşam sistemi (Archero tarzı): 10 nadirlik, çanta, oyuncu + komutan donatma ----------
// SWORD_LV/ARMOR_LV artık sadece eski kayıtları kuşama çevirmek için duruyor.
const RARITY = [
  { name: 'Sıradan', c: '#9aa0a8', m: 1 },
  { name: 'İyi', c: '#6fbf5e', m: 1.4 },
  { name: 'Nadir', c: '#4da3e8', m: 1.9 },
  { name: 'Epik', c: '#a86fe0', m: 2.5 },
  { name: 'Kusursuz Epik', c: '#d24fe8', m: 3.2 },
  { name: 'Efsanevi', c: '#f0b93d', m: 4.1 },
  { name: 'Kadim Efsanevi', c: '#f0822e', m: 5.3 },
  { name: 'Mitik', c: '#e84a5e', m: 6.8 },
  { name: 'Titan Masalı', c: '#3de8d0', m: 8.7 },
  { name: 'Kaos', c: '#ff2e2e', m: 11 },
];
const GEAR_SLOTS = { weapon: '⚔️ Silah', armor: '🛡️ Zırh', helmet: '🪖 Miğfer', boots: '🥾 Çizme', ring: '💍 Yüzük', locket: '📿 Tılsım' };
const GEAR_BASES = {
  sword:  { slot: 'weapon', name: 'Kılıç', icon: '🗡️', atk: 5 },
  axe:    { slot: 'weapon', name: 'Savaş Baltası', icon: '🪓', atk: 6 },
  mace:   { slot: 'weapon', name: 'Topuz', icon: '🔨', atk: 5, hp: 6 },
  leather:{ slot: 'armor', name: 'Deri Zırh', icon: '🥋', hp: 18, atk: 1 },
  plate:  { slot: 'armor', name: 'Plaka Zırh', icon: '🛡️', hp: 26 },
  helm:   { slot: 'helmet', name: 'Miğfer', icon: '🪖', hp: 12, atk: 1 },
  boots:  { slot: 'boots', name: 'Çizmeler', icon: '🥾', hp: 8, spd: 5 },
  ring:   { slot: 'ring', name: 'Kudret Yüzüğü', icon: '💍', atkp: 5 },
  seal:   { slot: 'ring', name: 'Mühür Yüzüğü', icon: '💠', hpp: 5 },
  locket: { slot: 'locket', name: 'Tılsım', icon: '📿', atkp: 3, hpp: 3 },
};
// Nadirlik zar ağırlıkları: güç 0=sıradan düşman, 1=seçkin düşman, 2=boss, 3=sandık
const RARITY_W = [
  [55, 26, 12, 5, 2, 0, 0, 0, 0, 0],
  [28, 28, 21, 12, 7, 3, 1, 0, 0, 0],
  [6, 14, 22, 21, 15, 11, 6, 3, 1.5, 0.5],
  [0, 8, 16, 22, 19, 14, 10, 6.5, 3.5, 1],
];
function rollRarity(power) {
  const w = RARITY_W[clamp(power, 0, 3)];
  let t = 0; for (const x of w) t += x;
  let roll = Math.random() * t, r = 0;
  for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) { r = i; break; } }
  while (Math.random() < 0.06 * (G.region - 1) && r < 9) r++; // bölge kademesi şansı yukarı çeker
  return r;
}
function gearStats(g) {
  const st = { atk: 0, hp: 0, atkp: 0, hpp: 0, spd: 0 };
  for (const it of Object.values(g || {})) {
    if (!it || !GEAR_BASES[it.b]) continue;
    const B = GEAR_BASES[it.b], m = RARITY[it.r].m;
    st.atk += (B.atk || 0) * m; st.hp += (B.hp || 0) * m;
    st.atkp += (B.atkp || 0) * m; st.hpp += (B.hpp || 0) * m; st.spd += (B.spd || 0) * m;
  }
  for (const k of Object.keys(st)) st[k] = Math.round(st[k]);
  return st;
}
const gearLabel = it => RARITY[it.r].name + ' ' + GEAR_BASES[it.b].name;
function gearStatText(it) {
  const B = GEAR_BASES[it.b], m = RARITY[it.r].m, out = [];
  if (B.atk) out.push('+' + Math.round(B.atk * m) + '⚔');
  if (B.hp) out.push('+' + Math.round(B.hp * m) + '❤');
  if (B.atkp) out.push('+%' + Math.round(B.atkp * m) + '⚔');
  if (B.hpp) out.push('+%' + Math.round(B.hpp * m) + '❤');
  if (B.spd) out.push('+' + Math.round(B.spd * m) + '👟');
  return out.join(' ');
}
// ---------- Köy deposu: pasif üretim burada birikir, limitli ----------
const stockCap = () => 150 + G.buildings.filter(b => b.type === 'depot' && !b.ruined && !b.outpost).reduce((a, b) => a + b.lv * 200, 0);
const opStockCap = op => 100 + (op.lv || 1) * 100 + G.buildings.filter(b => b.type === 'depot' && !b.ruined && b.outpost === op._id).reduce((a, b) => a + b.lv * 200, 0);
function addStock(k, n, x, y, site) {
  const op = site && G.outposts[site] && !G.outposts[site].isVillage ? G.outposts[site] : null;
  if (op) { // karakol üretimi kendi ambarına
    op._id = site;
    op.stock = op.stock || {};
    const cap2 = opStockCap(op);
    const can2 = Math.max(0, Math.min(n, cap2 - (op.stock[k] || 0)));
    op.stock[k] = (op.stock[k] || 0) + can2;
    if (x !== undefined) {
      const icon2 = (RES_DEF.find(r => r[0] === k) || [])[1] || '';
      addFloater(x + rr(-8, 8), y, can2 > 0 ? '+' + can2 + ' ' + icon2 + '→🏳️' : '🏳️ AMBAR DOLU!', can2 > 0 ? '#c8e0a8' : '#ff9a8a', 12);
    }
    return can2;
  }
  const cap = stockCap();
  const can = Math.max(0, Math.min(n, cap - (G.stock[k] || 0)));
  G.stock[k] = (G.stock[k] || 0) + can;
  if (ISLAND && can > 0) { // ada deposu ortak: üretim sunucuya da işlenir
    const sa = G.islOps.stockAdd = G.islOps.stockAdd || {};
    sa[k] = (sa[k] || 0) + can;
  }
  if (x !== undefined) {
    const icon = (RES_DEF.find(r => r[0] === k) || [])[1] || '';
    addFloater(x + rr(-8, 8), y, can > 0 ? '+' + can + ' ' + icon + '→🏬' : '🏬 DOLU!', can > 0 ? '#ffe9a8' : '#ff9a8a', 12);
  }
  return can;
}
// Eşya güç puanı: otomatik giy kıyası (statlar ağırlıklı, nadirlik çarpanı dahil)
function gearScore(it) {
  const B = GEAR_BASES[it.b], m = RARITY[it.r].m;
  return ((B.atk || 0) * 3 + (B.hp || 0) * 1 + (B.atkp || 0) * 3.5 + (B.hpp || 0) * 2.5 + (B.spd || 0) * 2) * m;
}
// Çantadan en iyileri kuşan: her slot için üzerindekiyle kıyasla, daha iyisi varsa takas et
function autoEquip(eq) {
  let changed = 0;
  for (const sk of Object.keys(GEAR_SLOTS)) {
    let bestI = -1, bestS = eq[sk] ? gearScore(eq[sk]) : -1;
    G.bag.forEach((it, i) => {
      if (GEAR_BASES[it.b].slot !== sk) return;
      const s = gearScore(it);
      if (s > bestS) { bestS = s; bestI = i; }
    });
    if (bestI >= 0) {
      const it = G.bag.splice(bestI, 1)[0];
      if (eq[sk]) G.bag.push(eq[sk]);
      eq[sk] = it; changed++;
    }
  }
  return changed;
}
// kuşam değişince statları tazele (can oranı korunur)
function afterGearChange(isPlayer, c) {
  if (isPlayer) {
    const p = G.player, frac = p.hp / p.maxHp;
    p.maxHp = playerMaxHp(); p.hp = Math.max(1, Math.round(p.maxHp * frac));
  } else if (c) cmdRecalc(c);
  save();
}
function dropGear(power, x, y) {
  const r = rollRarity(power);
  const keys = Object.keys(GEAR_BASES);
  const b = keys[Math.floor(Math.random() * keys.length)];
  const it = { b, r };
  G.bag.push(it);
  if (x !== undefined) addFloater(x + rr(-8, 8), y - 74, '🎒 ' + gearLabel(it), RARITY[r].c, 13 + r);
  if (r >= 3) { toast('🎒 ' + gearLabel(it) + ' çantana girdi!' + (r >= 7 ? ' 🌟' : '')); if (r >= 5) SFX.upgrade(); }
  return it;
}
// oyuncu toplam vuruş gücü: taban 10 + seviye + kuşam, sonra yüzdeler ve Hanedan Kılıcı
function playerAtk() {
  const gs = gearStats(G.equip);
  return Math.round((10 + (G.level - 1) + gs.atk) * (1 + gs.atkp / 100) * (1 + 0.15 * (G.dynUpg.blade || 0)) * BAL.patk);
}
// komutan statları: taban + seviye + kuşam
function cmdRecalc(c) {
  const C = COMMANDERS[c.id];
  const gs = gearStats(c.gear);
  const frac = c.maxHp ? c.hp / c.maxHp : 1;
  // Sv.20'ye kadar +14❤/+2⚔ (eski değerler birebir korunur), sonrası +7❤/+1⚔
  const n = c.lv - 1;
  const lvHp = n <= 19 ? n * 14 : 19 * 14 + (n - 19) * 7;
  const lvDmg = n <= 19 ? n * 2 : 19 * 2 + (n - 19);
  c.maxHp = Math.round((C.hp + lvHp + gs.hp) * (1 + gs.hpp / 100));
  c.hp = Math.max(1, Math.round(c.maxHp * frac));
  c.tdmg = Math.round((C.dmg + lvDmg + gs.atk) * (1 + gs.atkp / 100));
}
// Hanedan Mirası: mücevherle alınan KALICI güçler — bölgeden bölgeye taşınır
const DYN_UPG = {
  blade: { name: 'Hanedan Kılıcı', icon: '⚔️', desc: 'Kılıç hasarı +%15 / seviye', max: 3, cost: [4, 8, 14] },
  vigor: { name: 'Atalardan Güç', icon: '❤️', desc: 'Azami can +25 / seviye', max: 3, cost: [4, 8, 14] },
  swift: { name: 'Çevik Adımlar', icon: '🏃', desc: 'Hareket hızı +%8 / seviye', max: 2, cost: [5, 10] },
  taxes: { name: 'Vergi Ustası', icon: '💰', desc: 'Karakol geliri +%40 / seviye', max: 2, cost: [5, 10] },
  mason: { name: 'Usta İnşaatçılar', icon: '🔨', desc: 'İnşaat maliyetleri −%12 / seviye', max: 2, cost: [5, 10] },
};
// Seviye sistemi: XP kaynakları öldürme/görev/fetih/baskın; her seviye +10 can +1 hasar,
// asker kapasitesi = 2 + seviye/2 (+2 kışla Sv.2) — "ordu liderliği" karakterle büyür
const xpNeed = lv => lv <= 30 ? 80 + lv * 60 : 1880 + (lv - 30) * 25;
// Karakter tavanı Sv.100, komutan tavanı Sv.80. Eğriler Sv.30/Sv.20'ye kadar
// AYNEN korunur (mevcut kayıtlar etkilenmesin), ondan sonrası yavaşlar — yoksa
// doğrusal artışla 100. seviye ulaşılamaz bir sayıya çıkıyordu.
const LEVEL_MAX = 100;
const soldierCap = () => Math.min(12, 2 + Math.floor(G.level / 2)); // sadece karakter seviyesi (kışla yeni birim açar, kapasite vermez)
const playerMaxHp = () => { const gs = gearStats(G.equip); return Math.round((100 + gs.hp + 25 * (G.dynUpg.vigor || 0) + (G.level - 1) * 10) * (1 + gs.hpp / 100) * BAL.php); };
const playerSpeed = () => (225 + gearStats(G.equip).spd) * (1 + 0.08 * (G.dynUpg.swift || 0)) * (G.feastT > 0 ? 1.1 : 1) * (G.riding ? 1.55 : 1) * ((G.player.slowT || 0) > 0 ? 0.6 : 1); // ziyafet + at + donma
// İnşaat maliyeti indirimi (Usta İnşaatçılar)
const bcost = c => {
  const m = (1 - 0.12 * (G.dynUpg.mason || 0)) * BAL.cost;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.max(1, Math.ceil(v * m))]));
};
const SOLDIER = { hp: 90, dmg: 12, speed: 205, range: 58, aggro: 270, cd: 0.9, regen: 3, cost: { gold: 30, iron: 2 } };
// Asker sınıfları: kışlada seçilir
const SOLDIER_CLS = {
  sword:  { name: 'Kılıçlı', icon: '🗡️', desc: 'Dengeli yakın dövüşçü', hp: 90, dmg: 12, speed: 205, range: 58, cd: 0.9, cost: { gold: 30, iron: 2 } },
  bow:    { name: 'Okçu', icon: '🏹', desc: 'Uzaktan vurur, kırılgandır', hp: 55, dmg: 11, speed: 210, range: 240, cd: 1.9, cost: { gold: 35, iron: 3 }, ranged: true },
  shield: { name: 'Kalkanlı', icon: '🛡️', desc: 'Yavaş ama çok dayanıklı', hp: 170, dmg: 8, speed: 180, range: 58, cd: 1.1, cost: { gold: 45, iron: 4 } },
};
const BARRACKS_CAP = [0, 3, 5];
// ---------- Asker rütbe & seviye: XP leşle birikir, TERFİ MANUEL (Ordu panelinden altınla) ----------
// Asker tavanı Sv.25 — rütbeler 25 kademeye yayıldı (ilk 10'u eskisiyle birebir
// aynı, mevcut askerlerin unvanı değişmesin).
const SOLDIER_RANKS = ['Er', 'Onbaşı', 'Çavuş', 'Üstçavuş', 'Başçavuş', 'Muhafız', 'Kıdemli Muhafız', 'Yiğit', 'Alp', 'Başbuğ',
  'Akıncı', 'Kıdemli Akıncı', 'Serdengeçti', 'Bahadır', 'Kıdemli Bahadır', 'Tekin', 'Subaşı', 'Çeribaşı', 'Sancakdar', 'Tuğ Beyi',
  'Alp Eren', 'Bey', 'Ulu Bey', 'Han Yiğidi', 'Kağan Muhafızı'];
const SOLDIER_LV_MAX = 25, CMD_LV_MAX = 80;
// Sv.10'a kadar eski eğri korunur, sonrası yavaşlar (yoksa tavan erişilemez)
const sXpNeed = lv => lv <= 10 ? 20 + lv * 15 : 170 + (lv - 10) * 8;   // sıradaki terfi için gereken XP
const sPromoteCost = lv => lv <= 10 ? 15 + lv * 10 : 115 + (lv - 10) * 6; // terfi bedeli 🪙
const soldierRank = s => SOLDIER_RANKS[Math.min(SOLDIER_LV_MAX, s.lv || 1) - 1];
function soldierRecalc(s) { // seviye başına +14❤ +2⚔ (sınıf tabanının üstüne)
  const SC = SOLDIER_CLS[s.cls || 'sword'];
  const frac = s.maxHp ? s.hp / s.maxHp : 1;
  s.maxHp = SC.hp + ((s.lv || 1) - 1) * 14;
  s.hp = Math.max(1, Math.round(s.maxHp * frac));
  s.tdmg = SC.dmg + ((s.lv || 1) - 1) * 2;
}
function soldierXp(s, n) {
  if ((s.lv || 1) >= SOLDIER_LV_MAX) return;
  s.xp = (s.xp || 0) + n;
  addFloater(s.x, s.y - 52, '+' + n + 'xp', '#c9a8f0', 11);
  if (s.xp >= sXpNeed(s.lv || 1) && !s.promoNoted) {
    s.promoNoted = true;
    toast('🎖️ Bir askerin terfiye hazır — Ordu panelinden onayla! (' + sPromoteCost(s.lv || 1) + '🪙)');
  }
}
// Bağımsız komutan: görevi varsa (takip dışı) kendi başına gezer, kendi ordusunu kurar
const cmdIndependent = c => !!(c.order && c.order !== 'follow');
const cmdTroopCap = c => Math.min(8, 1 + Math.floor(c.lv / 2)); // öz ordu kapasitesi seviyeyle
const CMD_TROOP_COST = 30; // komutanın kendi kesesinden asker bedeli (BAL.cmdTroopCost ile ezilir)
const guardRadius = site => site === 'village' ? palR() + 110
  : site === 'camp1' ? opWallRAt('camp1') + 100 : site === 'fort' ? 480 : 520; // surun DIŞINDA devriye halkası
const siteName = id => id === 'village' ? 'Köy' : (LOCATIONS.find(l => l.id === id) || OUTPOSTS[id] || { name: id }).name;
// Taş Sur (köy surunun 2. seviyesi)
const PAL2 = { cost: { stone: 120, wood: 60, iron: 10 }, gateHp: 1200 };
// Köy genişletme kademeleri: her biri yeni inşa arsaları açar (sur içinde kalır)
const EXPANSIONS = [
  // arsa yarıçapları sur - ~90px: bina ile duvar arasında geçilebilir koridor kalır (sıkışma fix)
  { cost: { wood: 60, stone: 40, gold: 50 }, plots: [[122, 239], [-245, 109], [-245, -109], [122, -239]] },   // 2. halka (r268) — sur 365'e genişler
  { cost: { wood: 150, stone: 100, gold: 150 }, plots: [[-118, 324], [-118, -324], [322, 124], [322, -124]] }, // 3. halka (r345) — sur 445'e genişler
];
// Köylü işleri (Köylü Evi'ne atanır)
const VILLAGER_JOBS = {
  wood:  { name: 'Oduncu', icon: '🪵', every: 10 },
  stone: { name: 'Taşçı', icon: '🪨', every: 13 },
  scrap: { name: 'Hurdacı', icon: '🔩', every: 16 },
};
const VILLAGER_COST = { gold: 30 };
// Kuşatma silahları: kapı önündeki kuşatma kamplarında yerinde inşa edilir (M&B tarzı)
const ENGINES = {
  catapult: { name: 'Mancınık', icon: '🪨', cost: { wood: 50, stone: 30, iron: 10 }, buildTime: 25,
              desc: 'Yapılara uzaktan taş yağdırır — çelik kapıya işlemez', range: 430, rate: 4, dmgStruct: 120, dmgUnit: 45 },
  ballista: { name: 'Balista', icon: '🎯', cost: { wood: 60, iron: 8 }, buildTime: 18,
              desc: 'Savunmaya çıkan düşmanlara ağır ok atar', range: 400, rate: 2.2, dmg: 55 },
  ram:      { name: 'Koçbaşı', icon: '🐏', cost: { wood: 120, iron: 15 }, buildTime: 35,
              desc: 'Tamamlanınca kapıya ilerler ve döver — çelik kapının tek çaresi', rate: 2.6, dmg: 240, speed: 42 },
};
const ENEMY_DEF = {
  barb:  { hp: 40, dmg: 6, speed: 135, aggro: 230, range: 54, cd: 1.1, scale: 0.62, cloth: '#8a4a3a', gold: [4, 9], scrap: [0.35, 1, 2], xp: 10 },
  brute: { hp: 130, dmg: 14, speed: 105, aggro: 230, range: 62, cd: 1.5, scale: 0.8, cloth: '#6e3a2a', gold: [12, 22], scrap: [0.7, 2, 3], xp: 25 },
  guard: { hp: 200, dmg: 18, speed: 125, aggro: 280, range: 56, cd: 1.1, scale: 0.68, cloth: '#4a4a55', gold: [18, 30], scrap: [0.5, 2, 4], xp: 35 },
  chief: { hp: 950, dmg: 34, speed: 115, aggro: 320, range: 68, cd: 1.4, scale: 1.5, cloth: '#3a3a48', gold: [120, 120], scrap: [1, 4, 6], xp: 110 }, // isimli komutan adayı: aşırı zor
  legion:    { hp: 300, dmg: 22, speed: 118, aggro: 270, range: 58, cd: 1.2, scale: 0.7, cloth: '#8a2f2a', gold: [30, 45], scrap: [0.6, 3, 5], xp: 45 },
  commander: { hp: 1500, dmg: 42, speed: 120, aggro: 340, range: 70, cd: 1.5, scale: 1.65, cloth: '#6e1f1f', gold: [250, 250], scrap: [1, 5, 8], xp: 160 }, // isimli komutan adayı: aşırı zor
  wram:      { hp: 280, dmg: 45, speed: 66, aggro: 500, range: 72, cd: 1.9, scale: 0.78, cloth: '#6e3a2a', gold: [30, 50], scrap: [1, 3, 6], xp: 40 }, // barbar koçbaşısı (baskında kapı kırar)
  archer:    { hp: 30, dmg: 9, speed: 130, aggro: 320, range: 230, cd: 2.2, scale: 0.6, cloth: '#7a6a3a', gold: [6, 12], scrap: [0.3, 1, 2], ranged: true, xp: 12 }, // barbar okçusu: mesafe korur
  rivallord: { hp: 1300, dmg: 40, speed: 135, aggro: 340, range: 66, cd: 1.3, scale: 1.55, cloth: '#3a2a4a', gold: [300, 300], scrap: [1, 5, 8], xp: 200 }, // Kara Vulkar (şarj + öfke kalıpları) — isimli komutan adayı: aşırı zor
  shaman:    { hp: 60, dmg: 5, speed: 120, aggro: 320, range: 210, cd: 2.6, scale: 0.65, cloth: '#3f7a6a', gold: [15, 25], scrap: [0.4, 1, 3], xp: 30, ranged: true, healer: true }, // yaralı dostlarını iyileştirir — önce onu öldür!
  shieldbarb:{ hp: 90, dmg: 8, speed: 115, aggro: 240, range: 56, cd: 1.2, scale: 0.67, cloth: '#7a5a3a', gold: [10, 18], scrap: [0.5, 1, 3], xp: 22, arrowResist: 0.7 }, // kalkanı ok hasarını %70 keser
  wolf:      { hp: 45, dmg: 9, speed: 175, aggro: 340, range: 46, cd: 1.0, scale: 0.62, cloth: '#8a8f98', gold: [0, 2], scrap: [0, 0, 0], xp: 14, beast: true }, // gece köye inen sürü kurdu — leşi et verir
  bear:      { hp: 500, dmg: 35, speed: 150, aggro: 380, range: 62, cd: 1.3, scale: 1.75, cloth: '#5a4028', gold: [80, 120], scrap: [0, 0, 0], xp: 110, beast: true }, // Mağara Ayısı
  troll:     { hp: 1400, dmg: 50, speed: 88, aggro: 420, range: 80, cd: 1.8, scale: 2.3, cloth: '#5a7a4a', gold: [300, 400], scrap: [1, 6, 10], xp: 260, beast: true }, // gezen dünya boss'u
};
// Zorluk: düşman gücü ve hanedan puanı çarpanı (yeni doğan düşmanlara uygulanır)
// Denge (admin panelden düzenlenir, kd-balance): tüm ekonomi/katsayılar tek yerden
const BAL = { emul: 1, php: 1, patk: 1, xp: 1, cost: 1, prod: 1, visitSec: 36000, cmdTroopCost: 30, autoOn: 1 };
// Öncelik: yayınlanmış ayar (world-config.js) → üstüne yerel admin denemesi
const KDC = (typeof window !== 'undefined' && window.KD_CONFIG) || {};
try { Object.assign(BAL, KDC.balance || {}); } catch (e) { }
try { Object.assign(BAL, JSON.parse(localStorage.getItem('kd-balance')) || {}); } catch (e) { }
const DIFF = {
  kolay:  { name: 'Kolay', emul: 0.75, score: 0.75, raid: -1 },
  normal: { name: 'Normal', emul: 1, score: 1, raid: 0 },
  demir:  { name: 'Demirbaş', emul: 1.3, score: 1.5, raid: 2 },
};
// Yoldaş isimleri & özellikleri
// İsimli komutanlar: boss'ları yenince safına katılabilir; ölmezler — esir düşerler.
// Kapasiteden yemezler, sadece kendi öldürdükleriyle seviye atlarlar.
const COMMANDERS = {
  vulkar: { name: 'Kara Vulkar', title: 'Savaş Lordu', icon: '💀', hp: 160, dmg: 24, speed: 128, cloth: '#3a2a4a', crest: '#7a4fa0' },
  kaya:   { name: 'Şef Kaya', title: 'Kale Şefi', icon: '🪓', hp: 140, dmg: 19, speed: 112, cloth: '#3a3a48', crest: '#c03a2e' },
  marius: { name: 'Marius', title: 'Lejyon Komutanı', icon: '🦅', hp: 150, dmg: 22, speed: 118, cloth: '#6e1f1f', crest: '#c9ced6' },
};
// Diyar komutanları: her ırkın kendi rakip-lordu / kale şefi / lejyon komutanı (hepsi toplanabilir!)
const RACE_CMD_NAMES = {
  mizrakli:  ['Sivri Targan', 'Şef Temren', 'Komutan Kargı'],
  col:       ['Kum Ejderi Rashid', 'Şef Serap', 'Komutan Samyeli'],
  atli:      ['Rüzgar Hanı Bora', 'Şef Toynak', 'Komutan Yele'],
  samuray:   ['Ronin Kagetora', 'Şef Oda', 'Komutan Kenshi'],
  kurt:      ['Ulu Diş Fenrik', 'Şef Pençe', 'Komutan Uluma'],
  gladyator: ['Arena Kralı Maximus', 'Şef Spartaküs', 'Komutan Retiarius'],
  golge:     ['Gölge Efendisi Nyx', 'Şef Fısıltı', 'Komutan Zifir'],
  tasdev:    ['Kaya Yürek Gorm', 'Şef Granit', 'Komutan Çekiç'],
  ates:      ['Kor Rahibi İgnis', 'Şef Alaz', 'Komutan Köz'],
  orman:     ['Yaprak Hanı Meşe', 'Şef Filiz', 'Komutan Budak'],
  buz:       ['Buz Kağanı Boreas', 'Şef Kırağı', 'Komutan Tipi'],
};
for (const [rid, names] of Object.entries(RACE_CMD_NAMES)) {
  const R = RACES[rid];
  COMMANDERS['rival_' + rid] = { name: names[0], title: 'Savaş Lordu', icon: '💀', hp: 160, dmg: 24, speed: 128, cloth: R.cloth, crest: '#7a4fa0' };
  COMMANDERS['chief_' + rid] = { name: names[1], title: 'Kale Şefi', icon: '🪓', hp: 140, dmg: 19, speed: 112, cloth: R.cloth, crest: '#c03a2e' };
  COMMANDERS['cmdr_' + rid]  = { name: names[2], title: 'Lejyon Komutanı', icon: '🦅', hp: 150, dmg: 22, speed: 118, cloth: R.cloth, crest: '#c9ced6' };
}
// Bu vilayetin komutan kimlikleri (barbar diyarı = klasik üçlü)
const cmdIdFor = kind => PROV0.race === 'barbar' || !RACE_CMD_NAMES[PROV0.race]
  ? { rival: 'vulkar', chief: 'kaya', cmdr: 'marius' }[kind]
  : kind + '_' + PROV0.race;
const RIVALC = () => COMMANDERS[cmdIdFor('rival')];
const cmdKillsNeed = lv => lv < 20 ? 4 + lv * 3 : 70; // Sv.20'den sonra sabit 70 leş (yoksa tavan erişilemez)
const TRAITS = {
  keskin:    { name: 'Keskin', icon: '⚔️', desc: '+%20 hasar', dmg: 1.2 },
  dayanikli: { name: 'Dayanıklı', icon: '🛡️', desc: '+%30 can', hp: 1.3 },
  sadik:     { name: 'Sadık', icon: '❤️', desc: '2× yenilenme', regen: 2 },
};
const NODE_DEF = {
  tree:  { hp: 30, yield: { wood: 5 }, respawn: 55, r: 16 },
  rock:  { hp: 40, yield: { stone: 4 }, respawn: 80, r: 18 },
  scrap: { hp: 20, yield: { scrap: 3 }, respawn: 45, r: 14 },
};
const GATE_MELEE_FACTOR = 0.05;

// ---------- Oyun durumu ----------
const G = {
  t: 0, dt: 0, dead: false, deadT: 0, shake: 0, hitstop: 0,
  day: 1, dayT: 0, night: false, raidHappened: false, raidsSurvived: 0, duskWarned: false,
  arrows: [],
  res: { wood: 0, stone: 0, scrap: 0, iron: 0, meat: 0, gold: 50, gems: 0 },
  swordLv: 0, armorLv: 0,
  animals: [], feastT: 0,                            // yaban hayatı + ziyafet buff süresi (kayda girmez)
  stock: { wood: 0, stone: 0, scrap: 0, iron: 0, meat: 10 }, // köy deposu: pasif üretim burada birikir (başlangıç: kışlık et)
  famine: false, famineT: 0, eatAcc: 0, desertT: 0,  // et bakımı: kıtlık grev + firar sayaçları (kayda girmez)
  palisade: { built: false, lv: 1, gate: { hp: PAL.gateHp, maxHp: PAL.gateHp, alive: true } },
  rival: { alive: true, threatened: false, tribute: 0, x: 3100, y: 1400, wp: null, attack: null, attackT: 0, timer: 40 },
  legionConquered: false,
  sieges: { fort: {}, legion: {} },   // site id -> { catapult/ballista/ram: {x,y,prog,done,...} }
  built: {},            // type -> level
  soldiersOwned: 0,
  camp1Destroyed: false, chestOpened: false,
  questIdx: 0,
  player: { x: CAMPFIRE.x + 60, y: CAMPFIRE.y + 40, hp: 100, maxHp: 100, dir: 0, cd: 0, swing: 0, flash: 0, walk: 0, moving: false, charging: false, chargeT: 0, dodgeT: 0, dodgeCd: 0, dodgeDir: 0, heavyFx: 0 },
  cam: { x: 0, y: 0 },
  nodes: [], plots: [], buildings: [], enemies: [], soldiers: [],
  structures: [], props: [], walls: [], projectiles: [], floaters: [], particles: [], palStakes: [], opStakes: [],
  sawTimer: 0, respawnTimers: [], nearThing: null, panelFor: null,
  autoTravel: null,                                  // {pts:[[x,y],...], i, name}
  pendingTravel: null, eventState: null,             // yol olayları
  discovered: { village: 2 },                        // lokasyon: 2=keşfedildi, 1=söylenti
  outposts: {},                                      // id -> {owned, looted, garrison}
  garrisonUnits: [], combat: false,
  region: REGION0, dynasty: 0, victoryShown: false, hurtFlash: 0, villageTier: 1,
  provinceId: PROV0.id, worldConquered: WC0.slice(), countryBonus: {}, // cihan fethi ilerlemesi
  worldDone: false,                                  // tüm vilayetler alındı bayrağı
  level: 1, xp: 0,
  difficulty: 'normal', caveCleared: false,
  caveRun: null, caveReturn: null, caveCd: 0,       // prosedürel in koşusu + 15dk sayaç
  wounded: [], prisoners: { camp1: [], fort: [], legion: [] }, // yaralı/esir KOMUTANLAR (sıradan asker ölür)
  commanders: [],                                    // isimli komutanlar: {id, lv, kills, gear, ...} — kapasite dışı
  bag: [], equip: {},                                // kuşam: çanta eşyaları {b,r} + oyuncunun taktıkları {slot: item}
  stats: { kills: 0, chops: 0, mines: 0, bossKills: 0, deaths: 0, playtime: 0, caravans: 0 },
  ach: {},                                           // başarımlar (id -> true)
  telegraphs: [], caravans: [],
  dynUpg: { blade: 0, vigor: 0, swift: 0, taxes: 0, mason: 0 },
  pickups: [],                                       // yerdeki şifa damlaları
  patrols: PATROLS.map(() => ({ seg: 0, t: 0 })),    // devriye çıpaları
};

// ---------- Su kıyısı ----------
function shoreX(y) { return 150 + 45 * Math.sin(y * 0.005) + 25 * Math.sin(y * 0.013 + 2); }

// ---------- Dünya üretimi ----------
function genWorld() {
  // İnşa arsaları (kamp ateşi çevresi) — HER ARSANIN NE OLACAĞI ÖNCEDEN BELLİ:
  // menü yok; gerekli kaynakları getirip yanında durursun, kendiliğinden inşa olur
  // Halka düzeni: binalar arası ≥110px (çap 60 + geçiş koridoru), sur ile bina kenarı ≥70px.
  // Kapı doğuda (0°) olduğu için 40°-320° yayına dizilir, giriş koridoru boş kalır.
  const P = [[134, 112], [9, 175], [-119, 128], [-175, 0], [-119, -128], [9, -175], [134, -112]];
  const PLAN = ['sawmill', 'blacksmith', 'barracks', 'watchtower', 'house', 'siege', 'hunter'];
  P.forEach(([ox, oy], i) => G.plots.push({ x: CAMPFIRE.x + ox, y: CAMPFIRE.y + oy, built: null, plan: PLAN[i] }));

  // Kamp ateşi (yapı olarak — yıkılamaz)
  G.buildings.push({ type: 'campfire', x: CAMPFIRE.x, y: CAMPFIRE.y, lv: 1, hp: 1, maxHp: 1 });

  // Dekor: harabe sütunları, tekne, kamp çadırları, tüccar konağı
  G.props.push({ kind: 'column', x: RUINS.x - 110, y: RUINS.y - 60 }, { kind: 'column', x: RUINS.x + 90, y: RUINS.y + 40 }, { kind: 'columnFallen', x: RUINS.x - 40, y: RUINS.y + 110 });
  G.props.push({ kind: 'column', x: RUINS.x + 30, y: RUINS.y - 130 });
  G.props.push({ kind: 'boat', x: shoreX(1700) - 55, y: 1700 });
  // Çadırlar barbarların: kamp fethedilince kalkarlar (site etiketiyle)
  G.props.push({ kind: 'tent', site: 'camp1', x: CAMP1.x - 105, y: CAMP1.y - 65 },
    { kind: 'tent', site: 'camp1', x: CAMP1.x + 100, y: CAMP1.y - 55 },
    { kind: 'tent', site: 'camp1', x: CAMP1.x - 70, y: CAMP1.y + 85 });
  G.props.push({ kind: 'trader', x: MERCHANT.x, y: MERCHANT.y });
  G.props.push({ kind: 'cave', x: CAVE.x, y: CAVE.y });

  // Kaynak noktaları — bölgesel kümeler (odun kuzeyde, taş güneyde, hurda merkezde)
  // Yasak bölgeler yerleşkelerin SON hâline göre: köy kademe 3'te sur 445'e çıkıyor,
  // karakol arsaları merkezden ~165 uzağa açılıyor. Dar tutulursa kaynaklar sonradan
  // sur içinde kalıyor ve birimler onlara takılıyor.
  const blocked = (x, y) =>
    x > OVERWORLD_W - 60 || // mağara şeridine kaynak düşmesin
    x < shoreX(y) + 55 ||
    dist(x, y, CAMPFIRE.x, CAMPFIRE.y) < VILLAGE_CLEAR ||
    dist(x, y, CAMP1.x, CAMP1.y) < OUTPOST_CLEAR ||
    dist(x, y, MERCHANT.x, MERCHANT.y) < 180 ||
    // kaleler fethedilince DIŞ KALE ile 2x110px büyüyor: pay ona göre (yoksa kaynak sur içinde kalıyor)
    (x > FORT.x0 - 360 && x < FORT.x1 + 360 && y > FORT.y0 - 360 && y < FORT.y1 + 360) ||
    (x > LEG.x0 - 360 && x < LEG.x1 + 360 && y > LEG.y0 - 360 && y < LEG.y1 + 360) ||
    SIEGE_SITES.some(st => dist(x, y, st.x, st.y) < 200);
  function scatterAt(kind, n, cx2, cy2, radius) {
    let tries = 0;
    while (n > 0 && tries++ < 1200) {
      const a = rr(0, TAU), r2 = Math.sqrt(rng()) * radius;
      const x = cx2 + Math.cos(a) * r2, y = cy2 + Math.sin(a) * r2 * 0.8;
      if (x < 40 || x > WORLD.w - 40 || y < 40 || y > WORLD.h - 40 || blocked(x, y)) continue;
      if (G.nodes.some(o => dist(x, y, o.x, o.y) < 55)) continue;
      G.nodes.push({ kind, x, y, hp: NODE_DEF[kind].hp, alive: true, respT: 0, seed: rng() });
      n--;
    }
  }
  scatterAt('tree', 9, CAMPFIRE.x + 660, CAMPFIRE.y - 200, 240);  // köy yakını (tutorial) — sur büyüse de dışarıda kalır
  scatterAt('rock', 4, CAMPFIRE.x + 700, CAMPFIRE.y + 280, 220);
  scatterAt('tree', 34, FOREST.x, FOREST.y, 480);                 // Balta Ormanı
  scatterAt('rock', 22, QUARRY.x, QUARRY.y, 420);                 // Taş Ocağı
  scatterAt('tree', 6, QUARRY.x - 300, QUARRY.y - 250, 180);
  scatterAt('scrap', 10, RUINS.x, RUINS.y, 300);                  // Harabeler
  scatterAt('scrap', 4, FORT.x0 - 350, FORT.cy - 150, 220);       // kale yolu
  scatterAt('tree', 8, RUINS.x + 300, RUINS.y - 350, 240);

  // KARAKOL TEDARİĞİ: v3.7.1'de kaynaklar yerleşkelerden uzaklaştırıldı (birimler
  // sur içinde takılmasın diye) ama fethedilen üslerin köylüleri de o zaman 540px
  // öteye yürümeye başladı — ambara pratikte yük gelmiyordu. Her üssün yasak
  // halkasının hemen DIŞINA kendi ormanı/taşlığı konur: yürüyüş ~170px'e iner.
  function scatterRing(kind, n, cx3, cy3, r0, r1) {
    let tries = 0;
    while (n > 0 && tries++ < 1500) {
      const a = rr(0, TAU), r2 = r0 + rng() * (r1 - r0);
      const x = cx3 + Math.cos(a) * r2, y = cy3 + Math.sin(a) * r2 * 0.85;
      if (x < 40 || x > WORLD.w - 40 || y < 40 || y > WORLD.h - 40 || blocked(x, y)) continue;
      if (G.nodes.some(o => dist(x, y, o.x, o.y) < 52)) continue;
      G.nodes.push({ kind, x, y, hp: NODE_DEF[kind].hp, alive: true, respT: 0, seed: rng() });
      n--;
    }
  }
  const tedarik = (cx3, cy3, r0) => {
    scatterRing('tree', 7, cx3, cy3, r0, r0 + 150);
    scatterRing('rock', 5, cx3, cy3, r0, r0 + 150);
    scatterRing('scrap', 3, cx3, cy3, r0, r0 + 150);
  };
  tedarik(CAMP1.x, CAMP1.y, OUTPOST_CLEAR + 30);
  tedarik(FORT.cx, FORT.cy, Math.max(FORT.x1 - FORT.cx, FORT.y1 - FORT.cy) + 400);
  tedarik(LEG.cx, LEG.cy, Math.max(LEG.x1 - LEG.cx, LEG.y1 - LEG.cy) + 400);

  // Bölge bekçileri: orman kaçakçıları, ocak haydutları, harabe eşkıyaları
  spawnEnemy('barb', FOREST.x - 180, FOREST.y + 90, 'forest'); spawnEnemy('barb', FOREST.x + 160, FOREST.y - 60, 'forest');
  spawnEnemy('brute', QUARRY.x + 120, QUARRY.y - 60, 'quarry'); spawnEnemy('brute', QUARRY.x - 160, QUARRY.y + 100, 'quarry');
  spawnEnemy('barb', RUINS.x - 80, RUINS.y - 40, 'ruins'); spawnEnemy('barb', RUINS.x + 110, RUINS.y + 70, 'ruins'); spawnEnemy('barb', RUINS.x, RUINS.y + 160, 'ruins');

  // Devriye çeteleri (yollarda gezerler)
  PATROLS.forEach((pt, i) => {
    for (let k = 0; k < 3; k++) spawnEnemy('barb', pt.pts[0][0] + rr(-50, 50), pt.pts[0][1] + rr(-50, 50), 'roam' + i);
  });

  // Yaban hayatı: haritaya dağılmış av hayvanları
  spawnWildlife();

  // Barbar kampı: totem + düşmanlar (yapı canları bölgeyle ölçeklenir)
  const ms = 1 + (G.region - 1) * 0.3;
  G.structures.push({ kind: 'totem', x: CAMP1.x, y: CAMP1.y, hp: 300 * ms, maxHp: 300 * ms, alive: true });
  for (let i = 0; i < 9; i++) spawnEnemy('barb', CAMP1.x + rr(-160, 160), CAMP1.y + rr(-120, 160), 'camp1');
  spawnEnemy('brute', CAMP1.x + rr(-60, 60), CAMP1.y + rr(40, 120), 'camp1');
  spawnEnemy('archer', CAMP1.x + rr(-120, 120), CAMP1.y - 140, 'camp1');

  // Taş kale: surlar, kapı, muhafızlar, şef, sandık
  const T = 26;
  G.walls.push(
    { x: FORT.x0 - T / 2, y: FORT.y0 - T / 2, w: FORT.x1 - FORT.x0 + T, h: T },                       // üst
    { x: FORT.x0 - T / 2, y: FORT.y1 - T / 2, w: FORT.x1 - FORT.x0 + T, h: T },                       // alt
    { x: FORT.x1 - T / 2, y: FORT.y0 - T / 2, w: T, h: FORT.y1 - FORT.y0 + T },                       // sağ
    { x: FORT.x0 - T / 2, y: FORT.y0 - T / 2, w: T, h: FORT.gateY0 - FORT.y0 + T / 2 },               // sol üst
    { x: FORT.x0 - T / 2, y: FORT.gateY1, w: T, h: FORT.y1 - FORT.gateY1 + T / 2 },                   // sol alt
  );
  G.structures.push({ kind: 'gate', x: FORT.x0, y: (FORT.gateY0 + FORT.gateY1) / 2, hp: 1500 * ms, maxHp: 1500 * ms, alive: true });
  // iç sur halkaları: K.4+ çift, K.8+ üç katlı kale — her katın kendi kapısı kırılmalı
  const rings = PROV0.tier >= 8 ? 3 : PROV0.tier >= 4 ? 2 : 1;
  G.fortRings = rings;
  const addFortRing = (hw, hh, kind, rhp) => {
    const T2 = 22;
    const x0 = FORT.cx - hw, x1 = FORT.cx + hw, y0 = FORT.cy - hh, y1 = FORT.cy + hh;
    const gy0 = FORT.cy - 40, gy1 = FORT.cy + 40;
    G.walls.push(
      { x: x0 - T2 / 2, y: y0 - T2 / 2, w: x1 - x0 + T2, h: T2 },
      { x: x0 - T2 / 2, y: y1 - T2 / 2, w: x1 - x0 + T2, h: T2 },
      { x: x1 - T2 / 2, y: y0 - T2 / 2, w: T2, h: y1 - y0 + T2 },
      { x: x0 - T2 / 2, y: y0 - T2 / 2, w: T2, h: gy0 - y0 + T2 / 2 },
      { x: x0 - T2 / 2, y: gy1, w: T2, h: y1 - gy1 + T2 / 2 },
    );
    G.structures.push({ kind, x: x0, y: FORT.cy, gx: x0 - 12, gy: gy0, gw: 24, gh: gy1 - gy0, hp: Math.round(rhp), maxHp: Math.round(rhp), alive: true });
  };
  if (rings >= 2) addFortRing(240, 178, 'gate2', 1100 * ms);
  if (rings >= 3) addFortRing(132, 98, 'gate3', 850 * ms);
  G.structures.push({ kind: 'chest', x: rings >= 2 ? FORT.cx + 48 : FORT.x1 - 90, y: FORT.cy, hp: 1, maxHp: 1, alive: true });
  // MUHAFIZLAR HER SUR BANDINA dağıtılır. Rastgele kutu içine serpiştirmek, iç
  // sur halkaları varken dış ve orta bantları boş bırakıyordu — oyuncu ilk kapıyı
  // kırıp kimseyle karşılaşmadan ikinci kapıya yürüyordu.
  {
    const bantlar = rings >= 3 ? [[240, 178, 260, 200], [132, 98, 240, 178], [0, 0, 132, 98]]
                  : rings >= 2 ? [[240, 178, 260, 200], [0, 0, 240, 178]]
                  : [[0, 0, 260, 200]];
    const kisi = Math.ceil(12 / bantlar.length);
    for (const [ihw, ihh, dhw, dhh] of bantlar) {
      for (let gi = 0; gi < kisi; gi++) {
        // banttan rastgele nokta: dış kutuda tut, iç kutuya girme
        let px = 0, py = 0, dene = 0;
        do {
          px = FORT.cx + rr(-(dhw - 45), dhw - 45);
          py = FORT.cy + rr(-(dhh - 40), dhh - 40);
        } while (ihw && Math.abs(px - FORT.cx) < ihw + 40 && Math.abs(py - FORT.cy) < ihh + 40 && dene++ < 40);
        spawnEnemy('guard', px, py, 'fort');
      }
    }
  }
  spawnEnemy('chief', rings >= 2 ? FORT.cx - 50 : FORT.x0 + 340, FORT.cy + 10, 'fort');

  // Lejyon karargâhı (tier 3): taş surlar + güneye bakan çelik kapı
  const LT = 28;
  G.walls.push(
    { x: LEG.x0 - LT / 2, y: LEG.y0 - LT / 2, w: LEG.x1 - LEG.x0 + LT, h: LT },                  // üst
    { x: LEG.x0 - LT / 2, y: LEG.y0 - LT / 2, w: LT, h: LEG.y1 - LEG.y0 + LT },                  // sol
    { x: LEG.x1 - LT / 2, y: LEG.y0 - LT / 2, w: LT, h: LEG.y1 - LEG.y0 + LT },                  // sağ
    { x: LEG.x0 - LT / 2, y: LEG.y1 - LT / 2, w: LEG.gx0 - LEG.x0 + LT / 2, h: LT },             // alt-sol
    { x: LEG.gx1, y: LEG.y1 - LT / 2, w: LEG.x1 + LT / 2 - LEG.gx1, h: LT },                     // alt-sağ
  );
  G.structures.push({ kind: 'lgate', x: LEG.cx, y: LEG.y1, hp: 3000 * ms, maxHp: 3000 * ms, alive: true });
  G.structures.push({ kind: 'chest2', x: LEG.cx, y: LEG.y0 + 70, hp: 1, maxHp: 1, alive: true });
  for (let li = 0; li < 12; li++) spawnEnemy('legion', rr(LEG.x0 + 110, LEG.x1 - 110), rr(LEG.y0 + 80, LEG.y1 - 80), 'legion');
  spawnEnemy('commander', LEG.cx, LEG.y0 + 120, 'legion');

  // Köy, garnizon sistemi için baştan "senin karakolun"
  G.outposts.village = { owned: true, looted: false, garrison: 0, lv: 1, garrisonCls: [], isVillage: true };

  // Kara Vulkar'ın çetesi haritada gezmeye başlar
  spawnRivalBand();

  // Köy suru halkası (doğu boşluğu = kapı) — köy genişledikçe sur da genişler
  rebuildPalisade();
}
// Yerleşke temiz alanları: kaynaklar bu yarıçapın dışına düşer (yerleşke büyüse de içeride kalmasınlar)
const VILLAGE_CLEAR = PAL.r + EXPANSIONS.length * 80 + 100;  // kademe 3 suru (445) + pay
// Karakol da köy gibi büyüyor: temiz alan EN BÜYÜK haline (Sv.3 suru = 425) göre
// hesaplanır, yoksa sur genişleyince ağaç/taş sur içinde kalıp birimleri takıyor.
const OUTPOST_CLEAR = OP_WALL.r + 2 * OP_RING_STEP + 145;     // 570
// Yerleşkenin içinde kalmış kaynakları kaldır (sur genişleyince birimler bunlara takılıyordu).
// Diziden ÇIKARMIYORUZ: co-op senkronu düğümleri indeksle eşliyor, sıra bozulmamalı.
function clearNodesInside(cx, cy, r) {
  for (const n of G.nodes) {
    if (n.removed) continue;
    if (dist(n.x, n.y, cx, cy) > r) continue;
    n.removed = true; n.alive = false; n.respT = Infinity;
  }
}
// Sur yarıçapı köy kademesine bağlı; kapı boşluğu ~40px sabit kalsın diye açı ölçeklenir
const palR = () => PAL.r + (G.villageTier - 1) * 80;
const palGapA = () => PAL.gapA * PAL.r / palR();
function rebuildPalisade() {
  const r = palR();
  if (G.palisade.built) clearNodesInside(CAMPFIRE.x, CAMPFIRE.y, r + 26); // sur içinde ağaç/kaya kalmasın
  PAL_GATE.x = CAMPFIRE.x + r; PAL_GATE.y = CAMPFIRE.y;
  G.palStakes.length = 0;
  // Kazıklar kapı boşluğunun İKİ KENARINDAN başlayıp eşit aralıkla dizilir
  // (karakol suruyla aynı düzeltme): sabit adımla dönüp boşluğa denk geleni
  // atlamak, deliğin gerçek genişliğini kapıdan büyük yapıyordu.
  const gA = palGapA();
  const yay = TAU - 2 * gA;
  const n = Math.max(12, Math.round(yay * r / (G.palisade.lv >= 2 ? 33 : 42)));
  for (let i = 0; i <= n; i++) {
    const a = gA + yay * (i / n);   // kapı açısı 0 (doğu)
    G.palStakes.push({ x: CAMPFIRE.x + Math.cos(a) * r + rr(-2, 2), y: CAMPFIRE.y + Math.sin(a) * r + rr(-2, 2), h: rr(24, 30) });
  }
}
// Karakol suru: kazık halkası + köye bakan kapı (op.wall bayrağından yeniden kurulur)
const opWallGapDir = site => { const O = OUTPOSTS[site]; return Math.atan2(CAMPFIRE.y - O.y, CAMPFIRE.x - O.x); };
// ---- Sur yönlendirmesi: birimler duvara kafa atmasın, kapı ağzına dolaşsın ----
function wallRings() {
  const rings = [];
  if (G.palisade.built)
    rings.push({ cx: CAMPFIRE.x, cy: CAMPFIRE.y, r: palR(), gap: 0, gapA: palGapA(), village: true, gateUp: G.palisade.gate.alive });
  for (const [site, op] of Object.entries(G.outposts)) {
    if (!op || !op.wall || op.isVillage || !OP_WALL_SITES.includes(site)) continue;
    const og = G.structures.find(s2 => s2.kind === 'owgate' && s2.site === site);
    rings.push({ cx: OUTPOSTS[site].x, cy: OUTPOSTS[site].y, r: opWallR(op), gap: opWallGapDir(site), gapA: opGapA(op), oGate: og && og.alive ? og : null });
  }
  return rings;
}
// Hedef açıya yörünge adımı: dışarıdaki birim çevre üzerindeki ara noktalara yürür.
// Ardışık noktalar hep r+46 yarıçapında (0.4 rad adım) → aradaki düz çizgi duvara hiç sürtmez.
function orbitTo(x, y, rg, targetA) {
  const aU = Math.atan2(y - rg.cy, x - rg.cx);
  let da = targetA - aU; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
  if (Math.abs(da) <= 0.42) return null; // hedef açının koridorundayız: düz yaklaş
  const na = aU + Math.sign(da) * 0.4;
  return { wx: rg.cx + Math.cos(na) * (rg.r + 46), wy: rg.cy + Math.sin(na) * (rg.r + 46) };
}
const orbitToGap = (x, y, rg) => orbitTo(x, y, rg, rg.gap);
// Düz çizgi bir dikdörtgeni kesiyor mu? (kale/lejyon taş duvarları için)
function segHitsRect(x1, y1, x2, y2, r) {
  if (Math.max(x1, x2) < r.x || Math.min(x1, x2) > r.x + r.w ||
      Math.max(y1, y2) < r.y || Math.min(y1, y2) > r.y + r.h) return false;
  const ic = (px, py) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  if (ic(x1, y1) || ic(x2, y2)) return true;
  const kesis = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  return kesis(x1, y1, x2, y2, r.x, r.y, r.x + r.w, r.y) ||
         kesis(x1, y1, x2, y2, r.x + r.w, r.y, r.x + r.w, r.y + r.h) ||
         kesis(x1, y1, x2, y2, r.x + r.w, r.y + r.h, r.x, r.y + r.h) ||
         kesis(x1, y1, x2, y2, r.x, r.y + r.h, r.x, r.y);
}
// Kale/lejyon TAŞ DUVARLARI: yol bunlardan geçiyorsa duvarın köşesinden dolaş.
// (wallRings yalnız dairesel surları biliyordu; birimler dikdörtgen duvarlara yapışıp kalıyordu.)
function rectRoute(x, y, tx, ty) {
  const PAD = 34;
  for (const w of G.walls) {
    if (dist(x, y, w.x + w.w / 2, w.y + w.h / 2) > 1400) continue; // uzaktakine bakma
    const r = { x: w.x - PAD, y: w.y - PAD, w: w.w + PAD * 2, h: w.h + PAD * 2 };
    if (!segHitsRect(x, y, tx, ty, r)) continue;
    // Köşeler dikdörtgenin bir tık DIŞINDA olmalı; sınırda kalırsa "duvarın içinde" sayılıp elenirler
    const D = 14;
    const koseler = [[r.x - D, r.y - D], [r.x + r.w + D, r.y - D], [r.x + r.w + D, r.y + r.h + D], [r.x - D, r.y + r.h + D]];
    let en = null, ed = 1e9, yedek = null, yd = 1e9;
    for (const [kx, ky] of koseler) {
      const d = dist(x, y, kx, ky) + dist(kx, ky, tx, ty);
      if (d < yd) { yd = d; yedek = [kx, ky]; }
      if (segHitsRect(x, y, kx, ky, r)) continue;      // köşeye giderken de duvarı kesmemeli
      if (d < ed) { ed = d; en = [kx, ky]; }
    }
    const sec = en || yedek;                            // hiçbiri temiz değilse (duvarın içindeyiz) en kısa köşe
    if (sec) return { wx: sec[0], wy: sec[1] };
  }
  return null;
}
// Hedefe düz gidiş bir halkayı kesiyorsa rota üret.
// Dönüş: null (düz git) | {wx,wy} ara nokta | {attackVillageGate, ring} | {attackGate, ring} (düşman + sağlam kapı → kır)
function wallRoute(x, y, tx, ty, isEnemy) {
  for (const rg of wallRings()) {
    const uIn = dist(x, y, rg.cx, rg.cy) < rg.r - 6;
    const tIn = dist(tx, ty, rg.cx, rg.cy) < rg.r - 6;
    if (uIn && tIn) continue; // ikisi de içeride: engel yok
    if (!uIn && !tIn) { // ikisi de dışarıda: kestirme çemberi kesiyorsa çevresinden dolan
      const dx = tx - x, dy = ty - y, L2 = dx * dx + dy * dy;
      if (L2 < 1) continue;
      const t = clamp(((rg.cx - x) * dx + (rg.cy - y) * dy) / L2, 0, 1);
      if (dist(x + dx * t, y + dy * t, rg.cx, rg.cy) > rg.r + 8) continue; // kesmiyor
      const o = orbitTo(x, y, rg, Math.atan2(ty - rg.cy, tx - rg.cx));
      if (o) return o;
      continue;
    }
    if (isEnemy) { // kapı sağlamsa düşman geçemez: kapıya saldır (dolaşma yörüngesini çağıran kurar)
      if (rg.village && rg.gateUp) return { attackVillageGate: true, ring: rg };
      if (rg.oGate) return { attackGate: rg.oGate, ring: rg };
    }
    // Kapıdan geçiş MESAFE eşiğiyle yönetilir, açı eşiğiyle DEĞİL.
    // Açı testi ("kapı koridorunda mıyım") birimi eşikte gidip gelmeye sokuyordu:
    // 0.08 rad'ın altında hedef dışarısı, üstünde içerisi oluyor, birim saniyede
    // birkaç kez fikir değiştirip kapının önünde sallanıyordu ("duvarın kenarında
    // bekliyor"). Kapı ağzı SABİT bir nokta olarak hedeflenir; oraya varılınca
    // aynı eksende karşı tarafa geçilir — geri dönüş yok, salınım yok.
    const kapi = (rd) => ({ wx: rg.cx + Math.cos(rg.gap) * rd, wy: rg.cy + Math.sin(rg.gap) * rd });
    if (uIn) {
      const ic = kapi(rg.r - 30);                       // kapının iç ağzı
      const w = dist(x, y, ic.wx, ic.wy) > 70 ? ic : kapi(rg.r + 150);
      w.ring = rg; w.out = true; return w;              // navMove burada kapı kilidi kurar
    }
    const dis = kapi(rg.r + 40);                        // kapının dış ağzı
    const w2 = dist(x, y, dis.wx, dis.wy) > 70 ? (orbitToGap(x, y, rg) || dis) : kapi(rg.r - 150);
    w2.ring = rg; w2.out = false; return w2;
  }
  const kr = keepGateRoute(x, y, tx, ty);                  // kale surunun kapısından geç
  if (kr) return kr;
  return boxRoute(x, y, tx, ty) || rectRoute(x, y, tx, ty); // kale kutusunu dolaş, olmazsa tek duvarı
}
// KALE SURLARININ KAPISINDAN GEÇİŞ. Dikdörtgen surlarda kapı mantığı hiç yoktu:
// dış bantta devriye gezmesi gereken nöbetçi kaleden çıkamıyor, hep en içte
// kalıyordu. Seçim tamamen MESAFEYE dayanır (kapı eksenine hizalı mıyım),
// "içerideyim/dışarıdayım" testine değil — o test sur çizgisinde salınım üretir.
function keepGateRings() {
  const out = [];
  for (const sid of KEEP_SITES) {
    const B0 = sid === 'fort' ? FORT : LEG;
    if (B0.x0 === undefined) continue;
    const op = G.outposts[sid];
    const lv = op && op.owned && !op.looted ? (op.lv || 1) : 1;
    for (let k = 0; k < lv; k++) {
      const pad = k * KEEP_PAD;
      const b = { x0: B0.x0 - pad, y0: B0.y0 - pad, x1: B0.x1 + pad, y1: B0.y1 + pad };
      out.push(sid === 'fort'
        ? { b, gx: b.x0, gy: (FORT.gateY0 + FORT.gateY1) / 2, dikey: true }
        : { b, gx: (LEG.gx0 + LEG.gx1) / 2, gy: b.y1, dikey: false });
    }
  }
  return out;
}
function keepGateRoute(x, y, tx, ty) {
  for (const rg of keepGateRings()) {
    const b = rg.b;
    const ins = (px, py) => px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1;
    const uIn = ins(x, y), tIn = ins(tx, ty);
    if (uIn === tIn) continue;                 // aynı taraftalar: bu sur engel değil
    // kapı ekseni: fort'ta yatay (y sabit), lejyonda dikey (x sabit)
    const sapma = rg.dikey ? Math.abs(y - rg.gy) : Math.abs(x - rg.gx);
    const D = 85;
    const ic = rg.dikey ? { wx: rg.gx + D, wy: rg.gy } : { wx: rg.gx, wy: rg.gy - D };
    const dis = rg.dikey ? { wx: rg.gx - D, wy: rg.gy } : { wx: rg.gx, wy: rg.gy + D };
    if (sapma > 40) return uIn ? ic : dis;     // önce kapı eksenine hizalan
    return uIn ? dis : ic;                     // hizalıyım: karşı tarafa geç
  }
  return null;
}
// Kale/lejyon SURLARININ TAMAMINI tek bir engel olarak dolaş.
// rectRoute her duvar parçasını AYRI ele alıyor: bir segmentin köşesini dönen
// birim hemen bir sonraki segmente tosluyor, koca bir dikdörtgen kaleyi asla
// dolaşamıyordu ("köye devriyeye git dedik, buradan geçip gitmeye çalışıyor").
function keepBoxes() {
  const out = [];
  for (const sid of KEEP_SITES) {
    const B = sid === 'fort' ? FORT : LEG;
    if (B.x0 === undefined) continue;
    const op = G.outposts[sid];
    const pad = op && op.owned ? Math.max(0, ((op.lv || 1) - 1)) * KEEP_PAD : 0;
    out.push({ x0: B.x0 - pad, y0: B.y0 - pad, x1: B.x1 + pad, y1: B.y1 + pad });
  }
  return out;
}
function boxRoute(x, y, tx, ty) {
  const PAD = 48;
  for (const B of keepBoxes()) {
    const r = { x: B.x0 - PAD, y: B.y0 - PAD, w: B.x1 - B.x0 + PAD * 2, h: B.y1 - B.y0 + PAD * 2 };
    const ic = (px, py) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
    if (ic(x, y) || ic(tx, ty)) continue;          // biri içerideyse kapıdan geçilir, bu iş rectRoute'un
    if (!segHitsRect(x, y, tx, ty, r)) continue;
    const D = 18;
    const koseler = [[r.x - D, r.y - D], [r.x + r.w + D, r.y - D], [r.x + r.w + D, r.y + r.h + D], [r.x - D, r.y + r.h + D]];
    let en = null, ed = 1e9;
    for (const [kx, ky] of koseler) {
      if (segHitsRect(x, y, kx, ky, r)) continue;  // köşeye giderken kutuyu kesmemeli
      const d = dist(x, y, kx, ky) + dist(kx, ky, tx, ty);
      if (d < ed) { ed = d; en = [kx, ky]; }
    }
    if (en) return { wx: en[0], wy: en[1] };
  }
  return null;
}
// ============ ORTAK YÜRÜYÜŞ: navMove ============
// Birimlerin "duvara yapışma" ve "binanın etrafında sonsuz daire" sorunlarının
// KALICI çözümü. Üç katman:
//   1) wallRoute/rectRoute ile kaba rota (sur kapısı, kale köşesi)
//   2) İLERLEME ölçümü — hareket ediyor ama YAKLAŞMIYORSA takılmış sayılır
//      (daire çizen birim hareket ettiği için "duruyor mu" testine yakalanmıyordu)
//   3) Takılınca ENGEL TAKİBİ: collide'ın birimi ittiği yön engelin normalidir;
//      birim o normale DİK yönde (hep aynı tarafa) kayarak engeli dolaşır.
//      Bu, dikdörtgen/daire/bina/kaynak fark etmeksizin her engelde çalışır ve
//      yön bir kez seçildiği için birim geri dönüp döngüye girmez.
function navMove(u, tx, ty, spd, dt, r, isEnemy) {
  const sonMesafe = dist(u.x, u.y, tx, ty);
  // Ara hedef: sur kapısı / kale köşesi. İLERLEME BUNA GÖRE ölçülür — kapıya
  // yönelmek çoğu zaman NİHAİ hedeften uzaklaşmak demektir, son hedefe bakan
  // sayaç birimi daha kapıya varmadan "takıldı" sayıp işi iptal ettiriyordu.
  let gx = tx, gy = ty;
  const rt = wallRoute(u.x, u.y, tx, ty, !!isEnemy);
  if (rt && rt.wx !== undefined) { gx = rt.wx; gy = rt.wy; }
  // KAPI KİLİDİ: sur çizgisinin tam üstündeki birim, her karede "içerideyim /
  // dışarıdayım" arasında gidip gelip hedefini ters çeviriyordu — bir kare kapıya,
  // sonraki kare surun etrafına yöneliyor, net ilerleme sıfır oluyordu ("duvarın
  // kenarında bekliyor"). Geçiş bir kez başlayınca YÖN KİLİTLENİR; birim surun
  // öbür tarafına net geçene (ya da 12 sn geçene) dek kapıdan başka yere bakmaz.
  if (rt && rt.ring) {
    if (!u.nvLock || u.nvLock.ring !== rt.ring || u.nvLock.out !== rt.out) u.nvLock = { ring: rt.ring, out: rt.out, t: 12 };
  }
  if (u.nvLock) {
    const L = u.nvLock, rg = L.ring;
    L.t -= dt;
    const d2 = dist(u.x, u.y, rg.cx, rg.cy);
    const gecti = L.out ? d2 > rg.r + 60 : d2 < rg.r - 60;
    if (gecti || L.t <= 0) u.nvLock = null;
    else {
      const ua = Math.atan2(u.y - rg.cy, u.x - rg.cx);
      const yari = (rg.gapA || 0.12) * 0.6;
      const rd = L.out
        ? (d2 < rg.r - 20 && angDiff(ua, rg.gap) > yari ? rg.r - 30 : rg.r + 150)
        : (d2 > rg.r + 20 && angDiff(ua, rg.gap) > yari ? rg.r + 40 : rg.r - 150);
      gx = rg.cx + Math.cos(rg.gap) * rd; gy = rg.cy + Math.sin(rg.gap) * rd;
    }
  }
  if (u.nvGx === undefined || dist(gx, gy, u.nvGx, u.nvGy) > 45) {  // ara hedef değişti
    u.nvGx = gx; u.nvGy = gy; u.nvBest = undefined;
  }
  const dd = dist(u.x, u.y, gx, gy);
  let ang = Math.atan2(gy - u.y, gx - u.x);
  // ilerleme takibi (engel takibi sırasında ölü sayaç durur: dolanmak ilerlemedir)
  if (u.nvBest === undefined || dd < u.nvBest - 2) { u.nvBest = dd; u.nvStuck = 0; u.nvDead = 0; }
  else {
    u.nvStuck = (u.nvStuck || 0) + dt;
    if (!((u.nvWf || 0) > 0)) u.nvDead = (u.nvDead || 0) + dt;
  }
  if ((u.nvWf || 0) > 0) u.nvWf -= dt;
  else if ((u.nvStuck || 0) > 0.7) {              // takıldı: engel takibine geç
    u.nvWf = 2.6;
    u.nvDir = (u.nvFlip = !u.nvFlip) ? 1 : -1;    // her denemede öbür yana dolan
    u.nvStuck = 0;
  }
  const sx = Math.cos(ang) * spd * dt, sy = Math.sin(ang) * spd * dt;
  let [nx, ny] = collide(u.x + sx, u.y + sy, r, isEnemy);
  if ((u.nvWf || 0) > 0) {
    const px = nx - (u.x + sx), py = ny - (u.y + sy);   // collide'ın ittiği vektör = engel normali
    if (Math.hypot(px, py) > 0.05) {
      const ta = Math.atan2(py, px) + u.nvDir * Math.PI / 2;
      const [wx2, wy2] = collide(u.x + Math.cos(ta) * spd * dt, u.y + Math.sin(ta) * spd * dt, r, isEnemy);
      if (dist(wx2, wy2, u.x, u.y) > spd * dt * 0.3) { nx = wx2; ny = wy2; ang = ta; }
    }
  }
  u.x = nx; u.y = ny; u.dir = ang;
  return sonMesafe;
}
const navReset = u => { u.nvBest = undefined; u.nvStuck = 0; u.nvDead = 0; u.nvWf = 0; u.nvGx = undefined; u.nvLock = null; };
// Zindan kafesi: esir komutanların tutulduğu yer (site merkezine göre sabit konum)
const JAIL_OFFS = { camp1: [150, 70], fort: [180, 120], legion: [180, 120] };
const jailPos = site => { const O = OUTPOSTS[site], o = JAIL_OFFS[site] || [150, 70]; return { x: O.x + o[0], y: O.y + o[1] }; };
const jailCmds = site => (G.prisoners[site] || []).filter(m => m.cmd);
function rebuildOutpostWalls() {
  for (const [site2, op2] of Object.entries(G.outposts)) // karakol suru içindeki kaynaklar da kalkar
    if (op2 && op2.wall && !op2.isVillage && OUTPOSTS[site2]) clearNodesInside(OUTPOSTS[site2].x, OUTPOSTS[site2].y, opWallR(op2) + 26);
  G.opStakes.length = 0;
  G.structures = G.structures.filter(s => s.kind !== 'owgate');
  for (const [site, op] of Object.entries(G.outposts)) {
    if (!op || !op.wall || op.isVillage) continue;
    if (!OP_WALL_SITES.includes(site)) { // taş surlu kaleye kazık suru olmaz: eski kayıttan geldiyse söküp iade et
      delete op.wall; delete op.wallGateHp;
      gain(OP_WALL.cost, G.player.x, G.player.y - 30);
      toast('🪵 ' + OUTPOSTS[site].name + ' kazık suru söküldü — taş surları zaten var (malzeme iade edildi)');
      continue;
    }
    const O = OUTPOSTS[site], gapDir = opWallGapDir(site);
    const R = opWallR(op), gA = opGapA(op);
    // Kazıklar boşluğun İKİ KENARINDAN başlayıp eşit aralıkla dizilir.
    // Eskiden sabit adımla dönülüp boşluğa denk gelenler atlanıyordu: son kazık
    // rastgele bir yerde bitiyor, delik 90px yerine 140-155px açılıyor, kapı da
    // 51px çizildiği için "koca deliğin ortasında küçük kapı" görüntüsü çıkıyordu.
    const yay = TAU - 2 * gA;                       // kazıkla dolacak yay
    const n = Math.max(10, Math.round(yay * R / 40));
    for (let i = 0; i <= n; i++) {
      const a = gapDir + gA + yay * (i / n);
      G.opStakes.push({ x: O.x + Math.cos(a) * R + rr(-2, 2), y: O.y + Math.sin(a) * R + rr(-2, 2), h: rr(24, 30) });
    }
    const ghp = op.wallGateHp !== undefined ? op.wallGateHp : OP_WALL.gateHp;
    G.structures.push({
      kind: 'owgate', site, ang: gapDir, gw: gA * R,  // gw: kapının yarı genişliği = boşluğun yarısı
      x: O.x + Math.cos(gapDir) * R, y: O.y + Math.sin(gapDir) * R,
      hp: Math.max(0, ghp), maxHp: OP_WALL.gateHp, alive: ghp > 0,
    });
  }
}
// ---------- Yaban hayatı: avla → 🍖 et ----------
// tavşan/geyik kaçar, yaban domuzu vurulunca saldırır, kurt yakındakini avlar
const ANIMALS = {
  rabbit: { name: 'Tavşan', hp: 8, speed: 200, fleeR: 170, meat: 1, r: 7 },
  deer:   { name: 'Geyik', hp: 24, speed: 180, fleeR: 215, meat: 3, r: 11 },
  boar:   { name: 'Yaban Domuzu', hp: 65, speed: 135, fleeR: 0, meat: 5, dmg: 10, r: 12, fights: true },
  wolf:   { name: 'Kurt', hp: 42, speed: 170, fleeR: 0, meat: 2, dmg: 8, r: 10, hunts: true },
};
const ANIMAL_BASE = { rabbit: 5, deer: 4, boar: 3, wolf: 2 };
function animalSpot() { // köy/tesislerden uzak, karada bir nokta
  for (let t = 0; t < 24; t++) {
    const x = rr(280, OVERWORLD_W - 120), y = rr(120, WORLD.h - 120);
    if (x < shoreX(y) + 130) continue;
    if (dist(x, y, CAMPFIRE.x, CAMPFIRE.y) < 480) continue;
    if (dist(x, y, CAMP1.x, CAMP1.y) < 380) continue;
    if (dist(x, y, FORT.cx, FORT.cy) < 420 || dist(x, y, LEG.cx, LEG.cy) < 420) continue;
    if (dist(x, y, MERCHANT.x, MERCHANT.y) < 260) continue;
    return [x, y];
  }
  return null;
}
function spawnAnimal(type, x, y) {
  const A = ANIMALS[type];
  G.animals.push({ type, x, y, hx: x, hy: y, hp: A.hp, maxHp: A.hp, dir: rr(0, TAU), walk: 0, wt: 0, wx: x, wy: y, cd: 0, flash: 0, angered: false });
}
function spawnWildlife() {
  for (const [t, n] of Object.entries(ANIMAL_BASE))
    for (let i = 0; i < n; i++) { const s = animalSpot(); if (s) spawnAnimal(t, s[0], s[1]); }
}
function damageAnimal(a, dmg, fx, fy) {
  const A = ANIMALS[a.type];
  a.hp -= dmg; a.flash = 0.12;
  addFloater(a.x, a.y - 30, '-' + dmg, '#ffb0a8', 13);
  spawnParts(a.x, a.y - 14, 4, { colors: ['#8a2f2a', '#c9885a'], v: 70, life: 0.35, g: 150, r: 2.5 });
  const ang = Math.atan2(a.y - fy, a.x - fx);
  a.x += Math.cos(ang) * 8; a.y += Math.sin(ang) * 8;
  if (A.fights) { a.angered = true; a.angerT = 8; } // domuz öfkelenir
  else { a.fleeT = 3.5; } // diğerleri panikle kaçar
  if (a.hp <= 0) {
    a.dead = true;
    gain({ meat: A.meat }, a.x, a.y - 10);
    addXp(4, a.x, a.y - 26);
    spawnDust(a.x, a.y, 6);
    addFloater(a.x, a.y - 44, '🍖', '#e8d9c0', 14);
    SFX.chop();
  }
}
let ENEMY_UID = 1; // co-op düşman kimlik sayacı
// Irk uygulanmayan tipler: boss'lar/hayvanlar kimliğini korur (isimli komutan zinciri bozulmasın)
const RACE_SKIP = { chief: 1, commander: 1, rivallord: 1, bear: 1, troll: 1, wolf: 1, wram: 1 };
function spawnEnemy(type, x, y, camp, raceId) {
  const base = ENEMY_DEF[type];
  let d = base;
  const R = RACE_SKIP[type] || base.beast ? null : RACES[raceId || (camp === 'rival' ? 'barbar' : PROV0.race)] || null;
  if (R) {
    d = Object.assign({}, base, {
      hp: base.hp * (R.hp || 1),
      dmg: Math.round(base.dmg * (R.dmg || 1)),
      speed: base.speed * (R.spd || 1),
      cd: base.cd * (R.cdm || 1),
      range: base.ranged ? base.range : Math.round(base.range * (R.rng || 1)),
      scale: base.scale * (R.scl || 1),
      cloth: R.cloth, weapon: R.weapon, mount: R.mount, slow: R.slow, raceName: R.name,
    });
  }
  const mul = (1 + (G.region - 1) * 0.6) * (DIFF[G.difficulty] || DIFF.normal).emul * BAL.emul; // bölge + zorluk + admin
  // uid: co-op'ta iki bilgisayarın aynı düşmanı eşleştirmesi için kalıcı kimlik
  G.enemies.push({ type, camp, def: R ? d : undefined, uid: 'e' + (ENEMY_UID++), raceId: raceId || PROV0.race, x, y, hx: x, hy: y, hp: Math.round(d.hp * mul), maxHp: Math.round(d.hp * mul), mul, cd: 0, dir: 0, swing: 0, flash: 0, walk: 0, wt: 0, wx: x, wy: y, aggro: false });
}
const eDef = e => e.def || ENEMY_DEF[e.type]; // düşmanın etkin tanımı (ırk uygulanmış olabilir)

// ---------- Kayıt ----------
const SAVE_KEY = slotKey(SAVE_SLOT);
// Göç/sıfırlama sırasında otokayıt (5sn interval + visibilitychange) yazılan yeni veriyi ezmesin
let SUPPRESS_SAVE = false;
function save() {
  if (SUPPRESS_SAVE) return;
  if (VISIT || ISLAND) return; // ziyaret/ada: sandbox — kendi köy kaydına dokunulmaz
  if (MENU_OPEN) return; // menüdeyken otokayıt boş yuvayı doldurup "Yeni Oyun"u bozmasın
  try {
    // garnizon rütbeleri: canlı birimlerden kayda senkron (XP/terfi kaybolmasın)
    for (const [oid, op] of Object.entries(G.outposts)) {
      if (!op) continue;
      const live = G.garrisonUnits.filter(g2 => g2.garrisonOf === oid);
      if (live.length || op.garrison) op.garrisonCls = live.map(g2 => ({ cls: g2.cls || 'sword', lv: g2.lv || 1, xp: Math.round(g2.xp || 0) }));
    }
    // arsa-pozisyonlu format: karakol arsaları dinamik açıldığı için indeks yerine konumla eşleşir
    const bplots = G.plots.filter(pl => pl.built).map(pl => {
      const b = G.buildings.find(bb => bb.x === pl.x && bb.y === pl.y);
      return b ? { x: pl.x, y: pl.y, type: b.type, lv: b.lv, hp: b.hp, ruined: !!b.ruined, villager: !!b.villager, job: b.job || null, upPaid: b.upPaid || null, repPaid: b.repPaid || null } : null;
    }).filter(Boolean);
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      res: G.res, swordLv: G.swordLv, armorLv: G.armorLv,
      soldiersOwned: G.soldiersOwned,
      camp1Destroyed: G.camp1Destroyed, chestOpened: G.chestOpened, questIdx: G.questIdx,
      px: G.caveRun && G.caveReturn ? G.caveReturn.x : G.player.x,
      py: G.caveRun && G.caveReturn ? G.caveReturn.y : G.player.y,
      caveCd: Math.round(G.caveCd),
      wounded: G.wounded.map(w => ({ cmd: w.cmd, lv: w.lv, kills: w.kills, gear: w.gear, cls: w.cls, name: w.name, x: Math.round(w.x), y: Math.round(w.y) })),
      prisoners: G.prisoners,
      commanders: G.commanders.map(c => ({ id: c.id, lv: c.lv, kills: c.kills, gear: c.gear, order: c.order || 'follow', purse: Math.round(c.purse || 0), troopN: (c.troops || []).length })),
      kneels: G.props.filter(pr => pr.kind === 'kneel').map(pr => ({ cmd: pr.cmd, x: Math.round(pr.x), y: Math.round(pr.y) })),
      bag: G.bag, equip: G.equip, stock: G.stock,
      paidPlots: G.plots.filter(pl => !pl.built && pl.paid && Object.keys(pl.paid).length).map(pl => ({ x: pl.x, y: pl.y, paid: pl.paid })),
      day: G.day, raidsSurvived: G.raidsSurvived, bplots,
      palisadeBuilt: G.palisade.built, gateHp: G.palisade.gate.hp, gateAlive: G.palisade.gate.alive,
      fortGate: (() => { const og = G.structures.find(x2 => x2.kind === 'gate'); return G.outposts.fort && og && og.alive ? og.hp : 0; })(),
      legGate: (() => { const og = G.structures.find(x2 => x2.kind === 'lgate'); return G.outposts.legion && og && og.alive ? og.hp : 0; })(),
      legionConquered: G.legionConquered, sieges: G.sieges, discovered: G.discovered,
      outposts: G.outposts,
      region: G.region, dynasty: G.dynasty, victoryShown: G.victoryShown, dynUpg: G.dynUpg,
      provinceId: G.provinceId, worldConquered: G.worldConquered, countryBonus: G.countryBonus, worldDone: G.worldDone,
      villageTier: G.villageTier, level: G.level, xp: G.xp,
      horseOwned: !!G.horseOwned, riding: !!G.riding, autoVillage: G.autoVillage !== false,
      soldierCls: G.soldiers.map(sl => sl.cls || 'sword'),
      soldierMeta: G.soldiers.map(sl => ({ cls: sl.cls, name: sl.name, trait: sl.trait || null, lv: sl.lv || 1, xp: Math.round(sl.xp || 0) })),
      difficulty: G.difficulty, stats: G.stats, ach: G.ach, caveCleared: G.caveCleared,
      palisadeLv: G.palisade.lv,
      rival: { alive: G.rival.alive, threatened: G.rival.threatened, tribute: G.rival.tribute, x: Math.round(G.rival.x), y: Math.round(G.rival.y) },
    }));
  } catch (e) { /* özel modda vs. kayıt olmayabilir */ }
  netQueueUpload();
}
// Köy anlık görüntüsü buluta: arkadaşlar ziyaret edebilsin (75 sn'de bir, sessizce)
let netUpT = 0, netUpBusy = false;
function netQueueUpload(force) {
  if (!NETP || netUpBusy || VISIT || ISLAND) return;
  const now = Date.now();
  if (!force && now - netUpT < 75000) return;
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { }
  if (!snap) return;
  netUpT = now; netUpBusy = true;
  rpcAuth('save_village', {
    p_village: snap,
    p_meta: { day: G.day, level: G.level, prov: PROV0.name, dynasty: G.dynasty },
  }).catch(() => { netUpT = now - 60000; /* kısa süre sonra yeniden dene */ })
    .finally(() => { netUpBusy = false; });
}
// ---------- Çevrimiçi: ziyaret bitişi + yardım uygulama + sosyal veri ----------
function endVisit() {
  if (!VISIT || G.visitEnding) return;
  G.visitEnding = true;
  coopDisconnect();
  const fx = G.helpFx || { don: {}, repairs: 0, kills: 0 };
  const any = fx.kills || fx.repairs || Object.keys(fx.don).length;
  let doneRun = false;
  const done = () => {
    if (doneRun) return; doneRun = true;
    try { sessionStorage.removeItem('kd-visit'); sessionStorage.setItem('kd-resume', '1'); } catch (e) { }
    location.reload();
  };
  banner('🏠 KÖYÜNE DÖNÜYORSUN');
  const fin = [];
  const spent = Math.max(0, Math.min(20, Math.round(G.visitTick || 0)));
  if (spent > 0) fin.push(rpcAuth('use_visit', { p_host: VISIT.host, p_seconds: spent }));
  if (any) fin.push(rpcAuth('send_help', {
    p_host: VISIT.host,
    p_effects: { donations: fx.don, repairs: fx.repairs || 0, kills: fx.kills || 0 },
  }));
  Promise.allSettled(fin).then(done);
  setTimeout(done, 4000); // ağ takılsa bile eve dön
}
// Ev sahibi köyüne girince: ziyaretçilerin bıraktığı yardımlar uygulanır
function netApplyHelp() {
  if (!NETP || VISIT || ISLAND) return;
  rpcAuth('fetch_help').then(evts => {
    if (!evts || !evts.length) return;
    let delay = 1200;
    for (const ev of evts) {
      const fx = ev.effects || {}, parts = [];
      for (const [k, v] of Object.entries(fx.donations || {})) {
        if (!v || v <= 0) continue;
        const icon = (RES_DEF.find(r => r[0] === k) || [])[1] || k;
        if (k === 'gold') { G.res.gold += v; } else addStock(k, v); // altın cebe, kalanı depoya
        parts.push(v + icon);
      }
      if (fx.repairs > 0) { // ziyaretçinin onardıkları: en yıkık binalardan başlayarak ayağa kalkar
        let n = Math.min(fx.repairs, 6);
        for (const b of G.buildings) {
          if (n <= 0) break;
          if (b.ruined && BUILDINGS[b.type]) { b.ruined = false; b.hp = b.maxHp; delete b.repPaid; n--; }
        }
        parts.push(fx.repairs + ' bina onardı 🔧');
      }
      if (fx.kills > 0) parts.push(fx.kills + ' düşman öldürdü ⚔️');
      const msg = '🤝 ' + ev.visitor + ' köyüne uğradı' + (parts.length ? ': ' + parts.join(' · ') : '');
      setTimeout(() => toast(msg), delay); delay += 2600;
    }
    save();
  }).catch(() => { });
}
// ============================================================
// CANLI ORTAK OYUN (co-op) — Supabase Realtime, aynı haritada buluşma
// OTORİTE MODELİ: haritanın sahibi HOST'tur. Düşmanları, canlarını ve gece/gündüzü
// o simüle eder; misafir onun yayınladığı dünyayı görür, vuruşlarını ona bildirir.
// Host çevrimdışıysa hiçbir şey bozulmaz: oyun eski (fotoğraf/asenkron) moduna düşer.
// ============================================================
const CO = {
  ws: null, topic: null, mode: null, isHost: false,
  joined: false, gotWorld: false, peers: {},
  posT: 0, worldT: 0, hbT: 0, retryT: 0, waitT: 0, enemyMap: {},
};
const coopOn    = () => !!(CO.ws && CO.joined);
const coopGuest = () => coopOn() && !CO.isHost;
const coopHost  = () => coopOn() && CO.isHost;
// Misafir HOST'un dünyasına bağlandı mı? Bağlandıysa kendi simülasyonunu durdurur.
const coopSlave = () => coopGuest() && CO.gotWorld;
const coopPeerCount = () => Object.keys(CO.peers).length;

function coopConnect(mode, topic, isHost) {
  if (!NETP) return;
  coopDisconnect();
  CO.mode = mode; CO.topic = 'realtime:' + topic; CO.isHost = isHost;
  CO.gotWorld = false; CO.waitT = 0; CO.enemyMap = {}; CO.peers = {};
  coopOpen();
}
function coopOpen() {
  if (!CO.topic || !NETP) return;
  let ws;
  try { ws = new WebSocket('wss://kmfxcdnerqatjmklssli.supabase.co/realtime/v1/websocket?apikey=' + NET_KEY + '&vsn=1.0.0'); }
  catch (e) { CO.retryT = 6; return; }
  CO.ws = ws; CO.joined = false;
  ws.onopen = () => {
    try {
      ws.send(JSON.stringify({ topic: CO.topic, event: 'phx_join',
        payload: { config: { broadcast: { self: false, ack: false } } }, ref: '1' }));
    } catch (e) { }
  };
  ws.onmessage = ev => { try { coopMsg(JSON.parse(ev.data)); } catch (e) { } };
  ws.onclose = () => { CO.joined = false; CO.retryT = 5; };
  ws.onerror = () => { };
}
function coopDisconnect(quiet) {
  if (CO.ws) {
    if (CO.joined && !quiet) coopSend('bye', {});
    try { CO.ws.close(); } catch (e) { }
  }
  CO.ws = null; CO.joined = false; CO.gotWorld = false; CO.peers = {}; CO.enemyMap = {};
}
function coopSend(event, payload) {
  if (!CO.ws || CO.ws.readyState !== 1 || !CO.joined || !NETP) return;
  payload = payload || {}; payload.id = NETP.id;
  try {
    CO.ws.send(JSON.stringify({ topic: CO.topic, event: 'broadcast',
      payload: { type: 'broadcast', event, payload }, ref: null }));
  } catch (e) { }
}
function coopFind(uid) {
  const e = CO.enemyMap[uid];
  if (e && e.hp > 0) return e;
  for (const e2 of G.enemies) if (e2.uid === uid && e2.hp > 0) { CO.enemyMap[uid] = e2; return e2; }
  return null;
}
// Ada modunda host deterministik seçilir: kanaldaki en küçük oyuncu kimliği
function coopRecalcHost() {
  if (CO.mode !== 'island') return;
  const ids = [NETP.id].concat(Object.keys(CO.peers)).sort();
  const shouldHost = ids[0] === NETP.id;
  if (shouldHost === CO.isHost) return;
  CO.isHost = shouldHost;
  if (shouldHost) { CO.gotWorld = false; toast('👑 Ada dünyasını artık sen yönetiyorsun'); }
  else { CO.gotWorld = false; toast('🔗 Ada dünyası yoldaşından akıyor'); }
}
function coopPeer(d) {
  let p = CO.peers[d.id];
  if (!p) {
    p = CO.peers[d.id] = { id: d.id, name: d.name || 'Yoldaş', x: d.x || G.player.x, y: d.y || G.player.y,
      tx: d.x || G.player.x, ty: d.y || G.player.y, dir: 0, walk: 0, hp: 1, maxHp: 1, last: G.t };
    toast('🟢 ' + p.name + ' aynı haritada — birlikte savaşabilirsiniz!');
    SFX.horn();
    coopRecalcHost();
  }
  if (d.name) p.name = d.name; // isim her hello'da tazelenir (pos önce gelirse "Yoldaş" kalmasın)
  p.last = G.t;
  return p;
}
function coopMsg(m) {
  if (m.event === 'phx_reply' && m.ref === '1') {
    if (m.payload && m.payload.status === 'ok') {
      CO.joined = true; CO.retryT = 0;
      coopSend('hello', { name: NETP.name, x: Math.round(G.player.x), y: Math.round(G.player.y) });
    }
    return;
  }
  if (m.event !== 'broadcast' || !m.payload) return;
  const ev = m.payload.event, d = m.payload.payload || {};
  if (!d.id || (NETP && d.id === NETP.id)) return;
  if (ev === 'hello') { coopPeer(d); coopSend('hi', { name: NETP.name, x: Math.round(G.player.x), y: Math.round(G.player.y) }); return; }
  if (ev === 'hi') { coopPeer(d); return; } // cevaba cevap yok: sonsuz selamlaşma olmaz
  if (ev === 'bye') {
    const p = CO.peers[d.id];
    if (p) { toast('⚪ ' + p.name + ' ayrıldı'); delete CO.peers[d.id]; coopRecalcHost(); }
    return;
  }
  if (ev === 'pos') {
    const p = coopPeer(d);
    // Paketler arası boşlukta yoldaş DURUYOR, paket gelince zıplıyordu ("atlaya
    // atlaya"). Son iki paketten HIZ çıkarıp aradaki boşluğu o hızla dolduruyoruz.
    const now = performance.now() / 1000;
    const dtp = clamp(now - (p.lastT || now), 0.04, 0.6);
    if (p.lastT !== undefined) { p.vx = (d.x - p.tx) / dtp; p.vy = (d.y - p.ty) / dtp; }
    p.lastT = now; p.extT = 0;
    p.tx = d.x; p.ty = d.y; p.dir = d.a || 0; p.hp = d.h || 1; p.maxHp = d.m || 1;
    p.riding = !!d.r; p.moving = !!d.w; p.swing = d.s ? 0.18 : p.swing;
    if (!p.moving) { p.vx = 0; p.vy = 0; }   // durduğunu söylediyse ileri sürme
    return;
  }
  if (ev === 'w') { if (!CO.isHost) coopApplyWorld(d); return; }
  if (ev === 'hit') { // misafirin vuruşu: host uygular
    if (!CO.isHost) return;
    const e = coopFind(d.u);
    if (e) { e.lastHitBy = d.id; damageEnemy(e, d.d, d.x !== undefined ? d.x : e.x, d.y !== undefined ? d.y : e.y, !!d.c); }
    return;
  }
  if (ev === 'dead') { // host: düşman öldü — vuran misafirse ganimeti o alır
    const e = coopFind(d.u);
    if (e) { e.hp = 0; spawnDust(e.x, e.y, 8); }
    if (d.by === NETP.id) {
      if (d.loot) gain(d.loot, d.x, d.y);
      if (d.xp) addXp(d.xp, d.x, d.y - 40);
      G.stats.kills++;
      addFloater(d.x, d.y - 60, '💀', '#e8d9c0', 15);
    }
    return;
  }
  if (ev === 'fix' && CO.isHost) { // yoldaşın yıkık binamı onardı
    const b2 = G.buildings.find(bb => Math.abs(bb.x - d.x) < 24 && Math.abs(bb.y - d.y) < 24 && bb.ruined);
    if (b2) {
      b2.ruined = false; b2.hp = b2.maxHp; delete b2.repPaid;
      spawnParts(b2.x, b2.y - 30, 12, { colors: ['#ffd257', '#fff3c9'], v: 45, life: 1, g: -25 });
      SFX.build(); toast('🔧 ' + ((CO.peers[d.id] || {}).name || 'Yoldaşın') + ' ' + BUILDINGS[b2.type].name + '\'ni onardı!');
      save();
    }
    return;
  }
  if (ev === 'fx') { // karşı tarafın yaptığı iş: ekranda bildir + kaynak uçuş efekti
    if (d.msg) toast(d.msg);
    if (d.x !== undefined && d.icon) {
      for (let i = 0; i < 3; i++)
        G.flyItems.push({ x0: d.x + rr(-14, 14), y0: d.y - 30, x1: d.x2 !== undefined ? d.x2 : d.x, y1: d.y2 !== undefined ? d.y2 : d.y - 60, t: 0, icon: d.icon });
    }
    return;
  }
  if (ev === 'ws') { if (!CO.isHost && CO.gotWorld) coopApplyState(d); return; } // tam dünya durumu
  if (ev === 'nkill' && CO.isHost) { // yoldaşım bir kaynağı kırdı: bende de kırılsın
    const n = G.nodes[d.i];
    if (n && n.alive) { n.alive = false; n.respT = NODE_DEF[n.kind].respawn; spawnDust(n.x, n.y, 8); }
    return;
  }
  if (ev === 'act' && CO.isHost) { // yoldaşımın inşaat/yükseltme işi: bedeli benim kesemden
    const pl = G.plots[d.pi];
    if (!pl) return;
    if (d.k === 'build' && !pl.built && BUILDINGS[d.t]) {
      const c = bcost(BUILDINGS[d.t].cost);
      if (canAfford(c)) { pay(c); pl.plan = d.t; constructAt(pl); toast('🏗️ ' + ((CO.peers[d.id] || {}).name || 'Yoldaşın') + ' ' + BUILDINGS[d.t].name + ' kurdu!'); }
      else toast('⚠️ Yoldaşın ' + BUILDINGS[d.t].name + ' kurmak istedi ama kaynak yetmedi', true);
    } else if (d.k === 'up') {
      const b2 = G.buildings.find(x => x.x === pl.x && x.y === pl.y);
      const c2 = b2 && nextUpCost(b2);
      if (b2 && c2 && canAfford(bcost(c2))) { pay(bcost(c2)); applyUpgrade(b2); toast('⬆️ ' + ((CO.peers[d.id] || {}).name || 'Yoldaşın') + ' ' + BUILDINGS[b2.type].name + '\'ni yükseltti!'); }
    }
    return;
  }
  if (ev === 'stock' && CO.mode === 'visit' && CO.isHost) { // misafir köyüne kaynak bıraktı
    for (const [k, v] of Object.entries(d.s || {})) {
      if (!v || v <= 0) continue;
      if (k === 'gold') G.res.gold += v; else addStock(k, v, CAMPFIRE.x, CAMPFIRE.y - 40);
    }
    toast('🎁 ' + ((CO.peers[d.id] || {}).name || 'Yoldaşın') + ' köyüne kaynak bıraktı!');
    save();
    return;
  }
}
// HOST → misafirler: hareketli her şey (düşmanlar + kendi ordusu + yaban hayatı)
function coopBroadcastWorld() {
  const list = [], allies = [], anim = [];
  const pk = Object.values(CO.peers);
  const yakin = (x, y) => { for (const p of pk) if (dist(x, y, p.x, p.y) < 1500) return true; return false; };
  for (const e of G.enemies) {
    if (e.hp <= 0 || !yakin(e.x, e.y)) continue;
    list.push([e.uid, e.type, Math.round(e.x), Math.round(e.y), Math.round(e.hp), Math.round(e.maxHp),
      +(e.dir || 0).toFixed(2), e.raceId || '', e.camp || '', e.aggro ? 1 : 0]);
    if (list.length >= 44) break;
  }
  for (const s of G.soldiers.concat(G.commanders, G.garrisonUnits)) {
    if (s.hp <= 0 || !yakin(s.x, s.y)) continue;
    allies.push([Math.round(s.x), Math.round(s.y), s.cmd ? 'cmd:' + s.id : (s.cls || 'sword'),
      Math.round(s.hp), Math.round(s.maxHp), +(s.dir || 0).toFixed(2), s.garrisonOf ? 1 : 0]);
    if (allies.length >= 22) break;
  }
  for (const a of G.animals) {
    if (a.dead || !yakin(a.x, a.y)) continue;
    anim.push([Math.round(a.x), Math.round(a.y), a.type, Math.round(a.hp), +(a.dir || 0).toFixed(2)]);
    if (anim.length >= 16) break;
  }
  coopSend('w', { e: list, a: allies, an: anim, d: G.day, n: G.night ? 1 : 0 });
}
// HOST → misafirler: yavaş değişen dünya durumu (binalar, kaynaklar, yapılar, sur, ambar, hava)
function coopBroadcastState() {
  // Binalar KONUMLA gönderilir, arsa indeksiyle değil: karakol arsaları fetih
  // sırasına, genişletme arsaları kademe sırasına göre eklendiğinden iki tarafın
  // dizi sırası farklı olabiliyor ve indeks eşlemesi yanlış arsaya düşüyordu.
  const b2 = [];
  for (const bd of G.buildings) {
    if (bd.type === 'campfire') continue;
    b2.push([Math.round(bd.x), Math.round(bd.y), bd.type, bd.lv, bd.ruined ? 1 : 0, bd.villager ? 1 : 0]);
  }
  // KARAKOLLAR: fetih, seviye, sur ve kapı durumu (fetih sırası korunur)
  const ops = [];
  for (const [id, o] of Object.entries(G.outposts)) {
    if (!o || o.isVillage || !o.owned || !OUTPOSTS[id]) continue;
    ops.push([id, o.lv || 1, o.wall ? 1 : 0,
      o.wallGateHp === undefined ? -1 : Math.round(o.wallGateHp), o.looted ? 1 : 0]);
  }
  const nd = [];
  G.nodes.forEach((n, i) => { if (!n.alive) nd.push(i); }); // kırılmış kaynaklar
  const st = G.structures.map(s => [s.kind + '|' + (s.site || ''), s.alive ? 1 : 0, Math.round(s.hp)]);
  const stock = {}, res = {};
  for (const [k] of RES_DEF) { if (G.stock[k]) stock[k] = Math.floor(G.stock[k]); if (G.res[k]) res[k] = Math.floor(G.res[k]); }
  coopSend('ws', { b2, ops, nd, st, stock, res, wx: G.weather || 'clear', tier: G.villageTier,
    fl: [G.camp1Destroyed ? 1 : 0, G.chestOpened ? 1 : 0, G.legionConquered ? 1 : 0],
    pal: [G.palisade.built ? 1 : 0, G.palisade.lv, Math.round(G.palisade.gate.hp), G.palisade.gate.alive ? 1 : 0] });
}
// MİSAFİR: ev sahibinin dünya durumunu birebir uygular
function coopApplyState(d) {
  // 0) KÖY GENİŞLEMESİ ve KARAKOLLAR binalardan ÖNCE kurulur: bina konumları
  //    ancak o arsalar açıldıktan sonra karşılık bulur.
  if (d.tier && d.tier > G.villageTier) {
    for (let t = G.villageTier + 1; t <= d.tier; t++) addExpansionPlots(t);
    G.villageTier = d.tier; rebuildPalisade();
    toast('🏗️ Köy genişledi (yoldaşın)');
  }
  if (d.fl) { G.camp1Destroyed = !!d.fl[0]; G.chestOpened = !!d.fl[1]; G.legionConquered = !!d.fl[2]; }
  for (const o of (d.ops || [])) {
    const [oid, lv, wall, gateHp, looted] = o;
    if (!OUTPOSTS[oid]) continue;
    let op = G.outposts[oid];
    if (!op) {   // yoldaşın burayı fethetmiş: sancağı ve arsaları bende de aç
      op = G.outposts[oid] = { owned: true, looted: false, garrison: 0, lv: 1, garrisonCls: [], stock: {}, auto: false };
      G.structures.push({ kind: 'banner', site: oid, x: OUTPOSTS[oid].x, y: OUTPOSTS[oid].y,
        hp: outpostBannerHp(1), maxHp: outpostBannerHp(1), alive: true });
      G.enemies = G.enemies.filter(e => e.camp !== oid);
      spawnParts(OUTPOSTS[oid].x, OUTPOSTS[oid].y - 40, 16, { colors: ['#ffd257', '#fff3c9'], v: 50, life: 1.1, g: -25 });
      toast('🏳️ ' + OUTPOSTS[oid].name + ' fethedildi (yoldaşın)');
    }
    if (op.lv !== lv) {
      op.lv = lv;
      const bn = G.structures.find(x => x.kind === 'banner' && x.site === oid);
      if (bn) { bn.maxHp = outpostBannerHp(lv); bn.hp = bn.maxHp; }
      toast('🏳️ ' + OUTPOSTS[oid].name.replace(' Karakolu', '') + ' Sv.' + lv + ' oldu (yoldaşın)');
    }
    op.looted = !!looted;
    opAddPlots(oid, OUTPOST_PLOT_N[Math.min(3, lv)] || OUTPOST_PLOT_N[1]);   // deterministik: iki tarafta aynı yerler
    const surDegisti = (!!op.wall) !== !!wall;
    op.wall = wall; if (gateHp >= 0) op.wallGateHp = gateHp;
    if (surDegisti || wall) rebuildOutpostWalls();
    if (KEEP_SITES.includes(oid)) rebuildKeepWalls();
    if (surDegisti && wall) toast('🪵 ' + OUTPOSTS[oid].name.replace(' Karakolu', '') + ' suru dikildi (yoldaşın)');
  }
  const gorulen = new Set();
  for (const a of (d.b2 || [])) { // binalar: KONUMLA eşleşir (arsa indeksi değil)
    const [bx, by, type, lv, ruined, vill] = a;
    const pl = G.plots.find(p => Math.abs(p.x - bx) < 7 && Math.abs(p.y - by) < 7);
    if (!pl || !BUILDINGS[type]) continue;
    gorulen.add(pl);
    let bd = G.buildings.find(x => x.x === pl.x && x.y === pl.y);
    if (!bd) {
      pl.built = type; delete pl.paid;
      bd = { type, x: pl.x, y: pl.y, lv, hp: buildingMaxHp(lv), maxHp: buildingMaxHp(lv),
        ruined: !!ruined, villager: !!vill, outpost: pl.outpost || null };
      G.buildings.push(bd);
      G.built[type] = Math.max(G.built[type] || 0, lv);
      spawnDust(pl.x, pl.y, 10);
      spawnParts(pl.x, pl.y - 30, 10, { colors: ['#ffd257', '#fff3c9'], v: 45, life: 0.9, g: -25 });
      toast('🏗️ ' + BUILDINGS[type].name + ' kuruldu (yoldaşın)');
    } else {
      if (bd.lv !== lv) {
        bd.lv = lv; bd.maxHp = buildingMaxHp(lv); bd.hp = bd.maxHp;
        G.built[type] = Math.max(G.built[type] || 0, lv);
        spawnParts(bd.x, bd.y - 34, 10, { colors: ['#ffd257', '#fff3c9'], v: 42, life: 0.9, g: -25 });
        toast('⬆️ ' + BUILDINGS[type].name + ' Sv.' + lv + ' oldu (yoldaşın)');
      }
      bd.ruined = !!ruined; bd.villager = !!vill;
      if (bd.ruined) bd.hp = 0; else if (bd.hp <= 0) bd.hp = bd.maxHp;
    }
  }
  for (const bd of G.buildings.slice()) { // ev sahibinde olmayan bina bende de olmamalı
    if (bd.type === 'campfire') continue;
    const pl = G.plots.find(p => p.x === bd.x && p.y === bd.y);
    if (pl && !gorulen.has(pl)) { G.buildings = G.buildings.filter(x => x !== bd); pl.built = null; }
  }
  const olu = new Set(d.nd || []); // kaynak düğümleri: onun kırdığı bende de kırık
  G.nodes.forEach((n, i) => {
    if (olu.has(i)) { if (n.alive) { n.alive = false; n.respT = NODE_DEF[n.kind].respawn; spawnDust(n.x, n.y, 6); } }
    else if (!n.alive) { n.alive = true; n.hp = NODE_DEF[n.kind].hp; n.respT = 0; }
  });
  for (const a of (d.st || [])) { // yapılar: kapı/sancak/totem/sandık
    const [key, alive, hp] = a;
    const p2 = key.split('|'), kind = p2[0], site = p2[1] || '';
    const s = G.structures.find(x => x.kind === kind && (x.site || '') === site);
    if (s) { s.alive = !!alive; s.hp = hp; }
  }
  if (d.pal) {
    G.palisade.built = !!d.pal[0];
    if (G.palisade.lv !== d.pal[1]) { G.palisade.lv = d.pal[1]; rebuildPalisade(); }
    G.palisade.gate.hp = d.pal[2]; G.palisade.gate.alive = !!d.pal[3];
  }
  if (d.stock) for (const [k] of RES_DEF) G.stock[k] = d.stock[k] || 0;
  if (d.res && VISIT) for (const [k] of RES_DEF) G.res[k] = d.res[k] || 0; // ziyarette cep = ev sahibinin kesesi
  if (d.wx) { G.weather = d.wx; G.weatherT = 999; }
  if (G.panelFor && (G.panelFor.stockPage || G.panelFor.plot)) renderPanel();
}
// MİSAFİR: host'un dünyasını kendi ekranına uygular
function coopApplyWorld(d) {
  if (!CO.gotWorld) { // ilk paket: kendi simülasyonunu bırak, host'unkine geç
    CO.gotWorld = true;
    G.enemies = []; CO.enemyMap = {};
    G.animals = []; // hayvanlar host tarafında — hayalet av olmasın
    if (VISIT) { // ziyarette taşıdığım ordu ev sahibinin kopyasıydı: gerçeği host'tan gelecek
      G.soldiers = []; G.commanders = []; G.garrisonUnits = [];
    }
    banner('🟢 AYNI DÜNYADASINIZ');
    toast('Düşmanlar artık ortak: birlikte dövüşebilirsiniz!');
  }
  G.netAllies = (d.a || []).map(a => ({ x: a[0], y: a[1], cls: a[2], hp: a[3], maxHp: a[4], dir: a[5], gar: a[6], walk: (G.t * 8) % 100 }));
  G.netAnimals = (d.an || []).map(a => ({ x: a[0], y: a[1], type: a[2], hp: a[3], dir: a[4] }));
  const seen = {};
  for (const a of (d.e || [])) {
    const uid = a[0];
    seen[uid] = 1;
    let e = coopFind(uid);
    if (!e) {
      spawnEnemy(a[1], a[2], a[3], a[8] || 'coop', a[7] || undefined);
      e = G.enemies[G.enemies.length - 1];
      e.uid = uid; e.netRemote = true;
      CO.enemyMap[uid] = e;
      e.x = a[2]; e.y = a[3];
    }
    e.ntx = a[2]; e.nty = a[3];
    e.hp = a[4]; e.maxHp = Math.max(a[5], a[4]);
    e.dir = a[6]; e.aggro = !!a[9];
    e.netSeen = G.t;
  }
  for (const uid of Object.keys(CO.enemyMap)) { // host'un listesinden düşenler (öldü ya da çok uzakta)
    if (seen[uid]) continue;
    const e = CO.enemyMap[uid];
    if (e && G.t - (e.netSeen || 0) > 4) { e.hp = 0; delete CO.enemyMap[uid]; }
  }
  G.day = d.d || G.day;
  G.night = !!d.n;
}
// Her karede: konum yayını, dünya yayını, yoldaş yumuşatma, kopan bağlantı onarımı
// Yoldaş konumlarını yumuşat (ölü hesap + yakınsama) ve sessizleşeni düşür
function coopSmoothPeers(dt) {
  for (const id of Object.keys(CO.peers)) {
    const p = CO.peers[id];
    if (G.t - p.last > 12) { toast('⚪ ' + p.name + ' bağlantısı koptu'); delete CO.peers[id]; coopRecalcHost(); continue; }
    p.extT = (p.extT || 0) + dt;
    // Ölü hesap en fazla 200 ms sürer ve boşluk uzadıkça SÖNER: paket gecikirse
    // yoldaşı sonsuza dek ileri sürüp sonra geri çekmek, doldurmaya çalıştığımız
    // sıçramanın daha kötüsünü üretiyor.
    const ex = Math.min(p.extT, 0.2) * (1 - Math.min(1, p.extT / 0.5) * 0.55);
    const gx = p.tx + (p.vx || 0) * ex, gy = p.ty + (p.vy || 0) * ex;
    const k = 1 - Math.pow(0.0015, dt);                     // yumuşak ama hızlı yakınsama
    if (Math.abs(gx - p.x) > 400 || Math.abs(gy - p.y) > 400) { p.x = gx; p.y = gy; }
    else { p.x += (gx - p.x) * k; p.y += (gy - p.y) * k; }
    if (Math.hypot(gx - p.x, gy - p.y) > 1.5 || p.moving) p.walk += dt * 9;
    p.swing = Math.max(0, (p.swing || 0) - dt);
  }
}
function coopTick(dt) {
  if (!NETP) return;
  if (!CO.ws && CO.topic) { CO.retryT -= dt; if (CO.retryT <= 0) coopOpen(); return; }
  if (!coopOn()) return;
  CO.hbT += dt;
  if (CO.hbT > 25) { CO.hbT = 0; try { CO.ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })); } catch (e) { } }
  // Kendi konumum: HAREKET EDERKEN 18/sn (ölü hesapla birleşince akıcı görünür),
  // DURURKEN 2/sn. Sürekli 18 Hz yayın, kimse kıpırdamazken bile sunucu kotasını
  // boşuna yiyordu; duran oyuncunun zaten aktarılacak bir hareketi yok.
  const pl2 = G.player;
  const hareketli = pl2.moving || pl2.swing > 0 || CO.lastSentMove;
  CO.posT += dt;
  if (CO.posT >= (hareketli ? 0.055 : 0.5)) {
    CO.posT = 0;
    CO.lastSentMove = !!pl2.moving;
    coopSend('pos', { x: Math.round(pl2.x), y: Math.round(pl2.y), a: +(pl2.dir || 0).toFixed(2),
      h: Math.round(pl2.hp), m: Math.round(pl2.maxHp), r: G.riding ? 1 : 0, w: pl2.moving ? 1 : 0, s: pl2.swing > 0 ? 1 : 0 });
  }
  // host: dünya yayını (yalnız yanında biri varsa)
  if (CO.isHost && coopPeerCount() > 0) {
    CO.worldT += dt;
    if (CO.worldT >= 0.16) { CO.worldT = 0; coopBroadcastWorld(); }
    CO.stockT = (CO.stockT || 0) + dt; // dünya durumu: bina/kaynak/yapı/sur/ambar/hava
    if (CO.stockT >= 1.2) { CO.stockT = 0; coopBroadcastState(); }
  }
  coopSmoothPeers(dt);
  // misafir: host'un düşmanlarını yumuşatarak taşı
  if (coopSlave()) {
    for (const e of G.enemies) {
      if (e.ntx === undefined) continue;
      const dx = e.ntx - e.x, dy = e.nty - e.y;
      if (Math.abs(dx) > 300 || Math.abs(dy) > 300) { e.x = e.ntx; e.y = e.nty; }
      else { e.x += dx * Math.min(1, dt * 9); e.y += dy * Math.min(1, dt * 9); }
      if (Math.hypot(dx, dy) > 1.5) e.walk += dt * 10;
      e.cd = Math.max(0, e.cd - dt); e.swing = Math.max(0, e.swing - dt); e.flash = Math.max(0, e.flash - dt);
    }
  }
  // ziyarette topladıklarım: canlı bağlıysa 3 sn'de bir ev sahibinin ambarına aktar
  if (CO.mode === 'visit' && !CO.isHost && coopPeerCount() > 0 && G.helpFx && G.helpFx.don) {
    CO.donT = (CO.donT || 0) + dt;
    if (CO.donT > 3) {
      CO.donT = 0;
      if (Object.keys(G.helpFx.don).length) { coopSend('stock', { s: G.helpFx.don }); G.helpFx.don = {}; }
    }
  }
  // ziyarette host hiç görünmediyse: fotoğraf moduna düş (oyun bozulmasın)
  if (coopGuest() && !CO.gotWorld) {
    CO.waitT += dt;
    if (CO.waitT > 6 && !CO.waitNoted) {
      CO.waitNoted = true;
      toast(CO.mode === 'visit' ? '📷 Ev sahibi şu an oyunda değil — köyünün son hâlindesin' : '🏝️ Adada şimdilik yalnızsın', true);
    }
  }
}
// Yoldaşın ekranına "şunu yaptım" bildirimi
function coopFx(msg, x, y, icon) { coopSend('fx', { msg, x: x !== undefined ? Math.round(x) : undefined, y: y !== undefined ? Math.round(y) : undefined, icon }); }

// Arkadaş listesi + ada durumu (panel açılınca tazelenir)
function netRefreshSocial() {
  if (!NETP) return;
  rpcAuth('list_friends')
    .then(f => { G.netFriends = f; if (G.panelFor && G.panelFor.friendsPage) renderPanel(); })
    .catch(e => toast(netErrMsg(e), true));
  rpcAuth('get_island')
    .then(i => { G.netIsland = i; if (G.panelFor && G.panelFor.friendsPage) renderPanel(); })
    .catch(() => { });
}
// ---- OYUNCU ADI: tek kaynak ----
// Ad üç yerde birden kullanılıyor (HUD, kuşam paneli, çok oyunculu). Eskiden
// HUD ve kuşam panelinde 'Kael' SABİT yazıyordu; oyuncu adını değiştirse bile
// oyun içinde eski ad görünüyordu.
let PNAME = 'Kael';
try { PNAME = localStorage.getItem('kd-name') || PNAME; } catch (e) { }
const playerName = () => (PNAME || (NETP && NETP.name) || 'Kael');
function setPlayerName(nm, sessiz) {
  nm = (nm || '').trim().substring(0, 24);
  if (nm.length < 2) { if (!sessiz) toast('Ad en az 2 harf olmalı', true); return false; }
  PNAME = nm;
  try { localStorage.setItem('kd-name', PNAME); } catch (e) { }
  if (NETP && NETP.name !== PNAME) {           // çevrimiçiysen yoldaşların da görsün
    NETP.name = PNAME;
    try { localStorage.setItem('kd-net', JSON.stringify(NETP)); } catch (e) { }
    rpcAuth('rename_player', { p_name: PNAME }).catch(() => { });
    if (coopOn()) coopSend('hello', { name: PNAME, x: Math.round(G.player.x), y: Math.round(G.player.y) });
    netQueueUpload(true);
  }
  updateHUD();
  if (G.panelFor) renderPanel();
  if (!sessiz) toast('Adın güncellendi: ' + PNAME);
  return true;
}
function netRegister() {
  const nm = prompt('Cihanda görünecek adın (2-24 harf):', playerName());
  if (nm === null) return;
  rpc('register_player', { p_name: nm }).then(res => {
    NETP = res;
    try { localStorage.setItem('kd-net', JSON.stringify(NETP)); } catch (e) { }
    setPlayerName(NETP.name, true);   // oyun içi ad da aynı olsun
    toast('🌐 Çevrimiçisin! Davet kodun: ' + NETP.code);
    if (!VISIT && !ISLAND) coopConnect('visit', 'kd-v-' + NETP.id, true);
    netQueueUpload(true); // köyü hemen buluta gönder
    netRefreshSocial();
    if (G.panelFor && G.panelFor.friendsPage) renderPanel();
  }).catch(e => toast(netErrMsg(e), true));
}
function visitFriend(f) {
  if (VISIT || ISLAND) return;
  toast('🏠 ' + f.name + ' köyüne gidiliyor...');
  rpcAuth('get_village', { p_host: f.id }).then(v => {
    try { sessionStorage.setItem('kd-visit', JSON.stringify({ host: f.id, name: v.name, village: v.village, remaining: v.remaining })); } catch (e) { }
    SUPPRESS_SAVE = true; location.reload();
  }).catch(e => toast(netErrMsg(e), true));
}
// Dostluk adası: kişisel katkı sayacı (op paketiyle sunucuya eklenir)
function islContrib(k, n) {
  const c = G.islOps.contrib = G.islOps.contrib || {};
  c[k] = (c[k] || 0) + n;
}
const islKey = (x, y) => Math.round(x) + '_' + Math.round(y);
// Gönderilemeyen op paketini kuyruğa geri kat (ağ hatasında kayıp olmasın)
function islMergeOps(into, ops) {
  if (ops.stockAdd) { const sa = into.stockAdd = into.stockAdd || {}; for (const [k, v] of Object.entries(ops.stockAdd)) sa[k] = (sa[k] || 0) + v; }
  if (ops.built) into.built = Object.assign(ops.built, into.built || {});
  if (ops.cleared) into.cleared = [...new Set([...(into.cleared || []), ...ops.cleared])];
  if (ops.kills) into.kills = (into.kills || 0) + ops.kills;
  if (ops.bossDown) into.bossDown = true;
  if (ops.contrib) { const c = into.contrib = into.contrib || {}; for (const [k, v] of Object.entries(ops.contrib)) c[k] = (c[k] || 0) + v; }
}
function enterIsland() {
  if (!G.netIsland || VISIT || ISLAND) return;
  save(); // en güncel halini yaz — dönüşte kazanımlar bunun üstüne işlenir
  toast('⛵ ' + G.netIsland.name + ' adasına yelken açılıyor...');
  const entry = { res: Object.assign({}, G.res), level: G.level, xp: G.xp };
  try { sessionStorage.setItem('kd-island', JSON.stringify(Object.assign({}, G.netIsland, { entry }))); } catch (e) { }
  SUPPRESS_SAVE = true; location.reload();
}
function exitIsland() {
  if (!ISLAND || G.visitEnding) return;
  G.visitEnding = true;
  coopDisconnect();
  banner('⛵ EVE DÖNÜLÜYOR');
  // Kişisel kazanımlar eve taşınır: kaynak farkı, seviye/tecrübe, çanta+kuşam, komutan gelişimi.
  // Ordu/dünya durumu evdekiyle kalır (sefer bitti); ada ilerlemesi zaten sunucuda.
  try {
    const home = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (home) {
      const entry = ISLAND.entry || { res: {}, level: G.level, xp: 0 };
      home.res = home.res || {};
      for (const k of Object.keys(G.res)) {
        const d = (G.res[k] || 0) - (entry.res[k] || 0);
        if (d) home.res[k] = Math.max(0, (home.res[k] || 0) + d);
      }
      if (G.level > (home.level || 1) || (G.level === (home.level || 1) && G.xp > (home.xp || 0))) { home.level = G.level; home.xp = G.xp; }
      home.bag = G.bag; home.equip = G.equip;
      // komutanlar: adadaki gelişim işlenir; adada esir düşen evdeki listeden SİLİNMEZ (sefer bitti, eve döndü sayılır)
      const cur = {}; G.commanders.forEach(c => { cur[c.id] = c; });
      const clist = (home.commanders || []).map(hc => cur[hc.id]
        ? { id: hc.id, lv: cur[hc.id].lv, kills: cur[hc.id].kills, gear: cur[hc.id].gear } : hc);
      for (const c of G.commanders) if (!clist.some(l => l.id === c.id)) clist.push({ id: c.id, lv: c.lv, kills: c.kills, gear: c.gear });
      home.commanders = clist;
      localStorage.setItem(SAVE_KEY, JSON.stringify(home));
    }
  } catch (e) { }
  let doneRun = false;
  const done = () => {
    if (doneRun) return; doneRun = true;
    try { sessionStorage.removeItem('kd-island'); sessionStorage.setItem('kd-resume', '1'); } catch (e) { }
    location.reload();
  };
  const ops = G.islOps; G.islOps = {};
  rpcAuth('island_sync', { p_ops: ops, p_pos: null }).then(done).catch(done);
  setTimeout(done, 4000);
}
// Ada coğrafyası: normal haritanın ~5.5 katı alan, herkes aynı tohumla aynı adayı görür
function islandGeo() {
  const rI = mulberry32(((ISLAND.seed | 0) * 7 + 13) | 0);
  const j = (x, y) => ({ x: Math.round(x + (rI() - 0.5) * 480), y: Math.round(y + (rI() - 0.5) * 380) });
  return {
    campfire: { x: 1500, y: 3100 }, // ortak üs (sabit — herkes burada başlar)
    forest: j(3400, 1300), quarry: j(3200, 4900), ruins: j(5600, 3100),
    merchant: j(4700, 4200), camp1: j(6700, 1500), fort: j(9500, 4700),
    legion: j(8900, 1200), cave: j(6200, 4500),
  };
}
const ISL_CAMPS = [];
function genIslandExtras() {
  const rI = mulberry32(((ISLAND.seed | 0) * 31 + 7) | 0);
  const ms = 1 + (G.region - 1) * 0.3;
  // 4 ek ada kampı: temizlik tüm yoldaşlara işlenir
  [[2600, 5200], [5300, 900], [7700, 2800], [8700, 5500]].forEach(([bx, by], i) => {
    const x = bx + Math.round((rI() - 0.5) * 400), y = by + Math.round((rI() - 0.5) * 300);
    const site = 'icamp' + i;
    ISL_CAMPS.push({ site, x, y });
    G.structures.push({ kind: 'itotem', site, x, y, hp: Math.round(420 * ms), maxHp: Math.round(420 * ms), alive: true });
    G.props.push({ kind: 'tent', site, x: x - 100, y: y - 60 }, { kind: 'tent', site, x: x + 95, y: y + 70 });
    const pool = ['barb', 'barb', 'archer', 'shieldbarb', 'brute', 'shaman', 'barb'];
    for (let k2 = 0; k2 < pool.length; k2++) spawnEnemy(pool[k2], x + rr(-170, 170), y + rr(-130, 160), site);
  });
  // Ada Devi: doğu ucunda paylaşılan büyük boss
  spawnEnemy('troll', 10700, 3100, 'iboss');
  const bs = G.enemies[G.enemies.length - 1];
  bs.islBoss = true; bs.hp = Math.round(bs.hp * 2.2); bs.maxHp = bs.hp;
  // koca ada boş kalmasın: ek kaynak + yaban hayatı
  const scat = (kind, n, cx2, cy2, rad) => {
    let tries = 0;
    while (n > 0 && tries++ < n * 8) {
      const a = rr(0, TAU), r2 = Math.sqrt(rng()) * rad;
      const x2 = cx2 + Math.cos(a) * r2, y2 = cy2 + Math.sin(a) * r2 * 0.8;
      if (x2 < 60 || x2 > WORLD.w - 60 || y2 < 60 || y2 > WORLD.h - 60 || x2 < shoreX(y2) + 60) continue;
      if (G.nodes.some(o => dist(x2, y2, o.x, o.y) < 55)) continue;
      G.nodes.push({ kind, x: x2, y: y2, hp: NODE_DEF[kind].hp, alive: true, respT: 0, seed: rng() });
      n--;
    }
  };
  scat('tree', 30, 7000, 4800, 800); scat('tree', 22, 2300, 900, 650); scat('tree', 14, 9800, 2600, 600);
  scat('rock', 20, 8300, 3800, 650); scat('rock', 10, 1300, 1500, 450);
  scat('scrap', 12, 6900, 3400, 550);
  for (let i = 0; i < 14; i++) { const s2 = animalSpot(); if (s2) spawnAnimal(['rabbit', 'deer', 'boar', 'wolf'][i % 4], s2[0], s2[1]); }
}
// Sunucudan gelen ada durumunu dünyaya uygula (ilk kurulum + periyodik senkron)
function applyIslandState(payload, initial) {
  if (!payload || !ISLAND) return;
  if (payload.state) ISLAND.state = payload.state;
  if (payload.members) ISLAND.members = payload.members;
  try { sessionStorage.setItem('kd-island', JSON.stringify(ISLAND)); } catch (e) { }
  const st = ISLAND.state || {};
  // ortak depo: sunucu esas, henüz gönderilmemiş yerel eklemeler üstüne katılır
  const pend = (G.islOps && G.islOps.stockAdd) || {};
  for (const [k] of RES_DEF) {
    if (k === 'gold' || k === 'gems') continue;
    G.stock[k] = Math.max(0, (+((st.stock || {})[k]) || 0) + (+pend[k] || 0));
  }
  // yoldaşların kurduğu/yükselttiği binalar
  for (const [key, val] of Object.entries(st.built || {})) {
    if (!val || !BUILDINGS[val.type]) continue;
    const [bx, by] = key.split('_').map(Number);
    const pl = G.plots.find(p2 => Math.round(p2.x) === bx && Math.round(p2.y) === by);
    if (!pl) continue;
    if (!pl.built) {
      pl.built = val.type; delete pl.paid;
      G.buildings.push({ type: val.type, x: pl.x, y: pl.y, lv: val.lv || 1, hp: buildingMaxHp(val.lv || 1), maxHp: buildingMaxHp(val.lv || 1), ruined: false });
      G.built[val.type] = Math.max(G.built[val.type] || 0, val.lv || 1);
      if (!initial) { spawnDust(pl.x, pl.y, 12); toast('🏗️ Yoldaşın ' + BUILDINGS[val.type].name + ' kurdu!'); }
    } else {
      const b = G.buildings.find(bb => bb.x === pl.x && bb.y === pl.y);
      if (b && (val.lv || 1) > b.lv) {
        b.lv = val.lv; b.maxHp = buildingMaxHp(b.lv); b.hp = b.maxHp;
        G.built[b.type] = Math.max(G.built[b.type] || 0, b.lv);
        if (!initial) toast('⬆️ Yoldaşın ' + BUILDINGS[b.type].name + '\'yi Sv.' + b.lv + ' yaptı!');
      }
    }
  }
  // temizlenen kamplar + boss
  for (const cid of (st.cleared || [])) clearSiteRemote(String(cid), initial);
  if (st.bossDown) {
    const bs = G.enemies.find(e2 => e2.islBoss && e2.hp > 0);
    if (bs) { bs.hp = 0; if (!initial) toast('👹 Ada Devi yoldaşların tarafından devrildi!'); }
  }
  // sözde-canlılık: yoldaş hayaletleri (son 90 sn içinde görülenler)
  G.islandMates = (ISLAND.members || []).filter(m => m.id !== (NETP && NETP.id) && m.pos && m.ago < 90);
  const vn = $('visitName');
  if (vn) vn.textContent = '🏝️ ' + ISLAND.name + ' · kod: ' + ISLAND.code + ' · ⚔️ ' + (st.kills || 0) + ' ortak leş';
}
function clearSiteRemote(cid, initial) {
  if (cid.indexOf('icamp') === 0) {
    const t = G.structures.find(s2 => s2.kind === 'itotem' && s2.site === cid);
    if (t && t.alive) {
      t.alive = false;
      G.enemies = G.enemies.filter(e2 => e2.camp !== cid || e2.hp <= 0);
      if (!initial) toast('🏝️ Yoldaşların bir ada kampını temizledi!');
    }
  } else if (cid === 'camp1' && !G.camp1Destroyed) {
    G.camp1Destroyed = true;
    const t = G.structures.find(s2 => s2.kind === 'totem'); if (t) t.alive = false;
    G.enemies = G.enemies.filter(e2 => e2.camp !== 'camp1');
    createOutpost('camp1');
    if (!initial) toast('🏝️ Yoldaşların Barbar Kampı\'nı fethetti!');
  } else if (cid === 'fort' && !G.chestOpened) {
    G.chestOpened = true;
    for (const s2 of G.structures) if (s2.kind === 'gate' || s2.kind === 'gate2' || s2.kind === 'gate3' || s2.kind === 'chest') s2.alive = false;
    G.enemies = G.enemies.filter(e2 => e2.camp !== 'fort');
    createOutpost('fort');
    if (!initial) toast('🏝️ Yoldaşların Taş Kale\'yi fethetti!');
  } else if (cid === 'legion' && !G.legionConquered) {
    G.legionConquered = true;
    for (const s2 of G.structures) if (s2.kind === 'lgate' || s2.kind === 'chest2') s2.alive = false;
    G.enemies = G.enemies.filter(e2 => e2.camp !== 'legion');
    createOutpost('legion');
    if (!initial) toast('🏝️ Yoldaşların Lejyon Karargâhı\'nı fethetti!');
  }
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { }
  if (!s) return;
  Object.assign(G.res, s.res); G.swordLv = s.swordLv || 0; G.armorLv = s.armorLv || 0;
  G.soldiersOwned = s.soldiersOwned || 0;
  G.dynasty = s.dynasty || 0; G.victoryShown = !!s.victoryShown;
  G.level = s.level || 1; G.xp = s.xp || 0;
  G.horseOwned = !!s.horseOwned; G.riding = !!s.riding && !!s.horseOwned;
  G.autoVillage = s.autoVillage !== false;
  G.difficulty = DIFF[s.difficulty] ? s.difficulty : 'normal';
  if (s.stats) Object.assign(G.stats, s.stats);
  if (s.ach) G.ach = s.ach;
  G.caveCleared = !!s.caveCleared;
  G.caveCd = s.caveCd || 0;
  if (s.wounded && !ISLAND) G.wounded = s.wounded.map(w => ({ ...w, t: 0, alertT: 0 }));
  if (s.prisoners && !ISLAND) Object.assign(G.prisoners, s.prisoners);
  if (s.commanders) for (const c of s.commanders) addCommander(c.id, { lv: c.lv, kills: c.kills, gear: c.gear, order: ISLAND ? 'follow' : c.order, purse: c.purse, troopN: ISLAND ? 0 : c.troopN });
  if (s.kneels && !ISLAND) for (const k of s.kneels) if (COMMANDERS[k.cmd]) G.props.push({ kind: 'kneel', cmd: k.cmd, x: k.x, y: k.y });
  if (s.dynUpg) Object.assign(G.dynUpg, s.dynUpg);
  // kuşam: çanta + taktıkların; eski kayıttaki kılıç/zırh seviyeleri eşdeğer eşyaya çevrilir
  if (s.bag) G.bag = s.bag;
  if (s.stock && !ISLAND) Object.assign(G.stock, s.stock); // adada depo ortaktır (sunucudan gelir)
  if (s.equip) G.equip = s.equip;
  else {
    if (G.swordLv > 0) G.equip.weapon = { b: 'sword', r: Math.min([0, 2, 3, 4, 5, 6][G.swordLv] || 0, 9) };
    if (G.armorLv > 0) G.equip.armor = { b: 'plate', r: [0, 2, 4, 5][G.armorLv] || 0 };
    if (G.equip.weapon || G.equip.armor) setTimeout(() => toast('🎒 Demirci ustaların eski silahlarını yeni kuşama dönüştürdü!'), 1600);
  }
  // cihan fethi (PROV0/WC0 zaten erken okundu; buradakiler payload'la senkron kalsın)
  if (s.worldConquered) G.worldConquered = s.worldConquered;
  if (s.countryBonus) G.countryBonus = s.countryBonus;
  G.worldDone = !!s.worldDone;
  if (s.migrated || ISLAND) {
    // taze bölgeye göç (ya da dostluk adası seferi): sadece kişisel meta taşınır, dünya sıfırdan
    G.freshRegion = !ISLAND;
    G.player.maxHp = playerMaxHp(); G.player.hp = G.player.maxHp;
    const clsArr = s.soldierCls || [], metaArr = s.soldierMeta || [];
    for (let i = 0; i < G.soldiersOwned; i++) addSoldier(clsArr[i], metaArr[i]);
    if (!ISLAND) save(); // tam formata hemen geç (adada kendi kaydına yazılmaz)
    return;
  }
  G.camp1Destroyed = !!s.camp1Destroyed; G.chestOpened = !!s.chestOpened; G.questIdx = s.questIdx || 0;
  if (s.sieges) for (const id of Object.keys(G.sieges)) if (s.sieges[id]) G.sieges[id] = s.sieges[id];
  for (const id of Object.keys(G.sieges)) for (const en of Object.values(G.sieges[id])) // eski kayıtlarda şantiye HP'si yok
    if (en.hp === undefined) { en.hp = 260; en.maxHp = 260; }
  if (s.discovered) G.discovered = s.discovered;
  if (s.px) { G.player.x = s.px; G.player.y = s.py; }
  G.player.maxHp = playerMaxHp(); G.player.hp = G.player.maxHp;
  G.day = s.day || 1; G.raidsSurvived = s.raidsSurvived || 0;
  // Genişletme arsaları + karakol arsaları binalardan ÖNCE açılmalı
  G.villageTier = s.villageTier || 1;
  for (let t = 2; t <= G.villageTier; t++) addExpansionPlots(t);
  G.legionConquered = !!s.legionConquered;
  // köy garnizonu
  const vg = s.outposts && s.outposts.village;
  G.outposts.village = { owned: true, looted: false, garrison: (vg && vg.garrison) || 0, lv: 1, garrisonCls: (vg && vg.garrisonCls) || [], isVillage: true };
  for (let i = 0; i < G.outposts.village.garrison; i++) addGarrisonUnit('village', G.outposts.village.garrisonCls[i]);
  const conqueredIds = [];
  if (G.camp1Destroyed) conqueredIds.push('camp1');
  if (G.chestOpened) conqueredIds.push('fort');
  if (G.legionConquered) conqueredIds.push('legion');
  for (const id of conqueredIds) {
    const so = s.outposts && s.outposts[id];
    G.outposts[id] = so
      ? { owned: true, looted: !!so.looted, garrison: so.garrison || 0, lv: so.lv || 1, garrisonCls: so.garrisonCls || [], wall: so.wall || 0, wallGateHp: so.wallGateHp, stock: so.stock || {}, auto: so.auto !== false }
      : { owned: true, looted: false, garrison: 0, lv: 1, garrisonCls: [], stock: {}, auto: true };
    const O = OUTPOSTS[id], bHp = outpostBannerHp(G.outposts[id].lv);
    G.structures.push({ kind: 'banner', site: id, x: O.x, y: O.y, hp: bHp, maxHp: bHp, alive: !G.outposts[id].looted });
    opAddPlots(id, OUTPOST_PLOT_N[Math.min(3, G.outposts[id].lv)] || OUTPOST_PLOT_N[1]);
    for (let i = 0; i < G.outposts[id].garrison; i++) addGarrisonUnit(id, G.outposts[id].garrisonCls[i]);
  }
  // fetih temizliği ÖNCE (kapılar/sandıklar kırık say) — onarılmış kapı restore'u sonra gelir ki ezilmesin
  if (G.camp1Destroyed) {
    const tot0 = G.structures.find(s2 => s2.kind === 'totem'); if (tot0) tot0.alive = false;
    G.enemies = G.enemies.filter(e => e.camp !== 'camp1');
  }
  if (G.chestOpened) {
    for (const st of G.structures) if (st.kind === 'gate' || st.kind === 'gate2' || st.kind === 'gate3' || st.kind === 'chest') st.alive = false;
    G.enemies = G.enemies.filter(e => e.camp !== 'fort');
  }
  if (G.legionConquered) {
    for (const st of G.structures) if (st.kind === 'lgate' || st.kind === 'chest2') st.alive = false;
    G.enemies = G.enemies.filter(e => e.camp !== 'legion');
  }
  // fethedilen kalelerin onarılmış kapıları
  if (s.fortGate && G.outposts.fort) { const og = G.structures.find(x2 => x2.kind === 'gate'); if (og) { og.alive = true; og.hp = s.fortGate; } }
  if (s.legGate && G.outposts.legion) { const og = G.structures.find(x2 => x2.kind === 'lgate'); if (og) { og.alive = true; og.hp = s.legGate; } }
  rebuildOutpostWalls(); // op.wall bayraklarından kazık halkaları + sur kapıları
  // Yapıları arsalara yerleştir: yeni format konumla, eski format indeksle eşleşir
  if (s.bplots) s.bplots.forEach((bp, i) => {
    if (!bp) return;
    let pl = bp.x !== undefined ? G.plots.find(p2 => p2.x === bp.x && p2.y === bp.y) : G.plots[i];
    if (!pl && bp.x !== undefined) { // arsa düzeni değiştiyse (halka yerleşimi) en yakın BOŞ arsaya otur
      // Pay 260 → 520: v4.10'da yerleşke aralıkları büyüdüğü için kale/karakol
      // merkezleri birkaç yüz piksel kayabiliyor; eski kayıttaki binalar arsasız
      // kalmasın diye arama yarıçapı genişletildi.
      let bd2 = 520;
      for (const p2 of G.plots) { if (p2.built) continue; const dd2 = dist(bp.x, bp.y, p2.x, p2.y); if (dd2 < bd2) { bd2 = dd2; pl = p2; } }
    }
    if (!pl || pl.built) return;
    pl.built = bp.type;
    G.buildings.push({
      type: bp.type, x: pl.x, y: pl.y, lv: bp.lv,
      hp: bp.hp, maxHp: buildingMaxHp(bp.lv), ruined: !!bp.ruined,
      villager: !!bp.villager, job: bp.job || null, prodT: 0, upPaid: bp.upPaid || undefined, repPaid: bp.repPaid || undefined,
      outpost: (function () { const pl3 = G.plots.find(p3 => p3.x === pl.x && p3.y === pl.y); return (pl3 && pl3.outpost) || null; })(),
    });
    G.built[bp.type] = Math.max(G.built[bp.type] || 0, bp.lv);
  });
  // yarım kalan şantiye ödemeleri (tüm arsalar — köy + genişletme + karakol — artık mevcut)
  if (s.paidPlots) for (const pp of s.paidPlots) {
    const pl = G.plots.find(p2 => p2.x === pp.x && p2.y === pp.y);
    if (pl && !pl.built) pl.paid = pp.paid;
  }
  // (fetih temizliği yukarıya, kapı restore'undan önceye taşındı)
  G.palisade.built = !!s.palisadeBuilt;
  if (G.palisade.built) {
    G.palisade.lv = s.palisadeLv || 1;
    G.palisade.gate.maxHp = G.palisade.lv >= 2 ? PAL2.gateHp : PAL.gateHp;
    G.palisade.gate.hp = typeof s.gateHp === 'number' ? s.gateHp : G.palisade.gate.maxHp;
    G.palisade.gate.alive = s.gateAlive !== false;
  }
  if (s.rival) {
    Object.assign(G.rival, s.rival);
    if (!G.rival.alive) G.enemies = G.enemies.filter(e => e.camp !== 'rival');
    else G.enemies.forEach(e => { if (e.camp === 'rival') { e.x = G.rival.x + rr(-60, 60); e.y = G.rival.y + rr(-60, 60); e.hx = e.x; e.hy = e.y; } });
  }
  const clsArr2 = s.soldierCls || [], metaArr2 = s.soldierMeta || [];
  for (let i = 0; i < G.soldiersOwned; i++) addSoldier(clsArr2[i], metaArr2[i]);
}
function resetSave() { SUPPRESS_SAVE = true; try { localStorage.removeItem(SAVE_KEY); } catch (e) { } location.reload(); }
setInterval(save, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// Genişletme arsalarını aç (satın almada ve yüklemede aynı sırayla)
function addExpansionPlots(tier) {
  const ex = EXPANSIONS[tier - 2];
  if (!ex) return;
  const EXP_PLAN = [['house', 'depot', 'hunter', 'watchtower'], ['house', 'depot', 'watchtower', 'house']][tier - 2] || [];
  ex.plots.forEach(([ox, oy], i) => G.plots.push({ x: CAMPFIRE.x + ox, y: CAMPFIRE.y + oy, built: null, plan: EXP_PLAN[i] || 'house' }));
}
function addSoldier(cls, meta) {
  // sıradan asker: isimsiz — ama rütbesi/seviyesi var (meta ile taşınır)
  cls = SOLDIER_CLS[cls] ? cls : 'sword';
  const SC = SOLDIER_CLS[cls];
  const s = {
    soldier: true, cls, lv: (meta && meta.lv) || 1, xp: (meta && meta.xp) || 0,
    tdmg: SC.dmg, tregen: SOLDIER.regen,
    x: G.player.x + rr(-40, 40), y: G.player.y + rr(20, 50),
    hp: SC.hp, maxHp: SC.hp, cd: 0, dir: 0, swing: 0, flash: 0, walk: 0, idx: G.soldiers.length,
  };
  G.soldiers.push(s);
  soldierRecalc(s); s.hp = s.maxHp;
}
// Komutan orduya katılır (kapasiteden yemez); kuşamı (gear) yanında taşınır
function addCommander(id, opts) {
  const C = COMMANDERS[id];
  if (!C || G.commanders.some(c => c.id === id)) return;
  const c = {
    cmd: true, id, lv: (opts && opts.lv) || 1, kills: (opts && opts.kills) || 0,
    gear: (opts && opts.gear) || {},
    order: (opts && opts.order) || 'follow', purse: (opts && opts.purse) || 0, troops: [],
    x: (opts && opts.x) !== undefined ? opts.x : G.player.x + rr(-40, 40),
    y: (opts && opts.y) !== undefined ? opts.y : G.player.y + rr(20, 50),
    hp: 1, maxHp: 0, cd: 0, dir: 0, swing: 0, flash: 0, walk: 0,
  };
  G.commanders.push(c);
  cmdRecalc(c);
  c.hp = Math.max(1, Math.round(c.maxHp * ((opts && opts.hpFrac) || 1)));
  for (let i = 0; i < ((opts && opts.troopN) || 0); i++) cmdAddTroop(c); // kayıttan gelen öz ordu
}
const cmdOwned = id =>
  G.commanders.some(c => c.id === id) ||
  G.wounded.some(w => w.cmd === id) ||
  Object.values(G.prisoners).some(arr => arr.some(m => m.cmd === id)) ||
  G.props.some(pr => pr.kind === 'kneel' && pr.cmd === id);
// komutan leş sayar, eşiği geçince güçlenir
function cmdKill(c) {
  c.kills++;
  if (c.lv >= CMD_LV_MAX) return; // komutan tavanı: Sv.20
  if (c.kills >= cmdKillsNeed(c.lv)) {
    c.kills = 0; c.lv++;
    cmdRecalc(c);
    c.hp = Math.min(c.maxHp, c.hp + 30);
    const C = COMMANDERS[c.id];
    toast('⭐ ' + C.name + ' Sv.' + c.lv + ' oldu! (+14❤ +2⚔)');
    spawnParts(c.x, c.y - 30, 14, { colors: ['#ffd257', '#fff3c9', '#c9a8f0'], v: 55, life: 1.0, g: -28 });
    SFX.upgrade();
  }
}
// ---------- Komutan görevleri: bağımsız devriye/yağma + öz ordu ----------
function cmdSetOrder(c, order) {
  const C = COMMANDERS[c.id];
  if (c.order === order) return;
  c.order = order;
  c.wp = null; c.patA = undefined; c.raidPause = 0;
  if (order === 'follow') {
    if (c.troops && c.troops.length) { c.troops = []; toast(C.name + '\'in öz ordusu dağıldı (senin yanındayken ordusu olmaz)'); }
    toast(C.icon + ' ' + C.name + ' artık seni takip ediyor');
  } else if (order === 'raid') {
    toast(C.icon + ' ' + C.name + ' yağmaya çıktı — haritada gezip kese dolduracak 💰 (dikkat: uzakta yaralanırsa esir düşebilir!)');
  } else if (order.indexOf('guard:') === 0) {
    toast(C.icon + ' ' + C.name + ' ' + siteName(order.slice(6)) + ' çevresinde devriyeye başladı 🛡️');
  }
  SFX.horn(); save();
}
function cmdAddTroop(c) {
  const t = {
    cmdTroop: true, own: c, cls: 'sword',
    x: c.x + rr(-30, 30), y: c.y + rr(-30, 30),
    hp: 0, maxHp: 90 + c.lv * 4, tdmg: 12 + Math.floor(c.lv / 2),
    cd: 0, dir: 0, swing: 0, flash: 0, walk: 0,
  };
  t.hp = t.maxHp;
  (c.troops = c.troops || []).push(t);
  return t;
}
// Bağımsız komutanın boşta hareketi: koruma halkası ya da yağma gezisi
function cmdIndepIdle(c, dt) {
  const C = COMMANDERS[c.id];
  let wx = null, wy = null, spd = C.speed * 0.6;
  if (c.order.indexOf('guard:') === 0) {
    const site = c.order.slice(6), O = OUTPOSTS[site] || CAMPFIRE;
    const r = guardRadius(site);
    if (c.patA === undefined) c.patA = Math.atan2(c.y - O.y, c.x - O.x);
    // Devriye noktası karada ve harita içinde olmalı: halkanın bir kısmı denize/kenara
    // taşabiliyor, oraya varılamadığı için komutan sonsuza dek bekliyordu.
    const karada = (px, py) => px > shoreX(py) + 45 && px > 60 && px < WORLD.w - 60 && py > 60 && py < WORLD.h - 60;
    for (let dn = 0; dn < 20; dn++) {
      wx = O.x + Math.cos(c.patA) * r; wy = O.y + Math.sin(c.patA) * r;
      if (karada(wx, wy)) break;
      c.patA += 0.32; c.patT = 0;
    }
    c.patT = (c.patT || 0) + dt;
    // varıldı YA DA makul sürede varılamadı (engel) → sıradaki noktaya geç
    if (dist(c.x, c.y, wx, wy) < 40 || c.patT > 14) { c.patA += 0.32; c.patT = 0; return; }
  } else if (c.order === 'raid') {
    if (c.raidPause > 0) { c.raidPause -= dt; return; }
    if (!c.wp || dist(c.x, c.y, c.wp[0], c.wp[1]) < 60) {
      if (c.wp) { // menzile vardı: yağma geliri
        const g = ri(4, 10);
        c.purse = (c.purse || 0) + g;
        addFloater(c.x, c.y - 60, '💰 +' + g + ' yağma', '#ffd257', 12);
        c.raidPause = rr(2.5, 5);
      }
      const L = LOCATIONS[ri(1, LOCATIONS.length - 1)]; // köy hariç
      c.wp = [L.x + rr(-220, 220), L.y + rr(-160, 160)];
      return;
    }
    wx = c.wp[0]; wy = c.wp[1]; spd = C.speed * 0.7;
  }
  if (wx === null) return;
  navMove(c, wx, wy, spd, dt, 13, false);
  c.walk += dt * 9;
}
// Öz ordu: komutanı izler, yakınındaki düşmanla savaşır; bağımsızken keseden asker alınır
function cmdTroopsUpdate(c, dt) {
  c.troops = (c.troops || []).filter(t => t.hp > 0 && !t.dead);
  const indep = cmdIndependent(c);
  if (indep) { // kese doldukça saflar dolar (sadece kendi başındayken)
    c.recruitT = Math.max(0, (c.recruitT || 0) - dt);
    if (c.recruitT <= 0 && (c.purse || 0) >= CMD_TROOP_COST && c.troops.length < cmdTroopCap(c)) {
      c.purse -= CMD_TROOP_COST; c.recruitT = 6;
      cmdAddTroop(c);
      addFloater(c.x, c.y - 66, '🗡️ safa yeni asker (' + c.troops.length + '/' + cmdTroopCap(c) + ')', '#c8f0b8', 11);
    }
  }
  c.troops.forEach((t, i) => {
    t.cd = Math.max(0, t.cd - dt); t.swing = Math.max(0, t.swing - dt); t.flash = Math.max(0, t.flash - dt);
    let best = null, bd = 300;
    for (const e of G.enemies) { if (e.hp <= 0) continue; const dd = dist(t.x, t.y, e.x, e.y); if (dd < bd && dist(e.x, e.y, c.x, c.y) < 420) { bd = dd; best = e; } }
    if (best) {
      t.dir = Math.atan2(best.y - t.y, best.x - t.x);
      if (bd > 56) {
        const [nx2, ny2] = collide(t.x + Math.cos(t.dir) * 205 * dt, t.y + Math.sin(t.dir) * 205 * dt, 12);
        t.x = nx2; t.y = ny2; t.walk += dt * 10;
      } else if (t.cd <= 0) {
        t.cd = 0.95; t.swing = 0.18;
        damageEnemy(best, t.tdmg, t.x, t.y, false, t); // killer=t → kese komutana işler
      }
    } else {
      const a = (i / Math.max(1, c.troops.length)) * TAU;
      const fx = c.x + Math.cos(a) * 52, fy = c.y + Math.sin(a) * 52;
      const dd = dist(t.x, t.y, fx, fy);
      if (dd > 20) {
        const ang = Math.atan2(fy - t.y, fx - t.x);
        const [nx2, ny2] = collide(t.x + Math.cos(ang) * (dd > 260 ? 300 : 200) * dt, t.y + Math.sin(ang) * (dd > 260 ? 300 : 200) * dt, 12);
        t.x = nx2; t.y = ny2; t.walk += dt * 10; t.dir = ang;
      }
      if (dd > 900) { t.x = c.x + rr(-40, 40); t.y = c.y + rr(-40, 40); }
      if (t.hp < t.maxHp) t.hp = Math.min(t.maxHp, t.hp + 3 * dt);
    }
  });
}
// Kapı bakımı 60 sn'de bir yapılabilir (oto ve elle onarım aynı sayacı paylaşır)
const GATE_CD = 60;
const gateReady = key => G.t >= (G.gateCd && G.gateCd[key] || 0);
const gateWait = key => Math.max(0, Math.ceil((G.gateCd && G.gateCd[key] || 0) - G.t));
function gateUsed(key) { G.gateCd = G.gateCd || {}; G.gateCd[key] = G.t + GATE_CD; }
// ---------- OTO YÖNETİM: her üs kendi ambarıyla inşa/tamir/yükseltme/asker işlerini görür ----------
function autoPayFly(s, need, paid, tx, ty) { // ambardan şantiyeye kaynak uçur — 2: bitti, 1: aktı, 0: kaynak yok
  let moved = false;
  for (const [k, v] of Object.entries(need)) {
    const rem = v - (paid[k] || 0);
    if (rem <= 0) continue;
    const pocket = k === 'gold' || k === 'gems';
    const have = Math.floor(pocket ? (G.res[k] || 0) : (s.stock[k] || 0));
    const give = Math.min(4, rem, have);
    if (give <= 0) continue;
    if (pocket) G.res[k] -= give; else s.stock[k] -= give;
    paid[k] = (paid[k] || 0) + give;
    moved = true;
    G.flyItems.push({ x0: s.anchor.x + rr(-12, 12), y0: s.anchor.y - 44, x1: tx + rr(-10, 10), y1: ty - 12, t: 0, icon: (RES_DEF.find(r2 => r2[0] === k) || [])[1] || '' });
  }
  return Object.entries(need).every(([k, v]) => (paid[k] || 0) >= v) ? 2 : moved ? 1 : 0;
}
function autoSay(id, msg) {
  G.autoSayT = G.autoSayT || {};
  if ((G.autoSayT[id] || -99) + 5 > G.t) return;
  G.autoSayT[id] = G.t;
  toast('⚙️ Oto · ' + siteName(id).replace(' Karakolu', '') + ': ' + msg);
}
function autoManage() {
  if (G.dead || VISIT) return;
  const sites = [{ id: 'village', anchor: CAMPFIRE, stock: G.stock, on: G.autoVillage !== false }];
  for (const [oid, op] of Object.entries(G.outposts)) {
    if (!op || op.isVillage || !op.owned || op.looted) continue;
    op._id = oid; op.stock = op.stock || {};
    sites.push({ id: oid, anchor: OUTPOSTS[oid], op, stock: op.stock, on: op.auto !== false });
  }
  for (const s of sites) {
    if (!s.on) continue;
    autoSmelt(s);                                   // demirci hurdayı boş durmadan eritir (inşaattan bağımsız)
    if (!autoSite(s) && !autoAl(s)) autoCaravan(s, sites);   // iş bitti: eksik varsa satın al, yoksa yardım/satış
  }
}
// DEMİRCİ OCAĞI: üsste demirci varsa ambardaki hurda boş yatmaz — 5🔩 → 1⚙️ demir.
// Görsel akış iki ayaklıdır: ambar → demirci (hurda uçar), ~1.4 sn sonra demirci → ambar (demir döner).
function autoSmelt(s) {
  if (VISIT || G.dead || G.caveRun) return;
  G.smeltT = G.smeltT || {};
  if ((G.smeltT[s.id] || 0) > G.t) return;
  const sahip = s.id === 'village' ? null : s.id;
  const oca = G.buildings.find(b => b.type === 'blacksmith' && !b.ruined && (b.outpost || null) === sahip);
  if (!oca) return;
  const cap = s.id === 'village' ? stockCap() : opStockCap(s.op);
  if (Math.floor(s.stock.iron || 0) >= cap) return;                  // demir ambarı dolu
  const parti = Math.min(3, Math.floor((s.stock.scrap || 0) / 5));    // seferde en çok 3 külçe
  if (parti < 1) return;
  s.stock.scrap -= parti * 5;
  G.smeltT[s.id] = G.t + 9;
  for (let i = 0; i < parti * 2; i++)
    G.flyItems.push({ x0: s.anchor.x + rr(-14, 14), y0: s.anchor.y - 42, x1: oca.x + rr(-10, 10), y1: oca.y - 14, t: 0, icon: '🔩' });
  (G.smelts = G.smelts || []).push({ site: s.id, n: parti, t: 1.4, x: oca.x, y: oca.y, ax: s.anchor.x, ay: s.anchor.y });
}
// TÜCCARDAN ALIM: kese doluyken bir işin kaynağı eksik kaldıysa kervan altın
// götürüp malı getirir. Satış tek yönlüydü; "2970 altın var ama karakol 60 odun
// eksik olduğu için Sv.1'de bekliyor" durumu buradan çıkmıştı.
const AL_FIYAT = { wood: 2.6, stone: 3.6, iron: 9 };   // tüccarın satış fiyatı (birim başına 🪙)
function autoAl(s) {
  if (VISIT || ISLAND || G.caveRun || G.dead) return false;
  G.carCd = G.carCd || {};
  if ((G.carCd[s.id] || 0) > G.t) return false;
  if (G.caravans.some(c => c.fromSite === s.id)) return false;
  const cap = s.id === 'village' ? stockCap() : opStockCap(s.op);
  const bekleyen = bekleyenIhtiyac(s);
  let k = null, eksik = 0;
  for (const [kk, v] of Object.entries(bekleyen)) {
    if (!AL_FIYAT[kk]) continue;
    const e = v - Math.floor(s.stock[kk] || 0);
    if (e > eksik) { eksik = e; k = kk; }
  }
  if (!k || eksik < 10) return false;
  const adet = Math.min(80, Math.max(20, eksik), Math.floor(cap * 0.6));
  const bedel = Math.ceil(adet * AL_FIYAT[k]);
  if (Math.floor(G.res.gold || 0) < bedel + 120) return false;   // kese tamamen boşalmasın
  G.res.gold -= bedel;
  G.carCd[s.id] = G.t + 55;
  const A = s.anchor;
  const icon = (RES_DEF.find(r => r[0] === k) || ['', ''])[1];
  G.caravans.push({
    caravan: true, trade: true, buy: true, fromSite: s.id, res: k, amount: adet, gold: bedel, icon, leg: 0,
    x: A.x, y: A.y + 40, hp: 280, maxHp: 280, dir: 0, walk: 0, flash: 0,
    from: siteName(s.id).replace(' Karakolu', ''), toName: 'Tüccar',
    pts: [[MERCHANT.x - 40, MERCHANT.y + 40]], i: 0,
  });
  toast('🐪 Alım kervanı: ' + siteName(s.id).replace(' Karakolu', '') + ' → Göçebe Tüccar (' + bedel + '🪙 → ' + adet + icon + ')');
  save();
  return true;
}
// Boştaki üs: ambarı %75+ dolu bir kaynağı, o kaynağa muhtaç başka bir üsse kervanla gönderir
function autoCaravan(s, sites) {
  if (VISIT || ISLAND || G.caveRun || G.dead) return;
  G.carCd = G.carCd || {};
  if ((G.carCd[s.id] || 0) > G.t) return;                       // aynı üs sürekli kervan yollamasın
  if (G.caravans.some(c => c.fromSite === s.id)) return;        // yoldaki kervanı bitirsin
  const cap = s.id === 'village' ? stockCap() : opStockCap(s.op);
  // YARDIM ÖNCE GELİR. Satış eşiği yardım eşiğinden düşük olunca (%55 / %75)
  // ambar hiç %75'e ulaşamıyor, kaynak tüccara gidiyor ve muhtaç üsse yardım
  // kervanı hiç çıkmıyordu. Artık ikisi de %75; satış YALNIZCA muhtaç üs yoksa
  // ya da altın gerçekten gerekliyse (aşağıda) devreye girer.
  const fazla = [];
  for (const [k] of RES_DEF) {
    if (k === 'gold' || k === 'gems') continue;                 // değerliler kervanla taşınmaz
    if (Math.floor(s.stock[k] || 0) >= cap * 0.75) fazla.push(k);
  }
  if (!fazla.length) return autoSat(s, cap);
  // en muhtaç üssü seç: ambarı %40'ın altında olan
  let hedef = null, enAz = 1e9;
  for (const t of sites) {
    if (t.id === s.id || !t.on) continue;
    const tcap = t.id === 'village' ? stockCap() : opStockCap(t.op);
    for (const k of fazla) {
      const tv = Math.floor(t.stock[k] || 0);
      if (tv < tcap * 0.4 && tv < enAz) { enAz = tv; hedef = { t, k, tcap }; }
    }
  }
  if (!hedef) return autoSat(s, cap);   // kimse muhtaç değil → fazlayı tüccara sat
  const k = hedef.k;
  const yuk = Math.min(80, Math.floor((s.stock[k] || 0) - cap * 0.5), hedef.tcap - Math.floor(hedef.t.stock[k] || 0));
  if (yuk < 10) return;                                          // küçük yük için kervan kaldırmaya değmez
  s.stock[k] -= yuk;
  G.carCd[s.id] = G.t + 45;
  const A = s.anchor, B = hedef.t.anchor;
  const icon = (RES_DEF.find(r => r[0] === k) || ['', ''])[1];
  G.caravans.push({
    caravan: true, supply: true, fromSite: s.id, toSite: hedef.t.id, res: k, amount: yuk, icon,
    x: A.x, y: A.y + 40, hp: 280, maxHp: 280, dir: 0, walk: 0, flash: 0,
    from: siteName(s.id).replace(' Karakolu', ''), toName: siteName(hedef.t.id).replace(' Karakolu', ''),
    pts: [[B.x, B.y + 30]], i: 0,
  });
  toast('🐴 Yardım kervanı: ' + siteName(s.id).replace(' Karakolu', '') + ' → ' + siteName(hedef.t.id).replace(' Karakolu', '') + ' (' + yuk + icon + ')');
  save();
}
// GÖÇEBE TÜCCARA SATIŞ: ambarı taşan ama kimsenin ihtiyacı olmayan kaynak parayla döner.
// Oto yönetimin altın açığını (köylü daveti, asker, sur) bu kapatır — köy kendi kendini finanse eder.
const SAT_FIYAT = { wood: 1.2, stone: 1.6, scrap: 2.2, iron: 6, meat: 5 };   // birim başına 🪙
// Bu üste BEKLEYEN ödemelerin kalan kısmı. Satış kervanı bunu ayırmazsa
// yükseltme için biriktirilen odunu tüccara götürüp işi sonsuza dek kilitliyor
// (yaşandı: karakol Sv.1'de takıldı, kasada 3400 altın vardı ama odun 0'dı).
function bekleyenIhtiyac(s) {
  const need = {};
  const ekle = (cost, paid) => {
    if (!cost) return;
    for (const [k, v] of Object.entries(cost)) {
      const kalan = v - ((paid || {})[k] || 0);
      if (kalan > 0) need[k] = (need[k] || 0) + kalan;
    }
  };
  const sahip = s.id === 'village' ? null : s.id;
  if (s.op) {
    if ((s.op.lv || 1) < 3) ekle(bcost(OUTPOST_UPG[s.op.lv || 1]), s.op.lvPaid);   // sıradaki karakol seviyesi
    if (!s.op.wall && OP_WALL_SITES.includes(s.id)) ekle(bcost(OP_WALL.cost), s.op.wallPaid);
  } else if (G.villageTier < 1 + EXPANSIONS.length) {
    ekle(bcost(EXPANSIONS[G.villageTier - 1].cost), G.autoExpPaid);
  }
  for (const pl of G.plots)                       // başlamış şantiyeler
    if (!pl.built && pl.paid && (pl.outpost || null) === sahip && BUILDINGS[pl.plan]) ekle(bcost(BUILDINGS[pl.plan].cost), pl.paid);
  for (const b of G.buildings) {                  // başlamış onarım/yükseltmeler
    if ((b.outpost || null) !== sahip) continue;
    if (b.ruined && b.repPaid) ekle(bcost(repairCost(b.type)), b.repPaid);
    if (b.upPaid) ekle(bcost(nextUpCost(b)), b.upPaid);
    if (b.fixPaid) ekle(bcost(fixCost(b)), b.fixPaid);
  }
  return need;
}
function autoSat(s, cap) {
  // ALTIN GEREKİYOR MU? Sıradaki iş altın istiyorsa (karakol seviyesi, sur,
  // köylü daveti, asker) daha düşük eşikten satarız; istemiyorsa yalnız gerçek
  // taşma (%75) satılır ki yardım kervanına kaynak kalsın.
  const bekleyen = bekleyenIhtiyac(s);
  const altinLazim = (bekleyen.gold || 0) > Math.floor(G.res.gold || 0)
    || (G.res.gold || 0) < VILLAGER_COST.gold * 2;
  const esik = altinLazim ? 0.55 : 0.75;
  const satilir = [];
  for (const [k] of RES_DEF) {
    if (!SAT_FIYAT[k]) continue;
    if (Math.floor(s.stock[k] || 0) >= cap * esik) satilir.push(k);
  }
  if (!satilir.length) return;
  // en çok biriken kaynağı sat
  let k = satilir[0];
  for (const k2 of satilir) if ((s.stock[k2] || 0) > (s.stock[k] || 0)) k = k2;
  const ayrilan = bekleyenIhtiyac(s)[k] || 0;    // yükseltme/inşaat için sözü verilmiş miktar
  const yuk = Math.min(90, Math.floor((s.stock[k] || 0) - cap * 0.5 - ayrilan));
  if (yuk < 10) return;
  const kazanc = Math.max(1, Math.round(yuk * SAT_FIYAT[k]));
  s.stock[k] -= yuk;
  G.carCd[s.id] = G.t + 55;
  const A = s.anchor;
  const icon = (RES_DEF.find(r => r[0] === k) || ['', ''])[1];
  G.caravans.push({
    caravan: true, trade: true, fromSite: s.id, res: k, amount: yuk, gold: kazanc, icon, leg: 0,
    x: A.x, y: A.y + 40, hp: 280, maxHp: 280, dir: 0, walk: 0, flash: 0,
    from: siteName(s.id).replace(' Karakolu', ''), toName: 'Tüccar',
    pts: [[MERCHANT.x - 40, MERCHANT.y + 40]], i: 0,
  });
  toast('🐪 Satış kervanı: ' + siteName(s.id).replace(' Karakolu', '') + ' → Göçebe Tüccar (' + yuk + icon + ' → ' + kazanc + '🪙)');
  save();
}
// Her yerleşke kendi kendini besler: bir köylü/garnizon kendi üssünün ambarından yer,
// başka yerleşkenin ambarıyla işi olmaz. (Köy ayrıca oyuncunun cebinden de yiyebilir.)
const siteStock = sid => (!sid || sid === 'village') ? G.stock : ((G.outposts[sid] && G.outposts[sid].stock) || {});
function siteEat(sid, n) {                       // n adet et tüket, yiyebildiğini döndür
  const st = siteStock(sid);
  let yendi = Math.min(n, Math.floor(st.meat || 0));
  st.meat = (st.meat || 0) - yendi;
  if (ISLAND && (!sid || sid === 'village') && yendi > 0) {
    const sa = G.islOps.stockAdd = G.islOps.stockAdd || {}; sa.meat = (sa.meat || 0) - yendi;
  }
  if (yendi < n && (!sid || sid === 'village')) { // köyde cep de sayılır
    const cep = Math.min(n - yendi, Math.floor(G.res.meat || 0));
    G.res.meat -= cep; yendi += cep;
  }
  return yendi;
}
const siteAc = sid => siteEat(sid, 0) === 0 && Math.floor(siteStock(sid).meat || 0) <= 0
  && ((sid && sid !== 'village') || Math.floor(G.res.meat || 0) <= 0);
// Yeni köylüye meslek: üste EN AZ bulunan iş verilir (hepsi oduncu olmasın).
// Eşitlikte sözlük sırası (odun → taş → hurda) korunur, böylece ilk köylü hep oduncudur.
// Bir üste ikinci kez kurulmasının anlamı olmayan binalar (üretim yapmaz, sadece kilit açar).
// Kereste/avcı/ambar/kule çoğaltılabilir; demirci/kışla/atölye ikincisi ölü arsa demektir.
const UNIQ_BLD = ['blacksmith', 'barracks', 'siege'];
const sitesahip = b => (b.outpost || null);
const varMi = (type, sahip) => G.buildings.some(b => b.type === type && !b.ruined && sitesahip(b) === sahip);
// Aynı üste iki demirci düşmüşse (eski kayıt / plan çakışması) fazlası ambara çevrilir —
// arsa ölü kalmaz, seviye korunur, bina yıkılmaz.
function dedupeUnique() {
  const gorulen = {};
  let degisti = 0;
  for (const b of G.buildings) {
    if (!UNIQ_BLD.includes(b.type) || b.ruined) continue;
    const k = (b.outpost || 'village') + '|' + b.type;
    if (!gorulen[k]) { gorulen[k] = b; continue; }
    const eski = gorulen[k];
    const fazla = (b.lv || 1) > (eski.lv || 1) ? eski : b;      // yüksek seviyeli olan kalır
    if (fazla === eski) gorulen[k] = b;
    const ad = BUILDINGS[fazla.type].name;
    fazla.type = 'depot';
    const pl = G.plots.find(p => Math.abs(p.x - fazla.x) < 6 && Math.abs(p.y - fazla.y) < 6);
    if (pl) { pl.plan = 'depot'; pl.built = 'depot'; }
    degisti++;
    toast('🏚️ Fazladan ' + ad + ' vardı — ambara çevrildi (' + siteName(fazla.outpost || 'village').replace(' Karakolu', '') + ')');
  }
  if (degisti) save();
}
// Yemek her yerleşkede yerel üretildiğinden (v4.2) et kaynağı olmayan üs açlıktan
// kilitleniyor. Eski kayıtlarda avcı kulübesi planı hiç yoktu: ilk boş arsayı avcıya
// çevir; boş arsa yoksa yenisini aç.
function ensureHunters() {
  for (const [sid, op] of Object.entries(G.outposts)) {
    if (!op || !op.owned || op.looted || op.isVillage || !OUTPOSTS[sid]) continue;
    const varMi2 = G.buildings.some(b => b.type === 'hunter' && !b.ruined && b.outpost === sid)
      || G.plots.some(p => p.outpost === sid && !p.built && p.plan === 'hunter');
    if (varMi2) continue;
    const bos = G.plots.find(p => p.outpost === sid && !p.built);
    if (bos) bos.plan = 'hunter';
    else if (opAddPlots(sid, G.plots.filter(p => p.outpost === sid).length + 1)) {
      const yeni = G.plots.filter(p => p.outpost === sid).pop();
      if (yeni) yeni.plan = 'hunter';
    }
  }
}
function eksikMeslek(siteId) {
  const sahip = siteId === 'village' ? null : siteId;
  const sayim = {};
  for (const jk of Object.keys(VILLAGER_JOBS)) sayim[jk] = 0;
  for (const b of G.buildings)
    if (b.type === 'house' && b.villager && b.job && (b.outpost || null) === sahip && sayim[b.job] !== undefined) sayim[b.job]++;
  let en = 'wood';
  for (const jk of Object.keys(VILLAGER_JOBS)) if (sayim[jk] < sayim[en]) en = jk;
  return en;
}
function autoSite(s) {
  const R = s.id === 'village' ? palR() + 300 : 340;
  const near = o => dist(o.x, o.y, s.anchor.x, s.anchor.y) < R;
  // 1) yıkık bina onarımı
  for (const b of G.buildings) {
    if (!b.ruined || !BUILDINGS[b.type] || !near(b)) continue;
    b.repPaid = b.repPaid || {};
    const r1 = autoPayFly(s, bcost(repairCost(b.type)), b.repPaid, b.x, b.y);
    if (r1 === 2) {
      delete b.repPaid; b.ruined = false; b.hp = b.maxHp;
      SFX.build(); autoSay(s.id, BUILDINGS[b.type].name + ' onarıldı 🔧'); save();
    }
    if (r1) return true;
  }
  // 1b) HASARLI (ama ayakta) bina tamiri — kapılardaki gibi 60 sn'lik bina başına sayaçla
  for (const b of G.buildings) {
    if (!bldHurt(b) || !near(b) || b.hp > b.maxHp * 0.9) continue;
    if ((b.outpost || null) !== (s.id === 'village' ? null : s.id)) continue;
    if (!gateReady(bldKey(b))) continue;
    b.fixPaid = b.fixPaid || {};
    const rf = autoPayFly(s, bcost(fixCost(b)), b.fixPaid, b.x, b.y);
    if (rf === 2) {
      delete b.fixPaid; b.hp = b.maxHp; gateUsed(bldKey(b));
      spawnParts(b.x, b.y - 30, 8, { colors: ['#cfe0ff', '#9ab0d0'], v: 45, life: 0.6, g: 60 });
      SFX.build(); autoSay(s.id, BUILDINGS[b.type].name + ' tamir edildi 🔧'); save();
    }
    if (rf) return true;
  }
  // 2) KAPILAR: kırık olan hemen onarılır, hasarlısı (%70 altı) beklemeden tamir edilir
  if (s.id === 'village' && G.palisade.built) {
    const gt = G.palisade.gate;
    if ((!gt.alive || gt.hp < gt.maxHp * 0.7) && gateReady('village')) {
      const kirikti = !gt.alive;
      G.autoGatePaid = G.autoGatePaid || {};
      const r2 = autoPayFly(s, bcost(PAL.repair), G.autoGatePaid, PAL_GATE.x, PAL_GATE.y);
      if (r2 === 2) {
        G.autoGatePaid = {}; gt.hp = gt.maxHp; gt.alive = true; gateUsed('village');
        SFX.build(); autoSay('village', kirikti ? 'köy kapısı onarıldı 🚪' : 'köy kapısı tamir edildi 🔧'); save();
      }
      if (r2) return true;
    }
  }
  if (s.op && s.op.wall) { // karakol sur kapısı: kırık ya da yıpranmış
    const owg = G.structures.find(x2 => x2.kind === 'owgate' && x2.site === s.id);
    if (owg && (!owg.alive || owg.hp < owg.maxHp * 0.7) && gateReady(s.id)) {
      const kirikti2 = !owg.alive;
      s.op.gatePaid = s.op.gatePaid || {};
      const r3 = autoPayFly(s, bcost(OP_WALL.repair), s.op.gatePaid, owg.x, owg.y);
      if (r3 === 2) {
        delete s.op.gatePaid; owg.alive = true; owg.hp = owg.maxHp; s.op.wallGateHp = owg.maxHp; gateUsed(s.id);
        SFX.build(); autoSay(s.id, kirikti2 ? 'sur kapısı onarıldı 🚪' : 'sur kapısı tamir edildi 🔧'); save();
      }
      if (r3) return true;
    }
  }
  if (s.op && (s.id === 'fort' || s.id === 'legion')) { // fethedilen kalenin kendi kapısı
    const og = G.structures.find(x2 => x2.kind === (s.id === 'fort' ? 'gate' : 'lgate'));
    if (og && (!og.alive || og.hp < og.maxHp * 0.7) && gateReady(s.id + '_kale')) {
      const kirikti3 = !og.alive;
      s.op.kgPaid = s.op.kgPaid || {};
      const c5 = bcost(s.id === 'fort' ? { wood: 60, stone: 40 } : { stone: 80, iron: 12 });
      const r5 = autoPayFly(s, c5, s.op.kgPaid, og.x, og.y);
      if (r5 === 2) {
        delete s.op.kgPaid; og.alive = true; og.hp = og.maxHp; gateUsed(s.id + '_kale');
        SFX.build(); autoSay(s.id, kirikti3 ? 'kale kapısı onarıldı 🚪' : 'kale kapısı tamir edildi 🔧'); save();
      }
      if (r5) return true;
    }
  }
  // 2b) SUR KARARI: baskınlar başladıysa (gün 2+ ya da bir baskın atlatıldıysa) savunma öncelikli
  if (s.id === 'village' && !G.palisade.built && !VISIT && !ISLAND && (G.day >= 2 || G.raidsSurvived > 0)) {
    G.autoPalPaid = G.autoPalPaid || {};
    const r6 = autoPayFly(s, bcost(PAL.cost), G.autoPalPaid, CAMPFIRE.x + palR() * 0.7, CAMPFIRE.y);
    if (r6 === 2) {
      G.autoPalPaid = {};
      G.palisade.built = true;
      G.palisade.gate.maxHp = PAL.gateHp; G.palisade.gate.hp = PAL.gateHp; G.palisade.gate.alive = true;
      rebuildPalisade();
      SFX.build(); banner('🪵 KÖY SURU DİKİLDİ!'); autoSay('village', 'köy suru dikildi 🪵 — geceler artık daha güvenli'); save();
    }
    if (r6) return true;
  }
  // 2c) TAŞ SUR: baskınlar sertleştiyse ahşap çit yetmez — bu noktada inşaattan önceliklidir
  if (s.id === 'village' && G.palisade.built && G.palisade.lv < 2 && !VISIT && !ISLAND
      && (G.raidsSurvived >= 2 || G.day >= 7)) {
    G.autoPal2Paid = G.autoPal2Paid || {};
    const r9 = autoPayFly(s, bcost(PAL2.cost), G.autoPal2Paid, CAMPFIRE.x + palR() * 0.7, CAMPFIRE.y);
    if (r9 === 2) {
      G.autoPal2Paid = {};
      G.palisade.lv = 2;
      G.palisade.gate.maxHp = PAL2.gateHp; G.palisade.gate.hp = PAL2.gateHp; G.palisade.gate.alive = true;
      rebuildPalisade();
      SFX.upgrade(); banner('🏰 TAŞ SUR YÜKSELDİ!'); autoSay('village', 'sur taşa çevrildi 🏰 (kapı 500 → 1200)'); save();
    }
    if (r9) return true;
  }
  // karakola çit: ancak arsalar dolduktan SONRA (önce ev + gözcü kulesi, sur en pahalı iş)
  if (s.op && !s.op.wall && OP_WALL_SITES.includes(s.id) && !VISIT && !ISLAND
      && !G.plots.some(p2 => p2.outpost === s.id && !p2.built)) {
    s.op.wallPaid = s.op.wallPaid || {};
    const r7 = autoPayFly(s, bcost(OP_WALL.cost), s.op.wallPaid, s.anchor.x, s.anchor.y + 60);
    if (r7 === 2) {
      delete s.op.wallPaid;
      s.op.wall = 1; s.op.wallGateHp = OP_WALL.gateHp;
      rebuildOutpostWalls();
      SFX.build(); autoSay(s.id, 'karakol suru dikildi 🪵'); save();
    }
    if (r7) return true;
  }
  // 3) şantiye: planlı boş arsa inşaatı
  for (const pl of G.plots) {
    if (pl.built || !pl.plan || !near(pl)) continue;
    if ((pl.outpost || null) !== (s.id === 'village' ? null : s.id)) continue;
    // aynı üste ikinci demirci/kışla/atölye kurulmaz: arsa ambara çevrilir
    if (UNIQ_BLD.includes(pl.plan) && varMi(pl.plan, pl.outpost || null)) { pl.plan = 'depot'; delete pl.paid; }
    const B = BUILDINGS[pl.plan];
    if (B.req && !G.built[B.req]) continue;
    pl.paid = pl.paid || {};
    const r4 = autoPayFly(s, bcost(B.cost), pl.paid, pl.x, pl.y);
    if (r4 === 2) { constructAt(pl); autoSay(s.id, B.name + ' inşa edildi 🏗️'); }
    if (r4) return true;
  }
  // 4) köylü davet + iş ver (boş ev, cepten altın — depo akışından bağımsız)
  for (const b of G.buildings) {
    if (b.type !== 'house' || b.villager || b.ruined || !near(b)) continue;
    if ((b.outpost || null) !== (s.id === 'village' ? null : s.id)) continue;
    if (!canAfford(VILLAGER_COST)) break;
    pay(VILLAGER_COST); b.villager = true; b.job = eksikMeslek(s.id);
    autoSay(s.id, 'yeni köylü davet edildi 👤 (' + VILLAGER_JOBS[b.job].name.toLowerCase() + ')'); save();
    return true;
  }
  // 5) garnizon askeri eğit (cepten altın+demir)
  const op2 = s.id === 'village' ? G.outposts.village : s.op;
  if (op2 && G.built.barracks && op2.garrison < garrisonCap(op2)) {
    const sc2 = SOLDIER_CLS.sword;
    if (canAfford(sc2.cost)) {
      pay(sc2.cost);
      op2.garrison++;
      (op2.garrisonCls = op2.garrisonCls || []).push({ cls: 'sword', lv: 1, xp: 0 });
      addGarrisonUnit(s.id, 'sword');
      autoSay(s.id, 'garnizona asker katıldı 🗡️ (' + op2.garrison + '/' + garrisonCap(op2) + ')'); save();
      return true;
    }
  }
  // 5b) KARAKOLU GÜÇLENDİR (Sv.1→3): vergi +%50, garnizon +2, alan genişler,
  //     yeni arsalar açılır. Bu adım hiç yoktu — karakol kendi kendine asla
  //     seviye atlamıyordu, kullanıcı "kaynağı var ama güçlendirmiyor" dedi.
  //     Arsalar dolmadan ve (kazık surlu üste) sur dikilmeden sıra buraya gelmez.
  if (s.op && (s.op.lv || 1) < 3 && !VISIT && !ISLAND
      && !G.plots.some(p2 => p2.outpost === s.id && !p2.built)
      && (!OP_WALL_SITES.includes(s.id) || s.op.wall)) {
    const uc = bcost(OUTPOST_UPG[s.op.lv || 1]);
    s.op.lvPaid = s.op.lvPaid || {};
    const r8 = autoPayFly(s, uc, s.op.lvPaid, s.anchor.x, s.anchor.y - 30);
    if (r8 === 2) {
      delete s.op.lvPaid;
      s.op.lv = (s.op.lv || 1) + 1;
      const bn = G.structures.find(x => x.kind === 'banner' && x.site === s.id);
      if (bn) { bn.maxHp = outpostBannerHp(s.op.lv); bn.hp = bn.maxHp; }
      if (s.op.wall) rebuildOutpostWalls();
      if (KEEP_SITES.includes(s.id)) rebuildKeepWalls();
      const yeniArsa = opAddPlots(s.id, OUTPOST_PLOT_N[Math.min(3, s.op.lv)]);
      spawnParts(s.anchor.x, s.anchor.y - 40, 14, { colors: ['#ffd257', '#fff3c9'], v: 45, life: 1.1, g: -25 });
      SFX.upgrade();
      autoSay(s.id, 'karakol Sv.' + s.op.lv + ' oldu 🏳️' + (yeniArsa ? ' · +' + yeniArsa + ' arsa, alan genişledi' : ''));
      save();
    }
    if (r8) return true;
  }
  // 6) bina yükseltme (oyuncu başındaysa karışma)
  for (const b of G.buildings) {
    if (!near(b) || b.ruined) continue;
    if ((b.outpost || null) !== (s.id === 'village' ? null : s.id)) continue;
    const c = nextUpCost(b);
    if (!c || dist(G.player.x, G.player.y, b.x, b.y) < 110) continue;
    b.upPaid = b.upPaid || {};
    const r5 = autoPayFly(s, bcost(c), b.upPaid, b.x, b.y);
    if (r5 === 2) { applyUpgrade(b); autoSay(s.id, BUILDINGS[b.type].name + ' yükseltildi ⬆️'); }
    if (r5) return true;
  }
  // 7) köy genişletme (ambar + cep altını yeterse)
  if (s.id === 'village' && !VISIT && !ISLAND && G.villageTier < 1 + EXPANSIONS.length) {
    const ex = EXPANSIONS[G.villageTier - 1];
    G.autoExpPaid = G.autoExpPaid || {};
    if (autoPayFly(s, bcost(ex.cost), G.autoExpPaid, CAMPFIRE.x, CAMPFIRE.y - 30) === 2) {
      G.autoExpPaid = {};
      G.villageTier++; addExpansionPlots(G.villageTier); rebuildPalisade();
      SFX.build(); banner('KÖY GENİŞLEDİ! (oto)'); autoSay('village', 'köy genişletildi 🏗️'); save();
    }
  }
  return false; // bu üste yapacak iş kalmadı
}
// Terfi: XP dolu + altın ödendi → rütbe atlar (manuel — Ordu panelinden)
function promoteSoldier(u) {
  const lv = u.lv || 1;
  if (lv >= SOLDIER_LV_MAX) return;
  const need = sXpNeed(lv), cost = sPromoteCost(lv);
  if ((u.xp || 0) < need || G.res.gold < cost) { SFX.no(); return; }
  pay({ gold: cost });
  u.xp -= need; u.lv = lv + 1; u.promoNoted = false;
  soldierRecalc(u); u.hp = u.maxHp;
  spawnParts(u.x, u.y - 26, 12, { colors: ['#ffd257', '#fff3c9', '#c9a8f0'], v: 50, life: 0.9, g: -26 });
  SFX.upgrade();
  toast('🎖️ Terfi: ' + SOLDIER_CLS[u.cls || 'sword'].name + ' artık ' + soldierRank(u) + ' (Sv.' + u.lv + ') — +14❤ +2⚔');
  save();
}
// Kara Vulkar'ın çetesi
function spawnRivalBand() {
  if (!G.rival.alive) return;
  const R = G.rival;
  const want = Math.min(3 + Math.floor(G.day / 3), 8);
  let count = G.enemies.filter(e => e.camp === 'rival').length;
  if (!G.enemies.some(e => e.type === 'rivallord')) { spawnEnemy('rivallord', R.x, R.y, 'rival'); count++; }
  const hasShaman = G.enemies.some(e => e.camp === 'rival' && e.type === 'shaman');
  while (count < want) {
    const r2 = rng();
    const t2 = (!hasShaman && want >= 5 && count === want - 1) ? 'shaman'
      : r2 < 0.4 ? 'barb' : r2 < 0.65 ? 'archer' : r2 < 0.85 ? 'shieldbarb' : 'brute';
    spawnEnemy(t2, R.x + rr(-60, 60), R.y + rr(-60, 60), 'rival');
    count++;
  }
}

// ---------- Görevler ----------
const QUESTS = [
  { text: '10 odun topla 🪵', done: () => G.res.wood >= 10 || G.built.sawmill, target: () => nearestNode('tree') },
  { text: 'Bıçkıhane inşa et', done: () => !!G.built.sawmill, target: () => plotFor('sawmill') },
  { text: 'Demirci inşa et (taş için kayaları kır)', done: () => !!G.built.blacksmith, target: () => canAfford(BUILDINGS.blacksmith.cost) ? plotFor('blacksmith') : nearestNode('rock') },
  { text: 'Hurda topla ve 1 demir erit (Demirci)', done: () => G.res.iron >= 1 || G.swordLv > 0, target: () => G.res.scrap >= 5 ? buildingPos('blacksmith') : nearestNode('scrap') },
  { text: 'Bir kuşam parçası kuşan (düşmanlar düşürür — 🎒 çanta)', done: () => Object.keys(G.equip).length > 0 || G.bag.length > 0, target: () => nearestNode('scrap') || buildingPos('blacksmith') },
  { text: 'Kışla kur ve 2 asker eğit', done: () => G.soldiersOwned >= 2, target: () => G.built.barracks ? buildingPos('barracks') : plotFor('barracks') },
  { text: 'Barbar kampının totemini yok et', done: () => G.camp1Destroyed || !!G.outposts.camp1, target: () => ({ x: CAMP1.x, y: CAMP1.y }) },
  { text: 'Köylü Evi kur, köylü davet et ve iş ver', done: () => G.buildings.some(b => b.type === 'house' && b.villager && b.job), target: () => G.buildings.find(b => b.type === 'house') || plotFor('house') },
  { text: 'Gözcü Kulesi kur — geceleri baskın var!', done: () => !!G.built.watchtower, target: () => plotFor('watchtower') },
  { text: 'Köy suru inşa et (Köy Konağı menüsü)', done: () => G.palisade.built, target: () => ({ x: CAMPFIRE.x, y: CAMPFIRE.y }) },
  { text: 'İlk gece baskınını savuştur', done: () => G.raidsSurvived >= 1, target: () => ({ x: CAMPFIRE.x, y: CAMPFIRE.y }) },
  { text: 'Kuşatma Atölyesi kur', done: () => !!G.built.siege, target: () => plotFor('siege') },
  // ARA ADIM GÖREVLERİ HEDEFE DE BAKAR: kaleyi mancınıksız (sızma sabotajı,
  // koçbaşı, başka bir yolla) alan oyuncuda bu görev sonsuza dek asılı kalıyordu
  // — üstelik fetihten sonra kuşatma kampı kapandığı için artık kurulamıyor da.
  { text: 'Kale önündeki ⚔️ kampta mancınık kur (kaynak götür!)',
    done: () => !!(G.sieges.fort.catapult && G.sieges.fort.catapult.done) || G.chestOpened || !!G.outposts.fort,
    target: () => SIEGE_SITES[0] },
  { text: 'Taş kaleyi fethet! (kapı kırılınca ganimet sandığını aç)', done: () => G.chestOpened || !!G.outposts.fort, target: () => {
      const g = G.structures.find(s2 => s2.kind === 'gate');
      if (g && g.alive) return { x: FORT.x0, y: (FORT.gateY0 + FORT.gateY1) / 2 };
      const c = G.structures.find(s2 => s2.kind === 'chest');
      return c && c.alive ? c : { x: FORT.cx, y: FORT.cy }; // kapı kırıldı → ok sandığa
    } },
  { text: 'Lejyon kapısı önündeki ⚔️ kampta koçbaşı kur',
    done: () => !!(G.sieges.legion.ram && G.sieges.legion.ram.done) || G.legionConquered || !!G.outposts.legion,
    target: () => SIEGE_SITES[1] },
  { text: 'Lejyon karargâhını fethet! (çelik kapı kırılınca büyük sandığı aç)', done: () => G.legionConquered || !!G.outposts.legion, target: () => {
      const g = G.structures.find(s2 => s2.kind === 'lgate');
      if (g && g.alive) return { x: LEG.cx, y: LEG.y1 };
      const c = G.structures.find(s2 => s2.kind === 'chest2');
      return c && c.alive ? c : { x: LEG.cx, y: LEG.cy }; // ok büyük sandığa
    } },
];
function nearestNode(kind) {
  let best = null, bd = 1e9;
  for (const n of G.nodes) if (n.kind === kind && n.alive) { const d = dist(G.player.x, G.player.y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  return best;
}
function emptyPlot() { return G.plots.find(p => !p.built) || null; }
function plotFor(type) { return G.plots.find(p => !p.built && p.plan === type) || emptyPlot(); }
function buildingPos(type) { return G.buildings.find(b => b.type === type) || null; }
function checkQuests() {
  let advanced = false;
  while (G.questIdx < QUESTS.length) {
    // EMNİYET KEMERİ: sıradaki görev tamam değilse bile, DAHA SONRAKİ bir görev
    // tamamlanmışsa bu adım geçilir. Oyuncu bir aşamayı beklenmedik bir yoldan
    // aştığında (kaleyi mancınık kurmadan almak gibi) görev zinciri sonsuza dek
    // asılı kalıyordu — üstelik o adımı geri dönüp yapmak da mümkün olmuyor.
    const simdi = QUESTS[G.questIdx].done();
    if (!simdi) {
      let ilerisi = false;
      for (let i = G.questIdx + 1; i < QUESTS.length; i++) if (QUESTS[i].done()) { ilerisi = true; break; }
      if (!ilerisi) break;
    }
    G.questIdx++;
    advanced = true;
    if (simdi) { SFX.upgrade(); addXp(40, G.player.x, G.player.y - 50); }
    if (G.questIdx < QUESTS.length) toast('Yeni görev: ' + QUESTS[G.questIdx].text);
  }
  if (advanced) markRumors();
}
// Aktif görevin hedefi bilinmeyen bir lokasyondaysa haritaya "söylenti" olarak düşer
function markRumors() {
  if (G.questIdx >= QUESTS.length) return;
  const q = QUESTS[G.questIdx];
  const t = q.target && q.target();
  if (!t) return;
  for (const L of LOCATIONS) {
    if (!G.discovered[L.id] && dist(t.x, t.y, L.x, L.y) < 420) {
      G.discovered[L.id] = 1;
      toast('🗺️ Söylenti: ' + L.name + ' haritana işlendi');
    }
  }
}

// ---------- Kaynak & maliyet ----------
function canAfford(cost) { return Object.entries(cost).every(([k, v]) => G.res[k] >= v); }
function pay(cost) { for (const [k, v] of Object.entries(cost)) G.res[k] -= v; }
function gain(res, x, y) {
  for (const [k, v] of Object.entries(res)) {
    if (!v) continue;
    G.res[k] += v;
    // ziyarette toplanan her şey (değerliler hariç) ayrılırken ev sahibinin deposuna bırakılır
    if (VISIT && v > 0 && k !== 'gems' && G.helpFx) G.helpFx.don[k] = (G.helpFx.don[k] || 0) + v;
    const icon = RES_DEF.find(r => r[0] === k)[1];
    addFloater(x + rr(-10, 10), y - 20, `+${v} ${icon}`, '#ffe9a8');
    flashChip(k);
  }
}

// ---------- UI: DOM ----------
const $ = id => document.getElementById(id);
const elRes = $('res'), elQuestText = $('questText'), elPrompt = $('prompt'), elToasts = $('toasts'),
  elBanner = $('banner'), elPanel = $('panel'), elPanelTitle = $('panelTitle'), elPanelBody = $('panelBody'),
  elHpFill = $('hpFill'), elHpText = $('hpText'), elBtnInteract = $('btnInteract'), elDeath = $('deathOverlay'),
  elClock = $('clock');
const chipEls = {};
for (const [k, icon] of RES_DEF) {
  const c = document.createElement('div'); c.className = 'chip'; c.innerHTML = `<span>${icon}</span><span id="chip-${k}">0</span>`;
  elRes.appendChild(c); chipEls[k] = c;
}
function flashChip(k) { chipEls[k].classList.remove('flash'); void chipEls[k].offsetWidth; chipEls[k].classList.add('flash'); }
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  elToasts.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function banner(msg) { elBanner.textContent = msg; elBanner.classList.remove('show'); void elBanner.offsetWidth; elBanner.classList.add('show'); }
// Kenar butonlarında "burada yapacak iş var" bildirimi (kırmızı zıplayan top)
function hudDot(id, aktif) {
  const b = $(id);
  if (!b) return;
  const d = b.querySelector('.hudDot');
  if (aktif && !d) { const s = document.createElement('span'); s.className = 'hudDot'; b.appendChild(s); }
  else if (!aktif && d) d.remove();
}
// Bu kadronun çantada bekleyen daha iyi bir parçası var mı? (rozetler tek kaynaktan beslenir)
function gearBetterFor(eq) {
  eq = eq || {};
  return G.bag.some(it => {
    const sk = GEAR_BASES[it.b].slot;
    return gearScore(it) > (eq[sk] ? gearScore(eq[sk]) : -1);
  });
}
function refreshHudDots() {
  if (MENU_OPEN || G.infil) return;
  // 🎒 Çanta: çantada kuşandığından daha iyi bir parça var mı (oyuncu + komutanlar)
  const daha = [G.equip].concat(G.commanders.map(c => c.gear || {})).some(gearBetterFor);
  hudDot('btnBag', daha);
  // 🎖️ Ordu: terfi bekleyen asker (XP dolu + altın yeter) ya da görevsiz komutan
  const terfi = G.soldiers.concat(G.garrisonUnits).some(u => {
    const lv = u.lv || 1;
    return lv < SOLDIER_LV_MAX && (u.xp || 0) >= sXpNeed(lv) && G.res.gold >= sPromoteCost(lv);
  });
  hudDot('btnArmy', terfi);
  // 🌍 Cihan: yeni sefere çıkılabilir
  hudDot('btnWorld', !!G.victoryShown && !VISIT && !ISLAND);
  // 🤝 Yoldaşlar: çevrimiçi değilsen davet, çevrimiçiysen ziyaret edilebilir yoldaş
  const yoldas = !NETP ? false : (G.netFriends || []).some(f => f.has_village && (BAL.visitSec - (f.used || 0)) > 60);
  hudDot('btnFriends', yoldas && !VISIT && !ISLAND);
  // 🗺️ Harita: yerde yaralı yoldaş var (haritada kırmızı nabızla işaretli)
  hudDot('btnMap', G.wounded.length > 0 || G.props.some(pr => pr.kind === 'kneel'));
}
function updateHUD() {
  for (const [k] of RES_DEF) { const el = $('chip-' + k); const v = String(Math.floor(G.res[k])); if (el.textContent !== v) el.textContent = v; }
  const p = G.player;
  elHpFill.style.width = (100 * p.hp / p.maxHp) + '%';
  elHpText.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
  const nm = playerName() + ' · Sv.' + G.level;
  const elNm = $('playerName');
  if (elNm.textContent !== nm) elNm.textContent = nm;
  $('xpFill').style.width = Math.min(100, 100 * G.xp / xpNeed(G.level)) + '%';
  elQuestText.textContent = G.questIdx < QUESTS.length ? QUESTS[G.questIdx].text : 'Zafer! 🏔️ Köy Konağı → "Yeni bölgeye göç et" ile devam';
  let ct;
  if (G.night) {
    ct = '🌙 ' + (G.raidHappened ? 'BASKIN — köyünü koru!' : 'Gece') + ' · ' + Math.ceil(DAYLEN.night - G.dayT) + 'sn';
  } else {
    const kalan = DAYLEN.day - G.dayT;
    ct = '☀️ Gün ' + G.day + (kalan < 31 ? ' · gece ' + Math.ceil(kalan) + 'sn sonra' : '');
  }
  if (G.autoTravel) ct = '🧭 ' + G.autoTravel.name + ' yolunda · ' + ct;
  if (G.dynasty > 0) ct += ' · 👑' + G.dynasty;
  if (elClock.textContent !== ct) elClock.textContent = ct;
  elClock.classList.toggle('night', G.night);
  // ordu bilgisi: kapasite (eksik asker görünür) + komutanlar + esir/yaralı uyarıları
  const full = G.soldiers.length >= soldierCap();
  let ai = '<span class="cap' + (full ? ' full' : '') + '">🗡️ ' + G.soldiers.length + '/' + soldierCap() + '</span>';
  for (const c of G.commanders) ai += ' <span class="cmdTag">' + COMMANDERS[c.id].icon + 'Sv.' + c.lv + '</span>';
  for (const w of G.wounded) if (w.cmd) ai += '<br><span class="capTag">🩸 ' + COMMANDERS[w.cmd].name + ' yaralı!</span>';
  // teslim olmuş komutanlar: yanına gidip konuşulmayı bekliyorlar (haritada 🏳️)
  for (const pr of G.props) if (pr.kind === 'kneel' && COMMANDERS[pr.cmd])
    ai += '<br><span class="capTag">🏳️ ' + COMMANDERS[pr.cmd].name + ' teslim oldu — haritadan yerini bul</span>';
  for (const [st2, arr] of Object.entries(G.prisoners))
    for (const m of arr) if (m.cmd) ai += '<br><span class="capTag">🔒 ' + COMMANDERS[m.cmd].name + ' esir — zindan: ' + OUTPOSTS[st2].name.replace(' Karakolu', '') + '</span>';
  if (G.famine) ai += '<br><span class="capTag">🍖 ET BİTTİ — işçiler grevde' + (G.famineT > 45 ? ', ordu DAĞILIYOR!' : ', ordu aç!') + '</span>';
  const elAi = $('armyInfo');
  if (elAi.innerHTML !== ai) elAi.innerHTML = ai;
  // kaleye sız butonu: kuşatma kampı yakınında görünür, 60sn sayaçlı
  const elInf = $('btnInfil');
  const stI = nearSiegeSite();
  elInf.classList.toggle('hidden', !stI || !!G.infil);
  if (stI) {
    const cd = Math.ceil(G.infilCd || 0);
    // içeride yoldaş varsa buton kurtarma moduna geçer (zincir ikonu + nabız)
    const esirVar = !!infilPrisoner(stI.id);
    const label = cd > 0 ? cd + 's' : (esirVar ? '⛓️' : '🥷');
    if (elInf.textContent !== label) elInf.textContent = label;
    elInf.classList.toggle('rescue', esirVar && cd <= 0);
    elInf.disabled = cd > 0;
  }
}

// ---------- Panel ----------
function openPanel(thing) {
  G.panelFor = thing;
  elPanel.classList.remove('hidden');
  $('panelBack').classList.remove('hidden');
  elPanel.scrollTop = 0;
  renderPanel();
}
function closePanel() {
  G.panelFor = null;
  elPanel.classList.add('hidden');
  $('panelBack').classList.add('hidden');
}
// Boşluğa tıklama paneli kapatır (seçim bekleyen olay panelleri hariç)
$('panelBack').addEventListener('pointerdown', e => {
  e.stopPropagation(); e.preventDefault();
  if (G.panelFor && G.panelFor.event) return; // önce bir seçenek seçilmeli
  closePanel();
});
$('panelClose').addEventListener('click', closePanel);

function pitem(name, desc, cost, btnText, enabled, onClick) {
  const div = document.createElement('div'); div.className = 'pitem';
  const left = document.createElement('div');
  left.innerHTML = `<div class="pname">${name}</div>` + (desc ? `<div class="pdesc">${desc}</div>` : '') + (cost ? `<div class="pcost">${COST(cost)}</div>` : '');
  const btn = document.createElement('button'); btn.textContent = btnText; btn.disabled = !enabled;
  btn.addEventListener('click', () => { onClick(); renderPanel(); });
  div.appendChild(left); div.appendChild(btn);
  elPanelBody.appendChild(div);
}
function renderPanel() {
  if (!G.panelFor) return;
  if (elPanel.classList.contains('hidden')) elPanel.classList.remove('hidden');
  $('panelBack').classList.remove('hidden'); // doğrudan G.panelFor atanan yerlerde de katman açılsın
  elPanelBody.innerHTML = '';
  const th = G.panelFor;
  if (th.gearPage) { // 🎒 Kuşam & Çanta: Archero tarzı donatma (oyuncu + komutanlar)
    const who = th.gearPage, isP = who === 'player';
    const c = isP ? null : G.commanders.find(x => x.id === who);
    if (!isP && !c) { G.panelFor = { gearPage: 'player' }; renderPanel(); return; }
    const eq = isP ? G.equip : c.gear;
    elPanelTitle.textContent = '🎒 Kuşam & Çanta';
    // Sekmelerde de ❗ göster: hangi kahramanın çantasında daha iyisi bekliyor, tek bakışta belli olsun
    const tabRoz = eq2 => gearBetterFor(eq2) ? '<span class="tabBadge">!</span>' : '';
    let html = '<div class="gearTabs"><button class="gearTab' + (isP ? ' on' : '') + '" data-who="player">🧍 ' + playerName() + tabRoz(G.equip) + '</button>';
    for (const cc of G.commanders)
      html += '<button class="gearTab' + (who === cc.id ? ' on' : '') + '" data-who="' + cc.id + '">' + COMMANDERS[cc.id].icon + ' ' + COMMANDERS[cc.id].name + tabRoz(cc.gear) + '</button>';
    html += '</div>';
    // Kahraman vitrini: sol/sağ kuşam sütunları + merkez portre + isim plakası (çantada daha iyisi varsa ❗)
    const slotCell = sk => {
      const sname = GEAR_SLOTS[sk], it = eq[sk];
      const better = G.bag.some(it2 => GEAR_BASES[it2.b].slot === sk && gearScore(it2) > (it ? gearScore(it) : -1));
      return '<div class="gearSlot' + (it ? '' : ' empty') + '" data-slot="' + sk + '"' +
        (it ? ' style="border-color:' + RARITY[it.r].c + ';box-shadow:0 0 12px ' + RARITY[it.r].c + '77, inset 0 0 14px ' + RARITY[it.r].c + '33"' : '') + '>' +
        (better ? '<span class="slotBadge">!</span>' : '') +
        '<div class="gi">' + (it ? GEAR_BASES[it.b].icon : sname.split(' ')[0]) + '</div>' +
        '<div class="gn"' + (it ? ' style="color:' + RARITY[it.r].c + '"' : '') + '>' + (it ? RARITY[it.r].name : sname.split(' ')[1]) + '</div>' +
        (it ? '<div class="gs">' + gearStatText(it) + '</div>' : '') + '</div>';
    };
    const heroIcon = isP ? '💂' : COMMANDERS[c.id].icon;
    const heroName = isP ? playerName() : COMMANDERS[c.id].name;
    const heroTitle = isP ? 'Küllerden Doğan' : COMMANDERS[c.id].title || 'Komutan';
    html += '<div class="gearHero">';
    html += '<div class="gearCol">' + ['weapon', 'boots', 'ring'].map(slotCell).join('') + '</div>';
    html += '<div class="heroMid"><div class="heroPortrait">' + heroIcon + '</div>' +
      '<div class="heroPlaque"><div class="heroNm">' + heroName + '</div><div class="heroTi">' + heroTitle + '</div></div>' +
      '<div class="gearStats">' + (isP
        ? '⚔️ ' + playerAtk() + ' · ❤️ ' + playerMaxHp()
        : '⚔️ ' + c.tdmg + ' · ❤️ ' + c.maxHp + ' · ⭐ Sv.' + c.lv) + '</div></div>';
    html += '<div class="gearCol">' + ['armor', 'helmet', 'locket'].map(slotCell).join('') + '</div>';
    html += '</div>';
    html += '<div class="gearHead2">Çanta (' + G.bag.length + ') — eşyaya dokun: ' + (G.gearSalvage ? '<b style="color:#ff9a8a">ERİTİLİR (altın+hurda)</b>' : 'kuşanılır · slottakine dokun: çıkarılır') + '</div>';
    // kategori filtresi
    const gf = G.gearFilter || 'all';
    html += '<div class="gearFilter"><button class="gearFTab' + (gf === 'all' ? ' on' : '') + '" data-f="all">Tümü</button>';
    for (const [sk2, sname2] of Object.entries(GEAR_SLOTS))
      html += '<button class="gearFTab' + (gf === sk2 ? ' on' : '') + '" data-f="' + sk2 + '">' + sname2.split(' ')[0] + '</button>';
    html += '<span style="flex:1"></span>' +
      '<button id="gearAuto" class="gearFTab gearAutoBtn">⚡ Otomatik Giy</button>' +
      '<button id="gearSalv" class="gearFTab' + (G.gearSalvage ? ' on' : '') + '">🔥 Erit</button>' +
      '<button id="gearSalvAll" class="gearFTab gearSalvAllBtn">🔥 Hepsini Erit</button>';
    html += '</div>';
    html += '<div class="gearGrid">';
    const order = G.bag.map((it, i) => i)
      .filter(i => gf === 'all' || GEAR_BASES[G.bag[i].b].slot === gf)
      .sort((a, b) => G.bag[b].r - G.bag[a].r || gearScore(G.bag[b]) - gearScore(G.bag[a]));
    for (const i of order) {
      const it = G.bag[i], B = GEAR_BASES[it.b];
      html += '<div class="gearItem" data-i="' + i + '" style="border-color:' + RARITY[it.r].c + '">' +
        '<span class="gslot">' + GEAR_SLOTS[B.slot].split(' ')[0] + '</span>' +
        '<div class="gi">' + B.icon + '</div><div class="gn" style="color:' + RARITY[it.r].c + '">' + RARITY[it.r].name + '</div>' +
        '<div class="gs">' + B.name + '<br>' + gearStatText(it) + '</div></div>';
    }
    if (!order.length) html += '<div class="garEmpty">' + (G.bag.length ? 'bu kategoride eşya yok' : 'çanta boş — düşmanlar, bosslar ve sandıklar eşya düşürür') + '</div>';
    html += '</div>';
    elPanelBody.innerHTML = html;
    elPanelBody.querySelectorAll('.gearFTab').forEach(el => el.addEventListener('click', () => { G.gearFilter = el.dataset.f; renderPanel(); }));
    const ab = document.getElementById('gearAuto');
    if (ab) ab.addEventListener('click', () => {
      const n = autoEquip(eq);
      if (n > 0) {
        afterGearChange(isP, c); SFX.upgrade();
        toast('⚡ ' + n + ' parça kuşanıldı — ' + (isP ? playerName() : COMMANDERS[c.id].name) + ' hazır!');
      } else toast('Üzerindekiler zaten en iyileri 👍');
      renderPanel();
    });
    elPanelBody.querySelectorAll('.gearTab').forEach(el => el.addEventListener('click', () => { G.panelFor = { gearPage: el.dataset.who }; renderPanel(); }));
    elPanelBody.querySelectorAll('.gearSlot').forEach(el => el.addEventListener('click', () => {
      const sk = el.dataset.slot, it = eq[sk];
      if (!it) return;
      delete eq[sk]; G.bag.push(it);
      afterGearChange(isP, c); renderPanel();
    }));
    elPanelBody.querySelectorAll('.gearItem').forEach(el => el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i), it = G.bag[i];
      if (!it) return;
      if (G.gearSalvage) { // erit: nadirliğe göre altın + hurda
        G.bag.splice(i, 1);
        gain({ gold: Math.round(8 * RARITY[it.r].m), scrap: Math.max(1, Math.round(RARITY[it.r].m)) }, G.player.x, G.player.y - 30);
        SFX.coin(); save(); renderPanel(); return;
      }
      const sk = GEAR_BASES[it.b].slot;
      G.bag.splice(i, 1);
      if (eq[sk]) G.bag.push(eq[sk]); // takas: eskisi çantaya
      eq[sk] = it;
      afterGearChange(isP, c); SFX.upgrade(); renderPanel();
    }));
    const sb = document.getElementById('gearSalv');
    if (sb) sb.addEventListener('click', () => { G.gearSalvage = !G.gearSalvage; renderPanel(); });
    // 🔥 Hepsini Erit: görünen listedeki (filtreye tabi) her şeyi tek seferde eritir.
    // Onayda kaç parçanın KUŞANILANDAN İYİ olduğu ayrıca uyarılır — 75 eşyalık
    // çantada tek tek bakmak imkânsız, yanlışlıkla iyi parçayı yakmak can sıkıcı.
    const sab = document.getElementById('gearSalvAll');
    if (sab) sab.addEventListener('click', () => {
      const idx = G.bag.map((it, i2) => i2).filter(i2 => gf === 'all' || GEAR_BASES[G.bag[i2].b].slot === gf);
      if (!idx.length) { toast('Eritilecek eşya yok'); return; }
      const kadrolar = [G.equip].concat(G.commanders.map(cc => cc.gear || {}));
      let altin = 0, hurda = 0, iyi = 0;
      for (const i2 of idx) {
        const it = G.bag[i2];
        altin += Math.round(8 * RARITY[it.r].m);
        hurda += Math.max(1, Math.round(RARITY[it.r].m));
        const sk2 = GEAR_BASES[it.b].slot;
        if (kadrolar.some(eq2 => gearScore(it) > (eq2[sk2] ? gearScore(eq2[sk2]) : -1))) iyi++;
      }
      const uyari = iyi ? '\n\n⚠️ Bunlardan ' + iyi + ' tanesi birinin kuşandığından DAHA İYİ!' : '';
      if (!confirm(idx.length + ' parça eritilsin mi?\nKazanç: ' + altin + ' 🪙 + ' + hurda + ' 🔩' + uyari)) return;
      for (const i2 of idx.sort((a2, b2) => b2 - a2)) G.bag.splice(i2, 1);  // sondan başa: indeksler kaymasın
      gain({ gold: altin, scrap: hurda }, G.player.x, G.player.y - 30);
      SFX.build(); toast('🔥 ' + idx.length + ' parça eritildi: +' + altin + '🪙 +' + hurda + '🔩');
      save(); renderPanel();
    });
    return;
  }
  if (th.armyPage) { // 🎖️ Ordu: askerler (rütbe/terfi) + komutan görevleri + garnizonlar
    elPanelTitle.textContent = '🎖️ Ordu';
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Yanında <b>' + G.soldiers.length + '/' + soldierCap() + '</b> asker · ' + G.commanders.length + ' komutan · 🪙 ' + Math.floor(G.res.gold) + '. Askerler leşle XP biriktirir; terfiyi SEN onaylarsın (altınla, maks Sv.' + SOLDIER_LV_MAX + '). Komutan tavanı Sv.' + CMD_LV_MAX + '.</div>';
    // --- Komutanlar + görevleri ---
    const guardSites = ['village', ...['camp1', 'fort', 'legion'].filter(id => G.outposts[id])];
    if (G.commanders.length) elPanelBody.insertAdjacentHTML('beforeend', '<div class="gearHead2">⭐ Komutanlar — görev ver</div>');
    for (const c of G.commanders) {
      const C = COMMANDERS[c.id];
      const cap2 = cmdTroopCap(c), tn = (c.troops || []).length;
      const ordTxt = c.order === 'raid'
        ? '💰 Yağmada — kese ' + Math.round(c.purse || 0) + '🪙 · öz ordusu ' + tn + '/' + cap2 + ' (keseden 30🪙/asker)'
        : (c.order || '').indexOf('guard:') === 0
          ? '🛡️ ' + siteName(c.order.slice(6)) + ' çevresinde devriyede — kese ' + Math.round(c.purse || 0) + '🪙 · öz ordusu ' + tn + '/' + cap2
          : '🧭 Seni takip ediyor (yanındayken öz ordusu olmaz)';
      const div = document.createElement('div'); div.className = 'pitem armyCmd';
      div.innerHTML = '<div style="flex:1"><div class="pname">' + C.icon + ' ' + C.name + ' — Sv.' + c.lv + '/' + CMD_LV_MAX + ' ⚔️' + c.tdmg + ' ❤️' + c.maxHp + '</div>'
        + '<div class="pdesc">' + ordTxt + (c.lv < CMD_LV_MAX ? ' · sıradaki seviye: leş ' + c.kills + '/' + cmdKillsNeed(c.lv) : ' · <b>TAVAN</b>') + '</div>'
        + '<div class="armyOrders">'
        + '<button class="ordBtn' + (!cmdIndependent(c) ? ' on' : '') + '" data-cid="' + c.id + '" data-ord="follow">🧭 Takip Et</button>'
        + '<button class="ordBtn' + (c.order === 'raid' ? ' on' : '') + '" data-cid="' + c.id + '" data-ord="raid">💰 Yağma</button>'
        + guardSites.map(sid => '<button class="ordBtn' + (c.order === 'guard:' + sid ? ' on' : '') + '" data-cid="' + c.id + '" data-ord="guard:' + sid + '">🛡️ ' + siteName(sid).replace(' Karakolu', '') + '</button>').join('')
        + '</div></div>';
      elPanelBody.appendChild(div);
    }
    if (!G.commanders.length) elPanelBody.insertAdjacentHTML('beforeend', '<div class="garEmpty">henüz komutanın yok — boss\'ları yen, safına kat</div>');
    // --- Askerler (yanındakiler + garnizonlar) ---
    const unitRow = (u, where) => {
      const SC = SOLDIER_CLS[u.cls || 'sword'], lv = u.lv || 1;
      const maxed = lv >= SOLDIER_LV_MAX;
      const need = sXpNeed(lv), cost = sPromoteCost(lv), ready = !maxed && (u.xp || 0) >= need;
      const div = document.createElement('div'); div.className = 'pitem';
      div.innerHTML = '<div style="flex:1"><div class="pname">' + SC.icon + ' ' + soldierRank(u) + ' (' + SC.name + ') — Sv.' + lv + (maxed ? ' <b style="color:#ffd257">MAKS</b>' : '') + '</div>'
        + '<div class="pdesc">⚔️' + (u.tdmg || SC.dmg) + ' ❤️' + Math.ceil(u.hp) + '/' + u.maxHp + ' · ' + where
        + (maxed ? '' : ' · XP <b>' + Math.floor(u.xp || 0) + '/' + need + '</b>') + '</div></div>';
      const btn = document.createElement('button');
      btn.textContent = maxed ? '★' : 'Terfi ' + cost + '🪙';
      btn.disabled = maxed || !ready || G.res.gold < cost;
      btn.addEventListener('click', () => { promoteSoldier(u); renderPanel(); });
      div.appendChild(btn);
      elPanelBody.appendChild(div);
    };
    elPanelBody.insertAdjacentHTML('beforeend', '<div class="gearHead2">🗡️ Yanındaki askerler (' + G.soldiers.length + ')</div>');
    G.soldiers.forEach(sl => unitRow(sl, 'orduda'));
    if (!G.soldiers.length) elPanelBody.insertAdjacentHTML('beforeend', '<div class="garEmpty">yanında asker yok — kışladan eğit</div>');
    for (const [oid, op] of Object.entries(G.outposts)) {
      const units = G.garrisonUnits.filter(g2 => g2.garrisonOf === oid);
      if (!units.length) continue;
      elPanelBody.insertAdjacentHTML('beforeend', '<div class="gearHead2">🏳️ ' + siteName(oid) + ' garnizonu (' + units.length + ')</div>');
      units.forEach(g2 => unitRow(g2, 'garnizonda'));
    }
    if (!VISIT && !ISLAND) pitem('👑 Hanedan Mirası', 'Mücevherle kalıcı güçler — bölgeden bölgeye taşınır (💎 ' + G.res.gems + ')', null, 'Aç', true,
      () => { G.panelFor = { dyn: true, label: '👑' }; renderPanel(); });
    elPanelBody.querySelectorAll('.ordBtn').forEach(el => el.addEventListener('click', () => {
      const c = G.commanders.find(c2 => c2.id === el.dataset.cid);
      if (c) { cmdSetOrder(c, el.dataset.ord); renderPanel(); }
    }));
    return;
  }
  if (th.friendsPage) { // 🤝 Yoldaşlar: çevrimiçi profil + arkadaşlar + ziyaret + dostluk adası
    elPanelTitle.textContent = '🤝 Yoldaşlar';
    if (!NETP) {
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:10px">Çevrimiçi ol: arkadaşlarını davet koduyla ekle, köylerini günde 10 dakika ziyaret edip yardım et, birlikte <b>Dostluk Adası</b>\'nda savaşın — ortak üs, ortak depo, ortak keşif.</div>';
      pitem('🌐 Çevrimiçi Ol', 'Bir ad seç, davet kodun üretilsin (hesap/şifre yok)', null, 'Başla', true, netRegister);
      return;
    }
    let html = '<div class="netCode">Davet kodun: <b>' + NETP.code + '</b><button class="garBtn" id="netCopy">📋</button><span class="netName">' + NETP.name + ' <button class="garBtn" id="netRename">✏️</button></span></div>';
    elPanelBody.innerHTML = html;
    pitem('➕ Arkadaş Ekle', 'Arkadaşının 6 haneli davet kodunu gir', null, 'Ekle', true, () => {
      const code = prompt('Arkadaşının davet kodu:');
      if (!code) return;
      rpcAuth('add_friend', { p_code: code }).then(f => { toast('🤝 ' + f.name + ' artık yoldaşın!'); netRefreshSocial(); })
        .catch(e => toast(netErrMsg(e), true));
    });
    const fr = G.netFriends;
    if (!fr) elPanelBody.insertAdjacentHTML('beforeend', '<div class="garEmpty">yoldaşlar yükleniyor...</div>');
    else if (!fr.length) elPanelBody.insertAdjacentHTML('beforeend', '<div class="garEmpty">henüz yoldaşın yok — kodunu paylaş!</div>');
    else for (const f of fr) {
      const ago = f.ago < 150 ? '<b style="color:#57d364">şimdi çevrimiçi</b>'
        : f.ago < 3600 ? Math.floor(f.ago / 60) + ' dk önce'
        : f.ago < 86400 ? Math.floor(f.ago / 3600) + ' saat önce' : Math.floor(f.ago / 86400) + ' gün önce';
      const m = f.meta || {};
      const left = Math.max(0, BAL.visitSec - (f.used || 0));
      const desc = 'Sv.' + (m.level || 1) + ' · Gün ' + (m.day || 1) + (m.prov ? ' · ' + m.prov : '') + ' · ' + ago +
        (f.has_village ? ' · ziyaret hakkın: ' + fmtDur(left) : ' · köyü henüz bulutta değil (biraz oynasın)');
      pitem('🧑‍🌾 ' + f.name, desc, null, '🏠 Ziyaret', !VISIT && !ISLAND && f.has_village && left > 0, () => visitFriend(f));
    }
    // Dostluk Adası
    elPanelBody.insertAdjacentHTML('beforeend', '<div class="gearHead2">🏝️ Dostluk Adası — ortak üs, ortak savaş (normal haritanın 5-6 katı, çok daha çetin)</div>');
    const isl = G.netIsland;
    if (isl) {
      const mem = (isl.members || []).map(mm => mm.name + (mm.contrib && mm.contrib.kills ? ' (⚔️' + mm.contrib.kills + ')' : '')).join(', ');
      pitem('🏝️ ' + isl.name, 'Katılım kodu: <b>' + isl.code + '</b> · yoldaşlar: ' + mem, null, '⛵ Adaya Git', !VISIT && !ISLAND, () => enterIsland());
      pitem('🚪 Adadan ayrıl', 'Üyelikten çıkarsın (son üye ayrılınca ada silinir)', null, 'Ayrıl', !ISLAND, () => {
        if (!confirm('Adadan ayrılmak istediğine emin misin?')) return;
        rpcAuth('leave_island').then(() => { G.netIsland = null; toast('Adadan ayrıldın'); renderPanel(); }).catch(e => toast(netErrMsg(e), true));
      });
    } else {
      pitem('🏝️ Ada Kur', 'Yeni bir dostluk adası aç, kodunu yoldaşlarına ver', null, 'Kur', true, () => {
        const nm = prompt('Adanın adı:', 'Dostluk Adası');
        if (nm === null) return;
        rpcAuth('create_island', { p_name: nm }).then(i => { G.netIsland = i; toast('🏝️ Ada kuruldu! Kod: ' + i.code); renderPanel(); })
          .catch(e => toast(netErrMsg(e), true));
      });
      pitem('🔑 Adaya Katıl', 'Yoldaşının ada kodunu gir', null, 'Katıl', true, () => {
        const code = prompt('Ada katılım kodu:');
        if (!code) return;
        rpcAuth('join_island', { p_code: code }).then(i => { G.netIsland = i; toast('🏝️ ' + i.name + ' adasına katıldın!'); renderPanel(); })
          .catch(e => toast(netErrMsg(e), true));
      });
    }
    const cp = document.getElementById('netCopy');
    if (cp) cp.addEventListener('click', () => {
      try { navigator.clipboard.writeText(NETP.code); toast('Kod kopyalandı: ' + NETP.code); } catch (e) { toast('Kodun: ' + NETP.code); }
    });
    const rn = document.getElementById('netRename');
    if (rn) rn.addEventListener('click', () => {
      const nm = prompt('Yeni adın:', playerName());
      if (nm !== null) setPlayerName(nm);   // tek kaynak: HUD, kuşam paneli ve sunucu birlikte güncellenir
    });
    return;
  }
  if (th.opStock) { // 🏳️ Karakol Ambarı: buradaki üretim burada birikir — al / bırak
    const site = th.opStock, op2 = G.outposts[site], O2 = OUTPOSTS[site];
    if (!op2 || !O2) { closePanel(); return; }
    op2._id = site; op2.stock = op2.stock || {};
    const cap2 = opStockCap(op2);
    elPanelTitle.textContent = '🏳️ ' + O2.name + ' — Ambar';
    let html2 = VISIT
      ? '<div class="pdesc" style="margin-bottom:8px">Ev sahibinin karakol ambarı. Ziyarette <b>topladığın her şey</b> zaten ona akıyor; elle taşımana gerek yok.</div>'
      : '<div class="pdesc" style="margin-bottom:8px">Bu karakolun kendi ambarı: buradaki bıçkıhane, avcı ve köylüler üretimlerini <b>buraya</b> koyar. Limit: <b>' + cap2 + '</b>/kaynak (🏬 Depo kurarak artar). Karakolun <b>oto yönetimi</b> inşaat, tamir ve asker için buradan harcar — kaynak bırakırsan burayı hızla geliştirir.</div>';
    for (const [k, icon] of RES_DEF) {
      if (k === 'gold' || k === 'gems') continue; // değerliler hep cepte
      const s3 = Math.floor(op2.stock[k] || 0), pk3 = Math.floor(G.res[k] || 0);
      html2 += '<div class="stockRow"><span class="stockInfo">' + icon + ' <b>' + s3 + '</b>/' + cap2 +
        (VISIT ? '' : ' <span class="stockPocket">· cebinde ' + pk3 + '</span>') + '</span>' +
        (VISIT ? '' :
          '<button class="garBtn stockBtn" data-k="' + k + '" data-op="take" ' + (s3 ? '' : 'disabled') + '>⬇ Al</button>' +
          '<button class="garBtn stockBtn" data-k="' + k + '" data-op="put" ' + (pk3 && s3 < cap2 ? '' : 'disabled') + '>⬆ Bırak</button>') + '</div>';
    }
    if (!VISIT) { // oto yönetimin bir işe ayırdığı kaynaklar burada görünsün
      const bek = [];
      if (op2.wallPaid && Object.keys(op2.wallPaid).length) bek.push(['🪵 Karakol suru', op2.wallPaid, bcost(OP_WALL.cost)]);
      if (op2.gatePaid && Object.keys(op2.gatePaid).length) bek.push(['🚪 Sur kapısı', op2.gatePaid, bcost(OP_WALL.repair)]);
      if (op2.kgPaid && Object.keys(op2.kgPaid).length) bek.push(['🚪 Kale kapısı', op2.kgPaid, bcost(site === 'fort' ? { wood: 60, stone: 40 } : { stone: 80, iron: 12 })]);
      for (const pl2 of G.plots) {
        if (pl2.outpost !== site || pl2.built || !pl2.paid || !Object.keys(pl2.paid).length) continue;
        bek.push([(BUILDINGS[pl2.plan] || {}).icon + ' ' + (BUILDINGS[pl2.plan] || {}).name, pl2.paid, bcost((BUILDINGS[pl2.plan] || {}).cost || {})]);
      }
      for (const b4 of G.buildings) { // bu karakoldaki yükseltme / onarım birikimleri
        if (b4.outpost !== site || !BUILDINGS[b4.type]) continue;
        const B4 = BUILDINGS[b4.type];
        if (b4.upPaid && Object.keys(b4.upPaid).length) {
          const c4 = nextUpCost(b4);
          if (c4) bek.push([B4.icon + ' ' + B4.name + ' ⬆Sv.' + (b4.lv + 1), b4.upPaid, bcost(c4)]);
        }
        if (b4.repPaid && Object.keys(b4.repPaid).length) bek.push([B4.icon + ' ' + B4.name + ' 🔧 onarım', b4.repPaid, bcost(repairCost(b4.type))]);
      }
      if (bek.length) {
        html2 += '<div class="gearHead2">⚙️ Oto yönetimin biriktirdiği</div>';
        for (const [ad, odenen, gereken] of bek) {
          const kalan = Object.entries(gereken).map(([k4, v4]) => {
            const eksik = v4 - (odenen[k4] || 0);
            return eksik > 0 ? eksik + (RES_DEF.find(r => r[0] === k4) || ['', ''])[1] : null;
          }).filter(Boolean).join(' ');
          html2 += '<div class="stockRow"><span class="stockInfo">' + ad + ' — kalan: <b>' + (kalan || 'tamam') + '</b></span></div>';
        }
      }
    }
    elPanelBody.innerHTML = html2;
    if (!VISIT) elPanelBody.querySelectorAll('.stockBtn').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.k;
      if (el.dataset.op === 'take') {
        const n = Math.floor(op2.stock[k] || 0);
        op2.stock[k] -= n; gain({ [k]: n }, G.player.x, G.player.y - 30);
      } else {
        const n = Math.min(Math.floor(G.res[k] || 0), cap2 - Math.floor(op2.stock[k] || 0));
        if (n <= 0) return;
        G.res[k] -= n; op2.stock[k] = (op2.stock[k] || 0) + n;
        flashChip(k);
        addFloater(G.player.x, G.player.y - 40, '⬆ ' + n + ' → 🏳️', '#c8e0a8', 13);
      }
      SFX.coin(); save(); renderPanel();
    }));
    if (!VISIT) pitem('⬇ Hepsini al', 'Ambardaki tüm kaynakları cebine aktar', null, 'Al', RES_DEF.some(([k]) => k !== 'gold' && k !== 'gems' && Math.floor(op2.stock[k] || 0) > 0), () => {
      let t = 0;
      for (const [k] of RES_DEF) {
        if (k === 'gold' || k === 'gems') continue;
        const n = Math.floor(op2.stock[k] || 0);
        if (n <= 0) continue;
        op2.stock[k] -= n; G.res[k] = (G.res[k] || 0) + n; flashChip(k); t += n;
      }
      if (t) { SFX.coin(); addFloater(G.player.x, G.player.y - 40, '⬇ ' + t + ' 🏳️→🎒', '#c8e0a8', 14); save(); }
      renderPanel();
    });
    if (!VISIT) pitem('⬆ Hepsini bırak', 'Cebindeki tüm inşaat kaynaklarını bu ambara aktar', null, 'Aktar', true, () => {
      let toplam = 0;
      for (const [k] of RES_DEF) {
        if (k === 'gold' || k === 'gems') continue;
        const n = Math.min(Math.floor(G.res[k] || 0), cap2 - Math.floor(op2.stock[k] || 0));
        if (n > 0) { G.res[k] -= n; op2.stock[k] = (op2.stock[k] || 0) + n; toplam += n; }
      }
      if (toplam) { SFX.coin(); addFloater(G.player.x, G.player.y - 40, '⬆ ' + toplam + ' → 🏳️', '#c8e0a8', 14); save(); }
      renderPanel();
    });
    return;
  }
  if (th.stockPage) { // 🏬 Köy Deposu: pasif üretim burada birikir — al/bırak
    const cap = stockCap();
    elPanelTitle.textContent = '🏬 Köy Deposu' + (VISIT ? ' — ' + VISIT.name : '');
    // ZİYARETTE: burası ev sahibinin ambarı. Elle bırakmaya gerek yok, topladığın
    // her şey ona zaten akıyor; elle "bırak" hem çift sayardı hem de kaybolurdu.
    let html = VISIT
      ? '<div class="pdesc" style="margin-bottom:8px">🎁 <b>' + VISIT.name + '</b>\'ın ambarı. Burada <b>topladığın her şey</b> (odun, taş, hurda, av eti) doğrudan buraya akar — elle bırakman gerekmez.' +
        (coopPeerCount() ? ' Ev sahibi çevrimiçi: kaynaklar <b>anında</b> geçiyor.' : ' Ev sahibi çevrimdışı: ayrılırken toplu olarak teslim edilecek.') +
        ' Ambarındaki kaynakları köyünün <b>oto yönetimi</b> inşaat, tamir ve asker için kullanır.</div>'
      : '<div class="pdesc" style="margin-bottom:8px">Pasif üretim (bıçkıhane, köylüler, avcı kulübesi) burada birikir. Limit: <b>' + cap + '</b>/kaynak — 🏬 Depo binası kur, artır. Askerler etini buradan yer.</div>';
    if (VISIT) { // ziyaretçinin bu tur getirdiği: henüz gönderilmemiş + gönderilmiş toplam
      const bek = G.helpFx && G.helpFx.don ? Object.entries(G.helpFx.don).filter(([, v]) => v > 0) : [];
      html += '<div class="stockRow"><span class="stockInfo">🎒 Bu ziyarette topladıkların: <b>' +
        (bek.length ? bek.map(([k2, v2]) => Math.floor(v2) + (RES_DEF.find(r => r[0] === k2) || ['', ''])[1]).join(' ') : 'henüz yok') +
        '</b></span></div>';
    }
    for (const [k, icon] of RES_DEF) {
      if (k === 'gold' || k === 'gems') continue; // değerliler hep cepte
      const s2 = Math.floor(G.stock[k] || 0), pk = Math.floor(G.res[k] || 0);
      html += '<div class="stockRow"><span class="stockInfo">' + icon + ' <b>' + s2 + '</b>/' + cap + (VISIT ? '' : ' <span class="stockPocket">· cebinde ' + pk + '</span>') + '</span>' +
        (VISIT ? '' :
          '<button class="garBtn stockBtn" data-k="' + k + '" data-op="take" ' + (s2 ? '' : 'disabled') + '>⬇ Al</button>' +
          '<button class="garBtn stockBtn" data-k="' + k + '" data-op="put" ' + (pk && s2 < cap ? '' : 'disabled') + '>⬆ Bırak</button>') + '</div>';
    }
    elPanelBody.innerHTML = html;
    if (!VISIT) { // toplu işlemler
      pitem('⬇ Hepsini al', 'Depodaki tüm kaynakları cebine aktar', null, 'Al', RES_DEF.some(([k]) => k !== 'gold' && k !== 'gems' && Math.floor(G.stock[k] || 0) > 0), () => {
        let t = 0;
        for (const [k] of RES_DEF) {
          if (k === 'gold' || k === 'gems') continue;
          const n = Math.floor(G.stock[k] || 0);
          if (n <= 0) continue;
          G.stock[k] -= n; G.res[k] = (G.res[k] || 0) + n; flashChip(k); t += n;
          if (ISLAND) { const sa = G.islOps.stockAdd = G.islOps.stockAdd || {}; sa[k] = (sa[k] || 0) - n; }
        }
        if (t) { SFX.coin(); addFloater(G.player.x, G.player.y - 40, '⬇ ' + t + ' 🏬→🎒', '#ffe9a8', 14); save(); }
        renderPanel();
      });
      pitem('⬆ Hepsini bırak', 'Cebindeki inşaat kaynaklarını depoya koy', null, 'Bırak', RES_DEF.some(([k]) => k !== 'gold' && k !== 'gems' && Math.floor(G.res[k] || 0) > 0), () => {
        let t = 0;
        for (const [k] of RES_DEF) {
          if (k === 'gold' || k === 'gems') continue;
          const n = Math.min(Math.floor(G.res[k] || 0), cap - Math.floor(G.stock[k] || 0));
          if (n <= 0) continue;
          G.res[k] -= n; G.stock[k] = (G.stock[k] || 0) + n; t += n;
          if (ISLAND) { const sa = G.islOps.stockAdd = G.islOps.stockAdd || {}; sa[k] = (sa[k] || 0) + n; islContrib('donated', n); }
        }
        if (t) { SFX.coin(); addFloater(G.player.x, G.player.y - 40, '⬆ ' + t + ' → 🏬', '#ffe9a8', 14); save(); }
        renderPanel();
      });
    }
    elPanelBody.querySelectorAll('.stockBtn').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.k;
      if (el.dataset.op === 'take') {
        const n = Math.floor(G.stock[k] || 0);
        G.stock[k] -= n; gain({ [k]: n }, G.player.x, G.player.y - 30);
        if (ISLAND && n > 0) { const sa = G.islOps.stockAdd = G.islOps.stockAdd || {}; sa[k] = (sa[k] || 0) - n; }
      } else {
        const n = Math.min(Math.floor(G.res[k] || 0), stockCap() - Math.floor(G.stock[k] || 0));
        G.res[k] -= n; G.stock[k] += n;
        if (ISLAND && n > 0) { const sa = G.islOps.stockAdd = G.islOps.stockAdd || {}; sa[k] = (sa[k] || 0) + n; islContrib('donated', n); }
        addFloater(G.player.x, G.player.y - 40, '⬆ ' + n + ' → 🏬', '#ffe9a8', 13);
      }
      SFX.coin(); save(); renderPanel();
    }));
    return;
  }
  if (th.plot) { // boş arsa: inşa menüsü (karakol arsalarında sınırlı liste)
    const outId = th.plot.outpost;
    elPanelTitle.textContent = outId ? '🔨 İnşa Et — ' + OUTPOSTS[outId].name : '🔨 İnşa Et';
    let any = false;
    for (const [type, B] of Object.entries(BUILDINGS)) {
      if (outId && !OUTPOST_BUILDS.includes(type)) continue;
      if (G.built[type] && !B.multi) continue;
      const reqOk = !B.req || G.built[B.req];
      const bc = bcost(B.cost);
      any = true;
      pitem(B.icon + ' ' + B.name, reqOk ? B.desc : `Önce ${BUILDINGS[B.req].name} gerekli`, bc, 'İnşa', reqOk && canAfford(bc), () => buildAt(th.plot, type));
    }
    if (!any) elPanelBody.innerHTML = '<div class="pdesc">Tüm binalar inşa edildi. Yeni binalar yakında!</div>';
  } else if (th.gar) {
    // M&B tarzı garnizon transfer ekranı: iki sütun, tıkla → taraf değiştir
    const id = th.gar, op = G.outposts[id], O = OUTPOSTS[id];
    elPanelTitle.textContent = '⚖️ Garnizon — ' + O.name;
    const cap = garrisonCap(op);
    const gUnits = G.garrisonUnits.filter(g => g.garrisonOf === id);
    let html = '<div class="garCols"><div class="garCol"><div class="garHead">🧍 Yanındakiler (' + G.soldiers.length + '/' + soldierCap() + ')</div>';
    const uLabel = u => {
      const SC = SOLDIER_CLS[u.cls || 'sword'];
      return SC.icon + ' ' + (u.name || SC.name) + ' Sv.' + (u.lv || 1) + (u.trait && TRAITS[u.trait] ? ' ' + TRAITS[u.trait].icon : '');
    };
    G.soldiers.forEach((sl, i) => {
      html += `<button class="garBtn" data-side="f" data-i="${i}" ${op.garrison >= cap ? 'disabled' : ''}>${uLabel(sl)} →</button>`;
    });
    if (!G.soldiers.length) html += '<div class="garEmpty">yanında asker yok</div>';
    html += '</div><div class="garCol"><div class="garHead">🏳️ Garnizon (' + op.garrison + '/' + cap + ')</div>';
    gUnits.forEach((g, i) => {
      html += `<button class="garBtn" data-side="g" data-i="${i}" ${G.soldiers.length >= soldierCap() ? 'disabled' : ''}>← ${uLabel(g)}</button>`;
    });
    if (!gUnits.length) html += '<div class="garEmpty">garnizon boş</div>';
    html += '</div></div>';
    // toplu kısayollar
    const inOk = G.soldiers.length > 0 && op.garrison < cap;
    const outOk = gUnits.length > 0 && G.soldiers.length < soldierCap();
    html += '<div class="garCols" style="margin-top:8px">'
      + `<div class="garCol" style="min-height:0"><button class="garBtn" data-all="in" ${inOk ? '' : 'disabled'}>⏩ Hepsini bırak</button></div>`
      + `<div class="garCol" style="min-height:0"><button class="garBtn" data-all="out" ${outOk ? '' : 'disabled'}>⏪ Hepsini al</button></div>`
      + '</div>';
    html += '<div class="pdesc" style="margin-top:8px">Birime tıkla → taraf değiştirir. Garnizon kapasitesi karakol seviyesiyle artar (Sv.3 = 7).</div>';
    elPanelBody.innerHTML = html;
    elPanelBody.querySelectorAll('[data-all]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.all === 'in') {
        while (G.soldiers.length > 0 && op.garrison < cap) {
          const sl = G.soldiers.shift(); G.soldiersOwned--;
          op.garrison++; (op.garrisonCls = op.garrisonCls || []).push({ cls: sl.cls || 'sword', name: sl.name, trait: sl.trait || null });
          addGarrisonUnit(id, sl.cls || 'sword', sl);
        }
      } else {
        let gs = G.garrisonUnits.filter(g2 => g2.garrisonOf === id);
        while (gs.length > 0 && G.soldiers.length < soldierCap()) {
          const g2 = gs.shift();
          G.garrisonUnits = G.garrisonUnits.filter(x => x !== g2);
          op.garrison = Math.max(0, op.garrison - 1);
          const ci = (op.garrisonCls || []).findIndex(x => (typeof x === 'string' ? x : x.cls) === (g2.cls || 'sword'));
          if (ci >= 0) op.garrisonCls.splice(ci, 1);
          G.soldiersOwned++; addSoldier(g2.cls || 'sword', g2);
        }
      }
      SFX.build(); save(); renderPanel();
    }));
    elPanelBody.querySelectorAll('.garBtn').forEach(btn => btn.addEventListener('click', () => {
      const side = btn.dataset.side, i = +btn.dataset.i;
      if (side === 'f') {
        const sl = G.soldiers[i];
        if (!sl || op.garrison >= cap) return;
        G.soldiers.splice(i, 1); G.soldiersOwned--;
        op.garrison++; (op.garrisonCls = op.garrisonCls || []).push({ cls: sl.cls || 'sword', name: sl.name, trait: sl.trait || null });
        addGarrisonUnit(id, sl.cls || 'sword', sl);
      } else {
        const g = gUnits[i];
        if (!g || G.soldiers.length >= soldierCap()) return;
        G.garrisonUnits = G.garrisonUnits.filter(x => x !== g);
        op.garrison = Math.max(0, op.garrison - 1);
        const ci = (op.garrisonCls || []).findIndex(x => (typeof x === 'string' ? x : x.cls) === (g.cls || 'sword'));
        if (ci >= 0) op.garrisonCls.splice(ci, 1);
        G.soldiersOwned++; addSoldier(g.cls || 'sword', g);
      }
      SFX.build(); save(); renderPanel();
    }));
  } else if (th.statsPage) {
    elPanelTitle.textContent = '📊 İstatistik & Başarımlar';
    const st = G.stats;
    const mins = Math.floor(st.playtime / 60);
    elPanelBody.innerHTML =
      '<div class="pdesc" style="margin-bottom:8px">' +
      `⚔️ Öldürülen düşman: <b>${st.kills}</b> · 💀 Boss: <b>${st.bossKills}</b><br>` +
      `🪵 Kesilen ağaç: <b>${st.chops}</b> · 🪨 Kırılan kaya: <b>${st.mines}</b><br>` +
      `🐴 Ulaşan kervan: <b>${st.caravans}</b> · ⚰️ Kayıp asker: <b>${st.deaths}</b><br>` +
      `🌙 Savuşturulan baskın: <b>${G.raidsSurvived}</b> · ⏱️ Süre: <b>${mins} dk</b> · 👑 Hanedan: <b>${G.dynasty}</b></div>`;
    for (const a of ACHIEVEMENTS) {
      const got = !!G.ach[a.id];
      pitem((got ? a.icon : '🔒') + ' ' + a.name, a.desc, null, got ? '✓' : '—', false, () => { });
    }
  } else if (th.optsPage) {
    G.optsExtra = true;
    elPanelTitle.textContent = '⚙️ Ayarlar';
    elPanelBody.innerHTML =
      '<div class="pitem"><div style="flex:1"><div class="pname">🎵 Müzik & Ambiyans</div>' +
      `<input type="range" id="optMusic" min="0" max="100" value="${Math.round(OPTS.music * 100)}" style="width:100%"></div></div>` +
      '<div class="pitem"><div style="flex:1"><div class="pname">🔊 Efektler</div>' +
      `<input type="range" id="optSfx" min="0" max="100" value="${Math.round(OPTS.sfx * 100)}" style="width:100%"></div></div>`;
    pitem('📳 Ekran sarsıntısı', 'Vuruş/patlama sarsıntısı', null, OPTS.shake ? 'Açık' : 'Kapalı', true,
      () => { OPTS.shake = !OPTS.shake; saveOpts(); });
    $('optMusic').addEventListener('input', e2 => { OPTS.music = e2.target.value / 100; applyOpts(); saveOpts(); });
    $('optSfx').addEventListener('input', e2 => { OPTS.sfx = e2.target.value / 100; applyOpts(); saveOpts(); });
    if (!VISIT && !ISLAND) pitem('⚖️ Zorluk: ' + DIFF[G.difficulty].name, 'Düşman gücü ve hanedan puanı çarpanı (yeni düşmanlara işler)', null, 'Değiştir', true, () => {
      const keys2 = Object.keys(DIFF);
      G.difficulty = keys2[(keys2.indexOf(G.difficulty) + 1) % keys2.length];
      toast('Zorluk: ' + DIFF[G.difficulty].name + ' (düşman ×' + DIFF[G.difficulty].emul + ', puan ×' + DIFF[G.difficulty].score + ')');
      save(); renderPanel();
    });
    pitem('📊 İstatistik & Başarımlar', G.stats.kills + ' leş · ' + Object.keys(G.ach).length + '/' + ACHIEVEMENTS.length + ' başarım', null, 'Aç', true,
      () => { G.panelFor = { statsPage: true }; renderPanel(); });
    if (!VISIT && !ISLAND) {
      pitem('💾 Kayıt Yuvaları', 'Yuva ' + (SAVE_SLOT + 1) + ' aktif', null, 'Aç', true,
        () => { G.panelFor = { slotsPage: true }; renderPanel(); });
      pitem('🗑️ Kaydı sıfırla', 'Bu yuvadaki ilerleme silinir!', null, 'Sıfırla', true, () => { if (confirm('Bu yuvadaki tüm ilerleme silinsin mi?')) resetSave(); });
    }
  } else if (th.slotsPage) {
    elPanelTitle.textContent = '💾 Kayıt Yuvaları';
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Yuva değiştirmek oyunu yeniden yükler (mevcut oyun kaydedilir).</div>';
    for (let sl2 = 0; sl2 < 3; sl2++) {
      let info = 'boş';
      try {
        const d2 = JSON.parse(localStorage.getItem(slotKey(sl2)));
        if (d2) {
          const dp = (d2.provinceId && PROV_BY_ID[d2.provinceId]) || provFromLegacy(d2.region);
          info = dp.name + ' · Gün ' + (d2.day || 1) + ' · 👑' + (d2.dynasty || 0);
        }
      } catch (e2) { }
      const active = sl2 === SAVE_SLOT;
      pitem((active ? '▶️ ' : '') + 'Yuva ' + (sl2 + 1), info, null, active ? 'Aktif' : 'Geç', !active, () => {
        save();
        try { localStorage.setItem('kd-slot', String(sl2)); sessionStorage.setItem('kd-resume', '1'); } catch (e2) { }
        SUPPRESS_SAVE = true; location.reload();
      });
    }
  } else if (th.dyn) {
    elPanelTitle.textContent = '👑 Hanedan Mirası';
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Mücevherle satın alınan <b>kalıcı</b> güçler — göçlerde seninle gelir. Elinde: 💎 ' + G.res.gems + '</div>';
    for (const [k, U] of Object.entries(DYN_UPG)) {
      const lv = G.dynUpg[k] || 0;
      if (lv >= U.max) {
        pitem(U.icon + ' ' + U.name + ' Sv.' + lv, U.desc, null, 'MAKS', false, () => { });
      } else {
        const c = { gems: U.cost[lv] };
        pitem(U.icon + ' ' + U.name + ' Sv.' + lv + ' → ' + (lv + 1), U.desc, c, 'Yükselt', canAfford(c), () => {
          pay(c); G.dynUpg[k] = lv + 1;
          if (k === 'vigor') { G.player.maxHp = playerMaxHp(); G.player.hp = Math.min(G.player.maxHp, G.player.hp + 25); }
          spawnParts(G.player.x, G.player.y - 30, 14, { colors: ['#ffd257', '#fff3c9'], v: 40, life: 1, g: -25 });
          SFX.upgrade(); toast(U.name + ' güçlendi! 👑'); save();
        });
      }
    }
  } else if (th.event) {
    elPanelTitle.textContent = th.title;
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">' + th.text + '</div>';
    for (const c of th.choices)
      pitem(c.label, c.desc || '', null, 'Seç', c.enabled !== false, () => { closePanel(); c.act(); });
  } else if (th.banner) {
    const s = th.banner, op = G.outposts[s.site], O = OUTPOSTS[s.site];
    elPanelTitle.textContent = '🏳️ ' + O.name + (op.looted ? ' — YAĞMALANDI' : '');
    if (op.looted) {
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Sancak yerde, vergi kesildi. Onarırsan karakol yeniden çalışır.</div>';
      const rc = { wood: 20, gold: 15 };
      pitem('🔧 Sancağı yeniden dik', 'Karakol tekrar gelir üretir', rc, 'Onar', canAfford(rc),
        () => { pay(rc); op.looted = false; s.alive = true; s.hp = s.maxHp; SFX.build(); toast(O.name + ' yeniden senin! 🏳️'); save(); renderPanel(); });
    } else {
      const opLv = op.lv || 1;
      const incNow = Math.round(O.income * (1 + 0.5 * (opLv - 1)));
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Karakol Sv.' + opLv + ' · Günlük vergi: <b>+' + incNow + '🪙</b> · Garnizon: <b>' + op.garrison + '/' + garrisonCap(op) + '</b><br>Garnizon, baskınlara karşı sancağı savunur. Yan arsalara ev/kule kurabilirsin.</div>';
      if (opLv < 3) {
        const uc = bcost(OUTPOST_UPG[opLv]);
        pitem('🏳️ Karakolu güçlendir Sv.' + opLv + ' → ' + (opLv + 1), 'Vergi +%50, sancak +200 HP, garnizon kapasitesi +2', uc, 'Yükselt', canAfford(uc),
          () => {
            pay(uc); op.lv = opLv + 1;
            s.maxHp = outpostBannerHp(op.lv); s.hp = s.maxHp;
            // Alan genişler: kazık surlu üste +80 yarıçap, taş kalede yeni DIŞ KALE
            if (op.wall) rebuildOutpostWalls();
            if (KEEP_SITES.includes(s.site)) rebuildKeepWalls();
            const more = opAddPlots(s.site, OUTPOST_PLOT_N[Math.min(3, op.lv)]);
            spawnParts(s.x, s.y - 40, 14, { colors: ['#ffd257', '#fff3c9'], v: 45, life: 1.1, g: -25 });
            SFX.upgrade(); toast(O.name + ' güçlendi! Sv.' + op.lv + (more ? ' · +' + more + ' arsa, alan genişledi' : '')); save(); renderPanel();
          });
      }
      pitem('⚖️ Garnizon yönetimi', 'Askerlerini bırak / geri al (' + op.garrison + '/' + garrisonCap(op) + ')', null, 'Aç', true,
        () => { G.panelFor = { gar: s.site }; renderPanel(); });
      // yerel ambar: bu üssün üretimi burada birikir
      op._id = s.site; op.stock = op.stock || {};
      const ambar = Object.entries(op.stock).filter(([, v]) => Math.floor(v) > 0)
        .map(([k, v]) => Math.floor(v) + (RES_DEF.find(r => r[0] === k) || ['', ''])[1]).join(' ');
      pitem('🏳️ Üs Ambarı', (ambar || 'boş') + ' · limit ' + opStockCap(op) + '/kaynak — kaynak al ya da buraya taşı', null, 'Aç', true,
        () => { G.panelFor = { opStock: s.site }; renderPanel(); });
      pitem('⚙️ Oto yönetim', op.auto !== false ? 'AÇIK — ambar kaynaklarıyla kendini onarır, kurar, asker basar' : 'KAPALI — her şey elle', null,
        op.auto !== false ? 'Kapat' : 'Aç', true, () => { op.auto = op.auto === false; SFX.build(); toast('⚙️ ' + O.name + ' oto yönetim: ' + (op.auto !== false ? 'AÇIK' : 'KAPALI')); save(); renderPanel(); });
      // karakol suru: köy suru gibi, baskıncılar önce kapıyı kırmak zorunda kalır
      // (yalnız kendi taş suru olmayan karakollarda — kale/lejyonun kapı onarımı yukarıda)
      if (!OP_WALL_SITES.includes(s.site)) { /* taş surlu site: kazık suru yok */ }
      else if (!op.wall) {
        pitem('🪵 Karakol suru inşa et', 'Sancağı çitle çevirir; kapısı köye bakar — baskıncılar önce kapıyı kırar', OP_WALL.cost, 'İnşa', canAfford(OP_WALL.cost),
          () => { pay(OP_WALL.cost); op.wall = 1; op.wallGateHp = OP_WALL.gateHp; rebuildOutpostWalls(); SFX.build(); toast('🪵 ' + O.name + ' suru dikildi!'); save(); renderPanel(); });
      } else {
        const owg = G.structures.find(x2 => x2.kind === 'owgate' && x2.site === s.site);
        if (owg && !owg.alive) {
          const bk1 = gateWait(s.site);
          pitem('🚪 Sur kapısını onar', 'Kapı kırık — karakol savunmasız!' + (bk1 ? ' · <b>ustalar ' + bk1 + 'sn sonra hazır</b>' : ''),
            OP_WALL.repair, bk1 ? bk1 + 'sn' : 'Onar', !bk1 && canAfford(OP_WALL.repair),
            () => { pay(OP_WALL.repair); owg.alive = true; owg.hp = owg.maxHp; op.wallGateHp = owg.maxHp; gateUsed(s.site); SFX.build(); toast('Sur kapısı onarıldı! 🚪'); save(); renderPanel(); });
        } else if (owg && owg.hp < owg.maxHp) {
          const gc3 = { wood: 20 };
          const bk2 = gateWait(s.site);
          pitem('🔧 Sur kapısını tamir et', Math.round(owg.hp) + '/' + owg.maxHp + ' HP' + (bk2 ? ' · <b>' + bk2 + 'sn</b>' : ''),
            gc3, bk2 ? bk2 + 'sn' : 'Tamir', !bk2 && canAfford(gc3),
            () => { pay(gc3); owg.hp = owg.maxHp; op.wallGateHp = owg.maxHp; gateUsed(s.site); SFX.build(); toast('Kapı tamir edildi'); save(); renderPanel(); });
        }
      }
      // fethedilen kalenin kapısını onar: baskıncılar önce kapıyı kırmak zorunda kalır
      const gk = s.site === 'fort' ? 'gate' : s.site === 'legion' ? 'lgate' : null;
      if (gk) {
        const og = G.structures.find(x2 => x2.kind === gk);
        if (og && !og.alive) {
          const gc = bcost(s.site === 'fort' ? { wood: 60, stone: 40 } : { stone: 80, iron: 12 });
          const bk3 = gateWait(s.site + '_kale');
          pitem('🚪 Kale kapısını onar', 'Sana açık, düşmana kapalı — baskıncılar önce kapıyı kırar' + (bk3 ? ' · <b>' + bk3 + 'sn</b>' : ''),
            gc, bk3 ? bk3 + 'sn' : 'Onar', !bk3 && canAfford(gc),
            () => { pay(gc); og.alive = true; og.hp = og.maxHp; gateUsed(s.site + '_kale'); SFX.build(); toast('Kale kapısı onarıldı! 🚪'); save(); renderPanel(); });
        } else if (og && og.alive && og.hp < og.maxHp) {
          const gc2 = bcost({ stone: 30 });
          const bk4 = gateWait(s.site + '_kale');
          pitem('🔧 Kapıyı tamir et', Math.round(og.hp) + '/' + og.maxHp + ' HP' + (bk4 ? ' · <b>' + bk4 + 'sn</b>' : ''),
            gc2, bk4 ? bk4 + 'sn' : 'Tamir', !bk4 && canAfford(gc2),
            () => { pay(gc2); og.hp = og.maxHp; gateUsed(s.site + '_kale'); SFX.build(); toast('Kapı tamir edildi'); save(); renderPanel(); });
        }
      }
    }
  } else if (th.cave) {
    elPanelTitle.textContent = '🕳️ Karanlık İn';
    if (G.caveCd > 0) {
      const m2 = Math.floor(G.caveCd / 60), s2 = Math.floor(G.caveCd % 60);
      elPanelBody.innerHTML = '<div class="pdesc">İn boş... Derinlerden yeni homurtular gelene dek bekle.<br><b>Yeniden dolmasına: ' + m2 + ':' + String(s2).padStart(2, '0') + '</b></div>';
    } else {
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Zifiri karanlık, derin bir homurtu ve altın parıltısı... <b>İçeri girenin geri dönüşü yok:</b> ya derinlerdeki hazineyi alırsın ya da Konak\'ın ocağında uyanırsın.</div>';
      pitem('🕳️ İne gir', 'Her seferinde farklı bir in — yanındakiler seninle gelir', null, 'Gir', true, () => { closePanel(); enterCave(); });
    }
  } else if (th.wounded) {
    const w = th.wounded;
    if (w.cmd && COMMANDERS[w.cmd]) {
      const C = COMMANDERS[w.cmd];
      elPanelTitle.textContent = '🩹 ' + C.name + ' (' + C.title + ' Sv.' + (w.lv || 1) + ')';
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Yerde yatıyor, nefesi zayıf. Uzun süre yalnız bırakırsan düşman eline düşer — esir edilir.</div>';
      const hc = { gold: 25 };
      pitem('🩹 Sar ve kaldır', 'Safına yarı canla döner (kapasiteden yemez)', hc, 'Kaldır', canAfford(hc), () => {
        pay(hc);
        G.wounded = G.wounded.filter(x => x !== w);
        addCommander(w.cmd, { lv: w.lv, kills: w.kills, gear: w.gear, hpFrac: 0.5, x: w.x, y: w.y });
        spawnParts(w.x, w.y - 20, 8, { colors: ['#57d364', '#a8f0b0'], v: 35, life: 0.7, g: -25 });
        SFX.upgrade(); toast('🩹 ' + C.name + ' ayağa kalktı!');
        closePanel(); save();
      });
    } else { // eski kayıtlardan kalan yaralı asker
      const SC = SOLDIER_CLS[w.cls || 'sword'];
      elPanelTitle.textContent = '🩹 Yaralı ' + SC.name;
      const hc = { gold: 10 };
      pitem('🩹 Sar ve kaldır', 'Orduna yarı canla döner', hc, 'Kaldır', canAfford(hc) && G.soldiersOwned < soldierCap(), () => {
        pay(hc);
        G.wounded = G.wounded.filter(x => x !== w);
        G.soldiersOwned++;
        addSoldier(w.cls);
        const sl = G.soldiers[G.soldiers.length - 1];
        sl.hp = Math.round(sl.maxHp * 0.5); sl.x = w.x; sl.y = w.y;
        SFX.upgrade(); closePanel(); save();
      });
    }
  } else if (th.jail) {
    const site = th.jail, caps = jailCmds(site);
    elPanelTitle.textContent = '⛓️ Zindan — ' + OUTPOSTS[site].name.replace(' Karakolu', '');
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Demir parmaklıkların ardında yoldaşların tutuluyor. Burayı <b>fethedersen</b> hepsi özgür kalır ve safına döner.</div>';
    for (const m of caps) {
      const C = COMMANDERS[m.cmd];
      pitem(C.icon + ' ' + C.name + ' — ' + C.title + ' Sv.' + (m.lv || 1), 'Zincirli bekliyor... "Beni burada bırakma!"', null, '⛓️', false, () => { });
    }
    if (!G.outposts[site]) elPanelBody.innerHTML += '<div class="pdesc" style="margin-top:6px">⚔️ Kurtarmak için: ' + (site === 'camp1' ? 'kampın totemini yok et' : site === 'fort' ? 'kalenin kapısını kır, ganimet sandığını aç' : 'çelik kapıyı koçbaşıyla kır, büyük sandığı aç') + '</div>';
  } else if (th.kneel) {
    const pr = th.kneel, C = COMMANDERS[pr.cmd];
    elPanelTitle.textContent = '🏳️ ' + C.name + ' — ' + C.title;
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">"Beni yendin... Kılıcım artık senindir." <b>' + C.name + '</b> sancağının altına girmek istiyor. Komutanlar kapasiteden yemez, kendi leşleriyle seviye atlar; ölmez — esir düşer.</div>';
    pitem(C.icon + ' Safına kat', C.hp + '❤ ' + C.dmg + '⚔ · öncü hatta savaşır', null, 'Kat', true, () => {
      G.props = G.props.filter(x => x !== pr);
      addCommander(pr.cmd, { x: pr.x, y: pr.y });
      banner(C.icon + ' ' + C.name.toUpperCase() + ' SAFINDA!');
      toast(C.title + ' ' + C.name + ' artık senin komutanın — leş topladıkça güçlenecek');
      SFX.horn(); closePanel(); save();
    });
    pitem('🚶 Reddet', 'Kaderine terk et', null, 'Geç', true, () => { G.props = G.props.filter(x => x !== pr); closePanel(); });
  } else if (th.portal) {
    elPanelTitle.textContent = '✨ Çıkış Geçidi';
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Hazine sende — gün ışığı seni çağırıyor.</div>';
    pitem('🌞 İnden çık', 'Girdiğin yere dönersin', null, 'Çık', true, () => { closePanel(); leaveCave(true); });
  } else if (th.trade) {
    elPanelTitle.textContent = '🐪 Göçebe Tüccar';
    elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">"Hoş geldin savaşçı! Çölün en iyi fiyatları bende."'
      + '<br><b style="color:#ffd97e">👆 Takas düğmesini BASILI TUT</b> — art arda takas eder, bırakınca durur.</div>';
    // Takas butonu BASILI TUTULUNCA hızlıca birer birer devam eder (75 hurdayı
    // 15 kez tıklamak yerine parmağını basılı tut).
    const deal = (name, desc, check, apply) => {
      pitem(name, desc + ' · 👆 basılı tut = seri', null, 'Takas', check(), () => { apply(); SFX.coin(); });
      const btn = elPanelBody.lastElementChild && elPanelBody.lastElementChild.querySelector('button');
      if (!btn) return;
      let tekrar = null, ilk = null;
      const dur = () => { clearTimeout(ilk); clearInterval(tekrar); ilk = tekrar = null; };
      const bas = () => {
        dur();
        ilk = setTimeout(() => {                       // 350 ms basılı tutunca seri başlar
          tekrar = setInterval(() => {
            if (!check() || !document.body.contains(btn)) { dur(); renderPanel(); return; }
            apply(); SFX.coin(); updateHUD();
          }, 110);
        }, 350);
      };
      btn.addEventListener('pointerdown', bas);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => { if (tekrar) { dur(); renderPanel(); } else dur(); });
    };
    deal('🔩 5 hurda sat', '+12 🪙', () => G.res.scrap >= 5, () => { G.res.scrap -= 5; gain({ gold: 12 }, G.player.x, G.player.y - 30); });
    deal('⚙️ 1 demir al', '-10 🪙', () => G.res.gold >= 10, () => { G.res.gold -= 10; gain({ iron: 1 }, G.player.x, G.player.y - 30); });
    deal('⚙️ 5 demir al (toptan)', '-45 🪙', () => G.res.gold >= 45, () => { G.res.gold -= 45; gain({ iron: 5 }, G.player.x, G.player.y - 30); });
    deal('🪵 10 odun al', '-25 🪙', () => G.res.gold >= 25, () => { G.res.gold -= 25; gain({ wood: 10 }, G.player.x, G.player.y - 30); });
    deal('🪨 10 taş al', '-35 🪙', () => G.res.gold >= 35, () => { G.res.gold -= 35; gain({ stone: 10 }, G.player.x, G.player.y - 30); });
    deal('💎 1 mücevher sat', '+60 🪙', () => G.res.gems >= 1, () => { G.res.gems -= 1; gain({ gold: 60 }, G.player.x, G.player.y - 30); });
    deal('🍖 5 et sat', '+30 🪙 — "Taze av! Kervandakiler bayılır"', () => G.res.meat >= 5, () => { G.res.meat -= 5; gain({ gold: 30 }, G.player.x, G.player.y - 30); });
  } else if (th.site) {
    const st = th.site;
    elPanelTitle.textContent = '⚔️ ' + st.name;
    if (!G.built.siege) {
      elPanelBody.innerHTML = '<div class="pdesc">Kuşatma kurmak için önce köyde <b>Kuşatma Atölyesi</b> inşa etmelisin.</div>';
      return;
    }
    const S = G.sieges[st.id];
    const gate = G.structures.find(s2 => s2.kind === st.gateKind);
    if (gate && !gate.alive)
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:8px">Kapı kırıldı — hücum! ⚔️</div>';
    for (const [key, E] of Object.entries(ENGINES)) {
      const en = S[key];
      if (!en) {
        const ec = bcost(E.cost);
        pitem(E.icon + ' ' + E.name, E.desc + ' · inşaat ~' + Math.round(E.buildTime * 10 / 60) + ' dk', ec, 'Kur', canAfford(ec), () => {
          pay(ec);
          const [dx, dy] = st.slots[key];
          S[key] = { x: st.x + dx, y: st.y + dy, rx: st.x + dx, ry: st.y + dy, prog: 0, done: false, cd: 0, arm: 0, lunge: 0, dir: 0, hp: 260, maxHp: 260 };
          SFX.build(); toast(E.name + ' inşaatı başladı — şantiyede kal! 🔨');
          sortie(st);
          save();
        });
      } else if (!en.done) {
        pitem(E.icon + ' ' + E.name, 'İnşaat sürüyor — şantiyenin yakınında dur', null, '%' + Math.floor(en.prog / E.buildTime * 100), false, () => { });
      } else {
        pitem(E.icon + ' ' + E.name, key === 'ram' ? 'Kapıya ilerliyor ve dövüyor' : 'Kuruldu — otomatik çalışıyor', null, 'Hazır ✓', false, () => { });
      }
    }
  } else if (th.building) {
    const b = th.building, B = BUILDINGS[b.type];
    if (b.type === 'campfire') {
      elPanelTitle.textContent = '🏛️ Köy Konağı';
      elPanelBody.innerHTML = '<div class="pdesc" style="margin-bottom:10px">Köyünün kalbi: ocağın başında iyileşirsin, ölürsen burada yeniden doğarsın. Sur, genişletme, garnizon ve hanedan işleri buradan yönetilir.</div>';
      if (!G.palisade.built) {
        const pc = bcost(PAL.cost);
        pitem('🪵 Köy Suru inşa et', 'Köyü ahşap çitle çevirir; baskıncılar önce doğudaki kapıyı kırmak zorunda kalır', pc, 'İnşa', canAfford(pc),
          () => { pay(pc); G.palisade.built = true; G.palisade.gate.hp = PAL.gateHp; G.palisade.gate.alive = true; SFX.build(); banner('KÖY SURU DİKİLDİ!'); save(); });
      } else {
        if (!G.palisade.gate.alive || G.palisade.gate.hp < G.palisade.gate.maxHp) {
          const pr = bcost(PAL.repair);
          const bekle = gateWait('village');
          pitem('🚪 Köy kapısını onar', (G.palisade.gate.alive ? 'Kapı hasarlı' : 'Kapı kırık — geceleri köy savunmasız!') +
            (bekle ? ' · <b>ustalar ' + bekle + 'sn sonra hazır</b>' : ''), pr, bekle ? bekle + 'sn' : 'Onar', !bekle && canAfford(pr),
            () => { pay(pr); G.palisade.gate.hp = G.palisade.gate.maxHp; G.palisade.gate.alive = true; gateUsed('village'); SFX.build(); toast('Köy kapısı onarıldı! 🚪'); save(); });
        }
        if (G.palisade.lv < 2) {
          const p2 = bcost(PAL2.cost);
          pitem('🏰 Taş Sur\'a yükselt', 'Kazıklar taş sura dönüşür; kapı 500 → 1200 HP', p2, 'Yükselt', canAfford(p2),
            () => {
              pay(p2); G.palisade.lv = 2;
              G.palisade.gate.maxHp = PAL2.gateHp; G.palisade.gate.hp = PAL2.gateHp; G.palisade.gate.alive = true;
              rebuildPalisade(); // taş ayaklar daha sık dizilir
              SFX.build(); banner('TAŞ SUR YÜKSELDİ!'); save();
            });
        }
      }
      if (!VISIT && !ISLAND && G.villageTier < 1 + EXPANSIONS.length) {
        const ex = EXPANSIONS[G.villageTier - 1];
        const xc = bcost(ex.cost);
        pitem('🏗️ Köyü genişlet (Kademe ' + (G.villageTier + 1) + ')', '+' + ex.plots.length + ' yeni inşa arsası açılır', xc, 'Genişlet', canAfford(xc),
          () => {
            pay(xc); G.villageTier++;
            addExpansionPlots(G.villageTier);
            rebuildPalisade(); // sur da genişler
            spawnParts(CAMPFIRE.x, CAMPFIRE.y - 30, 16, { colors: ['#ffd257', '#fff3c9'], v: 60, life: 1.1, g: -25 });
            SFX.build(); banner('KÖY GENİŞLEDİ!');
            toast('+' + ex.plots.length + ' yeni arsa açıldı' + (G.palisade.built ? ', sur genişletildi 🏗️' : ''));
            save();
          });
      }
      const vop = G.outposts.village;
      if (vop)
        pitem('⚖️ Köy garnizonu', 'Sen uzaktayken köyü savunacak askerler (' + vop.garrison + '/' + garrisonCap(vop) + ')', null, 'Aç', true,
          () => { G.panelFor = { gar: 'village' }; renderPanel(); });

      pitem('⚙️ Oto yönetim (köy)', G.autoVillage !== false ? 'AÇIK — köy deposuyla kendini onarır, kurar, genişler, asker basar' : 'KAPALI — her şey elle', null,
        G.autoVillage !== false ? 'Kapat' : 'Aç', true, () => { G.autoVillage = G.autoVillage === false; SFX.build(); toast('⚙️ Köy oto yönetim: ' + (G.autoVillage !== false ? 'AÇIK' : 'KAPALI')); save(); renderPanel(); });
      pitem('🏬 Köy Deposu', 'Stok: 🍖' + Math.floor(G.stock.meat) + ' 🪵' + Math.floor(G.stock.wood) + ' 🪨' + Math.floor(G.stock.stone) + ' · limit ' + stockCap() + (G.famine ? ' — <b style="color:#ff9a8a">ET BİTTİ!</b>' : ''), null, 'Aç', true,
        () => { G.panelFor = { stockPage: true }; renderPanel(); });
      // Ziyafet: av etiyle ordu doyar — tam can + kısa yürüyüş morali
      pitem('🍖 Ziyafet ver', G.feastT > 0 ? 'Ziyafet sürüyor! (+%10 hız, ' + Math.ceil(G.feastT) + 'sn)' : 'Ocakta et çevrilir: sen + tüm ordu TAM CAN, 60sn +%10 hız', { meat: 8 }, 'Ziyafet', G.feastT <= 0 && G.res.meat >= 8, () => {
        pay({ meat: 8 });
        const p2 = G.player;
        p2.hp = p2.maxHp;
        for (const u of [...G.soldiers, ...G.commanders, ...G.garrisonUnits]) u.hp = u.maxHp;
        G.feastT = 60;
        spawnParts(p2.x, p2.y - 24, 16, { colors: ['#ffd257', '#ff9a2e', '#57d364'], v: 55, life: 1.0, g: -25 });
        banner('🍖 ZİYAFET!');
        toast('Ocak başında et çevrildi — ordu doydu: tam can + 60sn hız!');
        SFX.upgrade(); save();
      });
      if (!G.horseOwned)
        pitem('🐴 Savaş Atı satın al', 'Hızın ×1.55 — [H] ile bin/in', { gold: 150 }, 'Satın al', canAfford(bcost({ gold: 150 })), () => {
          pay(bcost({ gold: 150 })); G.horseOwned = true; G.riding = true;
          SFX.upgrade(); banner('🐴 SAVAŞ ATIN HAZIR!'); toast('[H] tuşu ya da Konak menüsünden bin/in'); save();
        });
      else
        pitem('🐴 Savaş Atı', G.riding ? 'At üstündesin — hız ×1.55' : 'Atın ahırda dinleniyor', null, G.riding ? 'İn' : 'Bin', true,
          () => { G.riding = !G.riding; SFX.build(); save(); });
      return;
    }
    elPanelTitle.textContent = B.icon + ' ' + B.name + ' (Sv.' + b.lv + ')' + (b.ruined ? ' — YIKIK' : '');
    if (b.ruined) {
      const rc = bcost(repairCost(b.type));
      pitem('🔧 Onar', 'Bina yıkıldı, onarılana dek çalışmaz', rc, 'Onar', canAfford(rc),
        () => { pay(rc); b.ruined = false; b.hp = b.maxHp; SFX.build(); toast(B.name + ' onarıldı!'); save(); });
      return;
    }
    // Hasarlı ama ayakta: hasar oranına göre tamir, bina başına 60 sn bekleme
    if (bldHurt(b)) {
      const fc = bcost(fixCost(b));
      const bek = gateWait(bldKey(b));
      const yuzde = Math.round(100 * b.hp / b.maxHp);
      pitem('🔧 Tamir et', 'Bina hasarlı: ❤️ ' + Math.ceil(b.hp) + '/' + b.maxHp + ' (%' + yuzde + ')' +
        (bek ? ' — ustalar dinleniyor, ' + bek + ' sn' : ''), fc, bek ? '⏳ ' + bek + 'sn' : 'Tamir et',
        !bek && canAfford(fc),
        () => {
          pay(fc); b.hp = b.maxHp; gateUsed(bldKey(b)); delete b.fixPaid;
          spawnParts(b.x, b.y - 30, 10, { colors: ['#cfe0ff', '#9ab0d0'], v: 50, life: 0.7, g: 60 });
          SFX.build(); toast(B.name + ' tamir edildi 🔧'); save();
        });
    }
    // yükseltmeler artık menüsüz: binanın yanında dur, kaynaklar uçarak gitsin
    if (b.type === 'house') {
      if (!b.villager) {
        pitem('👤 Köylü davet et', 'Bu eve bir köylü yerleşir', VILLAGER_COST, 'Davet et', canAfford(VILLAGER_COST),
          () => { pay(VILLAGER_COST); b.villager = true; SFX.build(); toast('Köyüne yeni bir köylü katıldı! 👤'); save(); });
      } else {
        for (const [jk, J] of Object.entries(VILLAGER_JOBS)) {
          const active = b.job === jk;
          const amt = b.lv >= 2 ? 2 : 1;
          pitem(J.icon + ' ' + J.name + (active ? ' ✓' : ''), `+${amt} ${J.icon} / ${J.every}sn`, null,
            active ? 'Aktif' : 'Ata', !active, () => { b.job = jk; b.prodT = 0; SFX.build(); toast('Köylü artık ' + J.name.toLowerCase() + ' 💪'); save(); });
        }
      }
    }
    if (b.type === 'blacksmith') {
      pitem('Hurda erit', '5 🔩 → 1 ⚙️ demir', { scrap: 5 }, 'Erit', G.res.scrap >= 5, () => { pay({ scrap: 5 }); gain({ iron: 1 }, b.x, b.y - 40); SFX.build(); });
      if (G.res.scrap >= 10) {
        const batch = Math.floor(G.res.scrap / 5);
        pitem('Hepsini erit', batch * 5 + ' 🔩 → ' + batch + ' ⚙️', null, 'Hepsi', true,
          () => { pay({ scrap: batch * 5 }); gain({ iron: batch }, b.x, b.y - 40); SFX.build(); });
      }
      // silah/zırh geliştirme kalktı: güç artık düşen KUŞAM eşyalarından geliyor
      pitem('🎒 Kuşam & Çanta', 'Ganimet eşyalarını kuşan — kendine ve komutanlarına (şu an ⚔️' + playerAtk() + ' ❤️' + playerMaxHp() + ')', null, 'Aç', true,
        () => { G.panelFor = { gearPage: 'player' }; renderPanel(); });
    }
    if (b.type === 'barracks') {
      const cap = soldierCap();
      elPanelBody.innerHTML += `<div class="pdesc" style="margin-bottom:6px">Ordu: ${G.soldiersOwned}/${cap} — kapasite karakter seviyenle artar (Sv.${G.level}). Kışla yükseltmesi yeni birim açar.</div>`;
      const UNIT_UNLOCK = { sword: 1, bow: 2, shield: 3 }; // kışla seviyesi şartı
      for (const [ck, SC] of Object.entries(SOLDIER_CLS)) {
        const need = UNIT_UNLOCK[ck] || 1;
        if (b.lv >= need)
          pitem(SC.icon + ' ' + SC.name + ' eğit', SC.desc + ` · ${SC.hp}❤ ${SC.dmg}⚔`, SC.cost, 'Eğit',
            G.soldiersOwned < cap && canAfford(SC.cost),
            () => { pay(SC.cost); G.soldiersOwned++; addSoldier(ck); SFX.build(); toast(SC.name + ' orduna katıldı! ' + SC.icon); save(); });
        else
          pitem('🔒 ' + SC.icon + ' ' + SC.name, 'Kışla Sv.' + need + ' gerekli — kaynak getir, kışla kendiliğinden yükselsin', null, 'Kilitli', false, () => { });
      }
      // kışla yükseltmesi menüsüz: binanın yanında kaynakla bekle
    }
    if (b.type === 'siege') {
      elPanelBody.innerHTML += '<div class="pdesc">Ustaların hazır. Kuşatma silahları düşman kapılarının önündeki <b>⚔️ kuşatma kamplarında</b> yerinde inşa edilir: kaynakları yanına al, kampa git, silahı seç ve inşaat bitene dek şantiyede kal. Silahlar kuruldukları kuşatmada kalır.</div>';
    }
    // "Binayı yık" kaldırıldı: arsalar planlı ve her tip zaten üsse bir kez
    // kuruluyor, yıkmanın bir faydası kalmadı — yanlışlıkla basılan bir düğmeydi.
    // Pasif üreticilerin paneli yıkım düğmesi gidince boş kalıyordu: ne yaptıkları
    // ve nereye ürettikleri yazsın (üretim üssün KENDİ ambarına gider — v4.2).
    if (!elPanelBody.innerHTML) {
      const nere = b.outpost && OUTPOSTS[b.outpost] ? OUTPOSTS[b.outpost].name.replace(' Karakolu', '') + ' ambarına' : 'köy deposuna';
      const bilgi = b.type === 'sawmill' ? '🪵 ' + (b.lv >= 2 ? 2 : 1) + ' odun / 8 sn → ' + nere
        : b.type === 'hunter' ? '🍖 ' + (b.lv >= 2 ? 2 : 1) + ' et / 10 sn → ' + nere
        : b.type === 'watchtower' ? '🏹 Menzile giren düşmana kendiliğinden ok atar'
        : b.type === 'depot' ? '🏬 Depo limiti +' + (b.lv * 200) + ' (her kaynak)'
        : B.desc;
      elPanelBody.innerHTML = '<div class="pdesc">' + bilgi
        + '<br><br>Kendiliğinden çalışır. Yükseltmek için kaynakları yanına getir — '
        + 'teslimat bitince bina kendi kendine yükselir.</div>';
    }
  }
  if (!elPanelBody.innerHTML) elPanelBody.innerHTML = '<div class="pdesc">Şimdilik yapılacak bir şey yok.</div>';
}
// Planlı şantiye tamamlandı: bedeli teslimatla ödendi, bina kendiliğinden yükselir
function constructAt(pl) {
  const type = pl.plan, B = BUILDINGS[type];
  delete pl.paid;
  if (coopSlave()) coopSend('act', { k: 'build', pi: G.plots.indexOf(pl), t: type }); // ev sahibinde de kurulsun
  pl.built = type; G.built[type] = Math.max(G.built[type] || 0, 1);
  G.buildings.push({ type, x: pl.x, y: pl.y, lv: 1, hp: buildingMaxHp(1), maxHp: buildingMaxHp(1), ruined: false, outpost: pl.outpost || null });
  if (ISLAND) { // ortak üs: inşan yoldaşlara da işlensin
    (G.islOps.built = G.islOps.built || {})[islKey(pl.x, pl.y)] = { type, lv: 1 };
    islContrib('built', 1);
  }
  SFX.build(); toast(B.name + ' inşa edildi! ' + B.icon);
  spawnDust(pl.x, pl.y, 12);
  spawnParts(pl.x, pl.y - 30, 12, { colors: ['#ffd257', '#fff3c9', '#f0b93d'], v: 45, life: 1.0, g: -25, r: 3 });
  save();
}
function buildAt(plot, type) {
  const B = BUILDINGS[type];
  const bc = bcost(B.cost);
  if (!canAfford(bc)) { SFX.no(); return; }
  pay(bc);
  plot.built = type; G.built[type] = 1;
  G.buildings.push({ type, x: plot.x, y: plot.y, lv: 1, hp: buildingMaxHp(1), maxHp: buildingMaxHp(1), ruined: false });
  SFX.build(); toast(B.name + ' inşa edildi! ' + B.icon);
  spawnDust(plot.x, plot.y, 12);
  spawnParts(plot.x, plot.y - 30, 12, { colors: ['#ffd257', '#fff3c9', '#f0b93d'], v: 45, life: 1.0, g: -25, r: 3 });
  closePanel(); save();
}
// Sıradaki yükseltmenin bedeli (yoksa null) — menüsüz teslimat sistemi bunu okur
function nextUpCost(b) {
  const B = BUILDINGS[b.type];
  if (!B) return null; // Konak (campfire) gibi sözlük dışı yapılar
  if (b.lv === 1 && B.lv2) return B.lv2.cost;
  if (b.lv === 2 && B.lv3) return B.lv3.cost;
  return null;
}
function applyUpgrade(b) {
  if (coopSlave()) coopSend('act', { k: 'up', pi: G.plots.findIndex(p => p.x === b.x && p.y === b.y) });
  delete b.upPaid;
  b.lv++; G.built[b.type] = Math.max(G.built[b.type] || 0, b.lv);
  b.maxHp = buildingMaxHp(b.lv); b.hp = b.maxHp;
  if (ISLAND) {
    (G.islOps.built = G.islOps.built || {})[islKey(b.x, b.y)] = { type: b.type, lv: b.lv };
    islContrib('built', 1);
  }
  spawnParts(b.x, b.y - 40, 14, { colors: ['#ffd257', '#fff3c9', '#f0b93d'], v: 45, life: 1.1, g: -25, r: 3 });
  SFX.upgrade(); toast(BUILDINGS[b.type].name + ' Sv.' + b.lv + ' oldu! ⬆'); save();
}
function upgradeBuilding(b, cost) { // (miras sarmalayıcı)
  cost = bcost(cost);
  if (!canAfford(cost)) { SFX.no(); return; }
  pay(cost); applyUpgrade(b);
}

// ---------- Girdi ----------
const keys = {};
let attackHeld = false, mouseAim = null;
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (MENU_OPEN) return; // menüdeyken oyun girdisi kapalı
  if (G.infil) { if (e.code === 'Space' || e.code === 'KeyE') { infilTap(); e.preventDefault(); } return; }
  keys[e.code] = true;
  if (e.code === 'Space') { attackHeld = true; e.preventDefault(); }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyH' && G.horseOwned) { G.riding = !G.riding; toast(G.riding ? '🐴 Ata bindin — rüzgar gibisin!' : '🐴 Attan indin'); save(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') { dodge(); e.preventDefault(); }
  if (e.code === 'Escape') { closePanel(); toggleMap(false); }
  audio();
});
window.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space') attackHeld = false; });

const joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
const elJoy = $('joy'), elKnob = $('joyKnob');
canvas.addEventListener('pointerdown', e => {
  audio();
  if (G.infil) { infilTap(); return; } // sızma: her dokunuş "durdur"
  if (e.pointerType === 'touch' && e.clientX < VW * 0.55 && !joy.active) {
    joy.active = true; joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.dx = 0; joy.dy = 0;
    elJoy.classList.remove('hidden');
    elJoy.style.left = (joy.cx - 65) + 'px'; elJoy.style.top = (joy.cy - 65) + 'px';
    elKnob.style.left = '37px'; elKnob.style.top = '37px';
  } else if (e.pointerType === 'mouse') {
    mouseAim = { x: e.clientX, y: e.clientY }; attackHeld = true;
  } else if (e.pointerType === 'touch') {
    doAttack(); // sağ tarafa dokunuş = saldırı
  }
});
window.addEventListener('pointermove', e => {
  if (joy.active && e.pointerId === joy.id) {
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const m = Math.hypot(dx, dy), max = 52;
    if (m > max) { dx = dx / m * max; dy = dy / m * max; }
    joy.dx = dx / max; joy.dy = dy / max;
    elKnob.style.left = (37 + dx) + 'px'; elKnob.style.top = (37 + dy) + 'px';
  } else if (mouseAim && e.pointerType === 'mouse') { mouseAim = { x: e.clientX, y: e.clientY }; }
});
window.addEventListener('pointerup', e => {
  if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; elJoy.classList.add('hidden'); }
  if (e.pointerType === 'mouse') { attackHeld = false; mouseAim = null; }
});
$('btnAttack').addEventListener('pointerdown', e => { e.stopPropagation(); audio(); if (G.infil) { infilTap(); return; } attackHeld = true; doAttack(); });
$('btnAttack').addEventListener('pointerup', () => { attackHeld = false; });
$('btnDodge').addEventListener('pointerdown', e => { e.stopPropagation(); audio(); dodge(); });
elBtnInteract.addEventListener('pointerdown', e => { e.stopPropagation(); interact(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function interact() {
  if (G.panelFor) { closePanel(); return; }
  computeNear();
  if (G.nearThing) openPanel(G.nearThing);
}

// ---------- Bölge haritası & yolculuk ----------
const elMapOverlay = $('mapOverlay'), mapCv = $('mapCanvas');
let mapOpen = false, mapLastDraw = -9, mapScale = 1, mapPad = 26;
function toggleMap(force) {
  mapOpen = force !== undefined ? force : !mapOpen;
  elMapOverlay.classList.toggle('hidden', !mapOpen);
  if (mapOpen) { closePanel(); drawMap(); }
}
$('mapClose').addEventListener('click', () => toggleMap(false));
// ses aç/kapat
const elMute = $('btnMute');
function setMute(m2) {
  muted = m2;
  try { localStorage.setItem('kd-mute', m2 ? '1' : '0'); } catch (e) { }
  if (MASTER) MASTER.gain.value = m2 ? 0 : 0.6;
  elMute.textContent = m2 ? '🔇' : '🔊';
}
elMute.addEventListener('pointerdown', e => { e.stopPropagation(); audio(); setMute(!muted); });
setMute(muted);
// zafer ekranı butonları
$('vicStay').addEventListener('click', () => $('victory').classList.add('hidden'));
$('vicMigrate').addEventListener('click', () => {
  $('victory').classList.add('hidden');
  openWorld(true); // cihan haritasından yeni sefer seç
});
// HUD'daki isme tıkla → adını değiştir (çevrimdışı oyuncunun tek yolu bu;
// çevrimiçiyse aynı anda sunucuya ve yoldaşlara da işlenir)
$('playerName').addEventListener('click', e => {
  e.stopPropagation();
  if (VISIT || MENU_OPEN) return;
  const nm = prompt('Adın (2-24 harf):', playerName());
  if (nm !== null) setPlayerName(nm);
});
$('btnMap').addEventListener('pointerdown', e => { e.stopPropagation(); audio(); toggleMap(); });
// Çanta + Sız butonları: pointerdown BAZEN yutulabiliyor → click de dinlenir
// (çifte tetikleme zaman korumasıyla engellenir; blur = odaklanan butonu Space'in tetiklemesini önler)
let bagTapT = 0;
const bagTap = e => {
  e.stopPropagation(); e.preventDefault();
  if (performance.now() - bagTapT < 350) return;
  bagTapT = performance.now();
  try { audio(); } catch (e2) { }
  $('btnBag').blur();
  if (G.infil || MENU_OPEN) return;
  if (G.panelFor && G.panelFor.gearPage) { closePanel(); return; }
  toggleMap(false); openPanel({ gearPage: 'player' });
};
$('btnBag').addEventListener('pointerdown', bagTap);
$('btnBag').addEventListener('click', bagTap);
// 🎖️ Ordu paneli (aynı çifte-tetik korumalı desen)
let armyTapT = 0;
const armyTap = e => {
  e.stopPropagation(); e.preventDefault();
  if (performance.now() - armyTapT < 350) return;
  armyTapT = performance.now();
  try { audio(); } catch (e2) { }
  $('btnArmy').blur();
  if (G.infil || MENU_OPEN) return;
  if (G.panelFor && G.panelFor.armyPage) { closePanel(); return; }
  toggleMap(false); openPanel({ armyPage: true });
};
$('btnArmy').addEventListener('pointerdown', armyTap);
$('btnArmy').addEventListener('click', armyTap);
// 🤝 Yoldaşlar / 🌍 Cihan / ⚙️ Ayarlar HUD butonları (aynı korumalı desen)
const mkHudBtn = (id, fn) => {
  let tT = 0;
  const h = e => {
    e.stopPropagation(); e.preventDefault();
    if (performance.now() - tT < 350) return;
    tT = performance.now();
    try { audio(); } catch (e2) { }
    $(id).blur();
    if (G.infil || MENU_OPEN) return;
    fn();
  };
  $(id).addEventListener('pointerdown', h);
  $(id).addEventListener('click', h);
};
mkHudBtn('btnFriends', () => {
  if (G.panelFor && G.panelFor.friendsPage) { closePanel(); return; }
  toggleMap(false); openPanel({ friendsPage: true }); netRefreshSocial();
});
mkHudBtn('btnWorld', () => { toggleMap(false); closePanel(); openWorld(G.victoryShown); });
mkHudBtn('btnSettings', () => {
  if (G.panelFor && G.panelFor.optsPage) { closePanel(); return; }
  toggleMap(false); openPanel({ optsPage: true });
});
let infilTapT = 0;
const infilBtnTap = e => {
  e.stopPropagation(); e.preventDefault();
  if (performance.now() - infilTapT < 350) return;
  infilTapT = performance.now();
  try { audio(); } catch (e2) { }
  $('btnInfil').blur();
  if (G.infilCd > 0 || G.infil) return;
  const st = nearSiegeSite();
  if (st) startInfil(st);
};
$('btnInfil').addEventListener('pointerdown', infilBtnTap);
$('btnInfil').addEventListener('click', infilBtnTap);
elMapOverlay.addEventListener('pointerdown', e => { if (e.target === elMapOverlay) toggleMap(false); });
function locStatus(id) {
  const op = G.outposts[id];
  if (op && op.owned) return op.looted ? '⚠️' : '✓';
  if (id === 'camp1' && G.camp1Destroyed) return '✓';
  if (id === 'fort' && G.chestOpened) return '✓';
  if (id === 'legion' && G.legionConquered) return '✓';
  return '';
}
function drawMap() {
  mapLastDraw = G.t;
  const availW = Math.max(340, Math.min(window.innerWidth * 0.94, 1400));   // taban: ölçüm henüz 0 iken harita kaybolmasın
  const availH = Math.max(260, window.innerHeight * 0.94 - 165);            // başlık + araç butonları + ipucu payı
  mapScale = Math.min((availW - mapPad * 2) / OVERWORLD_W, (availH - mapPad * 2) / WORLD.h);
  const cw = OVERWORLD_W * mapScale + mapPad * 2, ch = WORLD.h * mapScale + mapPad * 2;
  mapCv.width = cw * DPR; mapCv.height = ch * DPR;
  mapCv.style.width = cw + 'px'; mapCv.style.height = ch + 'px';
  const m = mapCv.getContext('2d');
  m.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W2S = (x, y) => [mapPad + x * mapScale, mapPad + y * mapScale];
  // parşömen zemin
  const pg = m.createLinearGradient(0, 0, cw, ch);
  pg.addColorStop(0, '#d9c4a0'); pg.addColorStop(1, '#c4ab82');
  m.fillStyle = pg; m.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 40; i++) {
    m.fillStyle = 'rgba(120,90,50,0.05)';
    m.beginPath(); m.ellipse(rr(0, cw), rr(0, ch), rr(20, 70), rr(12, 40), rr(0, TAU), 0, TAU); m.fill();
  }
  m.strokeStyle = '#8a6c3a'; m.lineWidth = 2; m.strokeRect(4, 4, cw - 8, ch - 8);
  // su
  m.fillStyle = '#7fb3ae';
  m.beginPath(); m.moveTo(mapPad, mapPad);
  for (let y = 0; y <= WORLD.h; y += 80) { const [sx2, sy2] = W2S(shoreX(y), y); m.lineTo(sx2, sy2); }
  const [, bY] = W2S(0, WORLD.h); m.lineTo(mapPad, bY); m.closePath(); m.fill();
  // yollar
  m.strokeStyle = 'rgba(110,80,40,0.55)'; m.lineWidth = 2; m.setLineDash([5, 4]);
  const roads = [
    [CAMPFIRE, RUINS], [RUINS, FOREST], [CAMPFIRE, QUARRY], [QUARRY, MERCHANT],
    [RUINS, MERCHANT], [RUINS, { x: CAMP1.x - 60, y: CAMP1.y + 160 }],
    [MERCHANT, { x: FORT.x0 - 200, y: (FORT.gateY0 + FORT.gateY1) / 2 }],
    [{ x: CAMP1.x, y: CAMP1.y + 100 }, { x: LEG.cx, y: LEG.y1 + 190 }],
  ];
  for (const [a, b] of roads) {
    const [ax, ay] = W2S(a.x, a.y), [bx, by] = W2S(b.x, b.y);
    m.beginPath(); m.moveTo(ax, ay); m.lineTo(bx, by); m.stroke();
  }
  m.setLineDash([]);
  // yolculuk çizgisi
  if (G.autoTravel) {
    const [px2, py2] = W2S(G.player.x, G.player.y);
    const [wx2, wy2] = W2S(...G.autoTravel.pts[G.autoTravel.pts.length - 1]);
    m.strokeStyle = 'rgba(180,50,35,0.8)'; m.lineWidth = 2.5; m.setLineDash([7, 5]);
    m.beginPath(); m.moveTo(px2, py2); m.lineTo(wx2, wy2); m.stroke(); m.setLineDash([]);
  }
  // lokasyonlar (keşif durumuna göre)
  m.textAlign = 'center';
  for (const L of LOCATIONS) {
    const [x, y] = W2S(L.x, L.y);
    const st2 = G.discovered[L.id] || 0;
    if (!st2) { // bilinmiyor
      m.fillStyle = 'rgba(90,80,60,0.4)';
      m.beginPath(); m.arc(x, y, 14, 0, TAU); m.fill();
      m.strokeStyle = 'rgba(60,45,25,0.5)'; m.lineWidth = 1.5; m.stroke();
      m.font = 'bold 14px sans-serif'; m.fillStyle = 'rgba(50,38,18,0.8)'; m.fillText('?', x, y + 5);
      continue;
    }
    m.globalAlpha = st2 === 1 ? 0.55 : 1;
    m.fillStyle = 'rgba(40,28,12,0.85)';
    m.beginPath(); m.arc(x, y, 17, 0, TAU); m.fill();
    m.strokeStyle = '#ffd97e'; m.lineWidth = 1.5; m.stroke();
    m.font = '16px sans-serif'; m.fillText(L.icon, x, y + 6);
    m.font = 'bold 11px sans-serif';
    m.fillStyle = '#3a2a10';
    m.fillText(L.name + (st2 === 1 ? ' (söylenti)' : locStatus(L.id) ? ' ✓' : ''), x, y + 32);
    m.globalAlpha = 1;
  }
  // esir komutanlar: tutuldukları zindanın altında görünür
  for (const [site, arr] of Object.entries(G.prisoners)) {
    const names = arr.filter(m2 => m2.cmd).map(m2 => COMMANDERS[m2.cmd].name);
    if (!names.length) continue;
    const O = OUTPOSTS[site];
    const [sx3, sy3] = W2S(O.x, O.y);
    m.font = 'bold 11px sans-serif'; m.textAlign = 'center';
    m.fillStyle = '#a83232';
    m.fillText('🔒 ' + names.join(', '), sx3, sy3 + 46);
  }
  // Kara Vulkar'ın çetesi
  if (G.rival.alive) {
    const [rx2, ry2] = W2S(G.rival.x, G.rival.y);
    m.fillStyle = 'rgba(50,20,50,0.85)';
    m.beginPath(); m.arc(rx2, ry2, 13, 0, TAU); m.fill();
    m.strokeStyle = '#7a4fa0'; m.lineWidth = 1.5; m.stroke();
    m.font = '13px sans-serif'; m.fillText('💀', rx2, ry2 + 4);
    m.font = 'bold 10px sans-serif'; m.fillStyle = '#4a2a5a';
    m.fillText(RIVALC().name + (G.rival.tribute > 0 ? ' (haraçlı)' : ''), rx2, ry2 + 26);
  }
  // Dağ Devi + kervanlar
  const troll = G.enemies.find(e2 => e2.type === 'troll');
  if (troll) {
    const [tx2, ty2] = W2S(troll.x, troll.y);
    m.font = '16px sans-serif'; m.fillText('👹', tx2, ty2 + 5);
  }
  for (const cv of G.caravans) {
    const [cx3, cy3] = W2S(cv.x, cv.y);
    m.font = '11px sans-serif'; m.textAlign = 'center'; m.fillText('🐴', cx3, cy3 + 4);
    if (cv.supply) { m.font = 'bold 8.5px sans-serif'; m.fillStyle = '#3f5220'; m.fillText(cv.amount + cv.icon, cx3, cy3 - 8); }
  }
  // görevdeki komutanlar: haritada isimli işaret
  m.textAlign = 'center';
  for (const c of G.commanders) {
    if (!cmdIndependent(c)) continue;
    const C = COMMANDERS[c.id];
    const [cx4, cy4] = W2S(c.x, c.y);
    m.fillStyle = 'rgba(60,40,110,0.85)';
    m.beginPath(); m.arc(cx4, cy4, 9, 0, TAU); m.fill();
    m.strokeStyle = '#e8d9ff'; m.lineWidth = 1.5; m.stroke();
    m.font = '10px sans-serif'; m.fillText(C.icon, cx4, cy4 + 3.5);
    m.font = 'bold 9px sans-serif'; m.fillStyle = '#3a2a5a';
    m.fillText(C.name + (c.order === 'raid' ? ' 💰' : ' 🛡️') + ((c.troops || []).length ? ' +' + c.troops.length : ''), cx4, cy4 - 13);
  }
  // düşman devriye kolları: kızıl işaret
  for (const [siteP, spP] of Object.entries(G.sitePatrols || {})) {
    if (!spP.active || !spP.active.leader || spP.active.leader.hp <= 0) continue;
    const ld = spP.active.leader;
    const [lx2, ly2] = W2S(ld.x, ld.y);
    m.font = '11px sans-serif'; m.fillText('🚩', lx2, ly2 + 4);
    m.font = 'bold 8.5px sans-serif'; m.fillStyle = '#7a1f14';
    m.fillText(spP.active.attack ? 'saldırı kolu!' : 'devriye', lx2, ly2 - 9);
  }
  // YARALI YOLDAŞLAR: nerede düştüklerini haritadan gör, git kaldır.
  // (Uzun süre terk edilirlerse düşman zindanına esir düşüyorlar — bu yüzden
  //  yerlerini görebilmek kritik.)
  for (const w of G.wounded) {
    const [wx3, wy3] = W2S(w.x, w.y);
    const nb = 0.6 + Math.sin(G.t * 4 + w.x) * 0.4;
    m.fillStyle = 'rgba(200,40,30,' + (0.16 + nb * 0.14) + ')';
    m.beginPath(); m.arc(wx3, wy3, 16 + nb * 5, 0, TAU); m.fill();
    m.fillStyle = '#c03a2e';
    m.beginPath(); m.arc(wx3, wy3, 7, 0, TAU); m.fill();
    m.strokeStyle = '#fff'; m.lineWidth = 2; m.stroke();
    m.font = '11px sans-serif'; m.textAlign = 'center'; m.fillStyle = '#fff';
    m.fillText('🩸', wx3, wy3 + 4);
    m.font = 'bold 9.5px sans-serif'; m.lineJoin = 'round';
    const ad = (w.name || (w.cmd && COMMANDERS[w.cmd] && COMMANDERS[w.cmd].name) || 'Yaralı asker') + ' — yaralı!';
    m.lineWidth = 3; m.strokeStyle = 'rgba(12,16,22,0.75)'; m.strokeText(ad, wx3, wy3 - 13);
    m.fillStyle = '#ff9a8a'; m.fillText(ad, wx3, wy3 - 13);
  }
  // TESLİM OLAN KOMUTANLAR: beyaz bayrakla diz çökmüş bekliyorlar. Yanlarına
  // gidip konuşmadan safa katılmıyorlar, o yüzden yerlerini haritadan görmek şart.
  for (const pr of G.props) {
    if (pr.kind !== 'kneel' || !COMMANDERS[pr.cmd]) continue;
    const [kx, ky] = W2S(pr.x, pr.y);
    const nb = 0.6 + Math.sin(G.t * 3 + pr.x) * 0.4;
    // parşömen zeminde beyaz soluk kalıyordu: koyu halka + mavi-gri nabız
    m.fillStyle = 'rgba(90,120,160,' + (0.16 + nb * 0.16) + ')';
    m.beginPath(); m.arc(kx, ky, 16 + nb * 5, 0, TAU); m.fill();
    m.fillStyle = '#3f4d63';
    m.beginPath(); m.arc(kx, ky, 8, 0, TAU); m.fill();
    m.strokeStyle = '#fff'; m.lineWidth = 2; m.stroke();
    m.font = '11px sans-serif'; m.textAlign = 'center';
    m.fillText('🏳️', kx, ky + 4);
    m.font = 'bold 9.5px sans-serif'; m.lineJoin = 'round';
    const ad = COMMANDERS[pr.cmd].name + ' — teslim oldu';
    m.lineWidth = 3; m.strokeStyle = 'rgba(12,16,22,0.75)'; m.strokeText(ad, kx, ky - 13);
    m.fillStyle = '#fff3d9'; m.fillText(ad, kx, ky - 13);
  }
  // oyuncu (indeyse mağara girişinde göster)
  const [px, py] = G.caveRun ? W2S(CAVE.x, CAVE.y) : W2S(G.player.x, G.player.y);
  m.fillStyle = '#c03a2e';
  m.beginPath(); m.arc(px, py, 6 + Math.sin(G.t * 5) * 1.5, 0, TAU); m.fill();
  m.strokeStyle = '#fff'; m.lineWidth = 2; m.stroke();
  m.fillStyle = '#7a1f14'; m.font = 'bold 10px sans-serif'; m.fillText('SEN', px, py - 12);
  // gece göstergesi
  if (G.night) { m.fillStyle = 'rgba(20,30,80,0.18)'; m.fillRect(0, 0, cw, ch); }
  // editör katmanı: sürüklenebilir işaretçiler
  if (mapEditMode && editGeo) {
    m.fillStyle = 'rgba(20,10,5,0.25)'; m.fillRect(0, 0, cw, ch);
    m.textAlign = 'center';
    for (const [k, icon, label] of EDIT_MARKERS) {
      const p2 = editGeo[k];
      const x = mapPad + p2.x * mapScale, y = mapPad + p2.y * mapScale;
      m.fillStyle = dragKey === k ? 'rgba(240,185,61,0.95)' : 'rgba(40,28,12,0.9)';
      m.beginPath(); m.arc(x, y, 19, 0, TAU); m.fill();
      m.strokeStyle = dragKey === k ? '#fff' : '#ffd97e'; m.lineWidth = 2;
      m.stroke();
      m.setLineDash([4, 4]); m.strokeStyle = 'rgba(255,217,126,0.5)';
      m.beginPath(); m.arc(x, y, 24, 0, TAU); m.stroke(); m.setLineDash([]);
      m.font = '17px sans-serif'; m.fillText(icon, x, y + 6);
      m.font = 'bold 10px sans-serif'; m.fillStyle = '#3a2a10';
      m.fillText(label, x, y + 38);
    }
  }
}
mapCv.addEventListener('pointerdown', e => {
  if (mapEditMode) { editorPointerDown(e); return; }
  const r = mapCv.getBoundingClientRect();
  const mx2 = e.clientX - r.left, my2 = e.clientY - r.top;
  for (const L of LOCATIONS) {
    const x = mapPad + L.x * mapScale, y = mapPad + L.y * mapScale;
    if (Math.hypot(mx2 - x, my2 - y) < 30) {
      if (!G.discovered[L.id]) { toast('Burayı henüz bilmiyorsun — keşfet ya da söylenti topla', true); return; }
      startTravel(L); toggleMap(false); return;
    }
  }
});

// ---------- Harita Editörü: işaretçileri sürükle, kaydet — yeni dünya kurulumunda geçerli ----------
const EDIT_MARKERS = [
  ['campfire', '🏠', 'Köy'], ['forest', '🌲', 'Orman'], ['quarry', '⛏️', 'Taş Ocağı'], ['ruins', '🏛️', 'Harabeler'],
  ['merchant', '🐪', 'Tüccar'], ['camp1', '⛺', 'Barbar Kampı'], ['fort', '🏰', 'Taş Kale'], ['legion', '🦅', 'Lejyon'],
  ['cave', '🕳️', 'Karanlık İn'],
];
let mapEditMode = false, editGeo = null, dragKey = null;
function setEditMode(on) {
  mapEditMode = on;
  if (on) {
    editGeo = JSON.parse(JSON.stringify(CUSTOM_MAPS[LAYOUT_IDX] || geoSnapshot()));
    if (!editGeo.cave) editGeo.cave = { x: CAVE.x, y: CAVE.y }; // eski özel haritalarda mağara yoksa
  }
  $('mapEdit').textContent = on ? '✕ Düzenlemeyi kapat' : '🛠️ Düzenle';
  $('mapSave').classList.toggle('hidden', !on);
  $('mapReset').classList.toggle('hidden', !on);
  $('mapHint').textContent = on
    ? 'İşaretçileri sürükle · 💾 Kaydet → göç ya da yeniden başlatmada geçerli olur'
    : 'Bir lokasyona tıkla → yolculuk başlar · [M] aç/kapat';
  drawMap();
}
// Harita DÜZENLEYİCİ yalnız admin panelinde (admin.html) görünür — oyunun
// içinde işi yok. admin.html'de window.KD_ADMIN = true olduğu için orada durur.
if (!window.KD_ADMIN) $('mapEdit').classList.add('hidden');
$('mapEdit').addEventListener('click', () => { if (window.KD_ADMIN) setEditMode(!mapEditMode); });
$('mapWorld').addEventListener('click', () => { toggleMap(false); openWorld(G.victoryShown); });
$('mapSave').addEventListener('click', () => {
  CUSTOM_MAPS[LAYOUT_IDX] = JSON.parse(JSON.stringify(editGeo));
  try { localStorage.setItem('kd-maps', JSON.stringify(CUSTOM_MAPS)); } catch (e) { }
  SFX.build(); toast('🗺️ Harita kaydedildi — yeni bölgeye göçte ya da sıfırlamada geçerli olur');
});
$('mapReset').addEventListener('click', () => {
  delete CUSTOM_MAPS[LAYOUT_IDX];
  try { localStorage.setItem('kd-maps', JSON.stringify(CUSTOM_MAPS)); } catch (e) { }
  editGeo = JSON.parse(JSON.stringify(BUILTIN_MAPS[LAYOUT_IDX]));
  toast('↩️ Bu bölge düzeni varsayılana döndü'); drawMap();
});
function editorPointerDown(e) {
  const r = mapCv.getBoundingClientRect();
  const mx2 = e.clientX - r.left, my2 = e.clientY - r.top;
  dragKey = null;
  for (const [k] of EDIT_MARKERS) {
    const p2 = editGeo[k];
    const x = mapPad + p2.x * mapScale, y = mapPad + p2.y * mapScale;
    if (Math.hypot(mx2 - x, my2 - y) < 26) { dragKey = k; break; }
  }
}
mapCv.addEventListener('pointermove', e => {
  if (!mapEditMode || !dragKey) return;
  const r = mapCv.getBoundingClientRect();
  let wx = (e.clientX - r.left - mapPad) / mapScale;
  let wy = (e.clientY - r.top - mapPad) / mapScale;
  const m = dragKey === 'fort' ? 330 : dragKey === 'legion' ? 370 : 220;
  wx = clamp(wx, Math.max(m, 430), OVERWORLD_W - m);
  wy = clamp(wy, Math.max(m, 240), WORLD.h - m);
  editGeo[dragKey] = { x: Math.round(wx), y: Math.round(wy) };
  drawMap();
});
window.addEventListener('pointerup', () => { dragKey = null; });
// ---------- Yol olayları (M&B karşılaşmaları) ----------
function triggerTravelEvent() {
  G.pendingTravel = G.autoTravel; G.autoTravel = null;
  const p = G.player;
  const resume = () => { if (G.pendingTravel) { G.autoTravel = G.pendingTravel; G.pendingTravel = null; } };
  const ambush = n => {
    for (let i = 0; i < n; i++) {
      spawnEnemy('barb', p.x + rr(130, 230) * (rng() < 0.5 ? -1 : 1), p.y + rr(-180, 180), 'event');
      G.enemies[G.enemies.length - 1].aggro = true;
    }
  };
  const roll = rng();
  if (roll < 0.3) {
    openPanel({ event: true, title: '🐫 Kervan Baskını!', text: 'İleride haydutların bastığı bir kervan görüyorsun. Kervancı yardım için bağırıyor!', choices: [
      { label: '⚔️ Yardım et', desc: 'Haydutları öldür → kervancı ödül verir', act: () => { ambush(3); G.eventState = { reward: { gold: ri(50, 90) } }; toast('Haydutlar üzerine geliyor!', true); SFX.horn(); } },
      { label: '🚶 Görmezden gel', desc: 'Kendi derdin yeter', act: resume },
    ] });
  } else if (roll < 0.55) {
    openPanel({ event: true, title: '⛏️ Yarı Gömülü Sandık', text: 'Yol kenarında toprağa gömülü eski bir sandık fark ediyorsun.', choices: [
      { label: '⛏️ Kaz', desc: 'Ne çıkacağı belli olmaz...', act: () => {
          if (rng() < 0.6) {
            const loot = { gold: ri(30, 70), scrap: ri(2, 6) };
            if (rng() < 0.12) loot.gems = 1;
            gain(loot, p.x, p.y - 30); SFX.coin(); toast('Define buldun! 🎉'); resume();
          } else { ambush(3); toast('Tuzak! Pusudaki haydutlar saldırıyor!', true); SFX.horn(); }
      } },
      { label: '🚶 Dokunma', desc: 'Riske girme', act: resume },
    ] });
  } else if (roll < 0.8) {
    openPanel({ event: true, title: '🧺 Seyyar Satıcı', text: '"Dostum! Ucuza demir var — savaş zamanı böylesi bulunmaz."', choices: [
      { label: '⚙️ 5 demir al', desc: '-40 🪙', enabled: G.res.gold >= 40, act: () => { pay({ gold: 40 }); gain({ iron: 5 }, p.x, p.y - 30); SFX.coin(); resume(); } },
      { label: '🚶 İlgilenme', desc: 'Yoluna bak', act: resume },
    ] });
  } else {
    openPanel({ event: true, title: '🩹 Yaralı Savaşçı', text: 'Yol kenarında yaralı bir savaşçı buldun. Su ve sargı istiyor.', choices: [
      { label: '❤️ Yardım et', desc: 'Belki borcunu öder', act: () => {
          const bar = buildingPos('barracks');
          if (bar && !bar.ruined && G.soldiersOwned < soldierCap()) { G.soldiersOwned++; addSoldier(); toast('Savaşçı minnetle orduna katıldı! 🗡️'); }
          else { gain({ gold: 25 }, p.x, p.y - 30); toast('"Sağ ol yiğit" — kesesini sana verdi'); }
          SFX.upgrade(); resume(); save();
      } },
      { label: '🚶 Geç', desc: '', act: resume },
    ] });
  }
}

function rivalEnvoy() {
  openPanel({ event: true, title: '💀 ' + RIVALC().name + '\'ın Elçisi', text: '"Beyim der ki: bu topraklarda barınmak istiyorsan haraç ödersin. 100 altın — yoksa çeliğimizi tadarsın."', choices: [
    { label: '🪙 Haracı öde (100)', desc: '3 gün dokunulmazlık', enabled: G.res.gold >= 100, act: () => { pay({ gold: 100 }); G.rival.tribute = 3; toast('Kara Vulkar\'ın çetesi şimdilik uzak duracak'); save(); } },
    { label: '⚔️ Reddet', desc: 'Bu topraklar benim!', act: () => { G.enemies.forEach(e => { if (e.camp === 'rival') e.aggro = true; }); SFX.horn(); banner('KARA VULKAR SALDIRIYOR!'); } },
  ] });
}

function startTravel(loc) {
  if (G.dead) return;
  if (G.caveRun) { toast('İnin içindesin — önce çıkışı bul!', true); return; }
  const p = G.player;
  if (dist(p.x, p.y, loc.x, loc.y) < 150) { toast('Zaten buradasın'); return; }
  const pts = [];
  if (G.palisade.built) {
    const inside = dist(p.x, p.y, CAMPFIRE.x, CAMPFIRE.y) < palR();
    const tInside = dist(loc.x, loc.y, CAMPFIRE.x, CAMPFIRE.y) < palR();
    if (inside !== tInside) pts.push([PAL_GATE.x + 55, PAL_GATE.y]); // kapıdan geç
  }
  pts.push([loc.x, loc.y]);
  G.autoTravel = { pts, i: 0, name: loc.name, stuck: 0 };
  toast('🧭 ' + loc.name + ' yolculuğu başladı — hareket edersen iptal olur');
}
function computeNear() {
  const p = G.player;
  G.nearThing = null;
  let nd = 92;
  // (arsalar artık menü açmaz: planlı şantiyeye kaynak taşımak yeterli — teslimat otomatik)
  for (const b of G.buildings) {
    const dd = dist(p.x, p.y, b.x, b.y);
    const B = b.type === 'campfire' ? { name: 'Köy Konağı', icon: '🏛️' } : BUILDINGS[b.type];
    if (dd < nd) { nd = dd; G.nearThing = { building: b, label: B.icon + ' ' + B.name }; }
  }
  for (const st of SIEGE_SITES) {
    if (G.outposts[st.id]) continue;   // kale fethedildi: kendi kapına kuşatma kurulmaz
    const dd = dist(p.x, p.y, st.x, st.y);
    if (dd < 120 && dd - 30 < nd) { nd = dd - 30; G.nearThing = { site: st, label: '⚔️ Kuşatma Kampı' }; }
  }
  const md = dist(p.x, p.y, MERCHANT.x, MERCHANT.y);
  if (md < 110 && md - 20 < nd) { nd = md - 20; G.nearThing = { trade: true, label: '🐪 Göçebe Tüccar' }; }
  const cd2 = dist(p.x, p.y, CAVE.x, CAVE.y);
  if (cd2 < 100 && cd2 - 15 < nd) { nd = cd2 - 15; G.nearThing = { cave: true, label: '🕳️ Karanlık İn' }; }
  const portal = G.props.find(pr => pr.kind === 'portal');
  if (portal) {
    const pd2 = dist(p.x, p.y, portal.x, portal.y);
    if (pd2 < 70 && pd2 - 20 < nd) { nd = pd2 - 20; G.nearThing = { portal: true, label: '✨ Çıkış Geçidi' }; }
  }
  for (const w2 of G.wounded) {
    const wd2 = dist(p.x, p.y, w2.x, w2.y);
    if (wd2 < 70 && wd2 - 15 < nd) { nd = wd2 - 15; G.nearThing = { wounded: w2, label: '🩹 ' + (w2.name || 'Yaralı asker') + ' (yaralı)' }; }
  }
  for (const pr of G.props) {
    if (pr.kind !== 'kneel') continue;
    const kd2 = dist(p.x, p.y, pr.x, pr.y);
    if (kd2 < 80 && kd2 - 15 < nd) { nd = kd2 - 15; G.nearThing = { kneel: pr, label: '🏳️ ' + COMMANDERS[pr.cmd].name + ' (teslim)' }; }
  }
  // zindan kafesi: esir komutan varsa yaklaşınca görünür
  for (const site of Object.keys(G.prisoners)) {
    const caps = jailCmds(site);
    if (!caps.length) continue;
    const jp = jailPos(site);
    const jd2 = dist(p.x, p.y, jp.x, jp.y);
    if (jd2 < 90 && jd2 - 10 < nd) { nd = jd2 - 10; G.nearThing = { jail: site, label: '⛓️ Zindan — ' + caps.map(m => COMMANDERS[m.cmd].name).join(', ') }; }
  }
  for (const s of G.structures) {
    if (s.kind !== 'banner') continue;
    const dd = dist(p.x, p.y, s.x, s.y);
    if (dd < 100 && dd - 10 < nd) { nd = dd - 10; G.nearThing = { banner: s, label: '🏳️ ' + OUTPOSTS[s.site].name }; }
  }
}

// ---------- Savaş ----------
function doAttack() {
  const p = G.player;
  if (p.cd > 0 || G.dead) return;
  p.cd = 0.5; p.swing = 0.18;
  if (mouseAim) {
    const wx = G.cam.x + mouseAim.x, wy = G.cam.y + mouseAim.y;
    p.dir = Math.atan2(wy - p.y, wx - p.x);
  }
  tone(rr(270, 350), 0.08, 'sawtooth', 0.05, -150); // savuruş (rastgele perde)
  // not: ileri hamle artık sadece görsel (çizimde) — pozisyon kaymaz
  const dmg = playerAtk();
  // 1) düşmanlar (yay içinde)
  let hitSomething = false;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < 82) {
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      let diff = Math.abs(ang - p.dir); if (diff > Math.PI) diff = TAU - diff;
      if (diff < 1.25 || d < 40) {
        const crit = rng() < 0.15;
        damageEnemy(e, crit ? Math.round(dmg * 1.6) : dmg, p.x, p.y, crit);
        hitSomething = true;
      }
    }
  }
  // 1b) av hayvanları (aynı yay)
  for (const a of G.animals) {
    if (a.dead) continue;
    const d = dist(p.x, p.y, a.x, a.y);
    if (d < 82) {
      const ang = Math.atan2(a.y - p.y, a.x - p.x);
      let diff = Math.abs(ang - p.dir); if (diff > Math.PI) diff = TAU - diff;
      if (diff < 1.25 || d < 40) { damageAnimal(a, dmg, p.x, p.y); hitSomething = true; }
    }
  }
  if (hitSomething) { G.hitstop = 0.06; return; }
  // 2) yapılar (totem, kapı, sandık) — kendi sancağına vuramazsın
  for (const s of G.structures) {
    if (!s.alive || s.kind === 'banner') continue;
    if (dist(p.x, p.y, s.x, s.y) < 95) {
      let d2 = dmg;
      if (s.kind === 'gate') { d2 = Math.max(1, Math.round(dmg * GATE_MELEE_FACTOR)); addFloater(s.x, s.y - 50, 'Çok sağlam! Mancınık gerek', '#ffb0a8'); }
      if (s.kind === 'lgate') { d2 = 1; addFloater(s.x, s.y - 50, 'Çelik kapı! Koçbaşı gerek', '#ffb0a8'); }
      damageStructure(s, d2);
      return;
    }
  }
  // 3) kaynak noktası
  let best = null, bd = 88;
  for (const n of G.nodes) if (n.alive) { const d = dist(p.x, p.y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  if (best) {
    best.hp -= 12;
    SFX.chop();
    spawnParts(best.x, best.y - 16, 6, { colors: NODE_FX[best.kind], v: 70, life: 0.5, g: 180, r: 3.5 });
    addFloater(best.x + rr(-8, 8), best.y - 30, '✦', '#fff');
    if (best.hp <= 0) {
      best.alive = false; best.respT = best.removed ? Infinity : NODE_DEF[best.kind].respawn;
      if (coopSlave()) coopSend('nkill', { i: G.nodes.indexOf(best) }); // yoldaşımda da kırılsın
      let y = { ...NODE_DEF[best.kind].yield };
      if (best.kind === 'tree' && G.built.sawmill >= 2) y.wood += 1;
      if (best.kind === 'tree') G.stats.chops++; else if (best.kind === 'rock') G.stats.mines++;
      gain(y, best.x, best.y);
      SFX.coin();
    }
  }
}
// Güçlü vuruş: saldırıyı basılı tutunca dolan şarj patlaması (geniş yay, 2.2× hasar, güçlü itme)
function heavyAttack() {
  const p = G.player;
  if (p.cd > 0 || G.dead) return;
  p.cd = 0.9; p.swing = 0.22; p.heavyFx = 0.3;
  if (mouseAim) {
    const wx = G.cam.x + mouseAim.x, wy = G.cam.y + mouseAim.y;
    p.dir = Math.atan2(wy - p.y, wx - p.x);
  }
  tone(130, 0.3, 'sawtooth', 0.16, -50);
  G.shake = 6; G.hitstop = 0.09;
  const dmg = Math.round(playerAtk() * 2.2);
  spawnParts(p.x, p.y - 20, 14, { colors: ['#fff', '#ffd257'], v: 130, life: 0.4, g: 60, r: 3 });
  let hitSomething = false;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < 105) {
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      let diff = Math.abs(ang - p.dir); if (diff > Math.PI) diff = TAU - diff;
      if (diff < 2.0 || d < 50) {
        damageEnemy(e, dmg, p.x, p.y, true); // ağır itmeli
        hitSomething = true;
      }
    }
  }
  if (hitSomething) return;
  for (const s of G.structures) {
    if (!s.alive || s.kind === 'banner') continue;
    if (dist(p.x, p.y, s.x, s.y) < 115) {
      let d2 = dmg;
      if (s.kind === 'gate') d2 = Math.max(2, Math.round(dmg * GATE_MELEE_FACTOR));
      if (s.kind === 'lgate') d2 = 2;
      damageStructure(s, d2);
      return;
    }
  }
  let best = null, bd = 108;
  for (const n of G.nodes) if (n.alive) { const d = dist(p.x, p.y, n.x, n.y); if (d < bd) { bd = d; best = n; } }
  if (best) {
    best.hp -= 26;
    SFX.chop();
    spawnParts(best.x, best.y - 16, 10, { colors: NODE_FX[best.kind], v: 90, life: 0.5, g: 180, r: 3.5 });
    if (best.hp <= 0) {
      best.alive = false; best.respT = NODE_DEF[best.kind].respawn;
      if (coopSlave()) coopSend('nkill', { i: G.nodes.indexOf(best) }); // yoldaşımda da kırılsın
      let y2 = { ...NODE_DEF[best.kind].yield };
      if (best.kind === 'tree' && G.built.sawmill >= 2) y2.wood += 1;
      if (best.kind === 'tree') G.stats.chops++; else if (best.kind === 'rock') G.stats.mines++;
      gain(y2, best.x, best.y);
      SFX.coin();
    }
  }
}
// Atılma: kısa, dokunulmaz hamle (Shift/X ya da 💨)
function dodge() {
  const p = G.player;
  if (G.dead || p.dodgeCd > 0) return;
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (joy.active) { mx = joy.dx; my = joy.dy; }
  p.dodgeDir = Math.hypot(mx, my) > 0.15 ? Math.atan2(my, mx) : p.dir + Math.PI; // girdisizken geri sıçra
  p.dodgeT = 0.18; p.dodgeCd = 1.1;
  p.charging = false; p.chargeT = 0;
  tone(520, 0.1, 'sine', 0.06, -300);
}
function damageEnemy(e, dmg, fx, fy, crit, killer) {
  if (fx === undefined) { fx = G.player.x; fy = G.player.y; }
  if (coopSlave() && e.netRemote) { // co-op misafir: vuruşu HOST'a bildir, canı o düşürür
    coopSend('hit', { u: e.uid, d: dmg, c: crit ? 1 : 0, x: Math.round(fx), y: Math.round(fy) });
    e.flash = 0.12; SFX.hit(); G.shake = Math.min(G.shake + (crit ? 4 : 2), 7);
    spawnParts(e.x, e.y - 26, crit ? 10 : 5, { colors: ['#fff', '#ffd257', '#ff9a2e'], v: 95, life: 0.35, g: 160, r: 3 });
    addFloater(e.x + rr(-10, 10), e.y - 46 * eDef(e).scale, '-' + dmg + (crit ? '!' : ''), crit ? '#ffd257' : '#ff6b5e', crit ? 22 : 16);
    return;
  }
  e.hp -= dmg; e.flash = 0.12; e.aggro = true;
  SFX.hit(); G.shake = Math.min(G.shake + (crit ? 4 : 2), 7);
  spawnParts(e.x, e.y - 26, crit ? 10 : 5, { colors: ['#fff', '#ffd257', '#ff9a2e'], v: 95, life: 0.35, g: 160, r: 3 });
  addFloater(e.x + rr(-10, 10), e.y - 46 * eDef(e).scale, '-' + dmg + (crit ? '!' : ''), crit ? '#ffd257' : '#ff6b5e', crit ? 22 : 16);
  // geri tepme (collide'dan geçer: darbe düşmanı surun içinden geçiremesin)
  const ang = Math.atan2(e.y - fy, e.x - fx);
  const kb = crit ? 12 : 7;
  const [kx, ky] = collide(e.x + Math.cos(ang) * kb, e.y + Math.sin(ang) * kb, 13 * (eDef(e).scale || 1), true);
  e.x = kx; e.y = ky;
  if (e.hp <= 0) killEnemy(e, killer);
}
function damageVillageGate(dmg) {
  const g = G.palisade.gate;
  if (!g.alive) return;
  g.hp -= dmg;
  spawnDust(PAL_GATE.x + rr(-10, 10), PAL_GATE.y + rr(-20, 20), 3);
  if (g.hp <= 0) {
    g.hp = 0; g.alive = false;
    SFX.boom(); G.shake = 9;
    toast('Köy kapısı kırıldı! 🚨', true);
    save();
  }
}
// XP kazan + seviye atlama (her seviye: +10 can, +1 hasar; çift seviyelerde kapasite artar)
function addXp(n, x, y) {
  if (G.level >= LEVEL_MAX) return;
  n = Math.max(1, Math.round(n * BAL.xp));
  G.xp += n;
  if (x !== undefined) addFloater(x + rr(-8, 8), y, '+' + n + ' XP', '#c9a8f0', 13);
  let leveled = false;
  while (G.level < LEVEL_MAX && G.xp >= xpNeed(G.level)) {
    G.xp -= xpNeed(G.level);
    G.level++;
    leveled = true;
  }
  if (leveled) {
    const p = G.player;
    p.maxHp = playerMaxHp();
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.6)); // seviye atlayınca toparlan
    banner('SEVİYE ' + G.level + '!');
    const perks = ['❤️ +10 can', '⚔️ +1 hasar'];
    if (G.level % 2 === 0) perks.push('🗡️ asker kapasitesi +1 (' + soldierCap() + ')');
    toast('Seviye ' + G.level + ': ' + perks.join(' · '));
    spawnParts(p.x, p.y - 30, 18, { colors: ['#ffd257', '#fff3c9', '#c9a8f0'], v: 60, life: 1.2, g: -30 });
    SFX.upgrade(); save();
  }
}

// Dost birime hasar (oyuncu / asker / garnizon) — okçu ve yakın dövüş ortak yolu
function damageAlly(u, dmg, fx, fy) {
  if (u === G.player || u === 'player') { damagePlayer(dmg, fx, fy); return; }
  u.hp -= dmg; u.flash = 0.12;
  addFloater(u.x, u.y - 44, '-' + dmg, '#ffb0a8');
  if (u.caravan) {
    if (!u.alerted) { u.alerted = true; toast('🐴 ' + u.from + ' kervanı saldırı altında!', true); SFX.no(); }
    return; // kervan ölümünü kendi döngüsü işler
  }
  if (u.hp <= 0) {
    spawnDust(u.x, u.y, 8);
    G.stats.deaths++;
    if (u.cmd) {
      // komutan ölmez: yaralı düşer — kaldırılabilir; terk edilirse esir düşer; öz ordusu dağılır
      const C = COMMANDERS[u.id];
      if (u.troops && u.troops.length) { u.troops = []; toast(C.name + '\'in öz ordusu komutansız dağıldı!', true); }
      G.wounded.push({ cmd: u.id, lv: u.lv, kills: u.kills, gear: u.gear, name: C.name, x: u.x, y: u.y, t: 0, alertT: 0 });
      toast('🩸 ' + C.name + ' yaralandı — yerde yatıyor!', true);
    } else if (u.cmdTroop) {
      u.dead = true; // komutanın adamı: sıradan kayıp (komutanın döngüsü listeden düşürür)
      if (u.own) addFloater(u.x, u.y - 40, COMMANDERS[u.own.id].name + ' bir adamını kaybetti', '#ffb0a8', 11);
    } else if (u.garrisonOf) {
      const op = G.outposts[u.garrisonOf];
      if (op) {
        op.garrison = Math.max(0, op.garrison - 1);
        const ci = (op.garrisonCls || []).findIndex(x => (typeof x === 'string' ? x : x.cls) === (u.cls || 'sword'));
        if (ci >= 0) op.garrisonCls.splice(ci, 1);
      }
      toast('⚰️ Karakol askeri nöbette düştü!', true);
    } else {
      toast('⚰️ Bir askerin düştü!', true);
      G.soldiersOwned--;
    }
  }
}
function damageBuilding(b, dmg) {
  if (b.type === 'campfire' || b.ruined) return;
  b.hp -= dmg;
  spawnDust(b.x + rr(-18, 18), b.y - 12, 3);
  if (b.hp <= 0) {
    b.hp = 0; b.ruined = true;
    SFX.boom(); G.shake = 9; spawnDust(b.x, b.y - 10, 20);
    toast(BUILDINGS[b.type].name + ' yıkıldı! Onarım gerekli 🔧', true);
    save();
  }
}
// Boss yenilince isimli komutan teslim olur: diz çöker, yanına gidip safına katabilirsin
function spawnKneel(cmdId, x, y) {
  if (cmdOwned(cmdId)) return; // zaten sende / yaralı / esir / bekliyor
  G.props.push({ kind: 'kneel', cmd: cmdId, x, y });
  const C = COMMANDERS[cmdId];
  setTimeout(() => toast('🏳️ ' + C.name + ' teslim oldu — yanına git, safına kat!', true), 1200);
}
function killEnemy(e, killer) {
  const d = eDef(e);
  const gold = Math.round(ri(d.gold[0], d.gold[1]) * (e.mul || 1));
  const loot = { gold };
  if (rng() < d.scrap[0]) loot.scrap = ri(d.scrap[1], d.scrap[2]);
  // bağımsız komutanın (ya da adamlarının) leşi: altın KOMUTANIN kesesine — asker bedelini oradan öder
  const purseCmd = killer && killer.cmd && cmdIndependent(killer) ? killer
    : killer && killer.cmdTroop && killer.own && cmdIndependent(killer.own) ? killer.own : null;
  // co-op: son vuruş yoldaşındansa ganimet ONA gider; ölüm her hâlükârda yayınlanır
  const coopClaim = coopHost() && e.lastHitBy && CO.peers[e.lastHitBy] ? e.lastHitBy : null;
  if (coopHost()) coopSend('dead', { u: e.uid, by: coopClaim, loot: coopClaim ? loot : null,
    xp: coopClaim ? (d.xp || 10) : 0, x: Math.round(e.x), y: Math.round(e.y) });
  if (coopClaim) { /* ganimet yoldaşın hanesine yazıldı */ }
  else if (purseCmd) {
    purseCmd.purse = (purseCmd.purse || 0) + gold + (loot.scrap || 0) * 2;
    addFloater(e.x, e.y - 40, '💰 +' + gold, '#ffd257', 12);
  } else gain(loot, e.x, e.y);
  if (!coopClaim) G.stats.kills++;
  if (VISIT && G.helpFx) G.helpFx.kills++;
  if (ISLAND) { G.islOps.kills = (G.islOps.kills || 0) + 1; islContrib('kills', 1); }
  if (killer && killer.cmd) cmdKill(killer); // komutan leşiyle seviye atlar
  else if (killer && killer.soldier) soldierXp(killer, Math.max(4, Math.round((d.xp || 10) / 2))); // asker XP biriktirir (terfi manuel)
  // kuşam dropu: boss garanti (yüksek tablo), seçkinler orta, sıradanlar düşük şans
  const GEAR_BOSS = { chief: 2, commander: 2, rivallord: 2, bear: 2, troll: 2 };
  const GEAR_ELITE = { guard: 1, legion: 1, brute: 1, shieldbarb: 1, shaman: 1 };
  if (GEAR_BOSS[e.type] !== undefined) dropGear(2, e.x, e.y);
  else if (GEAR_ELITE[e.type] !== undefined) { if (Math.random() < 0.09) dropGear(1, e.x, e.y); }
  else if (Math.random() < 0.05) dropGear(0, e.x, e.y);
  SFX.coin(); spawnDust(e.x, e.y, 8);
  spawnParts(e.x, e.y - 20, 9, { colors: ['#8a2f2a', '#5c1f1a', '#c9ced6'], v: 80, life: 0.5, g: 140 });
  addFloater(e.x, e.y - 60 * eDef(e).scale, '💀', '#e8d9c0', 15);
  if (!coopClaim) addXp(d.xp || 10, e.x, e.y - 40);
  if (rng() < 0.18) G.pickups.push({ x: e.x + rr(-14, 14), y: e.y + rr(-8, 8), t: 12 }); // şifa damlası
  if (e.type === 'chief') { banner('KALE ŞEFİ DÜŞTÜ!'); if (e.camp === 'fort') spawnKneel(cmdIdFor('chief'), e.x, e.y); }
  if (e.type === 'commander') { banner('LEJYON KOMUTANI DÜŞTÜ!'); if (e.camp === 'legion') spawnKneel(cmdIdFor('cmdr'), e.x, e.y); }
  if (e.type === 'wolf') gain({ meat: 2 }, e.x, e.y - 16); // kurt leşi et verir
  if (e.type === 'bear') {
    G.caveCleared = true; G.stats.bossKills++;
    gain({ gold: 150, gems: 8 }, e.x, e.y - 20);
    banner('MAĞARA AYISI DEVRİLDİ! 💎'); save();
  }
  if (e.type === 'troll') {
    G.stats.bossKills++;
    gain({ gold: 300, gems: 6 }, e.x, e.y - 20);
    if (e.islBoss) { // Ada Devi: paylaşılan boss — tüm yoldaşlara işlenir
      G.islOps.bossDown = true; islContrib('boss', 1);
      gain({ gold: 500, gems: 12 }, e.x, e.y - 20);
      dropGear(3, e.x, e.y);
      banner('ADA DEVİ DEVRİLDİ! 👹👹');
    } else banner('DAĞ DEVİ DEVRİLDİ! 👹');
    save();
  }
  if (e.type === 'rivallord') {
    G.rival.alive = false;
    gain({ gems: 5 }, e.x, e.y - 20);
    for (const o of G.enemies) if (o.camp === 'rival' && o !== e && o.hp > 0) { o.hp = 0; spawnDust(o.x, o.y, 6); }
    banner(RIVALC().name.toUpperCase() + ' DÜŞTÜ!');
    toast('Çetesi dağıldı — bölge rahat bir nefes aldı');
    spawnKneel(cmdIdFor('rival'), e.x, e.y);
    save();
  }
}
// Kuşatma yapısına hasar: savunucular şantiyeyi (bitmemiş olsa bile) yıkabilir
function damageEngine(site, key, dmg) {
  const en = (G.sieges[site] || {})[key];
  if (!en) return;
  const E = ENGINES[key];
  const ex = key === 'ram' && en.done ? en.rx : en.x, ey = key === 'ram' && en.done ? en.ry : en.y;
  en.hp -= dmg;
  addFloater(ex + rr(-10, 10), ey - 44, '-' + dmg, '#ffb0a8');
  spawnDust(ex + rr(-14, 14), ey - 8, 3);
  if (en.hp <= 0) {
    delete G.sieges[site][key];
    SFX.boom(); G.shake = 9; spawnDust(ex, ey, 22);
    toast('🚨 ' + E.name + (en.done ? '' : ' şantiyesi') + ' savunucular tarafından yıkıldı!', true);
    save();
  }
}
function damageStructure(s, dmg) {
  if (s.kind === 'cavechest' && G.enemies.some(e2 => e2.camp === 'cave' && e2.type === 'bear')) {
    addFloater(s.x, s.y - 50, 'Ayı hâlâ nöbette!', '#ffb0a8'); return;
  }
  s.hp -= dmg; SFX.hit(); G.shake = Math.min(G.shake + 2, 6);
  addFloater(s.x + rr(-12, 12), s.y - 46, '-' + dmg, '#ffd257');
  spawnDust(s.x + rr(-14, 14), s.y - 10, 3);
  if (s.kind === 'owgate') { const op2 = G.outposts[s.site]; if (op2) op2.wallGateHp = Math.max(0, Math.round(s.hp)); } // kayda senkron
  if (s.hp <= 0) {
    s.alive = false; SFX.boom(); G.shake = 10; spawnDust(s.x, s.y, 20);
    if (s.kind === 'owgate') toast('🚨 ' + OUTPOSTS[s.site].name + '\'nun sur kapısı kırıldı!', true);
    if (s.kind === 'totem') {
      G.camp1Destroyed = true;
      gain({ gold: 100, scrap: 20 }, s.x, s.y);
      addXp(60, s.x, s.y - 60);
      banner('BARBAR KAMPI DÜŞTÜ!');
      for (const e of G.enemies) if (e.camp === 'camp1' && e.hp > 0) e.hp = Math.min(e.hp, 10); // moral çöküşü
      createOutpost('camp1');
      if (ISLAND) { (G.islOps.cleared = G.islOps.cleared || []).push('camp1'); islContrib('cleared', 1); }
    } else if (s.kind === 'itotem') { // ada kampı: paylaşılan temizlik
      gain({ gold: 150, scrap: 25 }, s.x, s.y);
      addXp(80, s.x, s.y - 60);
      banner('ADA KAMPI TEMİZLENDİ!');
      for (const e of G.enemies) if (e.camp === s.site && e.hp > 0) e.hp = Math.min(e.hp, 10);
      if (ISLAND) { (G.islOps.cleared = G.islOps.cleared || []).push(s.site); islContrib('cleared', 1); }
    } else if (s.kind === 'gate') {
      if (G.outposts.fort) toast('🚨 Taş Kale\'nin kapısı kırıldı!', true); // bizim kapımız düştü
      else { banner('DIŞ KAPI KIRILDI! HÜCUM!'); addXp(50, s.x, s.y - 60); }
    } else if (s.kind === 'gate2' || s.kind === 'gate3') {
      banner(s.kind === 'gate2' ? 'ORTA SUR KAPISI PARÇALANDI!' : 'İÇ KALE DÜŞTÜ!');
      addXp(60, s.x, s.y - 60);
    } else if (s.kind === 'gate2' || s.kind === 'gate3') {
    ctx.fillStyle = s.kind === 'gate2' ? '#5f4a33' : '#4a3a2a';
    ctx.fillRect(s.x - 11, s.gy, 22, s.gh);
    ctx.fillStyle = '#3f3428';
    for (let i = 0; i < 3; i++) ctx.fillRect(s.x - 11 + i * 7, s.gy, 2, s.gh);
    ctx.fillStyle = '#8b8f98'; ctx.fillRect(s.x - 11, s.gy + 12, 22, 4); ctx.fillRect(s.x - 11, s.gy + s.gh - 16, 22, 4);
  } else if (s.kind === 'lgate') {
      if (G.outposts.legion) toast('🚨 Lejyon Karakolu\'nun kapısı kırıldı!', true);
      else { banner('ÇELİK KAPI PARÇALANDI! HÜCUM!'); addXp(90, s.x, s.y - 60); }
    } else if (s.kind === 'chest') {
      G.chestOpened = true;
      gain({ gold: 300, gems: 10 }, s.x, s.y);
      dropGear(3, s.x, s.y); dropGear(2, s.x, s.y);
      addXp(80, s.x, s.y - 60);
      banner('KALE FETHEDİLDİ! 💎');
      createOutpost('fort');
      if (ISLAND) { (G.islOps.cleared = G.islOps.cleared || []).push('fort'); islContrib('cleared', 1); }
    } else if (s.kind === 'chest2') {
      G.legionConquered = true;
      gain({ gold: 500, gems: 25 }, s.x, s.y);
      dropGear(3, s.x, s.y); dropGear(3, s.x, s.y);
      addXp(150, s.x, s.y - 60);
      banner('LEJYON KARARGÂHI DÜŞTÜ! 💎💎');
      createOutpost('legion');
      if (ISLAND) { (G.islOps.cleared = G.islOps.cleared || []).push('legion'); islContrib('cleared', 1); }
    } else if (s.kind === 'cavechest') {
      gain({ gold: 120 + G.region * 80, gems: 5 + G.region * 3 }, s.x, s.y);
      dropGear(3, s.x, s.y); dropGear(1, s.x, s.y);
      addXp(100, s.x, s.y - 60);
      G.caveCleared = true;
      G.caveCd = 900; // 15 dakika sonra in yeniden dolar
      banner('İNİN HAZİNESİ! 💎');
      G.props.push({ kind: 'portal', x: s.x - 60, y: s.y + 80 });
      toast('✨ Çıkış geçidi açıldı!');
    } else if (s.kind === 'banner') {
      const op = G.outposts[s.site];
      if (op) {
        op.looted = true;
        op.garrison = 0; op.garrisonCls = [];
        G.garrisonUnits = G.garrisonUnits.filter(g => g.garrisonOf !== s.site);
        toast('🚨 ' + OUTPOSTS[s.site].name + ' yağmalandı! Gelir kesildi — sancağı onarmalısın', true);
      }
    }
    save();
  }
}
function damagePlayer(dmg, fromX, fromY) {
  const p = G.player;
  if (G.dead) return;
  if (p.dodgeT > 0) { addFloater(p.x, p.y - 50, 'Kaçındı!', '#a8d8f0', 14); return; } // atılma dokunulmazlığı
  p.hp -= dmg; p.flash = 0.15; G.hitstop = 0.05; G.hurtFlash = 0.3;
  SFX.hurt(); G.shake = Math.min(G.shake + 4, 9);
  addFloater(p.x + rr(-10, 10), p.y - 48, '-' + dmg, '#ff3b30');
  const ang = Math.atan2(p.y - fromY, p.x - fromX);
  p.x += Math.cos(ang) * 9; p.y += Math.sin(ang) * 9;
  if (p.hp <= 0) {
    p.hp = 0; G.dead = true; G.deadT = 2.2;
    elDeath.classList.remove('hidden');
  }
}

// ---------- Efektler ----------
function addFloater(x, y, text, color, size) { G.floaters.push({ x, y, text, color, size: size || 16, t: 1 }); }
function spawnDust(x, y, n) {
  for (let i = 0; i < n; i++) G.particles.push({ x: x + rr(-8, 8), y: y + rr(-6, 6), vx: rr(-40, 40), vy: rr(-70, -20), t: rr(0.4, 0.8), max: 0.8, r: rr(2, 5) });
}
// Renkli parçacık patlaması: o = {colors, v(hız), life, g(yerçekimi; eksi=yükselir), r}
function spawnParts(x, y, n, o) {
  for (let i = 0; i < n; i++) G.particles.push({
    x: x + rr(-6, 6), y: y + rr(-5, 5),
    vx: rr(-(o.v || 50), o.v || 50), vy: o.g < 0 ? rr(-55, -15) : rr(-(o.v || 50), (o.v || 50) * 0.4),
    t: rr(o.life * 0.5, o.life), max: o.life,
    r: rr(1.5, o.r || 4), c: o.colors[ri(0, o.colors.length - 1)],
    g: o.g === undefined ? 90 : o.g,
  });
}
const NODE_FX = {
  tree:  ['#4e9440', '#7a4f2a', '#3f7a30'],
  rock:  ['#b5b5ae', '#8f8f89', '#77777d'],
  scrap: ['#8b8f98', '#c9772e', '#6a6a72'],
};

// ---------- Çarpışma ----------
function collide(px, py, r, isEnemy) {
  let x = px, y = py;
  // su
  const sx = shoreX(y) + 16;
  if (x < sx) x = sx;
  x = clamp(x, 20, WORLD.w - 20); y = clamp(y, 20, WORLD.h - 20);
  // sur halkaları (kapı boşluğu hariç; düşmana sağlam kapı kapalı) — bina itmesi/geri tepme
  // duvardan geçirmesin diye hem başta hem sonda uygulanır
  const ringPass = () => {
    if (G.palisade.built) {
      const pr2 = palR();
      const dd = dist(x, y, CAMPFIRE.x, CAMPFIRE.y);
      if (Math.abs(dd - pr2) < r + 9 && dd > 1) {
        const a = Math.atan2(y - CAMPFIRE.y, x - CAMPFIRE.x);
        let da = Math.abs(a); if (da > Math.PI) da = TAU - da;
        const inGap = da < palGapA();
        if (!inGap || (isEnemy && G.palisade.gate.alive)) {
          const side = dd < pr2 ? pr2 - (r + 9) : pr2 + (r + 9);
          x = CAMPFIRE.x + Math.cos(a) * side; y = CAMPFIRE.y + Math.sin(a) * side;
        }
      }
    }
    for (const [site, op] of Object.entries(G.outposts)) {
      if (!op || !op.wall || op.isVillage) continue;
      const O = OUTPOSTS[site];
      const dd = dist(x, y, O.x, O.y);
      const OR = opWallR(op);
      if (Math.abs(dd - OR) < r + 9 && dd > 1) {
        const a = Math.atan2(y - O.y, x - O.x);
        const inGap = angDiff(a, opWallGapDir(site)) < opGapA(op);
        const og = G.structures.find(s2 => s2.kind === 'owgate' && s2.site === site);
        if (!inGap || (isEnemy && og && og.alive)) {
          const side = dd < OR ? OR - (r + 9) : OR + (r + 9);
          x = O.x + Math.cos(a) * side; y = O.y + Math.sin(a) * side;
        }
      }
    }
  };
  ringPass();
  // daire engeller
  const solids = [];
  for (const n of G.nodes) if (n.alive && n.kind !== 'scrap') solids.push([n.x, n.y, NODE_DEF[n.kind].r]);
  for (const b of G.buildings) solids.push([b.x, b.y, b.type === 'campfire' ? 34 : 30]); // konak daha geniş
  // KAPILAR daire engel DEĞİLDİR: geçilebilirlikleri sur halkası/dikdörtgen mantığıyla ayrıca
  // kararlaşır. Daire olarak da eklenince kapı, kendi boşluğunun tam ortasında bir kaya gibi
  // duruyor ve dosta açık kapıdan geçmeye çalışan birimler kanadına takılıp yığılıyordu.
  const KAPILAR = ['gate', 'gate2', 'gate3', 'lgate', 'owgate'];
  for (const s of G.structures) if (s.alive && !KAPILAR.includes(s.kind)) solids.push([s.x, s.y, s.kind === 'totem' ? 16 : 15]);
  for (const [ox, oy, orr] of solids) {
    const d = dist(x, y, ox, oy), min = orr + r;
    // hafif açısal sapma (+0.09): tam hizada engele yürüyen birim kilitlenmesin, kenarından kaysın
    if (d < min && d > 0.01) { const a = Math.atan2(y - oy, x - ox) + 0.09; x = ox + Math.cos(a) * min; y = oy + Math.sin(a) * min; }
  }
  // duvarlar (dikdörtgen) + kapılar (fethedilen kalenin kapısı dosta açık, düşmana kapalı)
  const rects = [...G.walls];
  const gate = G.structures.find(s => s.kind === 'gate');
  if (gate && gate.alive && (G.outposts.fort ? isEnemy : !isEnemy)) rects.push({ x: FORT.x0 - 13, y: FORT.gateY0, w: 26, h: FORT.gateY1 - FORT.gateY0 }); // kale kimin ise kapısı ona açık
  const lgate = G.structures.find(s => s.kind === 'lgate');
  if (lgate && lgate.alive && (G.outposts.legion ? isEnemy : !isEnemy)) rects.push({ x: LEG.gx0, y: LEG.y1 - 13, w: LEG.gx1 - LEG.gx0, h: 26 });
  for (const s2 of G.structures) if ((s2.kind === 'gate2' || s2.kind === 'gate3') && s2.alive && (G.outposts.fort ? isEnemy : !isEnemy)) rects.push({ x: s2.gx, y: s2.gy, w: s2.gw, h: s2.gh }); // iç sur kapıları
  for (const w of rects) {
    const nx = clamp(x, w.x, w.x + w.w), ny = clamp(y, w.y, w.y + w.h);
    const d = dist(x, y, nx, ny);
    if (d < r) {
      if (d < 0.01) { y = w.y - r; } // içine gömülme kaçışı
      else { const a = Math.atan2(y - ny, x - nx); x = nx + Math.cos(a) * r; y = ny + Math.sin(a) * r; }
    }
  }
  ringPass(); // son geçiş: bina/duvar itmesi birimi sur halkasının öbür tarafına fırlatmasın
  return [x, y];
}

// ---------- Prosedürel Mağara Koşusu ----------
function clearCave() {
  for (const c of G.commanders) { c.patA = undefined; c.patT = 0; c.wp = null; c.sideT = 0; } // görev hedefleri tazelensin
  G.caveRooms = null; G.caveTorches = null; G.caveFloor = null;
  G.caveFaces = null; G.caveShade = null; G.caveCrystals = null;
  G.walls = G.walls.filter(w => !w.cave);
  G.enemies = G.enemies.filter(e => e.camp !== 'cave');
  G.structures = G.structures.filter(s => !s.cave);
  G.props = G.props.filter(pr => pr.kind !== 'portal');
  // içeride yaralı kalan yoldaşlar dışarı sürüklenir
  for (const w of G.wounded) if (w.x > OVERWORLD_W) { w.x = CAMPFIRE.x + rr(-80, 80); w.y = CAMPFIRE.y + rr(60, 130); }
}
// Prosedürel zindan: hücre ızgarasında odalar açılır, komşular L koridorlarla bağlanır,
// kapalı kalan hücreler yatay şeritler hâlinde duvara dönüşür (az sayıda dikdörtgen = hızlı çarpışma).
function buildDungeon(A) {
  const CELL = 112;   // hücre boyu 40 → 112: odalar ve 2 hücrelik koridorlar ~3x geniş
  const cols = Math.floor(A.w / CELL), rows = Math.floor(A.h / CELL);
  const acik = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const GX = 4, GY = 3;                                   // 12 oda hücresi
  const hw = Math.floor(cols / GX), hh = Math.floor(rows / GY);
  const odalar = [];
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const ow = 4 + Math.floor(Math.random() * Math.max(1, hw - 5));
    const oh = 3 + Math.floor(Math.random() * Math.max(1, hh - 4));
    const ox = gx * hw + 1 + Math.floor(Math.random() * Math.max(1, hw - ow - 1));
    const oy = gy * hh + 1 + Math.floor(Math.random() * Math.max(1, hh - oh - 1));
    for (let j = oy; j < oy + oh && j < rows; j++) for (let i = ox; i < ox + ow && i < cols; i++) acik[j][i] = true;
    odalar.push({ gx, gy, x: ox, y: oy, w: ow, h: oh, cx: ox + (ow >> 1), cy: oy + (oh >> 1) });
  }
  const ac = (i, j) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const jj = j + dy, ii = i + dx; if (jj >= 0 && jj < rows && ii >= 0 && ii < cols) acik[jj][ii] = true; } };
  const tunel = (a, b) => {
    let x = a.cx, y = a.cy;
    while (x !== b.cx) { x += Math.sign(b.cx - x); ac(x, y); }
    while (y !== b.cy) { y += Math.sign(b.cy - y); ac(x, y); }
  };
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const a = odalar[gy * GX + gx];
    if (gx < GX - 1) tunel(a, odalar[gy * GX + gx + 1]);
    if (gy < GY - 1) tunel(a, odalar[(gy + 1) * GX + gx]);
  }
  const T = 26; // dış kabuk
  G.walls.push(
    { cave: true, x: A.x0 - T, y: A.y0 - T, w: A.w + T * 2, h: T },
    { cave: true, x: A.x0 - T, y: A.y0 + A.h, w: A.w + T * 2, h: T },
    { cave: true, x: A.x0 - T, y: A.y0 - T, w: T, h: A.h + T * 2 },
    { cave: true, x: A.x0 + A.w, y: A.y0 - T, w: T, h: A.h + T * 2 },
  );
  for (let j = 0; j < rows; j++) { // kapalı hücreler → yatay duvar şeritleri
    let i = 0;
    while (i < cols) {
      if (acik[j][i]) { i++; continue; }
      let k = i;
      while (k < cols && !acik[j][k]) k++;
      G.walls.push({ cave: true, x: A.x0 + i * CELL, y: A.y0 + j * CELL, w: (k - i) * CELL, h: CELL });
      i = k;
    }
  }
  const dunya = o => ({ x: A.x0 + (o.cx + 0.5) * CELL, y: A.y0 + (o.cy + 0.5) * CELL });
  // Zemin: açık hücrelerin tamamı (odalar + koridorlar) yatay şeritler hâlinde
  const zemin = [];
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      if (!acik[j][i]) { i++; continue; }
      let k = i;
      while (k < cols && acik[j][k]) k++;
      zemin.push({ x: A.x0 + i * CELL, y: A.y0 + j * CELL, w: (k - i) * CELL, h: CELL });
      i = k;
    }
  }
  G.caveFloor = zemin;
  G.caveRooms = odalar.map(o => ({ x: A.x0 + o.x * CELL, y: A.y0 + o.y * CELL, w: o.w * CELL, h: o.h * CELL }));
  // Kaya ile zeminin SINIRLARI ayrıca çıkarılır — duvarı zeminden ayıran şey renk farkı
  // değil, bu kenarlardır: kayanın güney yüzü ışık alır (aydınlık taş şeridi), zeminin
  // kuzey kenarına da kayanın gölgesi düşer. İkisi olmadan her şey tek düz leke oluyordu.
  const yuzler = [], golgeler = [];
  const kosu = (j, testi, hedef, dy) => {
    let i = 0;
    while (i < cols) {
      if (!testi(j, i)) { i++; continue; }
      let k = i;
      while (k < cols && testi(j, k)) k++;
      hedef.push({ x: A.x0 + i * CELL, y: A.y0 + (j + dy) * CELL, w: (k - i) * CELL });
      i = k;
    }
  };
  for (let j = 0; j < rows; j++) {
    kosu(j, (jj, ii) => !acik[jj][ii] && jj + 1 < rows && acik[jj + 1][ii], yuzler, 1); // kayanın güney yüzü
    kosu(j, (jj, ii) => acik[jj][ii] && jj - 1 >= 0 && !acik[jj - 1][ii], golgeler, 0);  // zemine düşen gölge
  }
  G.caveFaces = yuzler; G.caveShade = golgeler;
  return { odalar, dunya };
}
function enterCave() {
  const A = CAVE_AREA;
  clearCave();
  G.caveReturn = { x: G.player.x, y: G.player.y };
  const { odalar, dunya } = buildDungeon(A);
  const giris = odalar[0], boss = odalar[odalar.length - 1];
  const gp = dunya(giris), bp = dunya(boss);
  // düşman kadrosu odalara dağılır (giriş odası boş: nefes alacak yer)
  const pool = ['barb', 'barb', 'archer', 'shieldbarb', 'brute', 'shaman'];
  const toplam = 6 + Math.floor(Math.random() * 3) + (G.region - 1);
  let kalan = toplam;
  G.caveTorches = [];
  G.caveCrystals = [];
  for (let oi = 1; oi < odalar.length; oi++) {
    const p2 = dunya(odalar[oi]);
    for (let m = 0; m < 3; m++)                                        // büyüyen odalarda 3 meşale
      G.caveTorches.push({ x: p2.x + rr(-150, 150), y: p2.y - rr(20, 150) });
    if (oi % 2 === 0)                                                     // bazı odalarda ışıldayan kristal kümesi
      G.caveCrystals.push({ x: p2.x + rr(-200, 200), y: p2.y + rr(40, 190), n: ri(2, 4), f: rng() * 6 });
    if (oi === odalar.length - 1) continue;                              // boss odasına aşağıda bakılır
    const adet = Math.max(1, Math.round(kalan / (odalar.length - oi)));
    for (let i = 0; i < adet && kalan > 0; i++, kalan--)
      spawnEnemy(pool[Math.floor(Math.random() * pool.length)], p2.x + rr(-190, 190), p2.y + rr(-150, 150), 'cave');
  }
  spawnEnemy('bear', bp.x - 40, bp.y, 'cave');
  for (let i = 0; i < 2; i++) spawnEnemy('brute', bp.x + rr(-70, 70), bp.y + rr(-60, 60), 'cave'); // boss muhafızları
  G.structures.push({ kind: 'cavechest', cave: true, x: bp.x + 60, y: bp.y, hp: 1, maxHp: 1, alive: true });
  // içeri ışınlan (yanındakilerle)
  G.player.x = gp.x; G.player.y = gp.y;
  [...G.soldiers, ...G.commanders].forEach(sl => { sl.x = G.player.x + rr(-30, 30); sl.y = G.player.y + rr(30, 70); });
  G.autoTravel = null; G.pendingTravel = null;
  G.caveRun = { active: true };
  banner('KARANLIK İN'); SFX.horn();
  toast('Geri dönüş yok — hazineyi al ya da karanlıkta kal!', true);
}
function leaveCave(won) {
  const back = G.caveReturn || { x: CAVE.x, y: CAVE.y + 80 };
  G.player.x = back.x; G.player.y = back.y + 40;
  [...G.soldiers, ...G.commanders].forEach(sl => { sl.x = G.player.x + rr(-30, 30); sl.y = G.player.y + rr(20, 60); });
  clearCave();
  G.caveRun = null;
  if (won) toast('Gün ışığı... İn 15 dakika sonra yeniden dolacak.');
}

// ---------- Başarımlar ----------
const ACHIEVEMENTS = [
  { id: 'firstblood', icon: '🗡️', name: 'İlk Kan', desc: 'İlk düşmanını öldür', check: () => G.stats.kills >= 1 },
  { id: 'lumber', icon: '🪵', name: 'Baltacı', desc: '25 ağaç kes', check: () => G.stats.chops >= 25 },
  { id: 'conqueror', icon: '🏳️', name: 'Fatih', desc: 'İlk karakolunu kur', check: () => !!(G.outposts.camp1 || G.outposts.fort || G.outposts.legion) },
  { id: 'stonewall', icon: '🏰', name: 'Taş Duvar', desc: 'Taş Sur\'a yükselt', check: () => G.palisade.lv >= 2 },
  { id: 'nightwatch', icon: '🌙', name: 'Gece Bekçisi', desc: '5 baskın savuştur', check: () => G.raidsSurvived >= 5 },
  { id: 'vulkar', icon: '💀', name: 'Vulkar Avcısı', desc: 'Kara Vulkar\'ı devir', check: () => !G.rival.alive },
  { id: 'bear', icon: '🐻', name: 'İn Temizliği', desc: 'Mağara Ayısı\'nı alt et', check: () => G.caveCleared },
  { id: 'veteran', icon: '⭐', name: 'Kıdemli', desc: 'Seviye 10\'a ulaş', check: () => G.level >= 10 },
  { id: 'dynasty', icon: '👑', name: 'Hanedan Yükselişi', desc: '2000 hanedan puanı biriktir', check: () => G.dynasty >= 2000 },
  { id: 'region2', icon: '🏔️', name: 'Göçebe Fatih', desc: '2. bölgeye ulaş', check: () => G.region >= 2 },
  { id: 'caravan', icon: '🐴', name: 'Kervancıbaşı', desc: '10 vergi kervanı ulaştır', check: () => G.stats.caravans >= 10 },
  { id: 'giant', icon: '👹', name: 'Dev Avcısı', desc: 'Dağ Devi\'ni devir', check: () => G.stats.bossKills >= 2 },
  { id: 'suomi', icon: '🔥', name: 'Kül Hakanı', desc: 'Kül Yakası\'nın tamamını fethet', check: () => { const ps = WORLD_PROVINCES.filter(p => p.country === 'kul'); return ps.length > 0 && ps.every(p => G.worldConquered.includes(p.id)); } },
  { id: 'world', icon: '🌍', name: 'Cihan Fatihi', desc: 'Bilinen dünyanın tamamını fethet', check: () => G.worldDone },
];
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (G.ach[a.id]) continue;
    try {
      if (a.check()) {
        G.ach[a.id] = true;
        banner('🏆 ' + a.name.toUpperCase());
        toast('🏆 Başarım: ' + a.name + ' — ' + a.desc);
        [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.1, 50), i * 120));
        save();
      }
    } catch (e) { }
  }
}

// ---------- Zafer & Hanedan ----------
function calcDynasty() {
  const rows = [];
  const add = (label, pts) => { pts = Math.round(pts); if (pts > 0) rows.push([label, pts]); };
  add('🏳️ Fethedilen karakollar', 3 * 200);
  add('⚡ Hız bonusu (Gün ' + G.day + ')', Math.max(0, 900 - (G.day - 1) * 40));
  add('🌙 Savuşturulan baskınlar', G.raidsSurvived * 40);
  const bl = G.buildings.filter(b => b.type !== 'campfire');
  add('🏘️ Köy gelişimi', bl.length * 50 + bl.reduce((a, b) => a + (b.lv - 1) * 40, 0));
  add('🗡️ Ordu', (G.soldiersOwned + Object.values(G.outposts).reduce((a, o) => a + (o.garrison || 0), 0)) * 30);
  add('👤 Köylüler', G.buildings.filter(b => b.villager).length * 40);
  add('🪙 Hazine', G.res.gold / 10 + G.res.gems * 15);
  add('💀 Kara Vulkar bertaraf', G.rival.alive ? 0 : 400);
  let total = rows.reduce((a, r) => a + r[1], 0);
  const regMul = 1 + (G.region - 1) * 0.5;
  if (regMul > 1) rows.push(['🌍 Bölge çarpanı', '×' + regMul.toFixed(1)]);
  const dMul = (DIFF[G.difficulty] || DIFF.normal).score;
  if (dMul !== 1) rows.push(['⚖️ Zorluk (' + DIFF[G.difficulty].name + ')', '×' + dMul.toFixed(2)]);
  total = Math.round(total * regMul * dMul);
  return { rows, total };
}
function showVictory(result) {
  $('victory').classList.remove('hidden');
  const P = PROV_BY_ID[G.provinceId], C = WORLD_COUNTRIES[P.country];
  $('vicRegion').textContent = C.flag + ' ' + P.name + ', ' + C.name + ' — Kademe ' + P.tier;
  $('vicRows').innerHTML =
    result.rows.map(r => `<div class="vrow"><span>${r[0]}</span><b>${typeof r[1] === 'number' ? '+' + r[1] : r[1]}</b></div>`).join('') +
    `<div class="vrow vtotal"><span>Bölge toplamı</span><b>+${result.total}</b></div>`;
  $('vicDynasty').textContent = '👑 Hanedan Puanı: ' + G.dynasty;
  setTimeout(() => toast('💎 Mücevherlerini Hanedan Mirası\'na yatır (Köy Konağı menüsü)'), 1500);
  // fanfar
  [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'triangle', 0.12, 40), i * 170));
}
function regionMigrate(targetPid) {
  const target = PROV_BY_ID[targetPid] || provFromLegacy(G.region + 1);
  try { sessionStorage.setItem('kd-resume', '1'); } catch (e) { } // sefer reload'unda menüyü atla
  SUPPRESS_SAVE = true; // reload sırasındaki otokayıt göç verisini ezmesin (aynı haritada kalma bug'ı)
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      migrated: true,
      region: target.tier, provinceId: target.id,
      worldConquered: G.worldConquered, countryBonus: G.countryBonus, worldDone: G.worldDone,
      dynasty: G.dynasty, dynUpg: G.dynUpg,
      level: G.level, xp: G.xp, horseOwned: !!G.horseOwned,
      res: G.res, swordLv: G.swordLv, armorLv: G.armorLv,
      bag: G.bag, equip: G.equip, // kuşam ve çanta seninle göçer
      // SADECE YANINDAKİ MAİYET GÖÇER. Garnizonlar fethedilen üsleri korumak için
      // orada bırakılır, komutanların öz orduları da kendi bölgelerinde kalır —
      // eskiden hepsi tek yığına ekleniyordu ve yeni haritada 12/12 olan ordu
      // 28/12 gibi kapasite üstü bir sayıya fırlıyordu.
      soldiersOwned: Math.min(G.soldiers.length, soldierCap()),
      soldierCls: G.soldiers.slice(0, soldierCap()).map(sl => sl.cls || 'sword'),
      soldierMeta: G.soldiers.slice(0, soldierCap()).map(sl => ({ cls: sl.cls || 'sword', lv: sl.lv || 1, xp: Math.round(sl.xp || 0) })),
      commanders: G.commanders.map(c => ({ id: c.id, lv: c.lv, kills: c.kills, gear: c.gear, purse: Math.round(c.purse || 0) })), // görev/ordu göçte sıfırlanır
      // esir/yaralı komutanlar da zincirlenmiş taşınır: yeni bölgenin zindanlarında kurtarılmayı bekler
      prisoners: (() => {
        const pz = { camp1: [], fort: [], legion: [] };
        for (const [st, arr] of Object.entries(G.prisoners)) for (const m of arr) if (m.cmd) pz[st].push(m);
        for (const w of G.wounded) if (w.cmd) pz[['camp1', 'fort', 'legion'][ri(0, 2)]].push({ cmd: w.cmd, lv: w.lv, kills: w.kills, gear: w.gear });
        return pz;
      })(),
      difficulty: G.difficulty, stats: G.stats, ach: G.ach,
    }));
  } catch (e) { }
  location.reload();
}

// ---------- Cihan Fethi: fetih işaretleme + dünya haritası ----------
function worldConquer() {
  const pid = G.provinceId;
  if (!G.worldConquered.includes(pid)) G.worldConquered.push(pid);
  const P = PROV_BY_ID[pid], C = WORLD_COUNTRIES[P.country];
  // ülke tamamlandı mı? (bir kere ödüllendir)
  const mates = WORLD_PROVINCES.filter(p => p.country === P.country);
  if (mates.every(p => G.worldConquered.includes(p.id)) && !G.countryBonus[P.country]) {
    G.countryBonus[P.country] = true;
    const bonus = 15 + P.tier * 5;
    G.res.gems += bonus; G.dynasty += 400;
    setTimeout(() => {
      banner(C.flag + ' ' + C.name.toUpperCase() + ' BİRLEŞTİRİLDİ!');
      toast('👑 ' + C.name + ' tamamen senin! +' + bonus + '💎, +400 hanedan', true);
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'triangle', 0.12, 50), i * 150));
    }, 2600);
  }
  // cihan tamamlandı mı?
  if (!G.worldDone && WORLD_PROVINCES.every(p => G.worldConquered.includes(p.id))) {
    G.worldDone = true;
    setTimeout(() => {
      banner('🌍 CİHAN FATİHİ! 🌍');
      toast('Bilinen dünyada sana direnecek kimse kalmadı. Hanedanın sonsuza dek anılacak! 👑', true);
    }, 5200);
  }
}
// Vilayet durumu: 2=fethedildi, 1=sefere açık (fethedilmiş komşusu var), 0=kilitli
function provState(p) {
  if (G.worldConquered.includes(p.id)) return 2;
  if (p.id === G.provinceId) return 1; // üzerinde savaştığın toprak her zaman görünür
  return p.links.some(l => G.worldConquered.includes(l)) ? 1 : 0;
}
// Stilize İskandinavya + Baltık kıyıları (1000×620 cihan tuvali)
// Fantezi kıtası: 5 diyar tek kara parçasını paylaşır (deniz sadece kenarlarda)
const WORLD_POLY = {
  // Sınırlar world-map.png üzerindeki biyom geçişlerine göre çizildi.
  demir: [[90, 225], [140, 98], [240, 30], [340, 8], [440, 45], [460, 128], [420, 195], [400, 270], [360, 315], [220, 345], [110, 330]],
  buz:   [[440, 45], [520, 8], [660, 8], [780, 30], [880, 83], [920, 150], [900, 218], [780, 233], [660, 225], [550, 203], [460, 165], [460, 128]],
  orta:  [[400, 195], [460, 165], [550, 203], [660, 225], [680, 315], [660, 413], [600, 488], [520, 525], [440, 495], [400, 413], [380, 315], [400, 270]],
  sis:   [[660, 225], [780, 233], [900, 218], [950, 270], [970, 375], [950, 480], [900, 585], [820, 660], [720, 698], [620, 690], [560, 630], [520, 525], [600, 488], [660, 413], [680, 315]],
  kul:   [[110, 330], [220, 345], [360, 315], [380, 315], [400, 413], [440, 495], [520, 525], [500, 600], [440, 675], [340, 713], [220, 698], [120, 645], [60, 540], [60, 420]],
};
// Görünüm paketi (admin panelinden): oyunun prosedürel renk paleti değiştirilebilir
let SKIN = {};
SKIN = JSON.parse(JSON.stringify(KDC.skin || {}));                       // yayındaki görünüm
try { Object.assign(SKIN, JSON.parse(localStorage.getItem('kd-skin')) || {}); } catch (e) { }  // yerel deneme
function applySkin() {
  if (SKIN.races) for (const [r2, c2] of Object.entries(SKIN.races)) if (RACES[r2]) RACES[r2].cloth = c2;
  if (SKIN.roofs) for (const [t2, c2] of Object.entries(SKIN.roofs)) if (BUILDINGS[t2]) BUILDINGS[t2].roof = c2;
  if (SKIN.theme) Object.assign(THEME, SKIN.theme);
}
applySkin();
const elWorldOverlay = $('worldOverlay'), worldCv = $('worldCanvas');
let worldScale = 1, worldPad = 0, worldOffX = 0;
// Harita 4:3 — elle çizilmiş cihan haritası görseli (world-map.png) bu orana göre.
const WORLD_MAP_W = 1000, WORLD_MAP_H = 750;
// Kullanıcının hazırladığı harita görseli: klasöre world-map.png konursa cihan
// haritası prosedürel çizim yerine BU görseli kullanır, etiket/vilayet noktaları
// üstüne bindirilir. Dosya yoksa prosedürel ada çizimi devreye girer.
// Önce sıkıştırılmış world-map.jpg denenir (2.9 MB PNG → 660 KB), yoksa PNG'ye
// düşer. Kullanıcı haritayı değiştirmek isterse klasöre world-map.png koyması
// yeterli; jpg silinince otomatik ona döner.
const worldImg = new Image();
let worldImgOk = false;
worldImg.onload = () => { worldImgOk = worldImg.naturalWidth > 0; };
worldImg.onerror = () => { if (worldImg.src.endsWith('.jpg')) worldImg.src = 'world-map.png'; };
worldImg.src = 'world-map.jpg';
function openWorld(choose) {
  if (VISIT || ISLAND) { toast('Ziyaret/ada sırasında cihan seferi yapılamaz — önce eve dön', true); return; }
  G.worldChoose = !!choose;
  elWorldOverlay.classList.remove('hidden');
  $('worldHint').textContent = G.worldChoose
    ? '⚔️ Sefere çıkılacak vilayeti seç — köy geride kalır, hanedanın seninle gelir'
    : 'Fethedilen komşular yeni seferler açar · amaç: bilinen dünyanın tamamı';
  drawWorld();
}
function closeWorld() { elWorldOverlay.classList.add('hidden'); }
$('worldClose').addEventListener('click', closeWorld);
elWorldOverlay.addEventListener('pointerdown', e => { if (e.target === elWorldOverlay) closeWorld(); });
function drawWorld() {
  const availW = Math.max(340, Math.min(window.innerWidth * 0.94, 1240));
  const availH = Math.max(260, window.innerHeight * 0.94 - 130); // başlık + ipucu payı
  worldScale = Math.min(availW / WORLD_MAP_W, availH / WORLD_MAP_H);
  const cw = WORLD_MAP_W * worldScale, ch = WORLD_MAP_H * worldScale;
  worldCv.width = cw * DPR; worldCv.height = ch * DPR;
  worldCv.style.width = cw + 'px'; worldCv.style.height = ch + 'px';
  const m = worldCv.getContext('2d');
  m.setTransform(DPR * worldScale, 0, 0, DPR * worldScale, 0, 0);
  // ---- HAZIR HARİTA GÖRSELİ ----
  // Klasörde world-map.png varsa arazi çizimi ondan gelir; etiketler, yollar ve
  // vilayet noktaları görselin ÜSTÜNE bindirilir (koordinatlar aynı kalır).
  if (worldImgOk) {
    m.drawImage(worldImg, 0, 0, WORLD_MAP_W, WORLD_MAP_H);
    // fethedilen diyarların üstüne hafif altın vurgu + sınır
    for (const [cid, poly] of Object.entries(WORLD_POLY)) {
      if (!G.countryBonus[cid]) continue;
      m.beginPath(); m.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) m.lineTo(poly[i][0], poly[i][1]);
      m.closePath();
      m.fillStyle = 'rgba(255,215,120,0.16)'; m.fill();
      m.strokeStyle = '#ffd97e'; m.lineWidth = 3; m.stroke();
    }
    m.textAlign = 'center';
    ciz_etiket_ve_noktalar(m);
    return;
  }
  // ---- DERİN DENİZ ----
  const sg = m.createLinearGradient(0, 0, 0, WORLD_MAP_H);
  sg.addColorStop(0, '#10476e'); sg.addColorStop(0.55, '#0d3a5e'); sg.addColorStop(1, '#0a2f4d');
  m.fillStyle = sg; m.fillRect(0, 0, WORLD_MAP_W, WORLD_MAP_H);
  // dalga süsleri (deterministik: drawWorld saniyede 8 kez çağrılıyor, rng kullanılamaz)
  m.strokeStyle = 'rgba(190,225,245,0.13)'; m.lineWidth = 1.4;
  for (let i = 0; i < 46; i++) {
    const wx = (i * 397) % WORLD_MAP_W, wy = 26 + (i * 251) % (WORLD_MAP_H - 52);
    m.beginPath(); m.arc(wx, wy, 7 + (i % 3) * 2, Math.PI * 0.15, Math.PI * 0.85); m.stroke();
  }
  // Ada silüeti: tüm diyar poligonları TEK yol olarak çizilip önce sığ su halkası,
  // sonra kumsal kenarı basılır — parçalı ülkeler yerine tek bir kara kütlesi okunur.
  const adaYolu = () => {
    m.beginPath();
    for (const poly of Object.values(WORLD_POLY)) {
      m.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) m.lineTo(poly[i][0], poly[i][1]);
      m.closePath();
    }
  };
  for (const [genislik, renk] of [[34, 'rgba(64,150,190,0.30)'], [22, 'rgba(86,175,205,0.34)'], [11, 'rgba(126,205,220,0.40)']]) {
    adaYolu(); m.lineWidth = genislik; m.strokeStyle = renk; m.lineJoin = 'round'; m.stroke();
  }
  adaYolu(); m.lineWidth = 7; m.strokeStyle = '#d9c089'; m.stroke();   // kumsal şeridi
  // diyarlar: her bölgenin kendi toprağı rengi (fethedilen altın çerçeveli)
  for (const [cid, poly] of Object.entries(WORLD_POLY)) {
    const done = !!G.countryBonus[cid];
    const CC = WORLD_COUNTRIES[cid];
    m.beginPath(); m.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) m.lineTo(poly[i][0], poly[i][1]);
    m.closePath();
    m.fillStyle = CC.col || '#5d6b52';
    m.fill();
    m.strokeStyle = done ? '#ffd97e' : (CC.edge || 'rgba(20,28,18,0.8)'); m.lineWidth = done ? 3 : 2.5; m.stroke();
  }
  // ---- ARAZİ DOKUSU: her diyar kendi biyomunu çizer (emoji değil, gerçek arazi) ----
  // Konumlar deterministik bir karmadan gelir: drawWorld 120 ms'de bir çağrıldığı için
  // rng() kullanılırsa doku her karede zıplar.
  const H = i => { let t = (i * 2654435761) >>> 0; t = ((t ^ (t >>> 15)) * 2246822507) >>> 0; return ((t ^ (t >>> 13)) >>> 0) % 100000 / 100000; };
  const icinde = (px, py, poly) => {
    let ic = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  };
  const dag = (px, py, s, taban, tepe, kar) => {          // dağ silüeti (+ istenirse karlı zirve)
    m.fillStyle = taban;
    m.beginPath(); m.moveTo(px - 13 * s, py); m.lineTo(px, py - 20 * s); m.lineTo(px + 13 * s, py); m.closePath(); m.fill();
    m.fillStyle = tepe;
    m.beginPath(); m.moveTo(px - 5 * s, py - 12 * s); m.lineTo(px, py - 20 * s); m.lineTo(px + 4 * s, py - 11 * s); m.closePath(); m.fill();
    if (kar) { m.fillStyle = '#eef6fa'; m.beginPath(); m.moveTo(px - 5 * s, py - 13 * s); m.lineTo(px, py - 20 * s); m.lineTo(px + 5 * s, py - 13 * s); m.closePath(); m.fill(); }
  };
  const agac = (px, py, s, koyu, acik) => {
    m.fillStyle = '#4a3220'; m.fillRect(px - 1 * s, py - 3 * s, 2 * s, 4 * s);
    m.fillStyle = koyu;
    m.beginPath(); m.moveTo(px - 6 * s, py - 2 * s); m.lineTo(px, py - 16 * s); m.lineTo(px + 6 * s, py - 2 * s); m.closePath(); m.fill();
    m.fillStyle = acik;
    m.beginPath(); m.moveTo(px - 3.5 * s, py - 5 * s); m.lineTo(px, py - 15 * s); m.lineTo(px + 1.5 * s, py - 6 * s); m.closePath(); m.fill();
  };
  const BIYOM = {
    demir: (px, py, h) => h < 0.24                        // volkanik dağ sırası + lav çatlakları
      ? (() => { dag(px, py, 1.1, '#5d3226', '#7d4433');
          m.strokeStyle = '#ef6a24'; m.lineWidth = 1.6;
          m.beginPath(); m.moveTo(px - 2, py - 14); m.lineTo(px + 1, py - 6); m.lineTo(px - 2, py); m.stroke(); })()
      : dag(px, py, 0.75 + h * 0.5, '#5a4436', '#7a5f4b'),
    buz:   (px, py, h) => h < 0.5 ? dag(px, py, 0.8 + h, '#8fa8b8', '#c2d6e2', true)
      : (() => { m.fillStyle = 'rgba(240,250,255,0.55)';  // buz kütleleri
          m.beginPath(); m.ellipse(px, py, 9 + h * 7, 5 + h * 3, h * 3, 0, TAU); m.fill(); })(),
    orta:  (px, py, h) => h < 0.62 ? agac(px, py, 0.75 + h * 0.5, '#3d6b2c', '#5b8f3e')
      : (() => { m.strokeStyle = 'rgba(120,160,80,0.6)'; m.lineWidth = 1.4; // ot tutamı
          for (let k = -1; k <= 1; k++) { m.beginPath(); m.moveTo(px + k * 3, py); m.lineTo(px + k * 4.5, py - 6); m.stroke(); } })(),
    sis:   (px, py, h) => h < 0.45
      ? (() => { m.fillStyle = 'rgba(38,74,72,0.55)';     // bataklık gölcüğü
          m.beginPath(); m.ellipse(px, py, 8 + h * 12, 4 + h * 6, h * 2, 0, TAU); m.fill();
          m.strokeStyle = 'rgba(150,190,170,0.3)'; m.lineWidth = 1; m.stroke(); })()
      : agac(px, py, 0.6 + h * 0.4, '#2f5340', '#44705a'),
    kul:   (px, py, h) => h < 0.55
      ? (() => { m.strokeStyle = 'rgba(160,124,66,0.5)'; m.lineWidth = 2.2;  // kum kumulları
          m.beginPath(); m.arc(px, py + 5, 11 + h * 10, Math.PI * 1.08, Math.PI * 1.92); m.stroke(); })()
      : (() => { m.fillStyle = '#8d6f42';                 // kaya sivrisi
          m.beginPath(); m.moveTo(px - 5, py); m.lineTo(px - 1, py - 13); m.lineTo(px + 4, py); m.closePath(); m.fill(); })(),
  };
  for (const [cid, poly] of Object.entries(WORLD_POLY)) {
    const ciz = BIYOM[cid]; if (!ciz) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [px, py] of poly) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    const tohum = cid.charCodeAt(0) * 977 + cid.length * 31;
    let kondu = 0;
    for (let i = 0; i < 260 && kondu < 42; i++) {
      const px = x0 + H(tohum + i * 3) * (x1 - x0), py = y0 + H(tohum + i * 3 + 1) * (y1 - y0);
      if (!icinde(px, py, poly)) continue;
      // kenardan biraz içeride kalsın (kumsala doku basmayalım)
      if (!icinde(px + 16, py, poly) || !icinde(px - 16, py, poly) || !icinde(px, py + 14, poly) || !icinde(px, py - 14, poly)) continue;
      m.globalAlpha = 0.85;
      ciz(px, py, H(tohum + i * 3 + 2));
      kondu++;
    }
    m.globalAlpha = 1;
  }
  // ---- NEHİRLER: dağlardan denize (haritaya ölçek ve yön duygusu katar) ----
  const NEHIRLER = [
    [[300, 181], [340, 302], [378, 399], [396, 520], [408, 611], [392, 708]],
    [[600, 290], [645, 399], [678, 508], [694, 611], [700, 692]],
    [[240, 363], [196, 450], [152, 547], [116, 629], [92, 663]],
  ];
  m.lineCap = 'round'; m.lineJoin = 'round';
  for (const nehir of NEHIRLER) {
    for (const [gen, renk] of [[7, 'rgba(20,60,90,0.35)'], [4.5, '#4d9ec4']]) {
      m.beginPath(); m.moveTo(nehir[0][0], nehir[0][1]);
      for (let i = 1; i < nehir.length - 1; i++) {
        const xc = (nehir[i][0] + nehir[i + 1][0]) / 2, yc = (nehir[i][1] + nehir[i + 1][1]) / 2;
        m.quadraticCurveTo(nehir[i][0], nehir[i][1], xc, yc);
      }
      m.lineTo(nehir[nehir.length - 1][0], nehir[nehir.length - 1][1]); // son parça: nehir denize ulaşsın
      m.lineWidth = gen; m.strokeStyle = renk; m.stroke();
    }
  }
  m.textAlign = 'center';
  ciz_etiket_ve_noktalar(m);
}
// Diyar etiketleri + yollar + vilayet noktaları (hem prosedürel hem görselli haritada aynı)
function ciz_etiket_ve_noktalar(m) {
  m.textAlign = 'center';
  // diyar etiketleri + ilerleme
  for (const cid of Object.keys(WORLD_POLY)) {
    const done = !!G.countryBonus[cid];
    const ps = WORLD_PROVINCES.filter(p => p.country === cid);
    const got = ps.filter(p => G.worldConquered.includes(p.id)).length;
    const CC = WORLD_COUNTRIES[cid];
    m.font = 'bold 15px Georgia, serif'; m.lineJoin = 'round';
    const dm = CC.flag + ' ' + CC.name + (done ? ' 👑' : ' ' + got + '/' + ps.length);
    m.lineWidth = 4; m.strokeStyle = 'rgba(12,16,22,0.55)'; m.strokeText(dm, CC.lx, CC.ly);
    m.fillStyle = done ? '#ffd97e' : 'rgba(252,246,232,0.95)';
    m.fillText(dm, CC.lx, CC.ly);
  }
  // bağlantılar
  m.setLineDash([7, 6]); m.lineWidth = 2.4;
  const seen = new Set();
  for (const p of WORLD_PROVINCES) for (const l of p.links) {
    const key = [p.id, l].sort().join('|');
    if (seen.has(key) || !PROV_BY_ID[l]) continue; seen.add(key);
    const q = PROV_BY_ID[l];
    const lit = provState(p) > 0 && provState(q) > 0;
    m.strokeStyle = lit ? 'rgba(255,217,126,0.8)' : 'rgba(255,255,255,0.35)';
    m.beginPath(); m.moveTo(p.wx, p.wy); m.lineTo(q.wx, q.wy); m.stroke();
  }
  m.setLineDash([]);
  // vilayetler
  for (const p of WORLD_PROVINCES) {
    const st = provState(p), cur = p.id === G.provinceId;
    const pulse = (st === 1 && G.worldChoose && !cur) ? 2 + Math.sin(G.t * 4 + p.idx) * 1.6 : 0;
    m.beginPath(); m.arc(p.wx, p.wy, 15 + pulse, 0, TAU);
    m.fillStyle = st === 2 ? '#3f7a3a' : st === 1 ? '#8a6c2e' : 'rgba(40,45,40,0.85)';
    m.fill();
    m.lineWidth = cur ? 3.5 : 2;
    m.strokeStyle = cur ? '#ff6a55' : st === 2 ? '#a8e09a' : st === 1 ? '#ffd97e' : 'rgba(120,120,110,0.5)';
    m.stroke();
    m.font = '13px sans-serif'; m.fillStyle = '#fff';
    m.fillText(st === 2 ? '✓' : st === 1 ? '⚔️' : '🔒', p.wx, p.wy + 4.5);
    // Yazılar artık kar/çöl gibi AÇIK zeminlerin üstüne de düşüyor: koyu bir kontur
    // olmadan okunmuyorlardı.
    m.lineJoin = 'round';
    const yaz = (metin, yy, boyut, renk) => {
      m.font = boyut; m.lineWidth = 3.5; m.strokeStyle = 'rgba(12,16,22,0.72)';
      m.strokeText(metin, p.wx, yy); m.fillStyle = renk; m.fillText(metin, p.wx, yy);
    };
    yaz(p.name, p.wy + 30, 'bold 11px sans-serif', st === 0 ? 'rgba(214,210,196,0.8)' : '#f7edd6');
    yaz('K.' + p.tier + ' · ' + (RACES[p.race] ? RACES[p.race].name : ''), p.wy + 41, '9px sans-serif',
      st === 0 ? 'rgba(198,194,182,0.72)' : 'rgba(240,232,212,0.92)');
    if (cur) { m.font = 'bold 10px sans-serif'; m.fillStyle = '#ff8a75'; m.fillText('SEN', p.wx, p.wy - 22); }
  }
  // toplam ilerleme
  m.textAlign = 'left'; m.font = 'bold 12px sans-serif'; m.fillStyle = 'rgba(240,230,200,0.85)';
  m.fillText('🌍 ' + G.worldConquered.length + ' / ' + WORLD_PROVINCES.length + ' vilayet', 14, WORLD_MAP_H - 14);
}
worldCv.addEventListener('pointerdown', e => {
  const r = worldCv.getBoundingClientRect();
  const mx2 = (e.clientX - r.left) / worldScale, my2 = (e.clientY - r.top) / worldScale;
  for (const p of WORLD_PROVINCES) {
    if (Math.hypot(mx2 - p.wx, my2 - p.wy) > 26) continue;
    const st = provState(p);
    if (p.id === G.provinceId) { toast(G.victoryShown ? 'Burası fethedildi — sefer için başka vilayet seç' : 'Zaten buradasın — önce kamp, kale ve lejyonu fethet!'); return; }
    if (st === 0) { toast('🔒 ' + p.name + ' uzakta — önce komşu bir vilayeti fethet'); return; }
    if (st === 2) { toast('✓ ' + p.name + ' zaten hanedanının toprağı'); return; }
    if (!G.victoryShown) { toast('Önce buradaki fethi tamamla (kamp + kale + lejyon)!'); return; }
    const C = WORLD_COUNTRIES[p.country];
    const gar = Object.values(G.outposts).reduce((a2, o) => a2 + (o.garrison || 0), 0);
    const uyari = '\n\nSeninle gelir: hanedan puanı, seviye, kuşam, çanta, kaynaklar ve YANINDAKİ '
      + Math.min(G.soldiers.length, soldierCap()) + ' asker + ' + G.commanders.length + ' komutan.'
      + '\nGeride kalır: köy, karakollar' + (gar ? ', ' + gar + ' garnizon askeri' : '') + ' ve komutanların öz orduları.';
    if (confirm(p.name + ', ' + C.name + ' (Kademe ' + p.tier + ') seferine çıkılsın mı?' + uyari)) {
      closeWorld(); regionMigrate(p.id);
    }
    return;
  }
});
// dünya haritası açıkken nabız animasyonu için hafif yeniden çizim
setInterval(() => { if (!elWorldOverlay.classList.contains('hidden')) drawWorld(); }, 120);

// ---------- Karakollar (fethedilen yerler) ----------
// ARSA PLANI: yemek artık her yerleşkede yerel üretildiği için AVCI KULÜBESİ
// ilk sırada — köylü davet edilmeden de et üretir, üs kendi kendini besler.
const OUTPOST_PLAN = ['hunter', 'house', 'watchtower', 'house', 'depot', 'hunter', 'sawmill', 'house', 'watchtower'];
const OUTPOST_PLOT_N = [0, 4, 7, 10];   // Sv.1'de 4 arsa, Sv.2'de 7, Sv.3'te 10
const OUTPOST_BUILDS = ['house', 'watchtower', 'hunter', 'sawmill', 'depot']; // karakolda kurulabilenler
// Nokta bir dikdörtgene pad kadar yakın mı?
function rectYakin(w, x, y, pad) {
  const nx = clamp(x, w.x, w.x + w.w), ny = clamp(y, w.y, w.y + w.h);
  return dist(x, y, nx, ny) < pad;
}
// Karakolun yerleşilebilir alanı. Kazık surlu üste daire; taş surlu kalede
// dikdörtgen kutu (iç sur halkaları G.walls'ta olduğu için aşağıdaki duvar
// testi arsaları kendiliğinden iç kale / orta kale / dış kale bantlarına dağıtır).
// DÖRTGEN SURLU KALELER: alan genişlemesi DIŞ KALE eklemektir. Kalenin kendi taş
// kutusu (iç kale) ve varsa iç sur halkaları (orta kale) dar; seviye atladıkça
// mevcut surun 110px dışına yeni bir dış sur çekilir ve o bant arsalara açılır.
const KEEP_PAD = 150;   // bant genişliği: iki duvara da 52px pay kalsın diye 110 dardı
const KEEP_SITES = ['fort', 'legion'];
function keepBox(site, lv) {
  const pad = Math.max(0, ((lv || 1) - 1)) * KEEP_PAD;
  const B = site === 'fort' ? FORT : LEG;
  return { x0: B.x0 - pad, y0: B.y0 - pad, x1: B.x1 + pad, y1: B.y1 + pad };
}
// Sahip olunan kalelerin dış sur halkalarını (seviyeye göre) yeniden kurar
function rebuildKeepWalls() {
  G.walls = G.walls.filter(w => !w.keep);
  G.keepGates = [];   // dış kale surlarının GÖRÜNÜR kapıları (çizim işareti)
  for (const sid of KEEP_SITES) {
    const op = G.outposts[sid];
    if (!op || !op.owned || op.looted || !OUTPOSTS[sid]) continue;
    for (let lv = 2; lv <= (op.lv || 1); lv++) {
      const B = keepBox(sid, lv), T = 24;
      if (sid === 'fort') {   // kale kapısı BATIDA: yeni surda da aynı hizada boşluk bırak
        G.walls.push(
          { keep: true, x: B.x0 - T / 2, y: B.y0 - T / 2, w: B.x1 - B.x0 + T, h: T },
          { keep: true, x: B.x0 - T / 2, y: B.y1 - T / 2, w: B.x1 - B.x0 + T, h: T },
          { keep: true, x: B.x1 - T / 2, y: B.y0 - T / 2, w: T, h: B.y1 - B.y0 + T },
          { keep: true, x: B.x0 - T / 2, y: B.y0 - T / 2, w: T, h: FORT.gateY0 - B.y0 + T / 2 },
          { keep: true, x: B.x0 - T / 2, y: FORT.gateY1, w: T, h: B.y1 - FORT.gateY1 + T / 2 },
        );
      } else {                // lejyon kapısı GÜNEYDE
        G.walls.push(
          { keep: true, x: B.x0 - T / 2, y: B.y0 - T / 2, w: B.x1 - B.x0 + T, h: T },
          { keep: true, x: B.x0 - T / 2, y: B.y0 - T / 2, w: T, h: B.y1 - B.y0 + T },
          { keep: true, x: B.x1 - T / 2, y: B.y0 - T / 2, w: T, h: B.y1 - B.y0 + T },
          { keep: true, x: B.x0 - T / 2, y: B.y1 - T / 2, w: LEG.gx0 - B.x0 + T / 2, h: T },
          { keep: true, x: LEG.gx1, y: B.y1 - T / 2, w: B.x1 + T / 2 - LEG.gx1, h: T },
        );
      }
      // Açıklığa görünür kapı: çıplak boşluk "kapısı yok" gibi duruyordu.
      G.keepGates.push(sid === 'fort'
        ? { x: B.x0, y: (FORT.gateY0 + FORT.gateY1) / 2, dikey: true, boy: FORT.gateY1 - FORT.gateY0 }
        : { x: (LEG.gx0 + LEG.gx1) / 2, y: B.y1, dikey: false, boy: LEG.gx1 - LEG.gx0 });
    }
    // yeni surun içinde kalan ağaç/taş kaldırılır (birimler takılmasın)
    const B2 = keepBox(sid, op.lv || 1);
    clearNodesInside((B2.x0 + B2.x1) / 2, (B2.y0 + B2.y1) / 2,
      Math.max(B2.x1 - B2.x0, B2.y1 - B2.y0) / 2 + 30);
  }
}
function opInside(site, x, y) {
  const O = OUTPOSTS[site];
  if (KEEP_SITES.includes(site)) {
    const B = keepBox(site, (G.outposts[site] && G.outposts[site].lv) || 1);
    return x > B.x0 + 62 && x < B.x1 - 62 && y > B.y0 + 62 && y < B.y1 - 62;
  }
  return dist(x, y, O.x, O.y) < opWallRAt(site) - 78;   // sur dibine bina dikilmez
}
// Boş arsa yeri ara: sur/taş duvar/iç kale halkası ile ÇAKIŞMAYAN ilk nokta.
// DİKKAT — testler YALNIZ değişmeyen geometriye bakar (kale kutusu, G.walls, sancak
// mesafesi, önceki arsalar). Ağaç/bina/yapı "canlı mı" durumuna göre değiştiği için
// buraya karıştırılamaz: aynı üs kayıt açılışında yeniden kurulurken FARKLI konumlar
// çıkar ve binalar arsalarını kaybederdi. Kaynaklar sonradan temizlenir.
function opFreeSpot(site, kondu) {
  const O = OUTPOSTS[site];
  // Arama Sv.3 dış kalesinin köşesine (merkezden ~600px) kadar uzanır; adım ince
  // tutulur, yoksa iki sur arasındaki dar bantlara hiç aday düşmüyor.
  for (let R = 132; R <= 780; R += 18) {
    for (let k = 0; k < 40; k++) {
      const a = k * (TAU / 40) + R * 0.021;              // deterministik: her halkada açı kayar
      const x = O.x + Math.cos(a) * R, y = O.y + Math.sin(a) * R * 0.92;
      if (!opInside(site, x, y)) continue;
      if (dist(x, y, O.x, O.y) < 112) continue;                                   // sancağın dibi boş kalsın
      if (G.walls.some(w => !w.cave && rectYakin(w, x, y, 52))) continue;          // taş duvarlar + iç sur halkaları
      if (kondu.some(p => dist(x, y, p.x, p.y) < 118)) continue;                   // arsalar arası geçiş payı
      return { x, y };
    }
  }
  return null;
}
// Bu üsse, hedeflenen sayıya ulaşana dek yeni arsa ekle (plan sırası korunur).
// Arsanın üstünde kalan ağaç/taş kaldırılır — yoksa birimler oraya takılıyor.
function opAddPlots(site, hedef) {
  if (KEEP_SITES.includes(site)) rebuildKeepWalls();   // dış kale surları arsalardan ÖNCE dursun
  const mevcut = G.plots.filter(p => p.outpost === site);
  const kondu = mevcut.map(p => ({ x: p.x, y: p.y }));
  let eklendi = 0;
  for (let i = mevcut.length; i < hedef; i++) {
    const spot = opFreeSpot(site, kondu);
    if (!spot) break;                                    // yer kalmadı: sessizce dur
    kondu.push(spot);
    G.plots.push({ x: spot.x, y: spot.y, built: null, outpost: site, plan: OUTPOST_PLAN[i % OUTPOST_PLAN.length] });
    clearNodesInside(spot.x, spot.y, 66);
    eklendi++;
  }
  return eklendi;
}
const OUTPOST_UPG = [null, { wood: 80, stone: 60, gold: 80 }, { wood: 160, stone: 120, gold: 160, iron: 10 }]; // Sv2, Sv3
const outpostBannerHp = lv => 300 + 200 * (lv - 1);
function createOutpost(id) {
  if (G.outposts[id]) return;
  const O = OUTPOSTS[id];
  G.outposts[id] = { owned: true, looted: false, garrison: 0, lv: 1, garrisonCls: [] };
  G.structures.push({ kind: 'banner', site: id, x: O.x, y: O.y, hp: 300, maxHp: 300, alive: true });
  const n0 = opAddPlots(id, OUTPOST_PLOT_N[1]);
  toast('🏳️ Karakol kuruldu: ' + O.name + ' — günde +' + O.income + '🪙, ' + n0 + ' inşa arsası açıldı (🏹 avcı kulübesi dahil)');
  // zindandaki esir komutanlar kurtulur, saflarına döner
  const caps = (G.prisoners && G.prisoners[id]) || [];
  while (caps.length) {
    const m2 = caps.shift();
    if (m2.cmd && COMMANDERS[m2.cmd]) {
      addCommander(m2.cmd, { lv: m2.lv || 1, kills: m2.kills || 0, gear: m2.gear, hpFrac: 0.6, x: O.x + rr(-40, 40), y: O.y + rr(30, 70) });
      toast('🔓 ' + COMMANDERS[m2.cmd].name + ' zindandan kurtarıldı!');
    } else if (m2.cls) { // eski kayıtlardan kalan esir askerler
      G.soldiersOwned++;
      addSoldier(m2.cls);
      const sl = G.soldiers[G.soldiers.length - 1];
      sl.x = O.x + rr(-40, 40); sl.y = O.y + rr(30, 70); sl.hp = Math.round(sl.maxHp * 0.6);
      toast('🔓 Esir asker zindandan kurtarıldı!');
    }
    SFX.upgrade();
  }
}
function addGarrisonUnit(id, cls, meta) {
  if (cls && typeof cls === 'object') { meta = cls; cls = cls.cls; } // meta objesiyle çağrı (kayıt/transfer)
  cls = SOLDIER_CLS[cls] ? cls : 'sword';
  const SC = SOLDIER_CLS[cls];
  const O = OUTPOSTS[id];
  const g = {
    soldier: true, garrisonOf: id, cls, lv: (meta && meta.lv) || 1, xp: (meta && meta.xp) || 0, tdmg: SC.dmg,
    x: O.x + rr(-40, 40), y: O.y + rr(20, 50), hp: SC.hp, maxHp: SC.hp, cd: 0, dir: 0, swing: 0, flash: 0, walk: 0, wt: 0,
  };
  G.garrisonUnits.push(g);
  soldierRecalc(g); g.hp = g.maxHp;
}

// ---------- Huruç: kuşatma inşaatı başlayınca savunucular kapıdan çıkar ----------
function sortie(st) {
  const camp = st.id === 'fort' ? 'fort' : 'legion';
  const type = st.id === 'fort' ? 'guard' : 'legion';
  const gate = G.structures.find(s => s.kind === st.gateKind);
  if (!gate || !gate.alive) return;                       // kapı zaten kırıksa çıkmazlar
  if (G.enemies.filter(e => e.camp === camp).length >= 6) return; // garnizon sınırı
  for (let i = 0; i < 2; i++) {
    const ox = st.id === 'fort' ? -45 : rr(-25, 25);
    const oy = st.id === 'fort' ? rr(-25, 25) : 55;
    spawnEnemy(type, gate.x + ox, gate.y + oy, camp);
    G.enemies[G.enemies.length - 1].aggro = true;
  }
  SFX.horn(); banner('HURUÇ! Savunucular çıkıyor!');
}

// ---------- Kaleye Sızma: kuşatma sürerken 60 sn'de bir "Gölge Sızması" mini oyunu ----------
// 3 aşamalı zamanlama halkası: ibre dönerken yeşil bölgede durdur; her aşama daha dar + hızlı.
const INFIL_CD = 180;   // sızma bekleme süresi (sn)
const INFIL_STAGES = [
  { t: '🧗 Surlara tırman', spd: 2.6, half: 0.44 },
  { t: '🕶️ Nöbetçiyi atlat', spd: 3.5, half: 0.30 },
  { t: '🔥 Sabotaj!', spd: 4.6, half: 0.19 },
];
// Sızılabilecek yer: yakındaki fethedilmemiş düşman yuvası.
// KUŞATMA ŞARTI KALKTI — casusluk artık kuşatmadan bağımsız bir yol; kuşatma
// kurmadan da esir kurtarmaya ya da nöbetçi avlamaya gidebilirsin.
const INFIL_SITES = () => ([
  ...SIEGE_SITES,
  { id: 'camp1', name: 'Barbar Kampı', x: CAMP1.x, y: CAMP1.y + 190, gateKind: null },
]);
function nearSiegeSite() {
  let en = null, ed = 700;
  for (const st of INFIL_SITES()) {
    if (G.outposts[st.id]) continue;
    if (st.id === 'camp1' && G.camp1Destroyed) continue;
    const d = dist(G.player.x, G.player.y, st.x, st.y);
    if (d < ed) { ed = d; en = st; }
  }
  return en;
}
// Bu yuvada bizim esirimiz var mı? (birden fazlaysa her sızmada BİRİ kurtulur)
const infilPrisoner = sid => ((G.prisoners && G.prisoners[sid]) || []).find(m => m.cmd || m.cls) || null;
function startInfil(st) {
  closePanel(); toggleMap(false);
  const esir = infilPrisoner(st.id);
  G.infil = {
    site: st.id, stage: 0, ang: rr(0, TAU), start: 0, success: 0, gC: rr(0, TAU), flash: 0,
    gorev: esir ? 'kurtar' : 'sabotaj',   // esir varsa öncelik kurtarma
  };
  G.infil.start = G.infil.ang;
  document.body.classList.add('infil');
  SFX.horn();
  toast(esir ? '🥷 İçeride yoldaşın var — zincirlerini kır!' : '🥷 Sızma: nöbetçileri indir, sonra kapıyı sabote et');
}
// 2. aşamadan sonrası göreve göre dallanır
function infilPhase2(f) {
  if (f.gorev === 'kurtar') {   // ZİNCİR KIRMA: yoldaşın bileklerindeki halkaları vur
    f.phase = 'chain'; f.bowT = 0; f.arrows = 6; f.kirik = 0;
    f.zincir = Array.from({ length: 3 }, (_, i2) => ({ o: -52 + i2 * 52, alive: true }));
  } else {                      // OK YAĞMURU: surdaki nöbetçileri indir
    f.phase = 'bow'; f.bowT = 0; f.arrows = 5; f.kills = 0;
    f.targets = Array.from({ length: 5 }, (_, i2) => ({ o: -168 + i2 * 84 + rr(-12, 12), alive: true }));
  }
  SFX.horn();
}
function infilTap() {
  const f = G.infil;
  if (!f) return;
  if (f.phase === 'bow' || f.phase === 'chain') { bowShoot(); return; }
  if (f.phase === 'gate') { gateStrike(); return; }
  const ST = INFIL_STAGES[f.stage];
  let da = Math.abs(((f.ang - f.gC) % TAU + TAU) % TAU); if (da > Math.PI) da = TAU - da;
  if (da <= ST.half) { // yeşilde durdurdu
    f.success++;
    tone(660 + f.stage * 160, 0.18, 'triangle', 0.12, 60);
    if (f.stage >= INFIL_STAGES.length - 1) { infilPhase2(f); return; }
    f.stage++; f.gC = rr(0, TAU); f.ang = f.gC + Math.PI; f.start = f.ang; f.flash = 0.25;
  } else finishInfil(false); // kaçırdı: yakalandı
}
// 3. AŞAMA — KAPI SABOTAJI: barut fıçısını kapının dibine koyup tokmakla çak.
// Kapı ancak burada başarı gösterirsen hasar alır (eskiden otomatik -%15 veriyordu).
const GATE_STRIKES = 3;
function gateBarPos(f) {   // sürgü çubuğundaki tokmağın 0..1 konumu (ileri-geri gider)
  const per = 1.9 - f.vurus * 0.35;
  const t = (f.gateT % per) / per;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}
function gateStrike() {
  const f = G.infil;
  if (!f || f.bitti) return;
  const p2 = gateBarPos(f);
  const yari = 0.13 - f.vurus * 0.028;                 // hedef bandı her vuruşta daralır
  const isabet = Math.abs(p2 - f.hedef) <= yari;
  f.vurusFx = { t: 0.3, hit: isabet, p: p2 };
  if (isabet) {
    f.vurus++; f.hasar += 0.09;                        // her isabet kapının %9'u
    tone(220, 0.22, 'square', 0.14, -60); SFX.build();
    if (f.vurus >= GATE_STRIKES) { f.bitti = true; setTimeout(() => finishInfil(true), 340); return; }
    f.hedef = rr(0.18, 0.82);
  } else {
    tone(120, 0.3, 'sawtooth', 0.1, -50);
    f.bitti = true;                                    // gürültü yaptın: kaç!
    setTimeout(() => finishInfil(true, 'gurultu'), 340);
  }
}
// Ok Yağmuru: sallanan nişangahı nöbetçinin üstünde durdur
function bowCrossPos(f) {
  const cx2 = VW / 2, cy2 = VH * 0.42;
  return [cx2 + Math.sin(f.bowT * 1.35) * Math.min(215, VW * 0.31), cy2 - 30 + Math.sin(f.bowT * 2.3 + 1) * 26];
}
function bowShoot() {
  const f = G.infil;
  if (!f || f.arrows <= 0) return;
  const zincirMi = f.phase === 'chain';
  const liste = zincirMi ? f.zincir : f.targets;
  const genis = zincirMi ? 17 : 26;      // zincir halkası daha küçük hedef
  f.arrows--;
  const [mx] = bowCrossPos(f);
  const cx2 = VW / 2;
  let hit = null;
  for (const t2 of liste) {
    if (!t2.alive) continue;
    if (Math.abs(mx - (cx2 + t2.o)) < genis) { hit = t2; break; }
  }
  if (hit) {
    hit.alive = false;
    if (zincirMi) { f.kirik++; tone(880, 0.18, 'square', 0.12, 120); }
    else { f.kills++; tone(740, 0.15, 'triangle', 0.12, 70); }
    SFX.arrow();
  } else { tone(160, 0.2, 'sawtooth', 0.08, -40); }
  f.shotFx = { t: 0.3, hit: !!hit };
  const bitti = liste.every(t2 => !t2.alive);
  if (zincirMi) {
    // Zincirler koptu → yoldaş serbest, sessizce çık (kapıyla işimiz yok)
    if (bitti || f.arrows <= 0) setTimeout(() => finishInfil(true), 300);
    return;
  }
  // Nöbetçiler temizlendi YA DA ok bitti → 3. AŞAMA: kapı sabotajı
  if (bitti || f.arrows <= 0) {
    const st2 = INFIL_SITES().find(s2 => s2.id === f.site);
    const gate2 = st2 && st2.gateKind && G.structures.find(s2 => s2.kind === st2.gateKind && s2.alive);
    if (!gate2) { setTimeout(() => finishInfil(true), 300); return; }   // kapısı yok/kırık: iş bitti
    f.phase = 'gate'; f.gateT = 0; f.vurus = 0; f.hasar = 0; f.hedef = rr(0.2, 0.8); f.bitti = false;
    SFX.horn();
  }
}
function finishInfil(ok, sebep) {
  const f = G.infil;
  if (!f) return; // zaten bitti (çift çağrı güvencesi)
  const st = INFIL_SITES().find(s2 => s2.id === f.site);
  G.infil = null; G.infilCd = INFIL_CD;
  document.body.classList.remove('infil');
  if (!ok || !st) { // yakalandın: alarm! kazanımlar da gitti
    banner('🚨 YAKALANDIN!');
    toast('Nöbetçiler seni fark etti — surlardan atlayıp canını zor kurtardın!', true);
    damagePlayer(Math.round(G.player.maxHp * 0.15), G.player.x, G.player.y);
    if (st) sortie(st);
    SFX.no(); save(); return;
  }
  const gains = [];
  const loot = Math.round((f.gorev === 'kurtar' ? 15 : 40) + G.region * 25);
  gain({ gold: loot }, G.player.x, G.player.y - 30); gains.push(loot + '🪙 ganimet');
  // --- KURTARMA GÖREVİ: zincirleri kırdıysan yoldaşın serbest (her sızmada BİRİ) ---
  if (f.gorev === 'kurtar') {
    const koptu = (f.zincir || []).every(z => !z.alive);
    if (koptu) {
      const liste = G.prisoners[f.site] || [];
      const i3 = liste.findIndex(m => m.cmd || m.cls);
      const m3 = i3 >= 0 ? liste.splice(i3, 1)[0] : null;
      if (m3 && m3.cmd && COMMANDERS[m3.cmd]) {
        addCommander(m3.cmd, { lv: m3.lv || 1, kills: m3.kills || 0, gear: m3.gear, hpFrac: 0.25,
          x: G.player.x + rr(-40, 40), y: G.player.y + rr(30, 60) });
        const yeni = G.commanders[G.commanders.length - 1];
        yeni.recovering = true; yeni.order = 'follow';   // iyileşene dek savaşmaz, peşinde dolanır
        banner('⛓️ ZİNCİRLER KIRILDI!');
        gains.push('🔓 ' + COMMANDERS[m3.cmd].name + ' kurtarıldı (yaralı — iyileşene dek dövüşmez)');
      } else if (m3 && m3.cls) {
        G.soldiersOwned++; addSoldier(m3.cls);
        const sl = G.soldiers[G.soldiers.length - 1];
        sl.x = G.player.x + rr(-40, 40); sl.y = G.player.y + rr(30, 60); sl.hp = Math.round(sl.maxHp * 0.3);
        banner('⛓️ ZİNCİRLER KIRILDI!');
        gains.push('🔓 Esir asker kurtarıldı');
      }
      const kalan = (G.prisoners[f.site] || []).filter(m => m.cmd || m.cls).length;
      if (kalan) gains.push('⚠️ zindanda ' + kalan + ' yoldaş daha var — tekrar sız');
    } else {
      gains.push('⛓️ zincirler kopmadı (' + (f.kirik || 0) + '/3) — yoldaşın içeride kaldı');
    }
    // kurtarma koşusunda kapıya dokunulmaz
    toast('🥷 ' + gains.join(' · '), false);
    banner(koptu ? '⛓️ ZİNCİRLER KIRILDI!' : '🥷 SIZMA BİTTİ');
    addXp(koptu ? 90 : 30, G.player.x, G.player.y - 40);
    SFX.upgrade(); save(); return;
  }
  // --- SABOTAJ GÖREVİ ---
  const defs = G.enemies.filter(e2 => e2.camp === st.id && e2.type !== 'chief' && e2.type !== 'commander');
  if (defs.length) { const v = defs[ri(0, defs.length - 1)]; damageEnemy(v, v.hp + 999, v.x, v.y); gains.push('1 nöbetçi sessizce indirildi'); }
  for (const [k2, en] of Object.entries(G.sieges[st.id] || {}))
    if (!en.done) { en.prog = Math.min(ENGINES[k2].buildTime, en.prog + ENGINES[k2].buildTime * 0.12); gains.push('inşaat +%12'); }
  const bowKills = f.kills || 0;
  if (bowKills > 0) { // okla indirilenler gerçekten ölür
    const defs2 = G.enemies.filter(e2 => e2.camp === st.id && e2.type !== 'chief' && e2.type !== 'commander');
    for (let i2 = 0; i2 < Math.min(bowKills, defs2.length); i2++) damageEnemy(defs2[i2], defs2[i2].hp + 999, defs2[i2].x, defs2[i2].y);
    gains.push('🏹 ' + bowKills + ' nöbetçi okla indirildi');
  }
  // KAPI: artık otomatik hasar YOK — sadece barut sabotajında çakabildiğin kadar
  const gate = st.gateKind && G.structures.find(s2 => s2.kind === st.gateKind && s2.alive);
  if (gate && (f.hasar || 0) > 0) {
    damageStructure(gate, Math.round(gate.maxHp * f.hasar));
    gains.push('💥 kapıya barut sabotajı (-%' + Math.round(f.hasar * 100) + ')');
  } else if (gate) {
    gains.push(sebep === 'gurultu' ? '💥 tokmak ıskaladı — kapıya zarar veremedin' : 'kapıya ulaşılamadı');
  }
  banner('🥷 SIZMA BAŞARILI!');
  toast('🥷 ' + gains.join(' · '), false);
  addXp(60, G.player.x, G.player.y - 40);
  SFX.upgrade(); save();
}

// ---------- Gece baskınları ----------
function spawnRaider(type, x, y) {
  spawnEnemy(type, x, y, 'raid');
  const e = G.enemies[G.enemies.length - 1];
  e.raider = true; e.aggro = true;
}
// Kurt sürüsü: bazı geceler et kokusuna köye iner (baskından bağımsız)
function wolfPack() {
  const n = Math.min(6, 3 + Math.floor(G.day / 4));
  for (let i = 0; i < n; i++) {
    const a = rr(-1.1, 1.1); // su batıda: doğu yayından gelirler
    const x = clamp(CAMPFIRE.x + Math.cos(a) * 720, 60, WORLD.w - 60);
    const y = clamp(CAMPFIRE.y + Math.sin(a) * 720, 60, WORLD.h - 60);
    spawnEnemy('wolf', x + rr(-40, 40), y + rr(-40, 40), 'wolfpack');
    const w = G.enemies[G.enemies.length - 1];
    w.raider = true; w.raidTarget = 'village'; w.aggro = true;
  }
  banner('🐺 KURT SÜRÜSÜ!');
  toast('🐺 Kurtlar et kokusunu aldı — köye iniyorlar! (leşleri et bırakır)', true);
  SFX.horn();
}
// Gün sonu raporu: sağ üstte belirir, 6sn sonra kaybolur
let dayRepTimer = null;
function dayReport(msg, bad) {
  const el = $('dayReport');
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.remove('hidden');
  if (dayRepTimer) clearTimeout(dayRepTimer);
  dayRepTimer = setTimeout(() => el.classList.add('hidden'), 6000);
  if (bad) SFX.no();
}
function startNight() {
  if (G.day >= 2 && rng() < 0.35) wolfPack();
  if (!G.built.blacksmith) { toast('🌙 Gece çöktü. Şimdilik sakin...'); return; }
  // hedef seçimi: köy ya da (varsa) sağlam bir karakol
  const ownedIds = Object.keys(G.outposts).filter(id => id !== 'village' && G.outposts[id].owned && !G.outposts[id].looted);
  let raidTarget = 'village', cx2 = CAMPFIRE.x, cy2 = CAMPFIRE.y;
  if (ownedIds.length && rng() < 0.45) {
    raidTarget = ownedIds[ri(0, ownedIds.length - 1)];
    cx2 = OUTPOSTS[raidTarget].x; cy2 = OUTPOSTS[raidTarget].y;
  }
  const n = Math.max(2, Math.min(2 + G.day, 9) + (G.region - 1) + (DIFF[G.difficulty] || DIFF.normal).raid); // bölge + zorlukla kalabalıklaşır
  for (let i = 0; i < n; i++) {
    const a = raidTarget === 'village' ? rr(-1.0, 1.0) : rr(0, TAU); // köyde su batıda
    const x = clamp(cx2 + Math.cos(a) * (raidTarget === 'village' ? 760 : 560), 60, WORLD.w - 60);
    const y = clamp(cy2 + Math.sin(a) * (raidTarget === 'village' ? 760 : 560), 60, WORLD.h - 60);
    const r2 = rng();
    const type = G.day >= 3 && r2 < 0.18 ? 'brute'
      : G.day >= 3 && r2 < 0.38 ? 'archer'
      : G.day >= 4 && r2 < 0.52 ? 'shieldbarb'
      : 'barb';
    spawnRaider(type, x + rr(-40, 40), y + rr(-40, 40));
    G.enemies[G.enemies.length - 1].raidTarget = raidTarget;
  }
  // 5. günden sonra baskına şaman katılabilir (önce onu vur!)
  if (G.day >= 5 && rng() < 0.5) {
    const a2 = raidTarget === 'village' ? rr(-1.0, 1.0) : rr(0, TAU);
    spawnRaider('shaman', clamp(cx2 + Math.cos(a2) * 760, 60, WORLD.w - 60), clamp(cy2 + Math.sin(a2) * 760, 60, WORLD.h - 60));
    G.enemies[G.enemies.length - 1].raidTarget = raidTarget;
  }
  // her 4. gece: yağmacı şefi köy baskınına önderlik eder
  if (raidTarget === 'village' && G.day % 4 === 0) {
    spawnRaider('chief', CAMPFIRE.x + 800, CAMPFIRE.y + rr(-100, 100));
    G.enemies[G.enemies.length - 1].raidTarget = 'village';
    toast('💀 Yağmacı Şefi baskına önderlik ediyor!', true);
  }
  // barbarlar kuşatmayı öğrendi: 4. günden (veya kampları yıkılınca) itibaren köye koçbaşı getirirler
  if (raidTarget === 'village' && (G.day >= 4 || G.camp1Destroyed)) {
    spawnRaider('wram', CAMPFIRE.x + 780, CAMPFIRE.y + rr(-120, 120));
    G.enemies[G.enemies.length - 1].raidTarget = 'village';
    toast('Baskıncılar koçbaşı getirdi! 🐏', true);
  }
  G.raidHappened = true;
  SFX.horn();
  banner(raidTarget === 'village' ? '🌙 BASKIN! Köyünü koru!' : '🌙 BASKIN: ' + OUTPOSTS[raidTarget].name + ' saldırı altında!');
}
function endNight() {
  let fled = 0;
  G.enemies = G.enemies.filter(e => { if (e.raider && e.camp !== 'rival') { spawnDust(e.x, e.y, 6); fled++; return false; } return true; });
  if (G.raidHappened) {
    G.raidsSurvived++;
    SFX.dawn(); banner('☀️ ŞAFAK — baskın savuşturuldu!');
    addXp(30, G.player.x, G.player.y - 50);
    if (fled > 0) toast(fled + ' baskıncı şafakla kaçtı');
  }
  G.raidHappened = false; G.duskWarned = false; G.day++;
  // 🍖 günlük tayın: HER GARNİZON KENDİ KALESİNDEN yer (başka yerleşkenin ambarına
  // el atmaz); sahadaki ordu ve komutanlar oyuncuyla birlikte köyün tayınından yer.
  {
    const garNerede = {};
    for (const g2 of G.garrisonUnits) garNerede[g2.garrisonOf] = (garNerede[g2.garrisonOf] || 0) + 1;
    let acKalan = 0, toplam = 0, yenen = 0;
    for (const [sid, n] of Object.entries(garNerede)) {
      if (sid === 'village') continue;                       // köy garnizonu aşağıdaki tayına dahil
      const y = siteEat(sid, n);
      toplam += n; yenen += y;
      if (y < n) { acKalan += n - y; dayReport('🍖 ' + siteName(sid).replace(' Karakolu', '') + ' garnizonu aç kaldı (' + y + '/' + n + ') — oraya et gönder!', true); }
    }
    const sahada = G.soldiers.length + G.commanders.length + (garNerede.village || 0);
    if (sahada > 0) {
      const y = siteEat('village', sahada);
      toplam += sahada; yenen += y;
      if (y < sahada) acKalan += sahada - y;
    }
    if (toplam > 0) {
      if (acKalan > 0) dayReport('🍖 ET YETMEDİ! ' + yenen + '/' + toplam + ' asker yiyebildi — avlan ya da avcı kulübesi kur!', true);
      else dayReport('🍖 ' + toplam + ' asker ' + yenen + ' et yedi (köy deposu: ' + Math.floor(G.stock.meat) + ')', false);
    }
  }
  // karakol vergileri: artık kervanlar taşır — köye ulaşırsa altın senin (koru!)
  for (const [id, o] of Object.entries(G.outposts)) {
    if (id === 'village' || !o.owned || o.looted) continue;
    const tax = Math.round(OUTPOSTS[id].income * (1 + 0.4 * (G.dynUpg.taxes || 0)) * (1 + 0.5 * ((o.lv || 1) - 1)));
    if (tax > 0) {
      const O = OUTPOSTS[id];
      G.caravans.push({ caravan: true, x: O.x, y: O.y + 40, gold: tax, hp: 320, maxHp: 320, dir: 0, walk: 0, flash: 0, from: O.name, pts: [[PAL_GATE.x + 60, PAL_GATE.y], [CAMPFIRE.x + 50, CAMPFIRE.y + 20]], i: 0 });
    }
  }
  if (G.caravans.length) toast('🐴 Vergi kervanları yola çıktı (' + G.caravans.length + ')');
  // Dağ Devi: 5. günden itibaren arada haritada belirir
  if (G.day >= 5 && G.day % 4 === 1 && !G.enemies.some(e => e.type === 'troll')) {
    const L = LOCATIONS[ri(1, LOCATIONS.length - 1)];
    spawnEnemy('troll', L.x + rr(-250, 250), L.y + rr(-200, 200), 'troll');
    toast('👹 Dağ Devi görüldü — haritaya bak!', true); SFX.horn();
  }
  // devriye çeteleri şafakta tazelenir
  PATROLS.forEach((pt, i) => {
    const anchor = patrolAnchor(i);
    let alive = G.enemies.filter(e => e.camp === 'roam' + i).length;
    while (alive < 3) { spawnEnemy('barb', anchor[0] + rr(-50, 50), anchor[1] + rr(-50, 50), 'roam' + i); alive++; }
  });
  // Kara Vulkar: haraç süresi işler, çete tazelenip büyür
  if (G.rival.alive) {
    G.rival.tribute = Math.max(0, G.rival.tribute - 1);
    spawnRivalBand();
  }
  save();
}
function patrolAnchor(i) {
  const pt = PATROLS[i], stt = G.patrols[i];
  const a = pt.pts[stt.seg], b = pt.pts[(stt.seg + 1) % pt.pts.length];
  return [lerp(a[0], b[0], stt.t), lerp(a[1], b[1], stt.t)];
}

// ---------- Güncelleme ----------
function update(dt) {
  G.t += dt;
  const p = G.player;

  // ziyaretçilerin bıraktığı yardımlar: menü kapanınca bir kez uygulanır
  if (G.netHelpPending) { G.netHelpPending = false; netApplyHelp(); }

  // ---- Hava durumu: bölgeye göre döngü (soğuk diyarlarda kar, sıcaklarda yağmur) ----
  if (!G.caveRun) {
    G.weatherT = (G.weatherT === undefined ? rr(25, 50) : G.weatherT) - dt;
    if (G.weatherT <= 0) {
      const cold = PROV0.country === 'buz' || PROV0.tier >= 8;
      const pool = cold ? ['clear', 'snow', 'snow', 'fog', 'storm', 'clear'] : ['clear', 'clear', 'rain', 'rain', 'fog', 'storm', 'clear'];
      const w2 = pool[ri(0, pool.length - 1)];
      if (w2 !== (G.weather || 'clear')) {
        G.weather = w2;
        const MSG = { rain: '🌧️ Yağmur başladı', storm: '⛈️ Fırtına yaklaşıyor!', fog: '🌫️ Sis bastırdı — uzağı görmek zor', snow: '❄️ Kar yağıyor', clear: '☀️ Hava açtı' };
        toast(MSG[w2]);
      }
      G.weatherT = rr(55, 120);
    }
    G.wFlash = Math.max(0, (G.wFlash || 0) - dt);
    if (G.weather === 'storm' && rng() < dt * 0.11) {
      G.wFlash = 0.42; // parlama üstten iner, hasar flaşıyla (kırmızı) karışmaz
      const uzak = rr(0.35, 1.4); // gök gürültüsü şimşekten sonra gelir
      setTimeout(() => { tone(52, 0.9, 'sawtooth', 0.09, -18); setTimeout(() => tone(38, 1.1, 'triangle', 0.06, -10), 180); }, uzak * 1000);
    }
  }

  // ziyaret sayacı: yerelde geri sayar, 20 sn'de bir sunucuya işlenir (günde 600 sn/arkadaş)
  if (VISIT && !G.visitEnding) {
    G.visitLeft = (G.visitLeft === undefined ? VISIT.remaining : G.visitLeft) - dt;
    G.visitTick = (G.visitTick || 0) + dt;
    if (G.visitTick >= 20) {
      G.visitTick -= 20;
      rpcAuth('use_visit', { p_host: VISIT.host, p_seconds: 20 })
        .then(rem => { if (rem <= 0) endVisit(); else G.visitLeft = Math.min(G.visitLeft, rem); })
        .catch(() => { });
    }
    if (G.visitLeft <= 0) endVisit();
    const vt = $('visitTime');
    if (vt) {
      const txt = '⏳ ' + fmtDur(G.visitLeft);
      if (vt.textContent !== txt) vt.textContent = txt;
    }
  }
  coopTick(dt); // canlı ortak oyun: konum/dünya alışverişi

  // dostluk adası: 12 sn'de bir op paketi + konum sunucuya, taze durum + yoldaş konumları geri
  if (ISLAND && !G.visitEnding) {
    G.islT = (G.islT || 0) + dt;
    if (G.islT >= 12 && !G.islBusy) {
      G.islT = 0; G.islBusy = true;
      const ops = G.islOps; G.islOps = {};
      rpcAuth('island_sync', { p_ops: ops, p_pos: { x: Math.round(p.x), y: Math.round(p.y) } })
        .then(payload => applyIslandState(payload))
        .catch(() => islMergeOps(G.islOps, ops)) // gönderilemedi: kuyruğa geri
        .finally(() => { G.islBusy = false; });
    }
  }

  // sızma mini oyunu: dünya donar, sadece ibre döner
  if (G.infil) {
    const f = G.infil;
    if (f.phase === 'bow' || f.phase === 'chain') {
      f.bowT = (f.bowT || 0) + dt;
      if (f.shotFx) { f.shotFx.t -= dt; if (f.shotFx.t <= 0) f.shotFx = null; }
      if (f.bowT > 15) finishInfil(true); // süre doldu: vurabildiğinle çekil
      return;
    }
    if (f.phase === 'gate') {   // barut sabotajı: tokmak sürgüde ileri-geri gider
      f.gateT = (f.gateT || 0) + dt;
      if (f.vurusFx) { f.vurusFx.t -= dt; if (f.vurusFx.t <= 0) f.vurusFx = null; }
      if (f.gateT > 16 && !f.bitti) { f.bitti = true; finishInfil(true); } // oyalanma: elindekiyle çekil
      return;
    }
    const ST = INFIL_STAGES[f.stage];
    f.ang += ST.spd * dt;
    f.flash = Math.max(0, (f.flash || 0) - dt);
    if (f.ang - f.start > TAU * 2.2) finishInfil(false); // 2 turdan fazla tereddüt = yakalanma
    return;
  }
  G.infilCd = Math.max(0, (G.infilCd || 0) - dt);

  // gündüz/gece döngüsü
  G.dayT += dt;
  if (!G.night) {
    const kalan = DAYLEN.day - G.dayT;
    if (kalan < 12 && !G.duskWarned && G.built.blacksmith) { G.duskWarned = true; toast('🌙 Güneş batıyor — köye dön!', true); SFX.no(); }
    if (kalan <= 0) { G.dayT = 0; G.night = true; startNight(); }
  } else if (G.dayT >= DAYLEN.night) {
    G.dayT = 0; G.night = false; endNight();
  }

  if (G.dead) {
    G.deadT -= dt;
    if (G.deadT <= 0) {
      G.dead = false; elDeath.classList.add('hidden');
      p.hp = p.maxHp; p.x = CAMPFIRE.x + 50; p.y = CAMPFIRE.y + 40;
      if (G.caveRun) { // inde öldün: koşu biter, in aktif kalır
        clearCave(); G.caveRun = null;
        [...G.soldiers, ...G.commanders].forEach(sl => { sl.x = p.x + rr(-30, 30); sl.y = p.y + rr(20, 60); });
        toast('İn seni yendi... Konağın ocağında gözlerini açtın.', true);
      }
      for (const e of G.enemies) { e.aggro = false; e.x = e.hx; e.y = e.hy; e.hp = e.maxHp; }
    }
  }
  // in sayacı (15 dk)
  if (G.caveCd > 0) G.caveCd = Math.max(0, G.caveCd - dt);

  // hareket
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (joy.active) { mx = joy.dx; my = joy.dy; }
  const mlen = Math.hypot(mx, my);
  p.moving = mlen > 0.15 && !G.dead;
  if (p.moving) {
    if (G.autoTravel) { G.autoTravel = null; toast('Yolculuk iptal edildi'); }
    const spd = playerSpeed();
    p.dir = Math.atan2(my, mx);
    const nx = p.x + (mx / Math.max(1, mlen)) * spd * dt;
    const ny = p.y + (my / Math.max(1, mlen)) * spd * dt;
    [p.x, p.y] = collide(nx, ny, 14);
    p.walk += dt * 11;
    if (G.panelFor) closePanel(); // yürüyünce panel kapanır
  } else if (G.autoTravel && !G.dead) {
    // yol yürüyüşü: hedefe hızlı otomatik ilerleme (saldırıya uğrarsan bozulur)
    const tv = G.autoTravel;
    tv.time = (tv.time || 0) + dt;
    const danger = G.enemies.some(e => e.aggro && dist(e.x, e.y, p.x, p.y) < 280);
    if (danger) { G.autoTravel = null; toast('Pusu! Yolculuk yarıda kaldı ⚔️', true); }
    else if (!tv.evented && tv.time > 4 && dist(p.x, p.y, CAMPFIRE.x, CAMPFIRE.y) > 700 && rng() < dt * 0.055) {
      tv.evented = true;
      triggerTravelEvent(); // yolculuğu duraklatır, panel açar
    }
    else {
      const [wx, wy] = tv.pts[tv.i];
      const dd = dist(p.x, p.y, wx, wy);
      if (dd < 80) {
        tv.i++;
        if (tv.i >= tv.pts.length) { G.autoTravel = null; toast('📍 ' + tv.name + ' bölgesine vardın'); SFX.upgrade(); }
      } else {
        p.dir = Math.atan2(wy - p.y, wx - p.x);
        const spd = playerSpeed() * 2.6;
        const ox = p.x, oy = p.y;
        [p.x, p.y] = collide(p.x + Math.cos(p.dir) * spd * dt, p.y + Math.sin(p.dir) * spd * dt, 14);
        p.moving = true; p.walk += dt * 15;
        // takılma: ilerleme yoksa vazgeç
        tv.stuck = dist(ox, oy, p.x, p.y) < spd * dt * 0.25 ? (tv.stuck || 0) + dt : 0;
        if (tv.stuck > 1.6) { G.autoTravel = null; toast('Yol tıkalı — yolculuk durdu', true); }
      }
      if (G.panelFor) closePanel();
    }
  }

  // Kara Vulkar: haritada gezer, güçlenir, haraç ister, mülklerine yürür
  if (G.rival.alive) {
    const R = G.rival;
    R.timer -= dt;
    // stratejik karar: 3. günden itibaren, haraç yoksa arada saldırı planla
    if (R.timer <= 0) {
      R.timer = rr(100, 160);
      if (!R.attack && G.day >= 3 && R.tribute <= 0 && rng() < 0.65) {
        const targets = ['village', ...Object.keys(G.outposts).filter(id => id !== 'village' && G.outposts[id].owned && !G.outposts[id].looted)];
        R.attack = targets[ri(0, targets.length - 1)];
        R.attackT = 55;
        SFX.horn();
        toast('⚠️ Kara Vulkar\'ın çetesi ' + (R.attack === 'village' ? 'köyüne' : OUTPOSTS[R.attack].name + '\'na') + ' yürüyor!', true);
      }
    }
    let wpx, wpy;
    if (R.attack) {
      const pos = R.attack === 'village' ? CAMPFIRE : OUTPOSTS[R.attack];
      wpx = pos.x; wpy = pos.y;
      R.attackT -= dt;
      const near = dist(R.x, R.y, wpx, wpy) < 420;
      for (const e of G.enemies) if (e.camp === 'rival') { e.raider = near; if (near) { e.raidTarget = R.attack; e.aggro = true; } }
      if (R.attackT <= 0) {
        R.attack = null;
        for (const e of G.enemies) if (e.camp === 'rival') { e.raider = false; e.aggro = false; e.tGate = false; e.tStruct = null; }
      }
    } else {
      if (!R.wp || dist(R.x, R.y, R.wp[0], R.wp[1]) < 60) {
        const L = LOCATIONS[ri(1, LOCATIONS.length - 1)]; // köy hariç
        R.wp = [L.x + rr(-200, 200), L.y + rr(-150, 150)];
      }
      [wpx, wpy] = R.wp;
    }
    const rspd = R.attack ? 78 : 46;
    const ra = Math.atan2(wpy - R.y, wpx - R.x);
    if (dist(R.x, R.y, wpx, wpy) > 30) { R.x += Math.cos(ra) * rspd * dt; R.y += Math.sin(ra) * rspd * dt; }
    // üyeler çıpayı ev bilir
    for (const e of G.enemies) if (e.camp === 'rival' && !e.aggro) { e.hx = R.x; e.hy = R.y; }
    // elçi: oyuncu çeteye ilk kez yaklaşınca
    if (!R.threatened && !G.dead && dist(p.x, p.y, R.x, R.y) < 460) {
      R.threatened = true;
      rivalEnvoy();
    }
  }

  // devriye çeteleri: çıpa rota üzerinde ilerler, üyeler evini takip eder
  PATROLS.forEach((pt, i) => {
    const stt = G.patrols[i];
    const a = pt.pts[stt.seg], b = pt.pts[(stt.seg + 1) % pt.pts.length];
    const segLen = dist(a[0], a[1], b[0], b[1]);
    stt.t += (pt.speed * dt) / Math.max(1, segLen);
    if (stt.t >= 1) { stt.t = 0; stt.seg = (stt.seg + 1) % pt.pts.length; }
    const [ax, ay] = patrolAnchor(i);
    for (const e of G.enemies) if (e.camp === 'roam' + i && !e.aggro) { e.hx = ax; e.hy = ay; }
  });

  // ---- Düşman kale kolları: fethedilmemiş siteler dışarı devriye çıkarır (gezi ya da köye saldırı) ----
  G.sitePatrols = G.sitePatrols || {};
  if (!coopSlave()) for (const site of ['camp1', 'fort', 'legion']) {
    if (G.outposts[site]) { delete G.sitePatrols[site]; continue; }
    const sp = G.sitePatrols[site] = G.sitePatrols[site] || { t: rr(80, 150), active: null };
    if (sp.active) {
      const lead = sp.active.leader;
      if (!lead || lead.hp <= 0 || !G.enemies.includes(lead)) {
        // lider düştü: kol dağılır (kalanlar oldukları yerde sıradan düşmana döner)
        for (const e of G.enemies) if (e.patrolOf === site) e.patrolOf = null;
        sp.active = null; sp.t = rr(120, 200);
        continue;
      }
      if (!sp.active.attack) {
        // gezi devriyesi: lider site çevresindeki halkada yürür, adamlar lideri izler
        const O = OUTPOSTS[site];
        sp.active.a += dt * 0.055;
        const wx = O.x + Math.cos(sp.active.a) * 560, wy = O.y + Math.sin(sp.active.a) * 420;
        if (!lead.aggro) { lead.hx = wx; lead.hy = wy; }
        for (const e of G.enemies) if (e.patrolOf === site && e !== lead && !e.aggro) { e.hx = lead.x + rr(-8, 8); e.hy = lead.y + rr(-8, 8); }
        sp.active.t2 += dt;
        if (sp.active.t2 > 115) { // tur bitti: kola eve dön
          for (const e of G.enemies) if (e.patrolOf === site) { e.hx = O.x + rr(-90, 90); e.hy = O.y + rr(-70, 70); e.patrolOf = null; }
          sp.active = null; sp.t = rr(140, 240);
        }
      } else {
        sp.active.t2 += dt;
        if (sp.active.t2 > 240) { sp.active = null; sp.t = rr(140, 240); } // saldırı kolu uzun sürdüyse takibi bırak (şafak temizliği raider'ları süpürür)
      }
    } else {
      sp.t -= dt;
      if (sp.t <= 0 && G.day >= 2 && !G.night) {
        const O = OUTPOSTS[site];
        const lt = site === 'camp1' ? 'brute' : site === 'fort' ? 'guard' : 'legion';
        const mt = site === 'camp1' ? 'barb' : lt;
        spawnEnemy(lt, O.x + rr(-40, 40), O.y + rr(60, 120), 'wander_' + site); // ayrı camp: kale garnizon sayımına girmez
        const lead = G.enemies[G.enemies.length - 1];
        lead.leader = true; lead.patrolOf = site;
        lead.hp = Math.round(lead.hp * 1.4); lead.maxHp = lead.hp; // kol lideri: komutan kumaşı
        for (let i2 = 0, n = ri(2, 3); i2 < n; i2++) {
          spawnEnemy(mt, O.x + rr(-70, 70), O.y + rr(50, 130), 'wander_' + site);
          G.enemies[G.enemies.length - 1].patrolOf = site;
        }
        if (rng() < 0.4) { // saldırı kolu: mevcut baskıncı AI'sıyla köye yürür
          for (const e of G.enemies) if (e.patrolOf === site) { e.raider = true; e.raidTarget = 'village'; e.aggro = true; }
          sp.active = { leader: lead, attack: true, t2: 0, a: 0 };
          banner('🚩 ' + siteName(site).toUpperCase() + ' KOLU KÖYE YÜRÜYOR!');
          SFX.horn();
        } else {
          sp.active = { leader: lead, attack: false, t2: 0, a: Math.atan2(O.y - CAMPFIRE.y, O.x - CAMPFIRE.x) + rr(-0.5, 0.5) };
          toast('👀 ' + siteName(site) + ' devriye çıkardı — yollara dikkat!', true);
        }
      }
    }
  }
  p.cd = Math.max(0, p.cd - dt);
  p.swing = Math.max(0, p.swing - dt);
  p.flash = Math.max(0, p.flash - dt);
  p.heavyFx = Math.max(0, p.heavyFx - dt);
  p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  p.slowT = Math.max(0, (p.slowT || 0) - dt);
  // atılma hareketi (dokunulmaz)
  if (p.dodgeT > 0) {
    p.dodgeT -= dt;
    [p.x, p.y] = collide(p.x + Math.cos(p.dodgeDir) * 720 * dt, p.y + Math.sin(p.dodgeDir) * 720 * dt, 14);
    if (rng() < dt * 30) G.particles.push({ x: p.x, y: p.y - 4, vx: 0, vy: -8, t: 0.25, max: 0.25, r: rr(2, 4), g: 0 });
  }
  // saldırı: basışta normal vuruş, basılı tutunca şarj → güçlü vuruş
  if (attackHeld && !G.dead) {
    if (p.cd <= 0) {
      if (!p.charging) { doAttack(); p.charging = true; p.chargeT = 0; }
      else {
        p.chargeT += dt;
        if (p.chargeT >= 0.55) { heavyAttack(); p.chargeT = 0; }
      }
    }
  } else { p.charging = false; p.chargeT = 0; }

  // üs iyileştirmesi: Konak ocağı YA DA sahip olduğun herhangi bir karakol sancağı (şifa FX'i)
  let nearBase = dist(p.x, p.y, CAMPFIRE.x, CAMPFIRE.y) < 170;
  if (!nearBase) for (const [oid2, op2] of Object.entries(G.outposts)) {
    if (!op2 || op2.isVillage || !op2.owned || op2.looted) continue;
    if (dist(p.x, p.y, OUTPOSTS[oid2].x, OUTPOSTS[oid2].y) < 170) { nearBase = true; break; }
  }
  if (nearBase && p.hp < p.maxHp && !G.dead) {
    p.hp = Math.min(p.maxHp, p.hp + 6 * dt);
    if (rng() < dt * 9) {
      G.particles.push({ x: p.x + rr(-14, 14), y: p.y - rr(6, 34), vx: rr(-8, 8), vy: rr(-42, -22), t: rr(0.5, 0.9), max: 0.9, r: rr(1.8, 3.2), c: rng() < 0.6 ? '#57d364' : '#ffd257', g: -25 });
    }
    G.healT = (G.healT || 0) + dt;
    if (G.healT > 1.6) { G.healT = 0; addFloater(p.x, p.y - 52, '+❤', '#57d364', 13); }
  }

  // 🔨 menüsüz teslimat: yanında durduğun şantiyeye/binaya kaynaklar üstünden UÇARAK gider.
  // Öncelik: boş planlı arsa (inşaat). Yoksa: yükseltme bekleyen bina (0.7sn bekleme — yanından
  // geçerken kazara kaynak akmasın). Bedel tamamlanınca kendiliğinden yükselir.
  G.flyItems = G.flyItems || [];
  G.deliverT = Math.max(0, (G.deliverT || 0) - dt);
  // teslimat sadece DURURKEN akar: yürürken yanından geçtiğin şantiye/bina kaynak kapamaz
  const pvx = G.pPrevX === undefined ? p.x : G.pPrevX, pvy = G.pPrevY === undefined ? p.y : G.pPrevY;
  G.stillT = dist(p.x, p.y, pvx, pvy) > 1.4 ? 0 : (G.stillT || 0) + dt;
  G.pPrevX = p.x; G.pPrevY = p.y;
  let dSite = null; // {x, y, need, paid, complete}
  if (!G.dead && G.stillT >= 0.3) {
    let bestPl = null, bestD = 95; // EN YAKIN aday arsa (dizi sırası değil)
    for (const pl of G.plots) {
      if (pl.built || !pl.plan) continue;
      const B = BUILDINGS[pl.plan];
      if (B.req && !G.built[B.req]) continue;
      const dd = dist(p.x, p.y, pl.x, pl.y);
      if (dd < bestD) { bestD = dd; bestPl = pl; }
    }
    if (bestPl) {
      bestPl.paid = bestPl.paid || {};
      dSite = { x: bestPl.x, y: bestPl.y, need: bcost(BUILDINGS[bestPl.plan].cost), paid: bestPl.paid, complete: () => constructAt(bestPl) };
    }
    if (!dSite) { // yıkık bina onarımı: yanına git, kaynaklar aksın (bekleme yok — tamir hep kasıtlı)
      let bR = null, bD = 85;
      for (const b of G.buildings) {
        if (!b.ruined || !BUILDINGS[b.type]) continue;
        const dd = dist(p.x, p.y, b.x, b.y);
        if (dd < bD) { bD = dd; bR = b; }
      }
      if (bR) {
        bR.repPaid = bR.repPaid || {};
        dSite = { x: bR.x, y: bR.y, need: bcost(repairCost(bR.type)), paid: bR.repPaid, complete: () => {
          delete bR.repPaid; bR.ruined = false; bR.hp = bR.maxHp;
          if (VISIT && G.helpFx) G.helpFx.repairs++;
          if (coopSlave()) coopSend('fix', { x: Math.round(bR.x), y: Math.round(bR.y) }); // ev sahibinde de onarılsın
          SFX.build(); toast(BUILDINGS[bR.type].name + ' onarıldı! 🔧'); save();
        } };
      }
    }
    // yükseltme teslimatı: PANEL AÇIKKEN DURUR (kışlada asker basarken kaynağını çalmasın)
    if (!dSite && !G.panelFor) for (const b of G.buildings) {
      const c = b.ruined ? null : nextUpCost(b);
      if (!c) { b.upT = 0; continue; }
      if (dist(p.x, p.y, b.x, b.y) > 85) { b.upT = 0; continue; }
      b.upT = (b.upT || 0) + dt;
      if (b.upT < 1.2) continue; // bekleme: niyet netleşsin (yanından geçerken/menü açarken akmaz)
      b.upPaid = b.upPaid || {};
      dSite = { x: b.x, y: b.y, need: bcost(c), paid: b.upPaid, complete: () => applyUpgrade(b) };
      break;
    }
  }
  if (dSite) {
    if (G.deliverT <= 0) {
      for (const [k, v] of Object.entries(dSite.need)) {
        const rem = v - (dSite.paid[k] || 0);
        if (rem <= 0) continue;
        const give = Math.min(2, rem, Math.floor(G.res[k] || 0));
        if (give <= 0) continue;
        G.deliverT = 0.11;
        G.res[k] -= give; dSite.paid[k] = (dSite.paid[k] || 0) + give;
        flashChip(k);
        G.flyItems.push({ x0: p.x + rr(-8, 8), y0: p.y - 26, x1: dSite.x + rr(-10, 10), y1: dSite.y - 12, t: 0, icon: (RES_DEF.find(r2 => r2[0] === k) || [])[1] || '' });
        tone(620 + rr(0, 220), 0.05, 'sine', 0.05, 90);
        break; // tik başına tek paket
      }
    }
    if (Object.entries(dSite.need).every(([k, v]) => (dSite.paid[k] || 0) >= v)) dSite.complete();
  }
  for (const f of G.flyItems) f.t += dt / 0.45;
  G.flyItems = G.flyItems.filter(f => f.t < 1);

  // ---- OTO YÖNETİM: üsler ambarlarındaki kaynakla kendilerini yönetir (varsayılan AÇIK) ----
  G.autoT = (G.autoT || 0) + dt;
  if (G.autoT >= 2.2) { G.autoT = 0; if (!coopSlave()) autoManage(); } // misafir ev sahibinin üssünü yönetmez

  // bıçkıhaneler: her biri kendi üssünün ambarına üretir (yıkıksa durur)
  for (const b of G.buildings) {
    if (b.type !== 'sawmill' || b.ruined) continue;
    b.sawT = (b.sawT || 0) + dt * BAL.prod;
    if (b.sawT >= 8) { b.sawT = 0; addStock('wood', b.lv >= 2 ? 2 : 1, b.x, b.y - 30, b.outpost); }
  }
  // avcı kulübeleri: pasif et → depo (kıtlıkta bile çalışır — kıtlığı bu çözer)
  for (const b of G.buildings) {
    if (b.type !== 'hunter' || b.ruined) continue;
    b.huntT = (b.huntT || 0) + dt * BAL.prod;
    if (b.huntT >= 10) { b.huntT = 0; addStock('meat', b.lv >= 2 ? 2 : 1, b.x, b.y - 34, b.outpost); }
  }

  // demirci ocağındaki pota: süresi dolan parti demire dönüşür ve ambara geri uçar
  if (G.smelts && G.smelts.length) {
    for (const sm of G.smelts) {
      sm.t -= dt;
      if (sm.t > 0) continue;
      sm.bitti = true;
      addStock('iron', sm.n, sm.x, sm.y - 38, sm.site === 'village' ? null : sm.site);
      spawnParts(sm.x, sm.y - 20, 8, { colors: ['#ffb347', '#ff7a3d', '#ffe9a8'], v: 55, life: 0.6, g: -20 });
      for (let i = 0; i < sm.n; i++)
        G.flyItems.push({ x0: sm.x + rr(-8, 8), y0: sm.y - 30, x1: sm.ax + rr(-12, 12), y1: sm.ay - 42, t: 0, icon: '⚙️' });
    }
    G.smelts = G.smelts.filter(sm => !sm.bitti);
  }

  // köylüler: işine yürür → çalışır → yükü eve taşır (baskında ateşe kaçar)
  const JOB_NODE = { wood: 'tree', stone: 'rock', scrap: 'scrap' };
  for (const b of G.buildings) {
    if (b.type !== 'house' || !b.villager) continue;
    if (b.vx === undefined) { b.vx = b.x + 26; b.vy = b.y + 26; b.vwT = 0; b.vwalk = 0; b.vdir = 0; b.vstate = null; b.vstuckT = 0; }
    // Köylü ortak navMove'u kullanır: sur kapısından dolaşır, takılırsa engeli
    // teğet boyunca dolanır. (b.nv* alanları navMove'un kendi durumu.)
    if (b.nvHost === undefined) b.nvHost = { x: b.vx, y: b.vy, dir: 0 };
    const walkTo = (tx2, ty2, sp) => {
      const dd = dist(b.vx, b.vy, tx2, ty2);
      if (dd <= 14) { navReset(b.nvHost); b.vstuckT = 0; b.vBestD = undefined; return true; }
      const H = b.nvHost; H.x = b.vx; H.y = b.vy;
      navMove(H, tx2, ty2, sp, dt, 10, false);
      b.vx = H.x; b.vy = H.y; b.vdir = H.dir;
      b.vwalk += dt * (sp > 100 ? 12 : 7);
      // nvDead: engel takibi DAHİL hiç yaklaşamadığı süre → üst katman iş değiştirsin
      b.vstuckT = H.nvDead || 0;
      return false;
    };
    const scared = G.night && G.raidHappened;
    if (scared) { // evine sığın, iş bırakılır
      b.vstate = null;
      b.vwT -= dt;
      if (b.vwT <= 0 || b.vtx === undefined) { b.vwT = rr(1, 2.5); b.vtx = b.x + rr(-35, 35); b.vty = b.y + 30 + rr(-12, 22); }
      walkTo(b.vtx, b.vty, 170);
      continue;
    }
    if (G.night) { // gece: iş biter, evin önünde oturulur (köy akşamı)
      b.vstate = null;
      b.vwT -= dt;
      if (b.vwT <= 0) { b.vwT = rr(2.5, 5); b.vtx = b.x + rr(-26, 26); b.vty = b.y + 30 + rr(-8, 16); }
      walkTo(b.vtx, b.vty, 55);
      continue;
    }
    // yemek molası: arada Konak ocağına gidip karnını doyurur (köy yaşantısı)
    if (b.mealT === undefined) b.mealT = rr(25, 90);
    if (b.meal) {
      // Yemek kendi üssünün ocağında yenir. Eskiden herkes KÖY ocağına yürüyordu:
      // barbar kampındaki köylünün evi konağa 2510px uzakta, gidiş-dönüş 70 sn —
      // adam gününün yarısını yolda geçirip ambara odun getiremiyordu.
      const oca = b.outpost && OUTPOSTS[b.outpost] ? OUTPOSTS[b.outpost] : CAMPFIRE;
      const qx = oca.x + 44 + (b.mealSlot || 0) * 20, qy = oca.y + 54;
      if ((b.mealEatT || 0) > 0) {
        b.mealEatT -= dt;
        b.mealFx = (b.mealFx || 0) - dt;
        if (b.mealFx <= 0) { b.mealFx = 1.3; addFloater(b.vx, b.vy - 44, '🍖', '#ffe9a8', 12); }
        if (b.mealEatT <= 0) { b.meal = false; b.mealT = rr(80, 150); b.vstate = null; siteEat(b.outpost, 1); }
      } else if (walkTo(qx, qy, 72)) b.mealEatT = 4;
      continue;
    }
    b.mealT -= dt;
    // Açlık artık KENDİ üssünün ambarına bakar: köyün eti bitti diye karakoldaki
    // köylü greve gitmez, karakolun kendi eti varsa çalışmaya devam eder.
    const evAc = siteAc(b.outpost);
    if (b.mealT <= 0 && !evAc) { b.meal = true; b.mealEatT = 0; b.mealSlot = (G.mealQ = ((G.mealQ || 0) + 1) % 5); b.vstate = null; }
    // köylü muhabbeti: oyuncu yakından geçerken laf atar
    b.talkCd = Math.max(0, (b.talkCd || 0) - dt);
    if (b.talkCd <= 0 && !scared && dist(G.player.x, G.player.y, b.vx, b.vy) < 95) {
      b.talkCd = rr(12, 25);
      const lines = ['Hasat bereketli bey\'im!', 'Sur sağlam olsun da...', 'Geceleri o sesler ne öyle?', 'Bu köy senin sayende ayakta.', 'Vulkar\'ın adamlarını görmüşler...', 'Sırtım ağrıyor ama şikayet etmem.', 'Konağın ocağı hiç sönmesin!'];
      addFloater(b.vx, b.vy - 56, '💬 ' + lines[ri(0, lines.length - 1)], '#fff3d9', 12);
    }
    if (evAc) { // KENDİ üssünün eti bitti: bu yerleşkenin işçileri grevde
      b.vstate = null;
      b.vwT -= dt;
      if (b.vwT <= 0) {
        b.vwT = rr(2.5, 5); b.vtx = b.x + rr(-45, 45); b.vty = b.y + 30 + rr(-20, 36);
        if (rng() < 0.4) addFloater(b.vx, b.vy - 52, '🍖 Karnımız aç, çalışamayız!', '#ff9a8a', 11);
      }
      walkTo(b.vtx, b.vty, 40);
      continue;
    }
    if (!b.job || b.ruined) { // işsiz: evin önünde dolan
      b.vwT -= dt;
      if (b.vwT <= 0) { b.vwT = rr(2, 5); b.vtx = b.x + rr(-60, 60); b.vty = b.y + 30 + rr(-26, 46); }
      walkTo(b.vtx, b.vty, 46);
      continue;
    }
    const J = VILLAGER_JOBS[b.job];
    if (!b.vstate) {
      // iş yeri seç: eve en yakın uygun kaynak; yoksa çevrede eşinilecek bir yer
      let best = null, bd = 700;
      for (const n of G.nodes) {
        if (n.kind !== JOB_NODE[b.job] || !n.alive) continue;
        const dd = dist(b.x, b.y, n.x, n.y);
        if (dd < bd) { bd = dd; best = n; }
      }
      b.vnode = best;
      // hedef nokta kaynağın çarpışma halkasının DIŞINDA (takılmasın)
      b.vtx = best ? best.x + rr(-12, 12) : b.x + rr(-220, 260);
      b.vty = best ? best.y + rr(30, 42) : b.y + rr(-170, 210);
      b.vstate = 'git'; b.workT = J.every * 0.5; b.vstuckT = 0; b.vBestD = undefined;
    } else if (b.vstate === 'git') {
      if (walkTo(b.vtx, b.vty, 62)) b.vstate = 'calis';
      else if (b.vstuckT > 2) { b.vstuckT = 0; b.vBestD = undefined; b.vstate = null; b.vnode = null; } // yol tıkalı, başka iş bul
    } else if (b.vstate === 'calis') {
      b.workT -= dt;
      b.vdir = b.vnode ? Math.atan2(b.vnode.y - b.vy, b.vnode.x - b.vx) : b.vdir;
      // ritmik alet sallama: her vuruşta savuruş animasyonu + kırıntı + ses
      b.vswing = Math.max(0, (b.vswing || 0) - dt);
      b.vhitT = (b.vhitT || 0) - dt;
      if (b.vhitT <= 0) {
        b.vhitT = 0.75;
        b.vswing = 0.18;
        const fx = b.vnode ? b.vnode.x : b.vtx, fy = b.vnode ? b.vnode.y : b.vty;
        spawnParts(fx, fy - 14, 4, { colors: NODE_FX[JOB_NODE[b.job]] || NODE_FX.scrap, v: 55, life: 0.45, g: 170, r: 3 });
        addFloater(fx + rr(-6, 6), fy - 26, '✦', '#fff', 12);
        if (dist(G.player.x, G.player.y, b.vx, b.vy) < 520) SFX.chop();
      }
      if (b.vnode && !b.vnode.alive) { b.vstate = null; } // kaynak tükendi, yenisini bul
      else if (b.workT <= 0) { b.vstate = 'don'; b.vstuckT = 0; }
    } else if (b.vstate === 'don') {
      if (walkTo(b.x, b.y + 28, 62)) {
        addStock(b.job, b.lv >= 2 ? 2 : 1, b.x, b.y - 34, b.outpost); // yük kendi üssünün ambarına
        b.vstate = null;
      } else if (b.vstuckT > 2.5) { b.vx = b.x + 20; b.vy = b.y + 28; } // eve sıkıştıysa kapıya al
    }
  }

  // lokasyon keşfi
  G.discT = (G.discT || 0) + dt;
  if (G.discT > 0.5) {
    G.discT = 0;
    for (const L of LOCATIONS) {
      if (G.discovered[L.id] === 2) continue;
      if (dist(p.x, p.y, L.x, L.y) < 380) {
        G.discovered[L.id] = 2;
        toast('🗺️ Keşfedildi: ' + L.name); SFX.upgrade(); save();
      }
    }
  }

  // yol olayı bitti mi? (dövüş olayları: düşmanlar ölünce ödül + devam)
  if (G.eventState && !G.enemies.some(e => e.camp === 'event')) {
    gain(G.eventState.reward, p.x, p.y - 30);
    banner('KERVAN KURTARILDI!'); SFX.coin();
    G.eventState = null;
  }
  if (G.pendingTravel && !G.panelFor && !G.enemies.some(e => e.camp === 'event' && e.aggro)) {
    G.autoTravel = G.pendingTravel; G.pendingTravel = null;
    toast('🧭 Yolculuğa devam ediyorsun');
  }

  // gözcü kuleleri: menzildeki düşmana ok at
  for (const b of G.buildings) {
    if (b.type !== 'watchtower' || b.ruined) continue;
    b.cd = Math.max(0, (b.cd || 0) - dt);
    if (b.cd > 0) continue;
    let best = null, bd = TOWER.range[b.lv];
    for (const e of G.enemies) { const dd = dist(b.x, b.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; } }
    if (best) {
      b.cd = TOWER.rate;
      G.arrows.push({ x: b.x, y: b.y - 58, tgt: best, dir: 0, dmg: TOWER.dmg[b.lv], life: 0 });
      SFX.arrow();
    }
  }
  // oklar (hafif güdümlü)
  for (const a of G.arrows) {
    const t2 = a.tgt;
    a.life += dt;
    if (!t2 || t2.hp <= 0 || a.life > 2.5) { a.dead = true; continue; }
    a.dir = Math.atan2(t2.y - 22 - a.y, t2.x - a.x);
    const asp = a.speed || 520;
    a.x += Math.cos(a.dir) * asp * dt; a.y += Math.sin(a.dir) * asp * dt;
    if (dist(a.x, a.y, t2.x, t2.y - 22) < 18) {
      a.dead = true;
      if (a.hostile) damageAlly(t2, a.dmg, a.x, a.y);
      else {
        const res = ((t2.def || ENEMY_DEF[t2.type]) || {}).arrowResist || 0; // kalkanlı barbar oku savar
        const ad = Math.max(1, Math.round(a.dmg * (1 - res)));
        if (res) addFloater(t2.x, t2.y - 52, 'sekti', '#c9ced6', 12);
        damageEnemy(t2, ad, a.x, a.y, false, a.owner); // okçunun leşi de sayılır
      }
    }
  }
  G.arrows = G.arrows.filter(a => !a.dead);

  // yıkık binalardan duman
  for (const b of G.buildings) {
    if (b.ruined && rng() < dt * 2) {
      G.particles.push({ x: b.x + rr(-14, 14), y: b.y - 20, vx: rr(-6, 6), vy: rr(-45, -25), t: rr(0.8, 1.4), max: 1.4, r: rr(4, 8), c: 'rgba(90,85,80,0.9)' });
    }
  }

  // kaynak yeniden doğma
  for (const n of G.nodes) if (!n.alive) { n.respT -= dt; if (n.respT <= 0) { n.alive = true; n.hp = NODE_DEF[n.kind].hp; } }

  // barbar kampı yeniden asker doğurma
  if (!G.camp1Destroyed) {
    const alive = G.enemies.filter(e => e.camp === 'camp1' && e.hp > 0).length;
    if (alive < 5 && Math.floor(G.t) % 20 === 0 && G.t - (G.lastCampSpawn || 0) > 19) {
      G.lastCampSpawn = G.t;
      const r2 = rng();
      spawnEnemy(r2 < 0.5 ? 'barb' : r2 < 0.7 ? 'archer' : r2 < 0.85 ? 'shieldbarb' : 'brute', CAMP1.x + rr(-140, 140), CAMP1.y + rr(-100, 140), 'camp1');
    }
  }

  // yaban hayatı: kaç / öfkelen / avlan + azalınca yenilen
  G.animals = G.animals.filter(a => !a.dead);
  G.animRespT = (G.animRespT || 30) - dt;
  if (G.animRespT <= 0) {
    G.animRespT = 30;
    for (const [t2, n2] of Object.entries(ANIMAL_BASE)) {
      if (G.animals.filter(a => a.type === t2).length >= n2) continue;
      const s2 = animalSpot();
      if (s2 && dist(s2[0], s2[1], p.x, p.y) > 400) { spawnAnimal(t2, s2[0], s2[1]); break; } // tur başına 1
    }
  }
  for (const a of G.animals) {
    const A = ANIMALS[a.type];
    a.cd = Math.max(0, a.cd - dt); a.flash = Math.max(0, (a.flash || 0) - dt);
    a.fleeT = Math.max(0, (a.fleeT || 0) - dt);
    a.angerT = Math.max(0, (a.angerT || 0) - dt);
    if (a.angered && a.angerT <= 0) a.angered = false;
    const pd = dist(a.x, a.y, p.x, p.y);
    const aggressive = (A.hunts && pd < 250) || (a.angered && A.fights);
    if (aggressive && !G.dead && pd > 1) {
      a.dir = Math.atan2(p.y - a.y, p.x - a.x);
      if (pd > 40) {
        const [nx2, ny2] = collide(a.x + Math.cos(a.dir) * A.speed * dt, a.y + Math.sin(a.dir) * A.speed * dt, A.r);
        a.x = nx2; a.y = ny2; a.walk += dt * 11;
      } else if (a.cd <= 0) {
        a.cd = 1.1;
        damageAlly('player', A.dmg || 6, a.x, a.y);
      }
    } else if ((A.fleeR && pd < A.fleeR) || a.fleeT > 0) {
      a.dir = Math.atan2(a.y - p.y, a.x - p.x); // oyuncudan uzağa
      const [nx2, ny2] = collide(a.x + Math.cos(a.dir) * A.speed * dt, a.y + Math.sin(a.dir) * A.speed * dt, A.r);
      a.x = nx2; a.y = ny2; a.walk += dt * 12;
    } else {
      a.wt -= dt;
      if (a.wt <= 0) { a.wt = rr(2, 5); a.wx = a.hx + rr(-140, 140); a.wy = a.hy + rr(-140, 140); }
      const dd = dist(a.x, a.y, a.wx, a.wy);
      if (dd > 10) {
        a.dir = Math.atan2(a.wy - a.y, a.wx - a.x);
        const [nx2, ny2] = collide(a.x + Math.cos(a.dir) * A.speed * 0.32 * dt, a.y + Math.sin(a.dir) * A.speed * 0.32 * dt, A.r);
        a.x = nx2; a.y = ny2; a.walk += dt * 5;
      }
      if (a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + 1.5 * dt);
    }
  }
  // ziyafet buff süresi
  G.feastT = Math.max(0, (G.feastT || 0) - dt);

  // 🍖 et bakımı: tüketim ŞAFAKTA toplu yapılır (endNight) — burada sadece kıtlık tespiti
  const troops = G.soldiers.length + G.garrisonUnits.length + G.commanders.length;
  const starving = G.stock.meat <= 0 && G.res.meat <= 0;
  const wasFamine = G.famine;
  // G.famine artık KÖYÜN açlığı: karakolların kendi ambarı ve kendi grevi var
  G.famine = starving && (troops > 0 || G.buildings.some(b => b.villager && !b.outpost));
  if (G.famine && !wasFamine) { toast('🍖 KÖYÜN ETİ BİTTİ! İşçiler grevde — ordu da uzun sürerse dağılır!', true); SFX.no(); }
  if (G.famine) {
    G.famineT += dt;
    if (G.famineT > 45 && troops > 0) { // 45sn tahammül, sonra 40sn'de bir firar
      G.desertT = (G.desertT || 0) + dt;
      if (G.desertT >= 40) {
        G.desertT = 0;
        if (G.garrisonUnits.length) { // önce garnizondan kaçarlar
          const g2 = G.garrisonUnits[ri(0, G.garrisonUnits.length - 1)];
          const op2 = G.outposts[g2.garrisonOf];
          if (op2) { op2.garrison = Math.max(0, op2.garrison - 1); (op2.garrisonCls || []).pop(); }
          G.garrisonUnits = G.garrisonUnits.filter(x => x !== g2);
          toast('🍖 Açlık: bir garnizon askeri firar etti!', true); SFX.no();
        } else if (G.soldiers.length) {
          G.soldiers.pop(); G.soldiersOwned = Math.max(0, G.soldiersOwned - 1);
          toast('🍖 Açlık: bir askerin orduyu terk etti!', true); SFX.no();
        }
        save();
      }
    }
  } else { G.famineT = 0; G.desertT = 0; }

  // düşman AI — misafirken dünya HOST'tan geldiği için kendi simülasyonumuz durur
  if (!coopSlave()) for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const d = eDef(e); // ırk uygulanmış etkin tanım (hız/menzil/bekleme farkları)
    e.cd = Math.max(0, e.cd - dt); e.swing = Math.max(0, e.swing - dt); e.flash = Math.max(0, e.flash - dt);
    // hedef seç: en yakın (oyuncu | asker | baskıncıysa bina)
    let tx = null, ty = null, tref = null, td = 1e9, tBuilding = null;
    if (!G.dead) { const dd = dist(e.x, e.y, p.x, p.y); if (dd < td) { td = dd; tx = p.x; ty = p.y; tref = 'player'; } }
    for (const s of G.soldiers) { if (s.hp <= 0) continue; const dd = dist(e.x, e.y, s.x, s.y); if (dd < td) { td = dd; tx = s.x; ty = s.y; tref = s; } }
    for (const s of G.commanders) { if (s.hp <= 0) continue; const dd = dist(e.x, e.y, s.x, s.y); if (dd < td) { td = dd; tx = s.x; ty = s.y; tref = s; } }
    for (const s of G.garrisonUnits) { if (s.hp <= 0) continue; const dd = dist(e.x, e.y, s.x, s.y); if (dd < td) { td = dd; tx = s.x; ty = s.y; tref = s; } }
    for (const c2 of G.commanders) for (const s of (c2.troops || [])) { if (s.hp <= 0) continue; const dd = dist(e.x, e.y, s.x, s.y); if (dd < td) { td = dd; tx = s.x; ty = s.y; tref = s; } }
    for (const cv of G.caravans) { if (cv.hp <= 0) continue; const dd = dist(e.x, e.y, cv.x, cv.y); if (dd < td && dd < 200) { td = dd; tx = cv.x; ty = cv.y; tref = cv; } } // kervana sadece yol üstündeyse saldırır
    e.tGate = false; e.tStruct = null; e.tEngine = null;
    // kale/lejyon savunucuları: menzildeki kuşatma yapılarına da saldırır (şantiye dahil — bitmeden yıkabilirler)
    if ((e.camp === 'fort' || e.camp === 'legion') && !G.outposts[e.camp]) {
      for (const [ekey, en] of Object.entries(G.sieges[e.camp] || {})) {
        const engX = ekey === 'ram' && en.done ? en.rx : en.x, engY = ekey === 'ram' && en.done ? en.ry : en.y;
        const dd = dist(e.x, e.y, engX, engY);
        if (dd < 420 && dd < td) { td = dd; tx = engX; ty = engY; tref = null; tBuilding = null; e.tEngine = { site: e.camp, key: ekey }; }
      }
    }
    if (e.raider) {
      e.aggro = true;
      if (e.raidTarget && e.raidTarget !== 'village') {
        // karakol baskını: savunmacı yoksa oradaki binalara / sancağa yürü
        const OC = OUTPOSTS[e.raidTarget];
        for (const b of G.buildings) {
          if (b.type === 'campfire' || b.ruined || dist(b.x, b.y, OC.x, OC.y) > 320) continue;
          const dd = dist(e.x, e.y, b.x, b.y);
          if (dd < td) { td = dd; tx = b.x; ty = b.y; tref = null; tBuilding = b; }
        }
        const bn = G.structures.find(s2 => s2.kind === 'banner' && s2.site === e.raidTarget && s2.alive);
        if (bn) {
          const dd = dist(e.x, e.y, bn.x, bn.y);
          if (dd < td) { td = dd; tx = bn.x; ty = bn.y; tref = null; tBuilding = null; e.tStruct = bn; }
        }
        // kale kapısı onarıldıysa önce onu kırmak zorundalar
        const gk = e.raidTarget === 'fort' ? 'gate' : e.raidTarget === 'legion' ? 'lgate' : null;
        if (gk) {
          const og = G.structures.find(s2 => s2.kind === gk && s2.alive);
          if (og) { tx = og.x; ty = og.y; tref = null; tBuilding = null; e.tStruct = og; td = dist(e.x, e.y, og.x, og.y); }
        }
        // karakol suru varsa ve hedef içerideyse: önce sur kapısını kır
        const opw = G.outposts[e.raidTarget];
        if (opw && opw.wall && tx !== null) {
          const owg = G.structures.find(s2 => s2.kind === 'owgate' && s2.site === e.raidTarget && s2.alive);
          if (owg) {
            const ORe = opWallRAt(e.raidTarget);
            const eInside = dist(e.x, e.y, OC.x, OC.y) < ORe - 15;
            const tInside = dist(tx, ty, OC.x, OC.y) < ORe - 5;
            if (!eInside && tInside) { tx = owg.x; ty = owg.y; tref = null; tBuilding = null; e.tStruct = owg; td = dist(e.x, e.y, owg.x, owg.y); }
          }
        }
      } else {
        // köy baskını: oyuncu/asker uzaktaysa binalara yönel
        for (const b of G.buildings) {
          if (b.type === 'campfire' || b.ruined) continue;
          const dd = dist(e.x, e.y, b.x, b.y);
          if (dd < td) { td = dd; tx = b.x; ty = b.y; tref = null; tBuilding = b; }
        }
        // sur ayaktaysa ve hedef içerideyse: önce kapıyı kır
        if (G.palisade.built && G.palisade.gate.alive && tx !== null) {
          const eInside = dist(e.x, e.y, CAMPFIRE.x, CAMPFIRE.y) < palR() - 15;
          const tInside = dist(tx, ty, CAMPFIRE.x, CAMPFIRE.y) < palR() - 5;
          if (!eInside && tInside) {
            tx = PAL_GATE.x + 14; ty = PAL_GATE.y; tref = null; tBuilding = null; e.tGate = true;
            td = dist(e.x, e.y, tx, ty);
          }
        }
      }
    }
    const homeD = dist(e.x, e.y, e.hx, e.hy);
    e.aggroCd = Math.max(0, (e.aggroCd || 0) - dt);
    if (!e.aggro && e.aggroCd <= 0 && td < d.aggro) e.aggro = true;
    // leash: anlık can yenileme YOK (okçuyla kaçarak savaşma taktiğini bozuyordu);
    // kısa soğuma sınırda aç/kapa titremesini de önler
    if (!e.raider && e.aggro && (homeD > 620 || (tref === null && !e.tEngine))) { e.aggro = false; e.aggroCd = 2.5; }
    // genel sur yönlendirmesi (leash'ten SONRA — kapı hedefi tref'i boşaltınca aggro düşmesin):
    // hedef surun öbür tarafındaysa kapı ağzına dolaş; düşman + sağlam kapı → kapıyı kırmaya giriş
    let route = null;
    if (e.aggro && tx !== null && !e.tGate && !e.tStruct) {
      route = wallRoute(e.x, e.y, tx, ty, true);
      if (route && route.attackVillageGate) {
        tx = PAL_GATE.x + 14; ty = PAL_GATE.y; tref = null; tBuilding = null; e.tGate = true;
        td = dist(e.x, e.y, tx, ty);
        route = orbitToGap(e.x, e.y, route.ring); // kapı uzaktaysa çevreden dolaşarak yaklaş
      } else if (route && route.attackGate) {
        e.tStruct = route.attackGate; tx = e.tStruct.x; ty = e.tStruct.y; tref = null; tBuilding = null;
        td = dist(e.x, e.y, tx, ty);
        route = orbitToGap(e.x, e.y, route.ring);
      }
    }
    // baskıncı köy mantığı kapıyı kendisi hedeflediyse de yörünge uygula (batıdan gelen kapıya dolaşsın)
    if (e.aggro && (e.tGate || e.tStruct) && !route && G.palisade.built && e.tGate) {
      const vr = wallRings().find(r2 => r2.village);
      if (vr && dist(e.x, e.y, vr.cx, vr.cy) > vr.r - 6) route = orbitToGap(e.x, e.y, vr);
    }
    // KARA VULKAR boss kalıpları: öfke + telegraflı şarj
    if (e.type === 'rivallord') {
      if (!e.raged && e.hp < e.maxHp * 0.3) { e.raged = true; e.flash = 0.3; banner('KARA VULKAR ÖFKELENDİ!'); SFX.horn(); }
      e.chargeCd = Math.max(0, (e.chargeCd || 0) - dt);
      if ((e.dashT || 0) > 0) { // şarj koşusu
        e.dashT -= dt;
        const [nx2, ny2] = collide(e.x + Math.cos(e.chargeDir) * 640 * dt, e.y + Math.sin(e.chargeDir) * 640 * dt, 18, true);
        e.x = nx2; e.y = ny2; e.walk += dt * 16; e.dir = e.chargeDir;
        if (!e.chargeHit) {
          const cdmg = Math.round(40 * (e.mul || 1));
          if (!G.dead && dist(e.x, e.y, p.x, p.y) < 46) { damageAlly('player', cdmg, e.x, e.y); e.chargeHit = true; }
          for (const al of [...G.soldiers, ...G.commanders, ...G.garrisonUnits])
            if (al.hp > 0 && dist(e.x, e.y, al.x, al.y) < 46) { damageAlly(al, cdmg, e.x, e.y); e.chargeHit = true; }
        }
        continue;
      }
      if ((e.chargingT || 0) > 0) { // gerilme (kaç!)
        e.chargingT -= dt;
        e.dir = e.chargeDir;
        if (e.chargingT <= 0) { e.dashT = 0.55; SFX.boom(); G.shake = 5; }
        continue;
      }
      if (e.aggro && tref && e.chargeCd <= 0 && td > 150 && td < 420) {
        e.chargingT = 0.75; e.chargeCd = e.raged ? 5 : 7.5;
        e.chargeDir = Math.atan2(ty - e.y, tx - e.x); e.chargeHit = false;
        G.telegraphs.push({ x: e.x, y: e.y, dir: e.chargeDir, len: 440, w: 64, t: 0.75, max: 0.75 });
        tone(90, 0.6, 'sawtooth', 0.14, 30);
        continue;
      }
    }
    if (e.aggro && (tref || tBuilding || e.tGate || e.tStruct || e.tEngine)) {
      e.dir = Math.atan2(ty - e.y, tx - e.x);
      const edmg = Math.round(d.dmg * (e.mul || 1) * (e.raged ? 1.3 : 1));
      // ŞAMAN: yaralı bir dostu varsa savaşmak yerine onu iyileştirir
      if (d.healer && e.cd <= 0) {
        let woundedAlly = null, wd = 260;
        for (const o of G.enemies) {
          if (o === e || o.hp <= 0 || o.hp >= o.maxHp) continue;
          const dd = dist(e.x, e.y, o.x, o.y);
          if (dd < wd) { wd = dd; woundedAlly = o; }
        }
        if (woundedAlly) {
          e.cd = d.cd; e.swing = 0.18;
          woundedAlly.hp = Math.min(woundedAlly.maxHp, woundedAlly.hp + Math.round(35 * (e.mul || 1)));
          addFloater(woundedAlly.x, woundedAlly.y - 48, '+' + Math.round(35 * (e.mul || 1)), '#57d364', 14);
          spawnParts(woundedAlly.x, woundedAlly.y - 24, 6, { colors: ['#57d364', '#a8f0b0'], v: 30, life: 0.6, g: -30, r: 2.5 });
          tone(880, 0.15, 'sine', 0.06, 150);
        }
      }
      if (route) e.dir = Math.atan2(route.wy - e.y, route.wx - e.x); // kapı ağzına dön
      if (d.ranged && tref && !tBuilding && !e.tGate && !e.tStruct && !e.tEngine && !route) {
        // okçu: mesafe korur, ok atar
        if (td < 150) { // fazla yakın — geri çekil
          const [nx2, ny2] = collide(e.x - Math.cos(e.dir) * d.speed * dt, e.y - Math.sin(e.dir) * d.speed * dt, 13 * d.scale, true);
          e.x = nx2; e.y = ny2; e.walk += dt * 10;
        } else if (td > d.range) {
          const [nx2, ny2] = collide(e.x + Math.cos(e.dir) * d.speed * dt, e.y + Math.sin(e.dir) * d.speed * dt, 13 * d.scale, true);
          e.x = nx2; e.y = ny2; e.walk += dt * 10;
        } else if (e.cd <= 0) {
          e.cd = d.cd; e.swing = 0.18;
          G.arrows.push({ x: e.x, y: e.y - 22, tgt: tref === 'player' ? G.player : tref, dir: e.dir, dmg: edmg, life: 0, speed: 430, hostile: true });
          SFX.arrow();
        }
      } else {
        const reach = (tBuilding || e.tGate || e.tStruct || e.tEngine) ? d.range + 20 : d.range;
        if (route || td > reach) { // rota varken hep yürü (duvar arkasına vurmaya çalışma)
          const spd2 = d.speed * (e.raged ? 1.4 : 1);
          const [nx2, ny2] = collide(e.x + Math.cos(e.dir) * spd2 * dt, e.y + Math.sin(e.dir) * spd2 * dt, 13 * d.scale, true);
          e.x = nx2; e.y = ny2; e.walk += dt * 10;
        } else if (e.cd <= 0) {
          e.cd = d.cd; e.swing = 0.18;
          if (e.tGate) damageVillageGate(edmg);
          else if (e.tStruct) damageStructure(e.tStruct, edmg);
          else if (e.tEngine) damageEngine(e.tEngine.site, e.tEngine.key, edmg);
          else if (tBuilding) damageBuilding(tBuilding, edmg);
          else {
            damageAlly(tref, edmg, e.x, e.y);
            if (d.slow && tref === 'player') { G.player.slowT = 1.4; addFloater(G.player.x, G.player.y - 62, '🧊 donma!', '#a8d8f0', 12); }
          }
        }
      }
    } else {
      // evinin etrafında gezin (savaş dışında YAVAŞ yenilenme — eskisi gibi anlık değil)
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 3 * dt);
      e.wt -= dt;
      if (e.wt <= 0) { e.wt = rr(1.5, 4); e.wx = e.hx + rr(-90, 90); e.wy = e.hy + rr(-90, 90); }
      const dd = dist(e.x, e.y, e.wx, e.wy);
      if (dd > 8) {
        e.dir = Math.atan2(e.wy - e.y, e.wx - e.x);
        const [nx2, ny2] = collide(e.x + Math.cos(e.dir) * d.speed * 0.45 * dt, e.y + Math.sin(e.dir) * d.speed * 0.45 * dt, 13 * d.scale, true);
        e.x = nx2; e.y = ny2; e.walk += dt * 6;
      }
    }
  }
  G.enemies = G.enemies.filter(e => e.hp > 0);

  // askerler
  G.soldiers = G.soldiers.filter(s => s.hp > 0);
  G.soldiers.forEach((s, i) => {
    const SC = SOLDIER_CLS[s.cls || 'sword'];
    s.cd = Math.max(0, s.cd - dt); s.swing = Math.max(0, s.swing - dt); s.flash = Math.max(0, s.flash - dt);
    // hedef: menzildeki en yakın düşman (+ takip kararlılığı: sur dolaşırken menzilden çıkan hedef bırakılmaz)
    let best = null, bd = SOLDIER.aggro;
    for (const e of G.enemies) { const dd = dist(s.x, s.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; } }
    if (best) { s.pursue = best; s.pursueT = 6; }
    else if ((s.pursueT || 0) > 0 && s.pursue && s.pursue.hp > 0) { s.pursueT -= dt; best = s.pursue; bd = dist(s.x, s.y, best.x, best.y); }
    else s.pursue = null;
    if (best) {
      s.dir = Math.atan2(best.y - s.y, best.x - s.x);
      const rt = wallRoute(s.x, s.y, best.x, best.y, false); // düşman surun öbür tarafındaysa kapı yörüngesi
      if (rt) s.pursueT = 6; // rotada ilerlerken takipten vazgeçme
      if (rt && rt.wx !== undefined) s.dir = Math.atan2(rt.wy - s.y, rt.wx - s.x);
      if (SC.ranged && bd < 130 && !rt) { // okçu asker: geri çekil
        const [nx2, ny2] = collide(s.x - Math.cos(s.dir) * SC.speed * dt, s.y - Math.sin(s.dir) * SC.speed * dt, 12);
        s.x = nx2; s.y = ny2; s.walk += dt * 10;
      } else if (rt || bd > SC.range) {
        // navMove: duvar köşesinde kilitlenmesin (takip dalında hiç takılma
        // sigortası yoktu — köşeye sıkışan birim sonsuza dek orada kalıyordu)
        navMove(s, best.x, best.y, SC.speed, dt, 12, false);
        s.walk += dt * 10;
        if ((s.nvDead || 0) > 3) { s.pursue = null; s.pursueT = 0; navReset(s); }  // ulaşamıyorum, safa dön
      } else if (s.cd <= 0) {
        s.cd = SC.cd; s.swing = 0.18;
        const sdmg = s.tdmg || SC.dmg;
        if (SC.ranged) { G.arrows.push({ x: s.x, y: s.y - 22, tgt: best, dir: s.dir, dmg: sdmg, life: 0, speed: 500, owner: s }); SFX.arrow(); }
        else damageEnemy(best, sdmg, s.x, s.y, false, s); // killer=s → XP biriktirir
      }
    } else {
      // formasyon: oyuncunun arkasında (sur araya girdiyse kapı ağzından dolaş)
      const a = p.dir + Math.PI, spread = (i - (G.soldiers.length - 1) / 2) * 0.7;
      let fx = p.x + Math.cos(a + spread) * 58, fy = p.y + Math.sin(a + spread) * 58;
      const dd = dist(s.x, s.y, fx, fy);
      if (dd > 26) {
        const spd = dd > 300 ? SOLDIER.speed * 1.6 : SOLDIER.speed;
        navMove(s, fx, fy, spd, dt, 12, false);
        s.walk += dt * 10;
        // engel takibi bile sökemediyse (kapana kısılmış) safa ışınla
        if ((s.nvDead || 0) > 3.5) { navReset(s); s.x = p.x + rr(-45, 45); s.y = p.y + rr(-45, 45); }
      } else navReset(s);
      if (dd > 800) { s.x = p.x + rr(-30, 30); s.y = p.y + rr(-30, 30); }
      if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + (s.tregen || SOLDIER.regen) * dt); // savaş dışı yenilenme
    }
  });

  // komutanlar: takipte öncü hatta savaşır; görevdeyse (koru/yağma) kendi başına gezer + öz ordusunu yönetir
  G.commanders = G.commanders.filter(c => c.hp > 0);
  G.commanders.forEach((c, i) => {
    const C = COMMANDERS[c.id];
    const indep = cmdIndependent(c) && !G.caveRun; // inde görev yok: herkes yanında dövüşür
    c.cd = Math.max(0, c.cd - dt); c.swing = Math.max(0, c.swing - dt); c.flash = Math.max(0, c.flash - dt);
    // ---- HAYATTA KALMA AKLI: ölmeden çekil, canını topla, geri dön ----
    // Yağmaya çıkan komutan alan koruması olmadığı için ölene kadar dövüşüyordu.
    // %28'in altına düşünce geri çekilir, en yakın kendi üssünde toparlanır,
    // %85'e ulaşınca görevine kaldığı yerden devam eder.
    if (!c.retreat && c.hp < c.maxHp * 0.28 && !G.caveRun) {
      c.retreat = true; c.pursue = null; c.pursueT = 0; c.wp = null; c.patA = undefined;
      addFloater(c.x, c.y - 70, '🩸 Çekiliyorum!', '#ff9a8a', 13);
      toast('🩸 ' + C.name + ' ağır yaralı — geri çekilip toparlanıyor');
    }
    if (c.retreat) {
      if (c.hp >= c.maxHp * 0.85) {
        c.retreat = false; c.bestD = undefined; c.fStuck = 0;
        addFloater(c.x, c.y - 70, '⚔️ Döndüm!', '#c8f0b8', 13);
        toast('⚔️ ' + C.name + ' toparlandı — görevine dönüyor');
      } else {
        // en yakın kendi üssüne kaç (köy dahil), oraya varınca hızlı iyileş
        let sig = CAMPFIRE, sd = dist(c.x, c.y, CAMPFIRE.x, CAMPFIRE.y);
        for (const [oid, op3] of Object.entries(G.outposts)) {
          if (!op3 || !op3.owned || op3.looted || op3.isVillage || !OUTPOSTS[oid]) continue;
          const d3 = dist(c.x, c.y, OUTPOSTS[oid].x, OUTPOSTS[oid].y);
          if (d3 < sd) { sd = d3; sig = OUTPOSTS[oid]; }
        }
        const evde = sd < 190;
        if (!evde) {
          let ang3 = Math.atan2(sig.y - c.y, sig.x - c.x);
          const rt3 = wallRoute(c.x, c.y, sig.x, sig.y, false);
          if (rt3 && rt3.wx !== undefined) ang3 = Math.atan2(rt3.wy - c.y, rt3.wx - c.x);
          // yakındaki düşmandan uzaklaşacak şekilde kaç (kaçarken göğüs germesin)
          let yakin = null, yd = 150;
          for (const e of G.enemies) { const d4 = dist(c.x, c.y, e.x, e.y); if (d4 < yd) { yd = d4; yakin = e; } }
          if (yakin) {
            const kac = Math.atan2(c.y - yakin.y, c.x - yakin.x);
            ang3 = Math.atan2(Math.sin(ang3) * 0.55 + Math.sin(kac) * 0.45, Math.cos(ang3) * 0.55 + Math.cos(kac) * 0.45);
          }
          const [nx3, ny3] = collide(c.x + Math.cos(ang3) * C.speed * 1.25 * dt, c.y + Math.sin(ang3) * C.speed * 1.25 * dt, 13);
          c.x = nx3; c.y = ny3; c.walk += dt * 13; c.dir = ang3;
        }
        c.hp = Math.min(c.maxHp, c.hp + SOLDIER.regen * (evde ? 6 : 2.2) * dt);
        cmdTroopsUpdate(c, dt);
        return;   // çekilirken savaşmaz
      }
    }
    // Kurtarılan esir: canı dolana dek savaşa girmez, oyuncunun etrafında dolanır
    if (c.recovering) {
      if (c.hp >= c.maxHp) {
        c.recovering = false;
        addFloater(c.x, c.y - 70, '⚔️ Hazırım!', '#c8f0b8', 13);
        toast('⚔️ ' + C.name + ' iyileşti — saflara katıldı!');
      } else {
        c.hp = Math.min(c.maxHp, c.hp + Math.max(SOLDIER.regen, c.maxHp / 40) * dt); // ~30 sn toparlanma
        c.recA = (c.recA || 0) + dt * 0.9;
        const rx = p.x + Math.cos(c.recA) * 78, ry = p.y + Math.sin(c.recA) * 78 * 0.7;
        const ang4 = Math.atan2(ry - c.y, rx - c.x);
        if (dist(c.x, c.y, rx, ry) > 16) {
          const [nx4, ny4] = collide(c.x + Math.cos(ang4) * C.speed * 0.9 * dt, c.y + Math.sin(ang4) * C.speed * 0.9 * dt, 13);
          c.x = nx4; c.y = ny4; c.walk += dt * 9; c.dir = ang4;
        }
        if (dist(c.x, c.y, p.x, p.y) > 700) { c.x = p.x + rr(-40, 40); c.y = p.y + rr(-40, 40); }
        cmdTroopsUpdate(c, dt);
        return;
      }
    }
    let best = null, bd;
    if (indep && c.order.indexOf('guard:') === 0) {
      // koruma görevi: siteye 520px yaklaşan HER düşman hedeftir (kendinden uzak olsa da koşar)
      const O = OUTPOSTS[c.order.slice(6)] || CAMPFIRE;
      bd = 1e9;
      for (const e of G.enemies) {
        if (e.hp <= 0 || dist(e.x, e.y, O.x, O.y) > 520) continue;
        const dd = dist(c.x, c.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
    } else {
      bd = SOLDIER.aggro + 40 + (indep ? 80 : 0);
      for (const e of G.enemies) { const dd = dist(c.x, c.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; } }
    }
    if (best) { c.pursue = best; c.pursueT = 6; }
    else if ((c.pursueT || 0) > 0 && c.pursue && c.pursue.hp > 0) { c.pursueT -= dt; best = c.pursue; bd = dist(c.x, c.y, best.x, best.y); }
    else c.pursue = null;
    if (best) {
      c.dir = Math.atan2(best.y - c.y, best.x - c.x);
      const rt = wallRoute(c.x, c.y, best.x, best.y, false);
      if (rt) c.pursueT = 6; // rotada ilerlerken takipten vazgeçme
      if (rt && rt.wx !== undefined) c.dir = Math.atan2(rt.wy - c.y, rt.wx - c.x);
      if (rt || bd > 58) {
        navMove(c, best.x, best.y, C.speed, dt, 13, false);
        c.walk += dt * 10;
        if ((c.nvDead || 0) > 3) { c.pursue = null; c.pursueT = 0; navReset(c); }  // ulaşamıyorum, vazgeç
      } else if (c.cd <= 0) {
        c.cd = 1.0; c.swing = 0.18;
        damageEnemy(best, c.tdmg, c.x, c.y, false, c); // killer=c → leş sayılır
      }
    } else if (indep) {
      cmdIndepIdle(c, dt); // devriye halkası ya da yağma gezisi
      if (c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + SOLDIER.regen * 1.5 * dt);
    } else {
      // formasyon: oyuncunun ÖNÜNDE yürür (öncü; sur araya girdiyse kapıdan dolaş)
      const spread = (i - (G.commanders.length - 1) / 2) * 0.8;
      let fx = p.x + Math.cos(p.dir + spread) * 64, fy = p.y + Math.sin(p.dir + spread) * 64;
      const dd = dist(c.x, c.y, fx, fy);
      if (dd > 24) {
        const spd = dd > 300 ? C.speed * 1.6 : C.speed;
        navMove(c, fx, fy, spd, dt, 13, false);
        c.walk += dt * 10;
        if ((c.nvDead || 0) > 3.5) { navReset(c); c.x = p.x + rr(-45, 45); c.y = p.y + rr(-45, 45); }
      } else navReset(c);
      if (dd > 800) { c.x = p.x + rr(-30, 30); c.y = p.y + rr(-30, 30); }
      if (c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + SOLDIER.regen * 1.5 * dt);
    }
    cmdTroopsUpdate(c, dt); // öz ordu (bağımsızken toplanır, komutanla savaşır)
  });

  // yaralı yoldaşlar: uzun süre terk edilirse fethedilmemiş bir kaleye esir düşer
  for (const w of G.wounded) {
    w.t += dt;
    const far = dist(p.x, p.y, w.x, w.y) > 750;
    w.alertT = far ? (w.alertT || 0) + dt : 0;
    if (w.t > 45 && w.alertT > 15) {
      const sites = ['camp1', 'fort', 'legion'].filter(id => !G.outposts[id]);
      if (sites.length) {
        const site = sites[ri(0, sites.length - 1)];
        w.captured = true;
        G.prisoners[site].push(w.cmd ? { cmd: w.cmd, lv: w.lv, kills: w.kills, gear: w.gear } : { cls: w.cls, name: w.name });
        toast('🔒 ' + (w.name || 'Yaralı asker') + ' esir düştü! Zindan: ' + OUTPOSTS[site].name.replace(' Karakolu', '') + ' — orayı fethet, kurtar.', true);
        SFX.no();
      } else w.t = 0; // fethedilmedik yer kalmadıysa yerinde bekler
    }
  }
  G.wounded = G.wounded.filter(w => !w.captured);

  // vergi kervanları: karakoldan köye yürür; ölürse altın kaybolur
  for (const cv of G.caravans) {
    cv.flash = Math.max(0, cv.flash - dt);
    if (cv.hp <= 0) {
      cv.dead = true;
      spawnDust(cv.x, cv.y, 12);
      toast(cv.supply
        ? '🐴 ' + cv.from + ' → ' + cv.toName + ' yardım kervanı yağmalandı! −' + cv.amount + cv.icon
        : cv.trade
          ? '🐪 ' + cv.from + (cv.buy ? ' alım' : ' satış') + ' kervanı yağmalandı! −'
              + (cv.buy ? (cv.leg ? cv.amount + cv.icon : cv.gold + '🪙') : (cv.leg ? cv.gold + '🪙' : cv.amount + cv.icon))
          : '🐴 ' + cv.from + ' kervanı yağmalandı! −' + cv.gold + '🪙', true);
      continue;
    }
    if (cv.trade) { // satış kervanı: tüccara git (leg 0), parayı alıp üsse dön (leg 1)
      const A = cv.fromSite === 'village' ? CAMPFIRE : OUTPOSTS[cv.fromSite];
      const [tx4, ty4] = cv.leg === 0 ? cv.pts[0] : [A.x, A.y + 40];
      if (dist(cv.x, cv.y, tx4, ty4) < 46) {
        if (cv.leg === 0) {   // takas noktası: yük ↔ altın el değiştirir
          cv.leg = 1; cv.gotGold = true;
          spawnParts(cv.x, cv.y - 24, 10, { colors: ['#ffd257', '#fff3c9'], v: 50, life: 0.7, g: -20 });
          addFloater(cv.x, cv.y - 46, cv.buy ? '🐪 ' + cv.gold + '🪙 → ' + cv.amount + cv.icon
                                             : '🐪 ' + cv.amount + cv.icon + ' → ' + cv.gold + '🪙', '#ffd257', 13);
          SFX.coin();
        } else {
          cv.dead = true;
          if (cv.buy) {
            addStock(cv.res, cv.amount, tx4, ty4 - 30, cv.fromSite === 'village' ? null : cv.fromSite);
            toast('🐪 Alım kervanı döndü — ' + cv.from + ' ambarına +' + cv.amount + cv.icon);
          } else {
            gain({ gold: cv.gold }, tx4, ty4 - 30);
            toast('🐪 Satış kervanı döndü — ' + cv.from + ' kasasına +' + cv.gold + '🪙');
          }
          G.stats.caravans++;
          SFX.coin();
          save();
        }
        continue;
      }
      navMove(cv, tx4, ty4, 74, dt, 14, false);
      cv.walk += dt * 8;
      continue;
    }
    if (cv.supply) { // yardım kervanı: hedef üssün ambarına boşaltır
      const [sx3, sy3] = cv.pts[0];
      if (dist(cv.x, cv.y, sx3, sy3) < 46) {
        cv.dead = true;
        addStock(cv.res, cv.amount, sx3, sy3 - 30, cv.toSite === 'village' ? null : cv.toSite);
        G.stats.caravans++;
        SFX.coin();
        toast('🐴 Yardım kervanı ulaştı — ' + cv.toName + ' ambarına +' + cv.amount + cv.icon);
        save();
        continue;
      }
      navMove(cv, sx3, sy3, 74, dt, 14, false);   // sur kapısından dolaşır, takılırsa engeli dolanır
      cv.walk += dt * 8;
      continue;
    }
    const inside = G.palisade.built && dist(cv.x, cv.y, CAMPFIRE.x, CAMPFIRE.y) < palR();
    const [wx2, wy2] = inside || !G.palisade.built ? cv.pts[1] : cv.pts[cv.i];
    const dd = dist(cv.x, cv.y, wx2, wy2);
    if (dd < 40) {
      if (cv.i === 0 && !inside && G.palisade.built) { cv.i = 1; }
      else {
        cv.dead = true;
        gain({ gold: cv.gold }, CAMPFIRE.x, CAMPFIRE.y - 40);
        G.stats.caravans++;
        toast('🐴 ' + cv.from + ' kervanı ulaştı: +' + cv.gold + '🪙');
      }
      continue;
    }
    navMove(cv, wx2, wy2, 72, dt, 14, false);
    cv.walk += dt * 8;
  }
  G.caravans = G.caravans.filter(cv => !cv.dead);

  // garnizon askerleri: karakolu savunur, tehdit yoksa TESİSİN İÇİNDE DEVRİYE gezer
  G.garrisonUnits = G.garrisonUnits.filter(g => g.hp > 0);
  // tesise göre devriye rotası: kale/lejyon iç duvar dikdörtgeni, köy/kamp sur içi çember
  function sitePatrolPoints(site, g) {
    // Taş kalelerde devriye HER SUR BANDINI dolaşır: dış kale eklendikçe
    // aradaki bantlar bomboş kalıyordu, garnizon hep en içte tur atıyordu.
    if (site === 'fort' || site === 'legion') {
      // Her nöbetçi TEK bir sur bandında tur atar. Bantları tek bir rotada
      // birleştirmek, birimi her adımda duvardan geçmeye zorluyordu: kapıya
      // dolaşmak uzun sürüyor, navMove pes ediyor ve orta bant hep boş kalıyordu.
      const B0 = site === 'fort' ? FORT : LEG;
      const op = G.outposts[site], lv = (op && op.lv) || 1;
      const halkalar = [];
      for (let k = 0; k < lv; k++) {
        const pad = k * KEEP_PAD;
        const x0 = B0.x0 - pad + 95, x1 = B0.x1 + pad - 95;
        const y0 = B0.y0 - pad + 85, y1 = B0.y1 + pad - 85;
        if (x1 - x0 < 120 || y1 - y0 < 100) continue;
        halkalar.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
      if (!halkalar.length) return [[B0.x0 + 95, B0.y0 + 85], [B0.x1 - 95, B0.y1 - 85]];
      if (g.patRing === undefined) {  // birime bir halka ata (bantlara eşit dağıl)
        g.patRing = (G.garrisonUnits.filter(u => u.garrisonOf === site).indexOf(g) + halkalar.length) % halkalar.length;
      }
      return halkalar[g.patRing % halkalar.length];
    }
    const isV = site === 'village';
    const cx = isV ? CAMPFIRE.x : OUTPOSTS[site].x, cy = isV ? CAMPFIRE.y : OUTPOSTS[site].y;
    const op = G.outposts[site];
    const r = isV ? (G.palisade.built ? palR() - 85 : 170) : (op && op.wall ? opWallR(op) - 70 : 150);
    const pts = [];
    for (let a = 0; a < TAU - 0.01; a += TAU / 8) pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    return pts;
  }
  for (const g of G.garrisonUnits) {
    const GC = SOLDIER_CLS[g.cls || 'sword'];
    g.cd = Math.max(0, g.cd - dt); g.swing = Math.max(0, g.swing - dt); g.flash = Math.max(0, g.flash - dt);
    const O = OUTPOSTS[g.garrisonOf];
    let best = null, bd = 1e9;
    for (const e of G.enemies) {
      if (dist(e.x, e.y, O.x, O.y) > 420) continue; // karakoldan uzağı kovalama
      const de = dist(g.x, g.y, e.x, e.y);
      if (de < bd) { bd = de; best = e; }
    }
    if (best) {
      g.dir = Math.atan2(best.y - g.y, best.x - g.x);
      if (GC.ranged && bd < 130) { // okçu garnizon geri çekilir
        const [nx2, ny2] = collide(g.x - Math.cos(g.dir) * GC.speed * dt, g.y - Math.sin(g.dir) * GC.speed * dt, 12);
        g.x = nx2; g.y = ny2; g.walk += dt * 10;
      } else if (bd > GC.range) {
        navMove(g, best.x, best.y, GC.speed, dt, 12, false);
        g.walk += dt * 10;
        if ((g.nvDead || 0) > 3) navReset(g);   // köşede kilitlenme: devriyeye dön
      } else if (g.cd <= 0) {
        g.cd = GC.cd; g.swing = 0.18;
        const gdmg = g.tdmg || GC.dmg;
        if (GC.ranged) { G.arrows.push({ x: g.x, y: g.y - 22, tgt: best, dir: g.dir, dmg: gdmg, life: 0, speed: 500, owner: g }); SFX.arrow(); }
        else damageEnemy(best, gdmg, g.x, g.y, false, g); // garnizon askeri de XP biriktirir
      }
    } else {
      // devriye: rota noktaları arasında tur at, nokta başında kısa nöbet duruşu
      if ((g.patPause || 0) > 0) g.patPause -= dt;
      else {
        const pts = sitePatrolPoints(g.garrisonOf, g);
        if (g.patI === undefined || g.patI >= pts.length * 4) { // en yakın noktadan başla
          let bi = 0, bdp = 1e9;
          pts.forEach((pt2, ix) => { const dp = dist(g.x, g.y, pt2[0], pt2[1]); if (dp < bdp) { bdp = dp; bi = ix; } });
          g.patI = bi; g.patDir = Math.random() < 0.5 ? 1 : -1;
        }
        const pt = pts[((g.patI % pts.length) + pts.length) % pts.length];
        const dd = dist(g.x, g.y, pt[0], pt[1]);
        if (dd > 24) {
          navMove(g, pt[0], pt[1], 72, dt, 12, false);
          g.walk += dt * 6;
          // engel takibi de sökemiyorsa sıradaki devriye noktasına geç
          if ((g.nvDead || 0) > 2.6) { g.patI += g.patDir; navReset(g); }
        } else {
          g.patI += g.patDir;
          g.patPause = rr(0.6, 2.2);
          navReset(g);
        }
      }
      if (g.hp < g.maxHp) g.hp = Math.min(g.maxHp, g.hp + SOLDIER.regen * dt);
    }
  }

  // düşman tesisleri boş kalmasın: okçuyla dışarıdan avlanan savunucular zamanla yenilenir (boss'lar hariç)
  G.campResp = G.campResp || {};
  if (!coopSlave())
  for (const [rc, base] of [['camp1', 10], ['fort', 12], ['legion', 12]]) {
    if (G.outposts[rc]) continue; // fethedildiyse yenilenme yok
    if (rc === 'camp1' && G.camp1Destroyed) continue;
    const alive = G.enemies.filter(e => e.camp === rc && e.type !== 'chief' && e.type !== 'commander').length;
    const rint = alive <= Math.ceil(base / 3) ? 10 : 40; // garnizon eridi: takviye seferberlik hızında
    if (alive >= base) { G.campResp[rc] = rint; continue; }
    G.campResp[rc] = (G.campResp[rc] === undefined ? rint : Math.min(G.campResp[rc], rint)) - dt;
    if (G.campResp[rc] > 0) continue;
    const sx2 = rc === 'camp1' ? CAMP1.x + rr(-140, 140) : rc === 'fort' ? rr(FORT.x0 + 120, FORT.x1 - 120) : rr(LEG.x0 + 120, LEG.x1 - 120);
    const sy2 = rc === 'camp1' ? CAMP1.y + rr(-100, 140) : rc === 'fort' ? rr(FORT.y0 + 90, FORT.y1 - 90) : rr(LEG.y0 + 80, LEG.y1 - 80);
    if (dist(sx2, sy2, p.x, p.y) > 280) { // oyuncunun gözü önünde belirmesin
      const pool = rc === 'camp1' ? ['barb', 'barb', 'archer', 'shieldbarb'] : rc === 'fort' ? ['guard'] : ['legion'];
      spawnEnemy(pool[ri(0, pool.length - 1)], sx2, sy2, rc);
      spawnDust(sx2, sy2, 6);
    }
    G.campResp[rc] = rint;
  }

  // kuşatma kampları: inşaat (%) + kurulan silahların çalışması
  for (const st of SIEGE_SITES) {
    if (G.outposts[st.id]) continue; // kale fethedildi: kuşatma bitti — silahlar anıt gibi durur, kendi kapına taş atmaz
    const S = G.sieges[st.id];
    if (Object.keys(S).length) { // kuşatma sürüyor: kale ara ara huruç yapar (şantiyeyi yık, kuşatmacıya saldır)
      st.sortieT = (st.sortieT === undefined ? rr(40, 70) : st.sortieT) - dt;
      if (st.sortieT <= 0) { st.sortieT = rr(50, 95); sortie(st); }
    }
    for (const key of Object.keys(S)) {
      const en = S[key], E = ENGINES[key];
      if (!en.done) {
        // inşaat sadece oyuncu şantiyedeyken ilerler — 50× yavaş: kuşatma artık uzun bir harekât
        if (!G.dead && dist(p.x, p.y, en.x, en.y) < 260) {
          en.prog += dt / 10; // 5× hızlandırıldı
          if (en.prog >= E.buildTime) {
            en.done = true; en.prog = E.buildTime;
            SFX.build(); banner(E.name.toUpperCase() + ' HAZIR!'); save();
          } else if (rng() < dt * 1.5) {
            spawnDust(en.x + rr(-14, 14), en.y - 8, 2);
            if (rng() < 0.4) SFX.chop();
          }
        }
        continue;
      }
      if (key === 'catapult') {
        en.cd = Math.max(0, en.cd - dt); en.arm = Math.max(0, en.arm - dt);
        if (en.cd > 0) continue;
        let target = null, td2 = E.range;
        for (const s of G.structures) {
          if (!s.alive || s.kind === 'chest' || s.kind === 'chest2' || s.kind === 'lgate' || s.kind === 'banner') continue;
          const dd = dist(en.x, en.y, s.x, s.y); if (dd < td2) { td2 = dd; target = s; }
        }
        if (!target) for (const e of G.enemies) { const dd = dist(en.x, en.y, e.x, e.y); if (dd < td2) { td2 = dd; target = e; } }
        if (target) {
          en.cd = E.rate; en.arm = 0.35;
          G.projectiles.push({ x0: en.x, y0: en.y - 20, x1: target.x, y1: target.y, t: 0, dur: 0.9 });
          tone(120, 0.25, 'triangle', 0.1, 60);
        }
      } else if (key === 'ballista') {
        en.cd = Math.max(0, en.cd - dt);
        if (en.cd > 0) continue;
        let best = null, bd = E.range;
        for (const e of G.enemies) { const dd = dist(en.x, en.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; } }
        if (best) {
          en.cd = E.rate; en.dir = Math.atan2(best.y - en.y, best.x - en.x);
          G.arrows.push({ x: en.x, y: en.y - 18, tgt: best, dir: en.dir, dmg: E.dmg, life: 0, speed: 640, big: true });
          SFX.arrow();
        }
      } else if (key === 'ram') {
        en.cd = Math.max(0, en.cd - dt); en.lunge = Math.max(0, en.lunge - dt);
        const gate = G.structures.find(s2 => s2.kind === st.gateKind);
        if (!gate || !gate.alive) continue; // kapı kırıldı — anıt gibi durur
        en.dir = Math.atan2(gate.y - en.ry, gate.x - en.rx);
        const gd = dist(en.rx, en.ry, gate.x, gate.y);
        if (gd > 62) {
          en.rx += Math.cos(en.dir) * E.speed * dt;
          en.ry += Math.sin(en.dir) * E.speed * dt;
        } else if (en.cd <= 0) {
          en.cd = E.rate; en.lunge = 0.35;
          SFX.boom(); G.shake = Math.min(G.shake + 4, 8);
          damageStructure(gate, E.dmg);
        }
      }
    }
  }

  // mermiler
  for (const pr of G.projectiles) {
    pr.t += dt / pr.dur;
    if (pr.t >= 1) {
      pr.dead = true;
      SFX.boom(); G.shake = 8; spawnDust(pr.x1, pr.y1, 16);
      for (const s of G.structures) {
        if (!s.alive || dist(pr.x1, pr.y1, s.x, s.y) >= 75) continue;
        if (s.kind === 'lgate') { addFloater(s.x, s.y - 50, 'Sekti! Koçbaşı gerek', '#ffb0a8'); continue; }
        damageStructure(s, ENGINES.catapult.dmgStruct);
      }
      for (const e of G.enemies) if (dist(pr.x1, pr.y1, e.x, e.y) < 75) damageEnemy(e, ENGINES.catapult.dmgUnit, pr.x1, pr.y1);
    }
  }
  G.projectiles = G.projectiles.filter(pr => !pr.dead);

  // telegraflar (boss şarj uyarısı)
  for (const tg of G.telegraphs) tg.t -= dt;
  G.telegraphs = G.telegraphs.filter(tg => tg.t > 0);

  // efektler
  for (const f of G.floaters) { f.t -= dt * 0.9; f.y -= 34 * dt; }
  G.floaters = G.floaters.filter(f => f.t > 0);
  for (const pa of G.particles) { pa.t -= dt; pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vy += (pa.g === undefined ? 90 : pa.g) * dt; }
  G.particles = G.particles.filter(pa => pa.t > 0);
  G.shake = Math.max(0, G.shake - dt * 18);

  // etkileşim yakınlığı
  computeNear();
  if (G.nearThing && !G.panelFor) {
    elPrompt.textContent = G.nearThing.label + '  —  [E]';
    elBtnInteract.classList.remove('hidden');
  } else {
    elPrompt.textContent = '';
    elBtnInteract.classList.add('hidden');
  }
  { const th0 = G.panelFor;
    const sticky = th0 && (th0.event || th0.gearPage || th0.armyPage || th0.friendsPage || th0.stockPage || th0.statsPage || th0.optsPage || th0.slotsPage || th0.dyn);
    if (th0 && !sticky && !G.nearThing) closePanel(); }

  // kamera (indeyken dış dünyayı gösterme)
  const camMinX = G.caveRun ? Math.min(OVERWORLD_W, WORLD.w - VW) : 0;
  G.cam.x = lerp(G.cam.x, clamp(p.x - VW / 2, camMinX, WORLD.w - VW), 1 - Math.pow(0.001, dt));
  G.cam.y = lerp(G.cam.y, clamp(p.y - VH / 2, 0, WORLD.h - VH), 1 - Math.pow(0.001, dt));

  // şifa damlaları: üstünden geçince iyileştirir
  for (const pk of G.pickups) {
    pk.t -= dt;
    if (pk.t <= 0) { pk.dead = true; continue; }
    if (!G.dead && dist(p.x, p.y, pk.x, pk.y) < 30 && p.hp < p.maxHp) {
      pk.dead = true;
      p.hp = Math.min(p.maxHp, p.hp + 30);
      addFloater(p.x, p.y - 52, '+30 ❤️', '#57d364', 18);
      tone(680, 0.15, 'sine', 0.1, 220);
      spawnParts(p.x, p.y - 20, 6, { colors: ['#57d364', '#a8f0b0'], v: 35, life: 0.6, g: -25, r: 2.5 });
    }
  }
  G.pickups = G.pickups.filter(pk => !pk.dead);

  // ortam FX: konak ocağının korları + oyuncu ayak tozu
  if (rng() < dt * 5 && dist(p.x, p.y, CAMPFIRE.x, CAMPFIRE.y) < VW) {
    G.particles.push({ x: CAMPFIRE.x + rr(-6, 6), y: CAMPFIRE.y + 22, vx: rr(-12, 12), vy: rr(-55, -30), t: rr(0.5, 1.1), max: 1.1, r: rr(1.5, 3), c: rng() < 0.5 ? '#ff9a2e' : '#ffd257', g: -20 });
  }
  if (p.moving && rng() < dt * 7) {
    G.particles.push({ x: p.x + rr(-6, 6), y: p.y + rr(-2, 2), vx: rr(-15, 15), vy: rr(-20, -6), t: 0.35, max: 0.35, r: rr(1.5, 3), g: 30 });
  }
  G.hurtFlash = Math.max(0, G.hurtFlash - dt);

  // savaş durumu (müzik geçişi için)
  G.combat = !G.dead && G.enemies.some(e => e.aggro && dist(e.x, e.y, p.x, p.y) < 650);

  // istatistik & başarımlar
  G.stats.playtime += dt;
  G.achT = (G.achT || 0) + dt;
  if (G.achT > 2) { G.achT = 0; checkAchievements(); }

  // ZAFER: üç yer de fethedildiyse (bayraklardan kontrol — en sağlam kaynak)
  if (!G.victoryShown && !VISIT && !ISLAND && G.camp1Destroyed && G.chestOpened && G.legionConquered) {
    createOutpost('camp1'); createOutpost('fort'); createOutpost('legion'); // güvence (idempotent)
    G.victoryShown = true;
    const result = calcDynasty();
    G.dynasty += result.total;
    worldConquer(); // vilayet cihan haritasında fethedildi olarak işaretlenir
    showVictory(result);
    save();
  }

  { // co-op durum rozeti
    const cb = $('coopBadge');
    if (cb) {
      const n = coopPeerCount();
      const show = !!NETP && (n > 0 || (CO.mode === 'visit' && !CO.isHost) || CO.mode === 'island');
      cb.classList.toggle('hidden', !show);
      if (show) {
        const names = Object.values(CO.peers).map(p => p.name).join(', ');
        const txt = n > 0
          ? '🟢 ' + names + ' · aynı haritada' + (CO.isHost ? ' (dünyayı sen yönetiyorsun)' : '')
          : (CO.mode === 'visit' && !CO.isHost ? '📷 Ev sahibi çevrimdışı' : '⚪ Yoldaş bekleniyor');
        if (cb.textContent !== txt) cb.textContent = txt;
        cb.classList.toggle('solo', n === 0);
      }
    }
  }
  G.dotT = (G.dotT || 0) + dt;
  if (G.dotT > 0.6) { G.dotT = 0; refreshHudDots(); }
  checkQuests();
  updateHUD();
  if (mapOpen && G.t - mapLastDraw > 0.3) drawMap();
}

// ---------- Zemin ön-render ----------
let groundCv = null;
function renderGround() {
  groundCv = document.createElement('canvas');
  const S = 0.5; // yarı çözünürlük yeterli
  groundCv.width = WORLD.w * S; groundCv.height = WORLD.h * S;
  const g = groundCv.getContext('2d');
  g.scale(S, S);
  // zemin (bölge temasına göre)
  const grad = g.createLinearGradient(0, 0, WORLD.w, WORLD.h);
  grad.addColorStop(0, THEME.gA); grad.addColorStop(1, THEME.gB);
  g.fillStyle = grad; g.fillRect(0, 0, WORLD.w, WORLD.h);
  // lekeler
  for (let i = 0; i < 950; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(120,80,30,0.06)' : 'rgba(255,240,190,0.07)';
    g.beginPath(); g.ellipse(rr(0, WORLD.w), rr(0, WORLD.h), rr(20, 90), rr(14, 60), rr(0, TAU), 0, TAU); g.fill();
  }
  // yol ağı: köy → harabeler kavşağı → diğer bölgeler
  g.strokeStyle = 'rgba(240,215,150,0.5)'; g.lineCap = 'round'; g.lineWidth = 46;
  const road = (x1, y1, mx, my, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke(); };
  road(CAMPFIRE.x, CAMPFIRE.y, 1500, 1650, RUINS.x, RUINS.y);                          // köy → harabeler
  road(RUINS.x, RUINS.y, 2000, 1000, FOREST.x, FOREST.y);                              // harabeler → orman
  road(CAMPFIRE.x, CAMPFIRE.y + 60, 1000, 2300, QUARRY.x, QUARRY.y);                   // köy → taş ocağı
  road(QUARRY.x, QUARRY.y, 2000, 2550, MERCHANT.x, MERCHANT.y);                        // ocak → tüccar
  road(RUINS.x, RUINS.y, 2450, 1950, MERCHANT.x, MERCHANT.y);                          // harabeler → tüccar
  road(RUINS.x, RUINS.y, 2900, 1050, CAMP1.x - 60, CAMP1.y + 160);                     // harabeler → barbar kampı
  road(MERCHANT.x, MERCHANT.y, 3300, 2500, FORT.x0 - 200, (FORT.gateY0 + FORT.gateY1) / 2); // tüccar → taş kale
  road(CAMP1.x, CAMP1.y + 100, 3600, 850, LEG.cx, LEG.y1 + 190);                       // kamp → lejyon
  // köy zemini
  g.fillStyle = 'rgba(160,110,55,0.25)';
  g.beginPath(); g.ellipse(CAMPFIRE.x, CAMPFIRE.y, 250, 210, 0, 0, TAU); g.fill();
  // kale iç zemini
  g.fillStyle = 'rgba(130,130,135,0.3)';
  g.fillRect(FORT.x0, FORT.y0, FORT.x1 - FORT.x0, FORT.y1 - FORT.y0);
  // lejyon karargâhı iç zemini (düzgün taş döşeme)
  g.fillStyle = 'rgba(150,145,150,0.38)';
  g.fillRect(LEG.x0, LEG.y0, LEG.x1 - LEG.x0, LEG.y1 - LEG.y0);
  g.strokeStyle = 'rgba(100,95,100,0.25)'; g.lineWidth = 2;
  for (let x = LEG.x0 + 60; x < LEG.x1; x += 60) { g.beginPath(); g.moveTo(x, LEG.y0); g.lineTo(x, LEG.y1); g.stroke(); }
  for (let y = LEG.y0 + 60; y < LEG.y1; y += 60) { g.beginPath(); g.moveTo(LEG.x0, y); g.lineTo(LEG.x1, y); g.stroke(); }
  // su
  const wgrad = g.createLinearGradient(0, 0, 260, 0);
  wgrad.addColorStop(0, THEME.w0); wgrad.addColorStop(1, THEME.w1);
  g.fillStyle = wgrad;
  g.beginPath(); g.moveTo(0, 0);
  for (let y = 0; y <= WORLD.h; y += 24) g.lineTo(shoreX(y), y);
  g.lineTo(0, WORLD.h); g.closePath(); g.fill();
  // kıyı köpüğü
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 5;
  g.beginPath(); for (let y = 0; y <= WORLD.h; y += 24) { const x = shoreX(y); y === 0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  // sığlık
  g.strokeStyle = 'rgba(180,240,225,0.35)'; g.lineWidth = 16;
  g.beginPath(); for (let y = 0; y <= WORLD.h; y += 24) { const x = shoreX(y) - 18; y === 0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  // kıyı bitkileri
  for (let i = 0; i < 140; i++) {
    const y = rr(0, WORLD.h), x = shoreX(y) + rr(18, 70);
    g.strokeStyle = 'rgba(80,140,60,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + rr(-6, 6), y - 14, x + rr(-10, 10), y - 22); g.stroke();
  }
  // mağara şeridi: zifiri kaya + odanın taş zemini
  g.fillStyle = '#0d0a16'; g.fillRect(OVERWORLD_W, 0, WORLD.w - OVERWORLD_W, WORLD.h);
  const A = CAVE_AREA;
  g.fillStyle = '#1b1628'; g.fillRect(A.x0, A.y0, A.w, A.h);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(8,5,16,0.3)' : 'rgba(120,102,160,0.09)';
    g.beginPath(); g.ellipse(A.x0 + rng() * A.w, A.y0 + rng() * A.h, rr(14, 60), rr(10, 36), rr(0, TAU), 0, TAU); g.fill();
  }
}

// ---------- Çizim yardımcıları ----------
function drawShadow(x, y, rx, ry) {
  ctx.fillStyle = 'rgba(60,35,10,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 3, rx, ry, 0, 0, TAU); ctx.fill();
}
function drawWarrior(w, opts) {
  const { x, y } = w;
  const sc = opts.scale || 1;
  const facingLeft = Math.cos(w.dir || 0) < 0;
  drawShadow(x, y, (opts.mount ? 20 : 14) * sc, 6 * sc);
  if (opts.foe) { // düşman işareti: kızıl zemin halkası
    ctx.strokeStyle = 'rgba(230,60,45,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 1, 15 * sc, 6.5 * sc, 0, 0, TAU); ctx.stroke();
  }
  ctx.save(); ctx.translate(x, y); ctx.scale(sc * (facingLeft ? -1 : 1), sc);
  if (opts.mount) { // at: gövde + boyun/baş + bacak salınımı + yele/kuyruk, binici üstte
    const hb = Math.sin(w.walk || 0) * 4;
    ctx.fillStyle = opts.horse || '#7a5230';
    ctx.fillRect(-15, -10 + Math.max(0, hb * 0.5), 4.5, 12 - Math.max(0, hb * 0.5));
    ctx.fillRect(-5, -10 + Math.max(0, -hb * 0.4), 4.5, 12 - Math.max(0, -hb * 0.4));
    ctx.fillRect(6, -10 + Math.max(0, -hb * 0.5), 4.5, 12 - Math.max(0, -hb * 0.5));
    ctx.fillRect(14, -10 + Math.max(0, hb * 0.4), 4.5, 12 - Math.max(0, hb * 0.4));
    ctx.beginPath(); ctx.ellipse(0, -16, 19, 9, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(13, -20); ctx.lineTo(24, -33); ctx.lineTo(29, -28); ctx.lineTo(17, -13); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(27, -32, 6, 3.8, 0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3f2a14';
    ctx.beginPath(); ctx.moveTo(20, -34); ctx.quadraticCurveTo(14, -30, 15, -22); ctx.lineTo(19, -26); ctx.closePath(); ctx.fill(); // yele
    ctx.beginPath(); ctx.moveTo(-19, -18); ctx.quadraticCurveTo(-27, -10 + hb, -23, -2); ctx.quadraticCurveTo(-21, -10, -18, -14); ctx.closePath(); ctx.fill(); // kuyruk
    ctx.translate(0, -17); // binici at sırtında
  }
  // bacaklar
  const lp = Math.sin(w.walk || 0) * 5;
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(-7, -14 + Math.max(0, lp * 0.4), 5, 14 - Math.max(0, lp * 0.4));
  ctx.fillRect(2, -14 + Math.max(0, -lp * 0.4), 5, 14 - Math.max(0, -lp * 0.4));
  // gövde
  ctx.fillStyle = opts.cloth;
  ctx.beginPath(); ctx.roundRect(-10, -34, 20, 22, 6); ctx.fill();
  if (opts.belt) { ctx.fillStyle = '#3f2a14'; ctx.fillRect(-10, -18, 20, 4); }
  // kafa
  ctx.fillStyle = opts.skin || '#e8b78a';
  ctx.beginPath(); ctx.arc(0, -41, 8, 0, TAU); ctx.fill();
  // kask
  if (opts.helmet) {
    ctx.fillStyle = opts.helmet;
    ctx.beginPath(); ctx.arc(0, -43, 8.5, Math.PI, 0); ctx.fill();
    if (opts.crest) { ctx.fillStyle = opts.crest; ctx.beginPath(); ctx.roundRect(-2.5, -56, 5, 13, 2); ctx.fill(); }
  } else {
    ctx.fillStyle = '#4a2f1a'; ctx.beginPath(); ctx.arc(0, -44, 7.5, Math.PI * 1.05, -0.15); ctx.fill(); // saç
  }
  // iş aleti (köylüler): balta / kazma / levye — çalışırken sallanır
  if (opts.tool) {
    const swingT2 = (w.swing || 0) / 0.18;
    const tAng = swingT2 > 0 ? lerp(1.35, -0.6, swingT2) : 0.75;
    ctx.save(); ctx.translate(8, -24); ctx.rotate(tAng);
    ctx.fillStyle = '#7a4f2a'; ctx.fillRect(-1.5, -15, 3, 17); // sap
    if (opts.tool === 'axe') {
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath(); ctx.moveTo(-1, -15); ctx.lineTo(-8.5, -12); ctx.lineTo(-1, -8.5); ctx.closePath(); ctx.fill();
    } else if (opts.tool === 'pick') {
      ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, -10, 6.5, Math.PI * 0.95, Math.PI * 2.05); ctx.stroke();
    } else {
      ctx.fillStyle = '#8b8f98'; ctx.fillRect(-4.5, -17, 9, 4); // levye başı
    }
    ctx.restore();
  }
  // asa (şaman): tepesinde yeşil küre
  if (opts.staff) {
    ctx.save(); ctx.translate(9, -26); ctx.rotate(0.3);
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-1.5, -20, 3, 24);
    ctx.fillStyle = '#57d364'; ctx.beginPath(); ctx.arc(0, -22, 4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.4 + Math.sin(G.t * 5) * 0.2;
    ctx.beginPath(); ctx.arc(0, -22, 7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
  }
  // yaban hayvanı: kulaklar + pençe (silahsız iri gövde)
  if (opts.beast) {
    ctx.fillStyle = opts.cloth || '#5a4028';
    ctx.beginPath(); ctx.arc(-6, -47, 3.5, 0, TAU); ctx.arc(6, -47, 3.5, 0, TAU); ctx.fill(); // kulaklar
  }
  // yay (okçular)
  if (opts.bow) {
    ctx.save(); ctx.translate(10, -26);
    const drawT = (w.swing || 0) > 0 ? 3 : 0; // atışta gerilme
    ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 10, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(-1.15) * 10, Math.sin(-1.15) * 10);
    ctx.lineTo(-drawT, 0);
    ctx.lineTo(Math.cos(1.15) * 10, Math.sin(1.15) * 10);
    ctx.stroke();
    ctx.restore();
  }
  // silah (savuruş animasyonu) — ırka göre değişir; köylü/okçu/şaman/hayvanlarda yok
  if (!opts.noWeapon && !opts.bow && !opts.staff && !opts.beast) {
  const swingT = (w.swing || 0) / 0.18;
  const ang = swingT > 0 ? lerp(1.4, -0.7, swingT) : ((w.chargeT || 0) > 0.12 ? -1.15 : 0.5); // şarjda silah yukarı
  ctx.save(); ctx.translate(9, -26); ctx.rotate(ang);
  const wp = opts.weapon || 'sword';
  if (wp === 'spear') {           // mızrak: uzun sap + yaprak uç
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-1.2, 6, 2.4, -34);
    ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(3.2, -28); ctx.lineTo(0, -25); ctx.lineTo(-3.2, -28); ctx.closePath(); ctx.fill();
  } else if (wp === 'katana') {   // katana: ince, uzun, hafif eğik
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(-1.2, -2, 2.4, 7);
    ctx.fillStyle = '#c9a24a'; ctx.fillRect(-3, -3, 6, 2);
    ctx.strokeStyle = '#e0e6ee'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(3.5, -14, 1.5, -27); ctx.stroke();
  } else if (wp === 'trident') {  // üç dişli gladyatör yabası
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-1.4, 6, 2.8, -30);
    ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, -24); ctx.lineTo(-5, -32); ctx.moveTo(0, -24); ctx.lineTo(0, -34); ctx.moveTo(5, -24); ctx.lineTo(5, -32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -24); ctx.lineTo(6, -24); ctx.stroke();
  } else if (wp === 'club') {     // taş topuz
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-1.8, 4, 3.6, -20);
    ctx.fillStyle = '#8f8f89'; ctx.beginPath(); ctx.ellipse(0, -20, 6, 8, 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6e6e68'; ctx.beginPath(); ctx.arc(-2, -23, 1.6, 0, TAU); ctx.arc(3, -18, 1.6, 0, TAU); ctx.fill();
  } else if (wp === 'scimitar') { // eğri pala
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-1.5, -2, 3, 8);
    ctx.strokeStyle = '#d8dde5'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(8, -10, 4, -21); ctx.stroke();
  } else if (wp === 'dagger') {   // gölge hançeri
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(-1.3, -2, 2.6, 6);
    ctx.fillStyle = '#8a7ab0'; ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(2, -2); ctx.lineTo(0, -14); ctx.closePath(); ctx.fill();
  } else if (wp === 'claw') {     // kurt pençesi: üç tırnak
    ctx.strokeStyle = '#d8dde5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-6, -9); ctx.moveTo(0, 0); ctx.lineTo(0, -11); ctx.moveTo(3, 0); ctx.lineTo(6, -9); ctx.stroke();
  } else if (wp === 'ice') {      // buz kristal mızrağı
    ctx.fillStyle = '#7a5230'; ctx.fillRect(-1.2, 6, 2.4, -22);
    ctx.fillStyle = '#a8d8f0'; ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(4, -20); ctx.lineTo(0, -16); ctx.lineTo(-4, -20); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, -22, 6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  } else {                        // kılıç (varsayılan)
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-1.5, -2, 3, 8);           // kabza
    ctx.fillStyle = '#c9ced6'; ctx.beginPath();
    ctx.moveTo(-2.5, -2); ctx.lineTo(2.5, -2); ctx.lineTo(1.5, -22); ctx.lineTo(-1.5, -22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8f6b30'; ctx.fillRect(-4.5, -3, 9, 2.5);          // siper
  }
  ctx.restore();
  }
  // kalkan (kalkanlı askerler)
  if (opts.shield) {
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.arc(11, -24, 8.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8f6b30'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(11, -24, 3, 0, TAU); ctx.fill();
  }
  // hasar parlaması
  if ((w.flash || 0) > 0) {
    ctx.fillStyle = `rgba(255,255,255,${w.flash * 5})`;
    ctx.beginPath(); ctx.ellipse(0, -30, 13, 20, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // can barı (hasarlıysa)
  if (opts.hpBar && w.hp < w.maxHp) {
    const bw = 34 * sc;
    ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(x - bw / 2, y - 58 * sc, bw, 5);
    ctx.fillStyle = opts.hpColor || '#e8506a'; ctx.fillRect(x - bw / 2 + 1, y - 58 * sc + 1, (bw - 2) * Math.max(0, w.hp / w.maxHp), 3);
  }
}
function drawTree(n) {
  if (!n.alive) { // kütük
    drawShadow(n.x, n.y, 10, 5);
    ctx.fillStyle = '#8a5c33'; ctx.beginPath(); ctx.ellipse(n.x, n.y - 4, 8, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9a06a'; ctx.beginPath(); ctx.ellipse(n.x, n.y - 6, 6, 4, 0, 0, TAU); ctx.fill();
    return;
  }
  drawShadow(n.x, n.y, 20, 8);
  ctx.fillStyle = '#7a4f2a'; ctx.fillRect(n.x - 4, n.y - 26, 8, 26);
  const s = 1 + (n.seed - 0.5) * 0.3;
  ctx.fillStyle = THEME.leaf1;
  ctx.beginPath(); ctx.arc(n.x - 10 * s, n.y - 34 * s, 15 * s, 0, TAU); ctx.arc(n.x + 10 * s, n.y - 36 * s, 14 * s, 0, TAU); ctx.fill();
  ctx.fillStyle = THEME.leaf2;
  ctx.beginPath(); ctx.arc(n.x, n.y - 46 * s, 16 * s, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,210,0.25)';
  ctx.beginPath(); ctx.arc(n.x - 5 * s, n.y - 50 * s, 8 * s, 0, TAU); ctx.fill();
}
function drawRock(n) {
  if (!n.alive) {
    drawShadow(n.x, n.y, 10, 4);
    ctx.fillStyle = '#8f8f89';
    ctx.beginPath(); ctx.arc(n.x - 6, n.y - 3, 4, 0, TAU); ctx.arc(n.x + 5, n.y - 2, 3, 0, TAU); ctx.fill();
    return;
  }
  drawShadow(n.x, n.y, 20, 8);
  const s = 1 + (n.seed - 0.5) * 0.35;
  ctx.fillStyle = '#9a9a94';
  ctx.beginPath();
  ctx.moveTo(n.x - 18 * s, n.y); ctx.lineTo(n.x - 12 * s, n.y - 20 * s); ctx.lineTo(n.x + 2, n.y - 26 * s);
  ctx.lineTo(n.x + 16 * s, n.y - 14 * s); ctx.lineTo(n.x + 18 * s, n.y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b5b5ae';
  ctx.beginPath(); ctx.moveTo(n.x - 12 * s, n.y - 20 * s); ctx.lineTo(n.x + 2, n.y - 26 * s); ctx.lineTo(n.x + 4, n.y - 12 * s); ctx.closePath(); ctx.fill();
}
function drawScrap(n) {
  if (!n.alive) return;
  drawShadow(n.x, n.y, 16, 6);
  ctx.save(); ctx.translate(n.x, n.y);
  ctx.fillStyle = '#7d7d84'; ctx.fillRect(-13, -8, 26, 8);
  ctx.fillStyle = '#94564a'; ctx.save(); ctx.rotate(-0.3); ctx.fillRect(-14, -14, 22, 5); ctx.restore();
  ctx.fillStyle = '#6a6a72'; ctx.save(); ctx.rotate(0.25); ctx.fillRect(-6, -16, 18, 5); ctx.restore();
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🔩', 0, -16);
  ctx.restore();
}
function drawBuilding(b) {
  const { x, y } = b;
  if (b.type === 'campfire') {
    // KÖY KONAĞI: merkez bina — mavi çatı, sancak, gece ışıldayan pencereler, önünde şifa ocağı
    drawShadow(x, y, 44, 14);
    // taş taban kat
    ctx.fillStyle = '#9a8a78'; ctx.fillRect(x - 36, y - 26, 72, 26);
    // ahşap üst kat
    ctx.fillStyle = '#c9b08a'; ctx.fillRect(x - 30, y - 48, 60, 22);
    ctx.strokeStyle = 'rgba(90,60,30,0.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(x - 36, y - 26, 72, 26); ctx.strokeRect(x - 30, y - 48, 60, 22);
    // kapı + pencereler (gece sıcak ışık)
    ctx.fillStyle = '#5a3a1e'; ctx.beginPath(); ctx.roundRect(x - 9, y - 22, 18, 22, [7, 7, 0, 0]); ctx.fill();
    ctx.fillStyle = G.night ? '#ffd257' : '#4a3a24';
    ctx.fillRect(x - 29, y - 20, 10, 9); ctx.fillRect(x + 19, y - 20, 10, 9);
    ctx.fillRect(x - 23, y - 44, 9, 8); ctx.fillRect(x + 14, y - 44, 9, 8);
    // mavi çatı (sorgucunla aynı renk — senin merkezin)
    ctx.fillStyle = '#3f6f9e';
    ctx.beginPath(); ctx.moveTo(x - 42, y - 46); ctx.lineTo(x, y - 74); ctx.lineTo(x + 42, y - 46); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(25,35,55,0.5)'; ctx.stroke();
    // sancak direği + mavi flama
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x - 1.5, y - 97, 3, 25);
    const wv = Math.sin(G.t * 3) * 2.5;
    ctx.fillStyle = '#3fa8d8';
    ctx.beginPath(); ctx.moveTo(x + 1.5, y - 95); ctx.quadraticCurveTo(x + 13 + wv, y - 92, x + 22 + wv, y - 89);
    ctx.lineTo(x + 1.5, y - 84); ctx.closePath(); ctx.fill();
    // önündeki şifa ocağı
    const hx = x, hy = y + 32;
    ctx.fillStyle = '#8f8f89';
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.arc(hx + Math.cos(a) * 11, hy + Math.sin(a) * 6, 3, 0, TAU); ctx.fill(); }
    const f = Math.sin(G.t * 12) * 2.5 + Math.sin(G.t * 7.3) * 1.5;
    const glow = ctx.createRadialGradient(hx, hy - 8, 3, hx, hy - 8, 36);
    glow.addColorStop(0, 'rgba(255,180,60,0.45)'); glow.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy - 8, 36, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff9a2e';
    ctx.beginPath(); ctx.moveTo(hx - 6, hy); ctx.quadraticCurveTo(hx - 4 + f, hy - 15 - f, hx, hy - 18 - f); ctx.quadraticCurveTo(hx + 4 + f * 0.5, hy - 12, hx + 6, hy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd257';
    ctx.beginPath(); ctx.moveTo(hx - 3, hy); ctx.quadraticCurveTo(hx + f * 0.4, hy - 9, hx, hy - 11); ctx.quadraticCurveTo(hx + 2, hy - 6, hx + 3, hy); ctx.closePath(); ctx.fill();
    // etkileşim çağrısı: süzülen ferman
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('📜', x, y - 102 + Math.sin(G.t * 2.5) * 3);
    return;
  }
  const B = BUILDINGS[b.type];
  // yıkık hali: moloz + çökmüş çatı
  if (b.ruined) {
    drawShadow(x, y, 34, 12);
    ctx.fillStyle = '#6f6152'; ctx.fillRect(x - 28, y - 16, 56, 16);
    ctx.fillStyle = '#54473a';
    ctx.beginPath(); ctx.moveTo(x - 32, y - 14); ctx.lineTo(x - 4, y - 30); ctx.lineTo(x + 26, y - 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a7a66'; ctx.beginPath(); ctx.arc(x - 16, y - 4, 5, 0, TAU); ctx.arc(x + 12, y - 6, 6, 0, TAU); ctx.fill();
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🔧', x, y - 36 + Math.sin(G.t * 3) * 2);
    return;
  }
  if (b.type === 'watchtower') {
    drawShadow(x, y, 20, 8);
    ctx.fillStyle = '#9a9184'; ctx.fillRect(x - 12, y - 44, 24, 44);           // taş gövde
    ctx.strokeStyle = 'rgba(70,60,45,0.45)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 12, y - 44, 24, 44);
    ctx.beginPath(); ctx.moveTo(x - 12, y - 22); ctx.lineTo(x + 12, y - 22); ctx.stroke();
    ctx.fillStyle = '#8a5c33'; ctx.fillRect(x - 17, y - 52, 34, 8);            // ahşap platform
    ctx.fillStyle = '#6e4a26';
    ctx.beginPath(); ctx.moveTo(x - 16, y - 52); ctx.lineTo(x, y - 70); ctx.lineTo(x + 16, y - 52); ctx.closePath(); ctx.fill(); // çatı
    ctx.fillStyle = '#2f2418'; ctx.fillRect(x - 3, y - 36, 6, 9);              // mazgal
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(B.icon, x, y - 76);
    if (b.lv > 1) { ctx.fillStyle = '#ffd257'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('★'.repeat(b.lv - 1), x, y - 90); }
    drawBuildingBar(b, 66);
    return;
  }
  drawShadow(x, y, 34, 12);
  // duvarlar
  ctx.fillStyle = b.type === 'blacksmith' ? '#9a8a78' : '#c9b08a';
  ctx.fillRect(x - 28, y - 34, 56, 34);
  ctx.strokeStyle = 'rgba(90,60,30,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(x - 28, y - 34, 56, 34);
  // kapı
  ctx.fillStyle = '#5a3a1e'; ctx.beginPath(); ctx.roundRect(x - 8, y - 20, 16, 20, [6, 6, 0, 0]); ctx.fill();
  // çatı
  ctx.fillStyle = B.roof;
  ctx.beginPath(); ctx.moveTo(x - 36, y - 32); ctx.lineTo(x, y - 58); ctx.lineTo(x + 36, y - 32); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,10,0.4)'; ctx.stroke();
  // ikon ve seviye
  ctx.font = '17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(B.icon, x, y - 66);
  if (b.lv > 1) {
    ctx.fillStyle = '#ffd257'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText('★'.repeat(b.lv - 1), x, y - 80);
  }
  drawBuildingBar(b, 64);
}
function drawBuildingBar(b, yOff) {
  if (b.ruined || b.hp >= b.maxHp) return;
  const bw = 46;
  ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(b.x - bw / 2, b.y - yOff, bw, 5);
  ctx.fillStyle = '#e8a13d'; ctx.fillRect(b.x - bw / 2 + 1, b.y - yOff + 1, (bw - 2) * Math.max(0, b.hp / b.maxHp), 3);
}
function drawPlot(p2) { // zemin katmanı: sadece kesikli elips
  const Bp = p2.plan && BUILDINGS[p2.plan];
  if (Bp && Bp.req && !G.built[Bp.req]) return; // önkoşul binası kurulana dek bu arsa GİZLİ
  ctx.save();
  ctx.strokeStyle = 'rgba(90,60,20,0.55)'; ctx.setLineDash([7, 6]); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(p2.x, p2.y - 8, 32, 20, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
// Ortak tabela çizimi (EN ÜST katman): koyu yuvarlak kutu + renkli metin
function drawTag(x, y, line, textC, borderC) {
  ctx.save(); ctx.textAlign = 'center';
  ctx.font = 'bold 10.5px sans-serif';
  const w = ctx.measureText(line).width + 14;
  ctx.fillStyle = 'rgba(30,24,14,0.8)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, 16, 5); ctx.fill();
  ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = textC;
  ctx.fillText(line, x, y + 12);
  ctx.restore();
}
const remainText = (need, paid) => {
  const parts = [];
  for (const [k, v] of Object.entries(need)) {
    const rem = v - ((paid || {})[k] || 0);
    if (rem > 0) parts.push(rem + ((RES_DEF.find(r => r[0] === k) || [])[1] || ''));
  }
  return parts.length ? parts.join(' ') : '✓';
};
function drawPlotSign(p2) { // üst katman: hayalet ikon + kalan maliyet
  const B = p2.plan && BUILDINGS[p2.plan];
  if (B && B.req && !G.built[B.req]) return;
  ctx.save(); ctx.textAlign = 'center';
  if (!B) { ctx.font = '16px sans-serif'; ctx.globalAlpha = 0.8; ctx.fillText('🔨', p2.x, p2.y - 10 + Math.sin(G.t * 2.5) * 2); ctx.restore(); return; }
  ctx.font = '19px sans-serif'; ctx.globalAlpha = 0.9;
  ctx.fillText(B.icon, p2.x, p2.y - 14 + Math.sin(G.t * 2.5) * 2);
  ctx.globalAlpha = 1; ctx.restore();
  drawTag(p2.x, p2.y + 6, remainText(bcost(B.cost), p2.paid), '#ffe9b0', 'rgba(255,217,126,0.35)');
}
function drawStructure(s) {
  if (!s.alive) {
    if (s.kind === 'gate') { // yıkık kapı
      ctx.fillStyle = '#6a5138';
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.rotate(0.4); ctx.fillRect(-14, -6, 24, 7); ctx.rotate(-0.9); ctx.fillRect(-12, 4, 22, 6);
      ctx.restore();
    } else if (s.kind === 'lgate') { // parçalanmış çelik kapı
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.fillStyle = '#4a4038';
      ctx.rotate(0.35); ctx.fillRect(-34, -8, 30, 9);
      ctx.rotate(-0.8); ctx.fillRect(6, 2, 28, 9);
      ctx.fillStyle = '#8b8f98'; ctx.rotate(0.5); ctx.fillRect(-12, -4, 20, 4);
      ctx.restore();
    } else if (s.kind === 'banner') { // yağmalanmış sancak: devrik direk
      drawShadow(s.x, s.y, 14, 5);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(1.1);
      ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-3, -46, 5, 46);
      ctx.fillStyle = 'rgba(120,60,45,0.8)';
      ctx.beginPath(); ctx.moveTo(2, -42); ctx.lineTo(20, -36); ctx.lineTo(2, -28); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🔧', s.x, s.y - 20 + Math.sin(G.t * 3) * 2);
    }
    return;
  }
  if (s.kind === 'totem' || s.kind === 'itotem') {
    drawShadow(s.x, s.y, 14, 6);
    ctx.fillStyle = s.kind === 'itotem' ? '#5a3a52' : '#7a4f2a'; ctx.fillRect(s.x - 7, s.y - 66, 14, 66);
    ctx.fillStyle = '#94564a'; ctx.fillRect(s.x - 9, s.y - 52, 18, 8); ctx.fillRect(s.x - 9, s.y - 30, 18, 8);
    ctx.fillStyle = '#e8d9c0'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💀', s.x, s.y - 68);
    ctx.fillStyle = '#ffd257'; ctx.beginPath(); ctx.arc(s.x - 3, s.y - 44, 2, 0, TAU); ctx.arc(s.x + 4, s.y - 44, 2, 0, TAU); ctx.fill();
  } else if (s.kind === 'gate') {
    ctx.fillStyle = '#6a5138'; ctx.fillRect(s.x - 13, FORT.gateY0, 26, FORT.gateY1 - FORT.gateY0);
    ctx.fillStyle = '#54402c';
    for (let i = 0; i < 4; i++) ctx.fillRect(s.x - 13 + i * 7, FORT.gateY0, 2, FORT.gateY1 - FORT.gateY0);
    ctx.fillStyle = '#3a3a40'; ctx.fillRect(s.x - 13, FORT.gateY0 + 20, 26, 5); ctx.fillRect(s.x - 13, FORT.gateY1 - 26, 26, 5);
  } else if (s.kind === 'lgate') {
    // çelik kapı: yatay (güney suru üzerinde)
    ctx.fillStyle = '#4a4038'; ctx.fillRect(LEG.gx0, s.y - 15, LEG.gx1 - LEG.gx0, 30);
    ctx.fillStyle = '#2f2a26';
    for (let i = 1; i < 6; i++) ctx.fillRect(LEG.gx0 + i * 20, s.y - 15, 2.5, 30);
    ctx.fillStyle = '#8b8f98';
    ctx.fillRect(LEG.gx0, s.y - 13, LEG.gx1 - LEG.gx0, 5); ctx.fillRect(LEG.gx0, s.y + 7, LEG.gx1 - LEG.gx0, 5);
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(LEG.gx0 + 12 + i * 20, s.y, 2.5, 0, TAU); ctx.fill(); }
  } else if (s.kind === 'chest2') {
    drawShadow(s.x, s.y, 20, 8);
    ctx.fillStyle = '#8a5c33'; ctx.beginPath(); ctx.roundRect(s.x - 19, s.y - 24, 38, 24, 4); ctx.fill();
    ctx.fillStyle = '#a06e3e'; ctx.beginPath(); ctx.roundRect(s.x - 19, s.y - 30, 38, 11, 5); ctx.fill();
    ctx.fillStyle = '#ffd257'; ctx.fillRect(s.x - 3, s.y - 22, 6, 11);
    ctx.fillRect(s.x - 19, s.y - 20, 38, 3);
    const sp2 = (G.t * 2) % 1;
    ctx.globalAlpha = 1 - sp2; ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif'; ctx.fillText('✦', s.x + 13, s.y - 32 - sp2 * 9); ctx.fillText('✦', s.x - 13, s.y - 28 - sp2 * 6);
    ctx.globalAlpha = 1;
  } else if (s.kind === 'banner') {
    // senin sancağın: taş kaide + direk + mavi flama
    drawShadow(s.x, s.y, 14, 6);
    ctx.fillStyle = '#8f8f89';
    ctx.beginPath(); ctx.ellipse(s.x, s.y - 2, 11, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(s.x - 2.5, s.y - 62, 5, 60);
    const wv = Math.sin(G.t * 3) * 3;
    ctx.fillStyle = '#3fa8d8';
    ctx.beginPath(); ctx.moveTo(s.x + 2, s.y - 60);
    ctx.quadraticCurveTo(s.x + 18 + wv, s.y - 55, s.x + 30 + wv, s.y - 50);
    ctx.lineTo(s.x + 2, s.y - 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd257'; ctx.beginPath(); ctx.arc(s.x, s.y - 64, 3.5, 0, TAU); ctx.fill();
  } else if (s.kind === 'cavechest') {
    drawShadow(s.x, s.y, 18, 7);
    ctx.fillStyle = '#6a5138'; ctx.beginPath(); ctx.roundRect(s.x - 16, s.y - 20, 32, 20, 3); ctx.fill();
    ctx.fillStyle = '#8a5c33'; ctx.beginPath(); ctx.roundRect(s.x - 16, s.y - 26, 32, 10, 4); ctx.fill();
    ctx.fillStyle = '#8ad8ff'; ctx.fillRect(s.x - 2.5, s.y - 18, 5, 9);
    const sp3 = (G.t * 2.5) % 1;
    ctx.globalAlpha = 1 - sp3; ctx.fillStyle = '#c9ecff';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✦', s.x + 11, s.y - 28 - sp3 * 8);
    ctx.globalAlpha = 1;
  } else if (s.kind === 'chest') {
    drawShadow(s.x, s.y, 15, 6);
    ctx.fillStyle = '#8a5c33'; ctx.beginPath(); ctx.roundRect(s.x - 14, s.y - 18, 28, 18, 3); ctx.fill();
    ctx.fillStyle = '#a06e3e'; ctx.beginPath(); ctx.roundRect(s.x - 14, s.y - 22, 28, 8, 4); ctx.fill();
    ctx.fillStyle = '#ffd257'; ctx.fillRect(s.x - 2, s.y - 16, 4, 8);
    ctx.fillRect(s.x - 14, s.y - 15, 28, 2);
    const sp = (G.t * 2) % 1;
    ctx.globalAlpha = 1 - sp; ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif'; ctx.fillText('✦', s.x + 10, s.y - 24 - sp * 8); ctx.globalAlpha = 1;
  }
  // yapı can barı
  if (s.hp < s.maxHp) {
    const bw = 52;
    const tY = (s.kind === 'totem' || s.kind === 'itotem') ? 84 : 60;
    ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(s.x - bw / 2, s.y - tY, bw, 6);
    ctx.fillStyle = '#e8506a'; ctx.fillRect(s.x - bw / 2 + 1, s.y - tY + 1, (bw - 2) * Math.max(0, s.hp / s.maxHp), 4);
  }
}
function drawProp(pr) {
  const { x, y } = pr;
  if (pr.kind === 'kneel') { // teslim olmuş komutan: diz çökmüş, beyaz bayrak
    const C = COMMANDERS[pr.cmd];
    drawShadow(x, y, 16, 6);
    ctx.save(); ctx.translate(x, y + 6); ctx.scale(1.15, 0.92); ctx.translate(-x, -(y + 6));
    drawWarrior({ x, y: y + 6, dir: 0, walk: 0, swing: 0, flash: 0, hp: 1, maxHp: 1 }, { cloth: C.cloth, scale: 1.1, noWeapon: true });
    ctx.restore();
    const bob = Math.sin(G.t * 2.5) * 2;
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🏳️', x + 16, y - 40 + bob);
    ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ffd97e';
    ctx.fillText(C.name + ' (teslim)', x, y - 56 + bob);
    return;
  }
  if (pr.kind === 'column') {
    drawShadow(x, y, 14, 6);
    ctx.fillStyle = '#ddd6c4'; ctx.fillRect(x - 9, y - 40, 18, 40);
    ctx.fillStyle = '#c9c2b0'; ctx.fillRect(x - 12, y - 46, 24, 8); ctx.fillRect(x - 12, y - 3, 24, 5);
    ctx.strokeStyle = 'rgba(120,110,90,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 3, y - 40); ctx.lineTo(x - 3, y); ctx.moveTo(x + 4, y - 40); ctx.lineTo(x + 4, y); ctx.stroke();
  } else if (pr.kind === 'columnFallen') {
    drawShadow(x, y, 30, 8);
    ctx.save(); ctx.translate(x, y); ctx.rotate(0.15);
    ctx.fillStyle = '#d5cebc'; ctx.fillRect(-32, -12, 64, 14);
    ctx.strokeStyle = 'rgba(120,110,90,0.5)'; ctx.lineWidth = 1.5;
    for (let i = -20; i <= 20; i += 13) { ctx.beginPath(); ctx.moveTo(i, -12); ctx.lineTo(i, 2); ctx.stroke(); }
    ctx.restore();
  } else if (pr.kind === 'boat') {
    ctx.save(); ctx.translate(x, y + Math.sin(G.t * 1.4) * 2); ctx.rotate(-0.25);
    ctx.fillStyle = '#7a4f2a';
    ctx.beginPath(); ctx.moveTo(-42, 0); ctx.quadraticCurveTo(0, 16, 42, 0); ctx.lineTo(30, -8); ctx.quadraticCurveTo(0, 2, -30, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5f3d20'; ctx.fillRect(-24, -8, 6, 8); ctx.fillRect(4, -9, 6, 9);
    ctx.restore();
  } else if (pr.kind === 'tent') {
    drawShadow(x, y, 26, 9);
    ctx.fillStyle = '#a3714b';
    ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x, y - 34); ctx.lineTo(x + 26, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7d5232';
    ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x, y - 16); ctx.lineTo(x + 8, y); ctx.closePath(); ctx.fill();
  } else if (pr.kind === 'portal') {
    const pt = G.t * 3;
    ctx.save(); ctx.translate(x, y - 16);
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.5 - i * 0.13;
      ctx.strokeStyle = '#8ad8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, 14 + i * 6 + Math.sin(pt + i) * 2, 22 + i * 7, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#c9ecff';
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 16, 0, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  } else if (pr.kind === 'grave') {
    drawShadow(x, y, 8, 4);
    ctx.fillStyle = '#8f8f89';
    ctx.beginPath(); ctx.roundRect(x - 5, y - 14, 10, 14, [5, 5, 0, 0]); ctx.fill();
    ctx.fillStyle = '#6f6f68'; ctx.fillRect(x - 3, y - 10, 6, 1.6); ctx.fillRect(x - 1, y - 12, 2, 6);
  } else if (pr.kind === 'cave') {
    // Karanlık İn: kayalık yamaç + oyulmuş kemer + derinliği olan zifiri tünel.
    // Zindanın mor taş paletiyle aynı dili konuşur (aynı yer olduğu anlaşılsın).
    drawShadow(x, y, 46, 15);
    // arka kaya kütlesi (dış hat)
    ctx.fillStyle = '#3b3450';
    ctx.beginPath();
    ctx.moveTo(x - 52, y + 4); ctx.lineTo(x - 46, y - 30); ctx.lineTo(x - 28, y - 50);
    ctx.lineTo(x - 4, y - 60); ctx.lineTo(x + 22, y - 52); ctx.lineTo(x + 44, y - 32);
    ctx.lineTo(x + 52, y + 4); ctx.closePath(); ctx.fill();
    // aydınlık üst yüzeyler (ışık üstten)
    ctx.fillStyle = '#5b5077';
    ctx.beginPath();
    ctx.moveTo(x - 46, y - 30); ctx.lineTo(x - 28, y - 50); ctx.lineTo(x - 4, y - 60);
    ctx.lineTo(x + 6, y - 44); ctx.lineTo(x - 16, y - 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6d6090';
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 60); ctx.lineTo(x + 22, y - 52); ctx.lineTo(x + 30, y - 38);
    ctx.lineTo(x + 8, y - 42); ctx.closePath(); ctx.fill();
    // yan kaya blokları (taban)
    ctx.fillStyle = '#332c46';
    ctx.beginPath(); ctx.ellipse(x - 40, y + 1, 15, 9, 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 42, y + 2, 13, 8, -0.25, 0, TAU); ctx.fill();
    // kemer ağzı: dıştan içe koyulaşan tünel
    const tg = ctx.createRadialGradient(x, y - 6, 3, x, y - 6, 26);
    tg.addColorStop(0, '#050409'); tg.addColorStop(0.65, '#0d0a16'); tg.addColorStop(1, '#1d1830');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.ellipse(x, y - 2, 20, 24, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - 20, y - 2, 40, 5);
    // kemer taşları
    ctx.strokeStyle = '#4a4165'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(x, y - 2, 22, 26, 0, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#584d78';
    for (let a2 = Math.PI + 0.25; a2 < TAU - 0.25; a2 += 0.42) {
      const kx = x + Math.cos(a2) * 22, ky = y - 2 + Math.sin(a2) * 26;
      ctx.save(); ctx.translate(kx, ky); ctx.rotate(a2 + Math.PI / 2);
      ctx.fillRect(-4, -3.5, 8, 7); ctx.restore();
    }
    // sarkıtlar (ağzın üstünde diş sırası)
    ctx.fillStyle = '#2a2440';
    for (let i = -2; i <= 2; i++) {
      const sx2 = x + i * 7.5, sh = 5 + ((i + 2) % 3) * 3;
      ctx.beginPath(); ctx.moveTo(sx2 - 3, y - 22); ctx.lineTo(sx2, y - 22 + sh); ctx.lineTo(sx2 + 3, y - 22); ctx.fill();
    }
    // yosun tutamları
    ctx.fillStyle = 'rgba(92,132,74,0.55)';
    ctx.beginPath(); ctx.ellipse(x - 34, y - 26, 9, 4, -0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 33, y - 20, 7, 3.5, 0.35, 0, TAU); ctx.fill();
    const dolu = (G.caveCd || 0) <= 0;
    if (dolu) { // HAZIR: ağızdan sızan altın ışık + nabız halkası + 💎
      const nb = 0.55 + Math.sin(G.t * 2.2) * 0.45;
      const gl = ctx.createRadialGradient(x, y - 6, 16, x, y - 6, 62);
      gl.addColorStop(0, 'rgba(255,205,90,' + (0.3 * nb + 0.14) + ')');
      gl.addColorStop(1, 'rgba(255,190,70,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y - 6, 62, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,120,' + (0.5 - nb * 0.3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 4, 38 + nb * 14, 14 + nb * 6, 0, 0, TAU); ctx.stroke();
      // ağızdan YERE sızan ışık huzmesi (ağzın kendisi karanlık kalmalı, yoksa
      // tünel altın bir lekeye dönüşüp kemer okunmuyor)
      ctx.fillStyle = 'rgba(255,206,110,' + (0.09 + nb * 0.07) + ')';
      ctx.beginPath(); ctx.moveTo(x - 15, y + 1); ctx.lineTo(x + 15, y + 1); ctx.lineTo(x + 30, y + 16); ctx.lineTo(x - 30, y + 16); ctx.fill();
      const bl = Math.sin(G.t * 1.8) > -0.4 ? 1 : 0;
      if (bl) { ctx.fillStyle = '#ffd257'; ctx.beginPath(); ctx.arc(x - 5, y - 12, 1.8, 0, TAU); ctx.arc(x + 5, y - 12, 1.8, 0, TAU); ctx.fill(); }
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('💎', x, y - 68 + Math.sin(G.t * 2.4) * 3);
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ffd97e';
      ctx.fillText('HAZİNE VAR', x, y - 80);
    } else { // BOŞ: soğuk gri, kalan süre
      ctx.fillStyle = 'rgba(28,32,46,0.4)';
      ctx.beginPath(); ctx.ellipse(x, y - 18, 54, 44, 0, 0, TAU); ctx.fill();
      const m2 = Math.floor(G.caveCd / 60), s2 = Math.floor(G.caveCd % 60);
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,205,215,0.85)';
      ctx.fillText('⏳ ' + m2 + ':' + String(s2).padStart(2, '0'), x, y - 68);
    }
  } else if (pr.kind === 'trader') {
    // renkli tüccar konağı: büyük çadır + halı + deve + mal sandıkları
    drawShadow(x, y, 40, 12);
    ctx.fillStyle = '#b3392b';
    ctx.beginPath(); ctx.moveTo(x - 40, y); ctx.lineTo(x - 6, y - 46); ctx.lineTo(x + 30, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e0a33d';
    ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 6, y - 30); ctx.lineTo(x + 14, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a4fa0'; ctx.fillRect(x - 20, y + 2, 44, 10); // halı
    ctx.fillStyle = '#8a5c33'; ctx.fillRect(x + 28, y - 10, 15, 11); ctx.fillRect(x + 33, y - 18, 12, 9); // sandıklar
    ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🐪', x + 58, y - 4);
    ctx.font = '13px sans-serif'; ctx.fillText('💰', x - 6, y - 52 + Math.sin(G.t * 2.5) * 2);
  }
}
// Yaban hayvanı: yandan görünüm dört ayaklı silüet (türe göre renk/aksesuar)
function drawAnimal(a) {
  const A = ANIMALS[a.type];
  const flip = Math.cos(a.dir) < 0 ? -1 : 1;
  const bob = Math.sin(a.walk * 2.2) * 1.5;
  const s = a.type === 'rabbit' ? 0.62 : a.type === 'deer' ? 1 : a.type === 'boar' ? 0.95 : 0.88;
  const body = a.type === 'rabbit' ? '#cfc8ba' : a.type === 'deer' ? '#b4844e' : a.type === 'boar' ? '#5a4030' : '#8a8f98';
  drawShadow(a.x, a.y + 2, 14 * s, 5 * s);
  ctx.save();
  ctx.translate(a.x, a.y + bob * 0.4);
  ctx.scale(flip * s, s);
  if (a.flash > 0) { ctx.globalAlpha = 0.55; }
  // bacaklar (yürüyüş salınımı)
  const lg = Math.sin(a.walk * 3) * 3;
  ctx.fillStyle = body;
  ctx.fillRect(-10 + lg, -8, 3.5, 9); ctx.fillRect(6 - lg, -8, 3.5, 9);
  // gövde
  ctx.beginPath(); ctx.ellipse(0, -14, 14, 8.5, 0, 0, TAU); ctx.fill();
  // baş
  ctx.beginPath(); ctx.arc(13, -19, 5.5, 0, TAU); ctx.fill();
  if (a.type === 'rabbit') { // uzun kulaklar + pofuduk kuyruk
    ctx.fillRect(12, -30, 2.5, 9); ctx.fillRect(16, -29, 2.5, 8);
    ctx.fillStyle = '#efe9dd'; ctx.beginPath(); ctx.arc(-13, -14, 3, 0, TAU); ctx.fill();
  } else if (a.type === 'deer') { // boynuzlar
    ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(12, -24); ctx.lineTo(9, -32); ctx.moveTo(12, -24); ctx.lineTo(15, -33);
    ctx.moveTo(9, -32); ctx.lineTo(5, -34); ctx.moveTo(15, -33); ctx.lineTo(18, -37); ctx.stroke();
  } else if (a.type === 'boar') { // dişler + sırt kılı
    ctx.fillStyle = '#efe9dd'; ctx.fillRect(16, -17, 4, 2);
    ctx.fillStyle = '#3f2c20'; ctx.fillRect(-8, -22, 14, 3);
  } else { // kurt: sivri kulak + kuyruk
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(10, -24); ctx.lineTo(12, -30); ctx.lineTo(14, -24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-13, -16); ctx.quadraticCurveTo(-20, -20, -19, -13); ctx.quadraticCurveTo(-16, -11, -13, -13); ctx.fill();
  }
  ctx.restore();
  if (a.hp < a.maxHp) { // can barı
    ctx.fillStyle = 'rgba(20,15,8,0.7)'; ctx.fillRect(a.x - 13, a.y - 34 * s - 6, 26, 3.5);
    ctx.fillStyle = '#ff6b5e'; ctx.fillRect(a.x - 13, a.y - 34 * s - 6, 26 * Math.max(0, a.hp) / a.maxHp, 3.5);
  }
  if (a.angered) { ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💢', a.x + 10, a.y - 34); }
}
// Karakol suru: her zaman AHŞAP görünüm (köy suru taşa yükselse bile) — kazık + travers
function drawOpStake(st) {
  ctx.fillStyle = 'rgba(60,35,10,0.25)';
  ctx.beginPath(); ctx.ellipse(st.x, st.y + 2, 6, 3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a4f2a'; ctx.fillRect(st.x - 4, st.y - st.h, 8, st.h);
  ctx.fillStyle = '#93643a';
  ctx.beginPath(); ctx.moveTo(st.x - 4, st.y - st.h); ctx.lineTo(st.x, st.y - st.h - 7); ctx.lineTo(st.x + 4, st.y - st.h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(40,20,5,0.3)'; ctx.fillRect(st.x + 1.5, st.y - st.h, 2.5, st.h);
}
function drawOpWallRails(vis) {
  const n = G.opStakes.length;
  if (!n) return;
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < n - 1; i++) {
    const a = G.opStakes[i], b = G.opStakes[i + 1]; // üretim açı sıralı: komşular ardışık
    if (dist(a.x, a.y, b.x, b.y) > 90) continue;    // kapı boşluğu / site sınırı
    if (!vis(a.x, a.y) && !vis(b.x, b.y)) continue;
    ctx.strokeStyle = '#8a5c33'; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.45); ctx.lineTo(b.x, b.y - b.h * 0.45); ctx.stroke();
    ctx.strokeStyle = '#75491f'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.8); ctx.lineTo(b.x, b.y - b.h * 0.8); ctx.stroke();
  }
  ctx.restore();
}
// Kazıklar arası bağlantı: ahşapta traversler, taşta dolu duvar bandı
function drawPalisadeRails(vis) {
  const n = G.palStakes.length;
  const stone = G.palisade.lv >= 2;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = G.palStakes[i], b = G.palStakes[(i + 1) % n];
    if (dist(a.x, a.y, b.x, b.y) > 90) continue;           // kapı boşluğu
    if (!vis(a.x, a.y) && !vis(b.x, b.y)) continue;
    if (stone) {
      // dolu duvar gövdesi (kale surları gibi)
      ctx.strokeStyle = '#77777d'; ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.32); ctx.lineTo(b.x, b.y - b.h * 0.32); ctx.stroke();
      ctx.strokeStyle = '#8f8f95'; ctx.lineWidth = 16;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.5); ctx.lineTo(b.x, b.y - b.h * 0.5); ctx.stroke();
      // üst yürüyüş yolu
      ctx.strokeStyle = '#a8a8ad'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.86); ctx.lineTo(b.x, b.y - b.h * 0.86); ctx.stroke();
    } else {
      ctx.strokeStyle = '#8a5c33'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.45); ctx.lineTo(b.x, b.y - b.h * 0.45); ctx.stroke();
      ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - a.h * 0.82); ctx.lineTo(b.x, b.y - b.h * 0.82); ctx.stroke();
    }
  }
  ctx.restore();
}
function drawStake(st) {
  if (G.palisade.lv >= 2) { // taş sur: mazgal taşı (duvar gövdesi traverslerde çizilir)
    ctx.fillStyle = '#b5b5ae'; ctx.fillRect(st.x - 7, st.y - st.h - 9, 14, 9);
    ctx.fillStyle = '#8f8f95'; ctx.fillRect(st.x - 7, st.y - st.h - 1, 14, 3);
    return;
  }
  ctx.fillStyle = 'rgba(60,35,10,0.25)';
  ctx.beginPath(); ctx.ellipse(st.x, st.y + 2, 6, 3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a4f2a'; ctx.fillRect(st.x - 4, st.y - st.h, 8, st.h);
  ctx.fillStyle = '#93643a';
  ctx.beginPath(); ctx.moveTo(st.x - 4, st.y - st.h); ctx.lineTo(st.x, st.y - st.h - 7); ctx.lineTo(st.x + 4, st.y - st.h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(40,20,5,0.3)'; ctx.fillRect(st.x + 1.5, st.y - st.h, 2.5, st.h);
}
function drawVillageGate() {
  const g = G.palisade.gate, x = PAL_GATE.x, y = PAL_GATE.y;
  const stone = G.palisade.lv >= 2;
  // iki yan direk (taş surda kule gibi)
  ctx.fillStyle = stone ? '#9a9a94' : '#6b4423';
  ctx.fillRect(x - 5, y - 52 - 8, 10, 52); ctx.fillRect(x - 5, y + 8, 10, 52);
  if (g.alive) {
    ctx.fillStyle = stone ? '#6a5138' : '#8a5c33'; ctx.fillRect(x - 6, y - 42, 12, 84);
    ctx.fillStyle = stone ? '#8b8f98' : '#54402c';
    ctx.fillRect(x - 6, y - 30, 12, 4); ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillRect(x - 6, y + 26, 12, 4);
    if (g.hp < g.maxHp) {
      const bw = 46;
      ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(x - bw / 2, y - 70, bw, 5);
      ctx.fillStyle = '#e8a13d'; ctx.fillRect(x - bw / 2 + 1, y - 69, (bw - 2) * Math.max(0, g.hp / g.maxHp), 3);
    }
  } else {
    // KIRIK KAPI: eskiden yalnız iki küçük çubuk kalıyordu, taş surda gri
    // direklerle birleşip "kapı yokmuş" gibi duruyordu. Artık menteşelerde
    // parçalanmış kanat kalıntısı + açıklığa savrulmuş kalaslar + uyarı var.
    ctx.save(); ctx.translate(x, y);
    // menteşelerde kalan kırık kanat parçaları (üstte ve altta)
    ctx.fillStyle = stone ? '#5a4530' : '#6a4526';
    ctx.beginPath(); ctx.moveTo(-6, -42); ctx.lineTo(6, -42); ctx.lineTo(4, -22); ctx.lineTo(-5, -28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, 42); ctx.lineTo(6, 42); ctx.lineTo(5, 24); ctx.lineTo(-4, 30); ctx.closePath(); ctx.fill();
    // kopmuş demir menteşeler
    ctx.fillStyle = stone ? '#8b8f98' : '#54402c';
    ctx.fillRect(-7, -34, 14, 4); ctx.fillRect(-7, 30, 14, 4);
    // yere savrulmuş kalaslar (açıklığın içinde)
    ctx.fillStyle = 'rgba(92,66,38,0.75)';
    ctx.save(); ctx.rotate(0.42); ctx.fillRect(-22, -6, 44, 8); ctx.restore();
    ctx.save(); ctx.rotate(-0.75); ctx.fillRect(-16, 8, 34, 7); ctx.restore();
    ctx.fillStyle = 'rgba(60,42,24,0.6)';
    ctx.save(); ctx.rotate(1.3); ctx.fillRect(-10, 14, 22, 5); ctx.restore();
    // kıymık tozu
    ctx.fillStyle = 'rgba(120,92,58,0.5)';
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * 11 - 2, 18 + (i % 2) * 5, 5, 3);
    ctx.restore();
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🚨', x, y - 72 + Math.sin(G.t * 3) * 2);
  }
}
function drawRam(rm) {
  drawShadow(rm.x, rm.y, 28, 10);
  ctx.save(); ctx.translate(rm.x, rm.y);
  // tekerlekler
  ctx.fillStyle = '#4f3319';
  ctx.beginPath(); ctx.arc(-18, -2, 6, 0, TAU); ctx.arc(18, -2, 6, 0, TAU); ctx.arc(-18, -14, 5, 0, TAU); ctx.arc(18, -14, 5, 0, TAU); ctx.fill();
  // iskelet + çatı
  ctx.fillStyle = '#6b4423'; ctx.fillRect(-24, -12, 48, 8);
  ctx.fillStyle = '#8a5c33';
  ctx.beginPath(); ctx.moveTo(-26, -12); ctx.lineTo(0, -30); ctx.lineTo(26, -12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,10,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  // asılı tomruk (saldırıda ileri gider)
  const push = rm.lunge > 0 ? Math.sin((0.35 - rm.lunge) / 0.35 * Math.PI) * 14 : 0;
  ctx.save(); ctx.rotate(rm.dir || 0); ctx.translate(push, 0);
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-20, -20, 44, 9);
  ctx.fillStyle = '#8b8f98'; ctx.beginPath(); ctx.roundRect(22, -22, 10, 13, 3); ctx.fill(); // demir başlık
  ctx.restore();
  ctx.restore();
}
function drawSiegeSite(st) {
  ctx.save();
  ctx.strokeStyle = 'rgba(140,45,30,0.5)'; ctx.setLineDash([9, 8]); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(st.x, st.y, 100, 62, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // erzak sandığı + çuval
  ctx.fillStyle = '#8a5c33'; ctx.fillRect(st.x - 34, st.y + 6, 17, 11);
  ctx.fillStyle = '#6b4423'; ctx.fillRect(st.x - 32, st.y + 3, 13, 4);
  ctx.fillStyle = '#c9b08a'; ctx.beginPath(); ctx.ellipse(st.x - 12, st.y + 12, 7, 5, 0, 0, TAU); ctx.fill();
  // sancak (dalgalanan)
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(st.x - 2, st.y - 48, 4, 48);
  const w = Math.sin(G.t * 3.2) * 3;
  ctx.fillStyle = '#b3392b';
  ctx.beginPath(); ctx.moveTo(st.x + 2, st.y - 46);
  ctx.quadraticCurveTo(st.x + 16 + w, st.y - 42, st.x + 27 + w, st.y - 38);
  ctx.lineTo(st.x + 2, st.y - 31); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd257'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('⚔️', st.x + 12 + w * 0.6, st.y - 36);
  ctx.restore();
}
function drawScaffold(en, E) {
  const pct = clamp(en.prog / E.buildTime, 0, 1);
  drawShadow(en.x, en.y, 20, 8);
  ctx.strokeStyle = '#8a5c33'; ctx.lineWidth = 3;
  ctx.strokeRect(en.x - 16, en.y - 26, 32, 26);
  ctx.beginPath();
  ctx.moveTo(en.x - 16, en.y - 26); ctx.lineTo(en.x + 16, en.y);
  ctx.moveTo(en.x + 16, en.y - 26); ctx.lineTo(en.x - 16, en.y);
  ctx.stroke();
  ctx.fillStyle = '#6b4423'; ctx.fillRect(en.x - 12, en.y - 6, 10, 5); ctx.fillRect(en.x + 3, en.y - 4, 8, 4);
  const bw = 46;
  ctx.fillStyle = 'rgba(20,15,25,0.85)'; ctx.fillRect(en.x - bw / 2, en.y - 44, bw, 7);
  ctx.fillStyle = '#57d364'; ctx.fillRect(en.x - bw / 2 + 1, en.y - 43, (bw - 2) * pct, 5);
  ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(E.icon + ' %' + Math.floor(pct * 100), en.x, en.y - 50);
  if (dist(G.player.x, G.player.y, en.x, en.y) >= 260) {
    ctx.fillStyle = '#ffb0a8'; ctx.font = '10px sans-serif';
    ctx.fillText('⏸ inşaat için yaklaş', en.x, en.y - 62);
  }
}
function drawBallista(b) {
  drawShadow(b.x, b.y, 16, 7);
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(0, -15); ctx.lineTo(11, 0); ctx.stroke(); // sehpa
  ctx.save(); ctx.translate(0, -17); ctx.rotate(b.dir || 0);
  ctx.fillStyle = '#6b4423'; ctx.fillRect(-8, -3.5, 26, 7);                  // gövde
  ctx.strokeStyle = '#8a5c33'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(6, -13); ctx.quadraticCurveTo(17, 0, 6, 13); ctx.stroke(); // yay
  ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(6, -13); ctx.lineTo(-5, 0); ctx.lineTo(6, 13); ctx.stroke(); // kiriş
  ctx.fillStyle = '#c9ced6'; ctx.fillRect(12, -1.5, 9, 3);                   // yüklü ok
  ctx.restore(); ctx.restore();
}
function drawCatapult(c) {
  drawShadow(c.x, c.y, 24, 9);
  ctx.save(); ctx.translate(c.x, c.y);
  // tekerlekler
  ctx.fillStyle = '#4f3319';
  ctx.beginPath(); ctx.arc(-14, -3, 7, 0, TAU); ctx.arc(14, -3, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8a5c33'; ctx.fillRect(-20, -10, 40, 7);
  // kol
  const armAng = c.arm > 0 ? lerp(-1.5, -0.5, c.arm / 0.35) : -0.5;
  ctx.save(); ctx.translate(0, -8); ctx.rotate(armAng);
  ctx.fillStyle = '#6b4423'; ctx.fillRect(-3, -30, 6, 32);
  ctx.fillStyle = '#54402c'; ctx.beginPath(); ctx.arc(0, -30, 6, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-4, -16, 8, 8);
  ctx.restore();
}
function drawFortWalls() {
  for (const w of G.walls) {
    if (w.cave) { // zindan kayası: koyu kütle + karo dokusu (aydınlık dudak ayrıca çizilir)
      ctx.fillStyle = '#211b2f';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';                // kaba blok dokusu
      for (let bx = w.x + 4; bx < w.x + w.w - 6; bx += 42) ctx.fillRect(bx, w.y + 5, 34, 14);
      ctx.strokeStyle = 'rgba(9,6,16,0.5)'; ctx.lineWidth = 1;
      for (let bx = w.x + 42; bx < w.x + w.w - 2; bx += 42) { ctx.beginPath(); ctx.moveTo(bx, w.y); ctx.lineTo(bx, w.y + w.h); ctx.stroke(); }
      continue;
    }
    ctx.fillStyle = '#8f8f95';
    ctx.fillRect(w.x, w.y - 16, w.w, w.h + 16); // yükseklik hissi
    ctx.fillStyle = '#a8a8ad';
    ctx.fillRect(w.x, w.y - 16, w.w, 10);
    // mazgallar
    ctx.fillStyle = '#77777d';
    if (w.w > w.h) { for (let x = w.x + 6; x < w.x + w.w - 8; x += 22) ctx.fillRect(x, w.y - 20, 10, 6); }
    else { for (let y = w.y - 12; y < w.y + w.h - 6; y += 24) ctx.fillRect(w.x + w.w / 2 - 5, y, 10, 6); }
  }
  // Zindanda kayanın zemine bakan yüzü: ışık alan açık taş dudağı. Duvarı zeminden
  // ayıran asıl ipucu bu — renk farkı tek başına yeterli olmuyor.
  if (G.caveRun) for (const f of (G.caveFaces || [])) {
    ctx.fillStyle = '#7a6aa0';
    ctx.fillRect(f.x, f.y - 11, f.w, 11);
    ctx.fillStyle = '#8f7dba';
    ctx.fillRect(f.x, f.y - 11, f.w, 4);
    ctx.fillStyle = 'rgba(20,13,34,0.55)';
    for (let bx = f.x + 10; bx < f.x + f.w - 8; bx += 40) ctx.fillRect(bx, f.y - 8, 15, 3);
    ctx.fillStyle = 'rgba(10,6,18,0.35)';
    ctx.fillRect(f.x, f.y - 1.5, f.w, 1.5);
  }
}

// ---------- Ana çizim ----------
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const shakeAmt = OPTS.shake ? G.shake : 0;
  const shx = (rng() - 0.5) * shakeAmt, shy = (rng() - 0.5) * shakeAmt;
  const cx = Math.round(G.cam.x - shx), cy = Math.round(G.cam.y - shy);
  ctx.clearRect(0, 0, VW, VH);
  // zemin
  ctx.drawImage(groundCv, cx / 2, cy / 2, VW / 2, VH / 2, 0, 0, VW, VH);
  ctx.save(); ctx.translate(-cx, -cy);

  // su parıltısı (canlı)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const y = cy + ((i * 173 + G.t * 14) % (VH + 60)) - 30;
    const x = shoreX(y) - 45 - 25 * Math.sin(y * 0.01 + i);
    if (x > cx - 40) { ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.stroke(); }
  }

  // zindan: oda zeminleri ve meşaleler (duvarların altında)
  if (G.caveRun && G.caveFloor) {
    const gorunur = (x, y, w, h) => !(x > cx + VW || x + w < cx || y > cy + VH || y + h < cy);
    for (const f of G.caveFloor) { // koridorlar dahil tüm yürünebilir zemin
      if (!gorunur(f.x, f.y, f.w, f.h)) continue;
      ctx.fillStyle = '#4a4166';                                 // kayadan (#211b2f) belirgin şekilde AÇIK
      ctx.fillRect(f.x, f.y, f.w, f.h);
    }
    for (const r of (G.caveRooms || [])) { // odalar koridordan da açık: nerede olduğun belli olsun
      if (!gorunur(r.x, r.y, r.w, r.h)) continue;
      ctx.fillStyle = '#5d5280';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';                  // döşeme taşları
      for (let gx2 = r.x + 6; gx2 < r.x + r.w - 8; gx2 += 44)
        for (let gy2 = r.y + 6; gy2 < r.y + r.h - 8; gy2 += 40) ctx.fillRect(gx2, gy2, 38, 34);
      ctx.strokeStyle = 'rgba(24,17,38,0.45)'; ctx.lineWidth = 1;  // derzler
      for (let gx2 = r.x + 44; gx2 < r.x + r.w - 4; gx2 += 44) { ctx.beginPath(); ctx.moveTo(gx2, r.y); ctx.lineTo(gx2, r.y + r.h); ctx.stroke(); }
      for (let gy2 = r.y + 40; gy2 < r.y + r.h - 4; gy2 += 40) { ctx.beginPath(); ctx.moveTo(r.x, gy2); ctx.lineTo(r.x + r.w, gy2); ctx.stroke(); }
    }
    for (const g2 of (G.caveShade || [])) { // kayanın zemine düşen gölgesi (derinlik)
      if (!gorunur(g2.x, g2.y, g2.w, 16)) continue;
      const gr = ctx.createLinearGradient(0, g2.y, 0, g2.y + 15);
      gr.addColorStop(0, 'rgba(12,8,22,0.55)'); gr.addColorStop(1, 'rgba(12,8,22,0)');
      ctx.fillStyle = gr; ctx.fillRect(g2.x, g2.y, g2.w, 15);
    }
    for (const k of (G.caveCrystals || [])) { // turkuaz kristal kümeleri (zindanın renk vurgusu)
      if (k.x < cx - 60 || k.x > cx + VW + 60 || k.y < cy - 60 || k.y > cy + VH + 60) continue;
      const nb = 0.65 + Math.sin(G.t * 2.4 + k.f) * 0.35;
      const hl = ctx.createRadialGradient(k.x, k.y - 8, 2, k.x, k.y - 8, 46);
      hl.addColorStop(0, 'rgba(60,230,205,' + (0.22 * nb) + ')'); hl.addColorStop(1, 'rgba(60,230,205,0)');
      ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(k.x, k.y - 8, 46, 0, TAU); ctx.fill();
      for (let i = 0; i < k.n; i++) {
        const ox2 = (i - (k.n - 1) / 2) * 11, hh2 = 16 + (i % 2) * 9;
        ctx.fillStyle = '#1c6d68';
        ctx.beginPath(); ctx.moveTo(k.x + ox2 - 5, k.y); ctx.lineTo(k.x + ox2, k.y - hh2); ctx.lineTo(k.x + ox2 + 5, k.y); ctx.fill();
        ctx.fillStyle = 'rgba(78,240,214,' + (0.55 + 0.35 * nb) + ')';
        ctx.beginPath(); ctx.moveTo(k.x + ox2 - 2, k.y - 2); ctx.lineTo(k.x + ox2, k.y - hh2 + 2); ctx.lineTo(k.x + ox2 + 2, k.y - 2); ctx.fill();
      }
    }
    for (const t of (G.caveTorches || [])) {
      // NOT: vis() bu noktada henüz tanımlı değil (TDZ) — sınır kontrolü elle yapılır
      if (t.x < cx - 60 || t.x > cx + VW + 60 || t.y < cy - 60 || t.y > cy + VH + 60) continue;
      ctx.fillStyle = '#4a3a24'; ctx.fillRect(t.x - 2, t.y - 18, 4, 18);
      const par = 0.75 + Math.sin(G.t * 7 + t.x) * 0.25;
      ctx.fillStyle = '#ff9a2e'; ctx.beginPath(); ctx.ellipse(t.x, t.y - 22, 5 * par, 8 * par, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd257'; ctx.beginPath(); ctx.ellipse(t.x, t.y - 23, 2.6 * par, 4.5 * par, 0, 0, TAU); ctx.fill();
    }
  }

  // boss şarj telegrafı: kırmızı uyarı şeridi
  for (const tg of G.telegraphs) {
    ctx.save();
    ctx.translate(tg.x, tg.y - 14); ctx.rotate(tg.dir);
    ctx.globalAlpha = 0.28 * (tg.t / tg.max) + 0.1;
    ctx.fillStyle = '#c03a2e';
    ctx.fillRect(0, -tg.w / 2, tg.len, tg.w);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#c03a2e'; ctx.lineWidth = 2;
    ctx.strokeRect(0, -tg.w / 2, tg.len, tg.w);
    ctx.restore();
  }

  // arsalar (elipsler zeminde; TABELALAR en üst katmanda çizilir — sur/duvar altında kalmasın)
  for (const p2 of G.plots) if (!p2.built) drawPlot(p2);

  // kale surları (varlıklardan önce — oyuncu önünden geçebilir gibi görünmesin diye basit yaklaşım)
  drawFortWalls();

  // y-sıralı varlık listesi (görüş dışını atla — büyük harita)
  const vis = (x, y) => x > cx - 140 && x < cx + VW + 140 && y > cy - 180 && y < cy + VH + 140;
  if (G.palisade.built) drawPalisadeRails(vis); // sur traversleri kazıkların altına çizilir
  drawOpWallRails(vis); // karakol suru traversleri (her zaman ahşap)
  const list = [];
  for (const n of G.nodes) if (vis(n.x, n.y)) list.push({ y: n.y, f: () => (n.kind === 'tree' ? drawTree(n) : n.kind === 'rock' ? drawRock(n) : drawScrap(n)) });
  for (const b of G.buildings) {
    list.push({ y: b.y, f: () => drawBuilding(b) });
    if (b.type === 'house' && b.villager && b.vx !== undefined && vis(b.vx, b.vy))
      list.push({ y: b.vy, f: () => {
        const tool = b.job === 'wood' ? 'axe' : b.job === 'stone' ? 'pick' : b.job === 'scrap' ? 'bar' : null;
        drawWarrior({ x: b.vx, y: b.vy, dir: b.vdir || 0, walk: b.vwalk || 0, swing: b.vswing || 0, flash: 0, hp: 1, maxHp: 1 },
          { cloth: '#b9a37e', scale: 0.58, noWeapon: true, tool: b.vstate === 'don' ? null : tool });
        if (b.vstate === 'don') { // omuzdaki yük
          ctx.fillStyle = b.job === 'wood' ? '#7a4f2a' : b.job === 'stone' ? '#9a9a94' : '#7d7d84';
          ctx.beginPath(); ctx.roundRect(b.vx - 7, b.vy - 46, 14, 8, 2); ctx.fill();
        }
      } });
  }
  for (const s of G.structures) list.push({ y: s.y, f: () => drawStructure(s) });
  for (const pr of G.props) {
    // fethedilen barbar kampının çadırları sökülür (ada totemleri de aynı kural)
    if (pr.site && (G.outposts[pr.site] || (pr.site === 'camp1' && G.camp1Destroyed))) continue;
    if (vis(pr.x, pr.y)) list.push({ y: pr.y, f: () => drawProp(pr) });
  }
  for (const e of G.enemies) {
    if (e.type === 'wram') {
      // düşman koçbaşısı: mürettebatlı kuşatma aracı
      list.push({ y: e.y, f: () => {
        drawRam({ x: e.x, y: e.y, dir: e.dir, lunge: e.swing });
        if (e.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${e.flash * 4})`; ctx.beginPath(); ctx.ellipse(e.x, e.y - 14, 26, 16, 0, 0, TAU); ctx.fill(); }
        if (e.hp < e.maxHp) {
          const bw = 40;
          ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(e.x - bw / 2, e.y - 44, bw, 5);
          ctx.fillStyle = '#e8506a'; ctx.fillRect(e.x - bw / 2 + 1, e.y - 43, (bw - 2) * Math.max(0, e.hp / e.maxHp), 3);
        }
      } });
      continue;
    }
    const hel = e.type === 'guard' || e.type === 'chief' || e.type === 'rivallord' ? '#55555f' : (e.type === 'legion' || e.type === 'commander') ? '#c9ced6' : null;
    const cr = e.type === 'chief' || e.type === 'commander' ? '#c03a2e' : e.type === 'rivallord' ? '#7a4fa0' : null;
    list.push({ y: e.y, f: () => {
      drawWarrior(e, {
        foe: true,
        cloth: e.raged ? '#5a2a3a' : eDef(e).cloth, scale: eDef(e).scale, hpBar: true, belt: true,
        helmet: hel, crest: cr, bow: e.type === 'archer', shield: e.type === 'shieldbarb',
        staff: e.type === 'shaman', beast: eDef(e).beast, weapon: eDef(e).weapon, mount: eDef(e).mount,
      });
      if (e.type === 'troll') { // dünya boss'u etiketi
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd257'; ctx.fillText(e.islBoss ? '👹 Ada Devi' : '👹 Dağ Devi', e.x, e.y - 128);
      }
      if (e.leader) { // düşman kol lideri: kızıl flama
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ff8a7e'; ctx.fillText('🚩 Kol Lideri', e.x, e.y - 66);
      }
    } });
  }
  // yaban hayatı
  for (const a of G.animals) if (!a.dead && vis(a.x, a.y)) list.push({ y: a.y, f: () => drawAnimal(a) });
  // ev sahibinin ordusu (misafir ekranı): host'tan gelen asker/komutan/garnizon
  if (coopSlave()) {
    for (const a of (G.netAllies || [])) {
      if (!vis(a.x, a.y)) continue;
      list.push({ y: a.y, f: () => {
        const cmd = String(a.cls).indexOf('cmd:') === 0;
        const C2 = cmd ? COMMANDERS[a.cls.slice(4)] : null;
        drawWarrior(a, {
          cloth: C2 ? C2.cloth : (a.gar ? '#6e8a5e' : a.cls === 'shield' ? '#4a6a8e' : '#5c7a9e'),
          scale: C2 ? 1.28 : (a.cls === 'shield' ? 0.64 : 0.6), hpBar: true, hpColor: '#57d364',
          belt: true, helmet: C2 ? '#55555f' : '#9aa3b0', crest: C2 ? C2.crest : null,
          bow: a.cls === 'bow', shield: a.cls === 'shield',
        });
        if (C2) {
          ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd97e';
          ctx.fillText(C2.icon + ' ' + C2.name, a.x, a.y - 78);
        }
      } });
    }
    for (const a of (G.netAnimals || [])) if (vis(a.x, a.y)) list.push({ y: a.y, f: () => drawAnimal(a) });
  }
  // canlı yoldaşlar: aynı haritadaki gerçek oyuncular
  for (const pid of Object.keys(CO.peers)) {
    const pp = CO.peers[pid];
    if (!vis(pp.x, pp.y)) continue;
    list.push({ y: pp.y, f: () => {
      ctx.strokeStyle = 'rgba(87,211,100,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(pp.x, pp.y + 1, 16, 7, 0, 0, TAU); ctx.stroke();
      drawWarrior(pp, { cloth: '#4f8f78', scale: 1.18, hpBar: true, hpColor: '#57d364', belt: true,
        helmet: '#c9a24a', crest: '#57d364', mount: pp.riding, horse: '#6e4a26' });
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#a8f0c0';
      ctx.fillText('🤝 ' + pp.name, pp.x, pp.y - 84);
    } });
  }
  for (const s of G.soldiers) list.push({ y: s.y, f: () =>
    drawWarrior(s, { cloth: s.cls === 'shield' ? '#4a6a8e' : '#5c7a9e', scale: s.cls === 'shield' ? 0.64 : 0.6, hpBar: true, hpColor: '#57d364', belt: true, helmet: '#9aa3b0', bow: s.cls === 'bow', shield: s.cls === 'shield' }) });
  // komutanlar: iri, sancak rengi tepelikli, isim + seviye + görev etiketi
  // Komutan etiketleri: yan yana duran komutanların yazıları üst üste binip
  // okunmaz hâle geliyordu — yakındakiler kademeli olarak yukarı kaydırılır.
  const cmdEtiketY = [];
  for (const c of G.commanders) if (vis(c.x, c.y)) {
    let ey = c.y - 78;
    for (let g2 = 0; g2 < 6; g2++) {                       // boş satır bulana dek yukarı çık
      if (!cmdEtiketY.some(e => Math.abs(e.x - c.x) < 150 && Math.abs(e.y - ey) < 15)) break;
      ey -= 15;
    }
    cmdEtiketY.push({ x: c.x, y: ey });
    const eyy = ey;
    list.push({ y: c.y, f: () => {
      const C = COMMANDERS[c.id];
      drawWarrior(c, { cloth: C.cloth, scale: 1.28, hpBar: true, hpColor: '#ffd257', belt: true, helmet: '#55555f', crest: C.crest });
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      const ord = c.order === 'raid' ? ' · 💰 yağmada' : (c.order || '').indexOf('guard:') === 0 ? ' · 🛡️ devriyede' : '';
      const yazi = C.icon + ' ' + C.name + ' · Sv.' + c.lv + ord;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,10,6,0.7)'; ctx.strokeText(yazi, c.x, eyy);
      ctx.fillStyle = '#ffd97e'; ctx.fillText(yazi, c.x, eyy);
    } });
  }
  // komutanların öz ordusu: komutan kumaşında küçük askerler
  for (const c of G.commanders) for (const t of (c.troops || [])) if (vis(t.x, t.y)) list.push({ y: t.y, f: () =>
    drawWarrior(t, { cloth: COMMANDERS[c.id].cloth, scale: 0.6, hpBar: true, hpColor: '#ffd257', belt: true, helmet: '#7a7a85' }) });
  for (const g of G.garrisonUnits) if (vis(g.x, g.y)) list.push({ y: g.y, f: () => drawWarrior(g, { cloth: g.cls === 'shield' ? '#5a7a52' : '#6e8a5e', scale: g.cls === 'shield' ? 0.64 : 0.6, hpBar: true, hpColor: '#57d364', belt: true, helmet: '#9aa3b0', bow: g.cls === 'bow', shield: g.cls === 'shield' }) });
  for (const w of G.wounded) if (vis(w.x, w.y)) list.push({ y: w.y, f: () => {
    // yerde yatan yaralı
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(1.35);
    drawWarrior({ x: 0, y: 0, dir: 0, walk: 0, swing: 0, flash: 0, hp: 1, maxHp: 1 }, { cloth: '#7d8794', scale: 0.9, noWeapon: true });
    ctx.restore();
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🩸', w.x + 12, w.y - 6);
    const bob = Math.sin(G.t * 3) * 2;
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,200,190,0.9)';
    ctx.fillText((w.name || 'Yaralı asker') + ' (yaralı)', w.x, w.y - 30 + bob);
  } });
  for (const st of SIEGE_SITES) {
    // Kale fethedilince kuşatma kampının çemberi/bayrağı kalkar — savaş bitti,
    // kendi toprağının ortasında düşman kuşatma işareti durmasın.
    if (!G.outposts[st.id]) list.push({ y: st.y, f: () => drawSiegeSite(st) });
    const S = G.sieges[st.id];
    const engBar = (en, x, y) => { // savunucular vurduysa şantiye can barı
      if (en.hp === undefined || en.hp >= en.maxHp) return;
      ctx.fillStyle = 'rgba(20,15,8,0.7)'; ctx.fillRect(x - 24, y - 66, 48, 5);
      ctx.fillStyle = '#ff6b5e'; ctx.fillRect(x - 24, y - 66, 48 * Math.max(0, en.hp) / en.maxHp, 5);
    };
    for (const key of Object.keys(S)) {
      const en = S[key], E = ENGINES[key];
      if (!en.done) list.push({ y: en.y, f: () => { drawScaffold(en, E); engBar(en, en.x, en.y); } });
      else if (key === 'catapult') list.push({ y: en.y, f: () => { drawCatapult(en); engBar(en, en.x, en.y); } });
      else if (key === 'ballista') list.push({ y: en.y, f: () => { drawBallista(en); engBar(en, en.x, en.y); } });
      else list.push({ y: en.ry, f: () => { drawRam({ x: en.rx, y: en.ry, dir: en.dir, lunge: en.lunge }); engBar(en, en.rx, en.ry); } });
    }
  }
  // Dış kale surlarının kapıları: taş söve + demir kanat (dosta hep açık)
  for (const kg of (G.keepGates || [])) {
    if (!vis(kg.x, kg.y)) continue;
    list.push({ y: kg.y, f: () => {
      const yari = kg.boy / 2;
      ctx.save(); ctx.translate(kg.x, kg.y);
      if (!kg.dikey) ctx.rotate(Math.PI / 2);           // güney kapısı: yatay açıklık
      ctx.fillStyle = '#8f8f95';                        // taş söveler
      ctx.fillRect(-13, -yari - 16, 26, 18); ctx.fillRect(-13, yari - 2, 26, 18);
      ctx.fillStyle = '#a8a8ad';
      ctx.fillRect(-13, -yari - 16, 26, 6); ctx.fillRect(-13, yari - 2, 26, 6);
      ctx.fillStyle = '#5a4530';                        // açık duran çift kanat
      ctx.fillRect(-9, -yari, 7, yari - 4); ctx.fillRect(-9, 6, 7, yari - 4);
      ctx.fillStyle = '#6d5a48';
      ctx.fillRect(-9, -yari + 6, 7, 3); ctx.fillRect(-9, yari - 12, 7, 3);
      ctx.strokeStyle = 'rgba(30,26,20,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(2, -yari); ctx.lineTo(2, yari); ctx.stroke();
      ctx.restore();
    } });
  }
  if (G.palisade.built) {
    for (const st of G.palStakes) if (vis(st.x, st.y)) list.push({ y: st.y, f: () => drawStake(st) });
    list.push({ y: PAL_GATE.y, f: drawVillageGate });
  }
  // zindan kafesleri: esir komutanlar parmaklıklar ardında görünür
  for (const site of Object.keys(G.prisoners)) {
    const caps = jailCmds(site);
    if (!caps.length) continue;
    const jp = jailPos(site);
    if (!vis(jp.x, jp.y)) continue;
    list.push({ y: jp.y, f: () => {
      const { x, y } = jp;
      drawShadow(x, y + 4, 34, 9);
      // içerideki esir(ler): soluk, oturur pozda
      caps.slice(0, 2).forEach((m, i) => {
        const C = COMMANDERS[m.cmd];
        ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(x - 8 + i * 18, y + 3); ctx.scale(0.85, 0.78); ctx.translate(-(x - 8 + i * 18), -(y + 3));
        drawWarrior({ x: x - 8 + i * 18, y: y + 3, dir: 0, walk: 0, swing: 0, flash: 0, hp: 1, maxHp: 1 }, { cloth: C.cloth, scale: 1, noWeapon: true });
        ctx.restore();
      });
      // kafes: taban + demir parmaklıklar + üst kiriş
      ctx.fillStyle = '#4a4038'; ctx.fillRect(x - 34, y + 2, 68, 7);
      ctx.fillStyle = '#565e68';
      for (let bx = -32; bx <= 32; bx += 8) ctx.fillRect(x + bx - 1.5, y - 52, 3, 56);
      ctx.fillStyle = '#3c434c'; ctx.fillRect(x - 36, y - 56, 72, 7); ctx.fillRect(x - 36, y - 30, 72, 4);
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⛓️', x + 30, y - 58);
      const bob = Math.sin(G.t * 2.2) * 2;
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ff9a8a';
      ctx.fillText(caps.map(m => COMMANDERS[m.cmd].name).join(', '), x, y - 66 + bob);
    } });
  }
  // karakol surları (her zaman ahşap kazık görünümü)
  for (const st of G.opStakes) if (vis(st.x, st.y)) list.push({ y: st.y, f: () => drawOpStake(st) });
  // Kapı KIRIKKEN de çizilir: eskiden `s.alive` koşulu yüzünden hiçbir şey çizilmiyor,
  // surda sebepsiz bir boşluk kalıyordu ("kapı hiç gözükmüyor"). Artık direkler durur,
  // kanat kırılmış olarak yerde yatar — orada bir kapı olduğu ve onarım gerektiği belli.
  for (const s of G.structures) if (s.kind === 'owgate' && vis(s.x, s.y)) list.push({ y: s.y, f: () => {
    drawShadow(s.x, s.y, 30, 9);
    // Kapı DİK çizilir — kazıklar gibi. v3.8.2'de halkanın teğetine döndürmüştüm;
    // oyunun sahte-3B çiziminde döndürülen dikdörtgen "yere serilmiş tahta" gibi
    // duruyor, kapı olduğu anlaşılmıyordu. Genişlik açının yatay bileşenine göre
    // hafifçe daralır (yandan bakış hissi), yükseklik hep aynı kalır.
    // Kapı, surdaki boşluğu TAM doldurur. Kazıklar her yerde dik çizildiği için
    // kapıya da perspektif daraltması uygulanmaz — yoksa yandan bakınca kapı
    // daralıp deliğin ortasında yüzüyor gibi duruyordu.
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale((s.gw || 45) / 36, 1);   // çizim ±36 birim; boşluğun yarısına ölçekle
    // Kapı, kazık surun bir parçası gibi görünmeli: aynı açık ahşap tonu, aynı
    // sivri kazık başlıkları, ince demir kuşak. (Önceki hâli koyu ve iri kalıp
    // çitin yanında yamalı duruyordu.)
    const KY = 38;                                                 // kapı yüksekliği
    ctx.fillStyle = '#7a5327';                                     // yan direkler (kapı kırılsa da durur)
    ctx.fillRect(-36, -KY - 2, 11, KY + 9); ctx.fillRect(25, -KY - 2, 11, KY + 9);
    ctx.fillStyle = '#8d6231';                                     // sivri kazık başlıkları (çitle aynı dil)
    ctx.beginPath(); ctx.moveTo(-36, -KY - 2); ctx.lineTo(-30.5, -KY - 13); ctx.lineTo(-25, -KY - 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(25, -KY - 2); ctx.lineTo(30.5, -KY - 13); ctx.lineTo(36, -KY - 2); ctx.fill();
    ctx.fillStyle = '#6b4a26'; ctx.fillRect(-38, -KY - 6, 76, 7);   // üst kiriş
    if (s.alive) {
      ctx.fillStyle = '#9a7040'; ctx.fillRect(-25, -KY, 50, KY);    // çift kanat (çitten bir tık açık)
      ctx.strokeStyle = 'rgba(70,45,18,0.42)'; ctx.lineWidth = 1.2;
      for (let i = -19; i <= 19; i += 6.5) { ctx.beginPath(); ctx.moveTo(i, -KY + 2); ctx.lineTo(i, -2); ctx.stroke(); }
      ctx.fillStyle = '#6d5a48';                                    // ince demir kuşaklar
      ctx.fillRect(-25, -KY + 8, 50, 3.5); ctx.fillRect(-25, -13, 50, 3.5);
      ctx.strokeStyle = 'rgba(60,40,16,0.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -KY); ctx.lineTo(0, 0); ctx.stroke();   // kanat aralığı
      ctx.fillStyle = '#c9a24a';                                    // halkalar
      ctx.beginPath(); ctx.arc(-6, -18, 2.6, 0, TAU); ctx.arc(6, -18, 2.6, 0, TAU); ctx.fill();
    } else {
      // kırık: direkler ayakta, kanatlar parçalanıp yere düşmüş
      ctx.fillStyle = 'rgba(70,48,22,0.5)';
      ctx.fillRect(-26, -13, 24, 10); ctx.fillRect(4, -8, 22, 8);
      ctx.fillStyle = '#3a2a16';
      ctx.fillRect(-28, -KY, 7, 15); ctx.fillRect(20, -KY, 8, 11);   // kırık kanat kalıntıları
      ctx.strokeStyle = 'rgba(35,22,8,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(16, -2); ctx.stroke();
    }
    ctx.restore();
    if (!s.alive) { // kırık kapı: uyarı işareti
      ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🚨', s.x, s.y - 56 + Math.sin(G.t * 3) * 2);
    } else if (s.hp < s.maxHp) {
      ctx.fillStyle = 'rgba(20,15,8,0.7)'; ctx.fillRect(s.x - 22, s.y - 60, 44, 5);
      ctx.fillStyle = '#d8763a'; ctx.fillRect(s.x - 22, s.y - 60, 44 * s.hp / s.maxHp, 5);
    }
  } });
  for (const cv of G.caravans) if (vis(cv.x, cv.y)) list.push({ y: cv.y, f: () => {
    drawShadow(cv.x, cv.y, 20, 8);
    ctx.save(); ctx.translate(cv.x, cv.y);
    if (Math.cos(cv.dir) < 0) ctx.scale(-1, 1);
    ctx.fillStyle = '#4f3319';
    ctx.beginPath(); ctx.arc(-10, -3, 5, 0, TAU); ctx.arc(6, -3, 5, 0, TAU); ctx.fill(); // tekerler
    const satisDolu = cv.trade && (cv.buy ? cv.leg === 1 : cv.leg === 0);          // satışta giderken, alımda dönerken yüklü
    ctx.fillStyle = cv.supply || satisDolu ? '#6b7a3f' : '#8a5c33'; ctx.fillRect(-16, -16, 24, 11); // kasa
    if (cv.supply || satisDolu) { ctx.fillStyle = '#9fb060'; ctx.fillRect(-14, -19, 20, 4); } // yüklü çuval sırtı
    else { ctx.fillStyle = '#ffd257'; ctx.fillRect(-13, -14, 6, 4); ctx.fillRect(-4, -14, 6, 4); } // altın çuvalları
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cv.trade ? '🐪' : '🐴', 17, -4);
    ctx.restore();
    if (cv.supply || cv.trade) { // ne taşıdığı ve nereye gittiği başında yazsın
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(cv.trade && (cv.buy ? !cv.leg : cv.leg) ? '🪙' : cv.icon, cv.x, cv.y - 32);
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = cv.trade ? '#ffd97e' : '#c8e0a8';
      ctx.fillText('→ ' + (cv.trade ? (cv.leg ? cv.from : 'Tüccar') : cv.toName), cv.x, cv.y - 44);
    }
    if (cv.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${cv.flash * 4})`; ctx.beginPath(); ctx.ellipse(cv.x, cv.y - 8, 20, 12, 0, 0, TAU); ctx.fill(); }
    if (cv.hp < cv.maxHp) {
      ctx.fillStyle = 'rgba(20,15,25,0.8)'; ctx.fillRect(cv.x - 18, cv.y - 28, 36, 5);
      ctx.fillStyle = '#e8a13d'; ctx.fillRect(cv.x - 17, cv.y - 27, 34 * Math.max(0, cv.hp / cv.maxHp), 3);
    }
  } });
  if (!G.dead) list.push({ y: G.player.y, f: () => {
    const pl = G.player;
    // savuruşta salt görsel atılım (pozisyon değişmez)
    const off = pl.swing > 0 ? Math.sin((0.18 - pl.swing) / 0.18 * Math.PI) * 6 : 0;
    // şarj halkası (güçlü vuruş doluyor)
    if (pl.charging && pl.chargeT > 0.12) {
      const cp = Math.min(1, pl.chargeT / 0.55);
      ctx.save();
      ctx.globalAlpha = 0.35 + cp * 0.3;
      ctx.strokeStyle = cp >= 1 ? '#ffd257' : '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pl.x, pl.y - 8, 22 + cp * 22, 0, TAU * cp); ctx.stroke();
      ctx.restore();
    }
    // kılıç izi: savuruş yayı (güçlü vuruşta altın ve geniş)
    if (pl.swing > 0) {
      const heavy = pl.heavyFx > 0;
      const prog = 1 - pl.swing / (heavy ? 0.22 : 0.18);
      ctx.save();
      ctx.globalAlpha = (heavy ? 0.55 : 0.4) * (1 - prog);
      ctx.strokeStyle = heavy ? '#ffd257' : '#fff';
      ctx.lineWidth = heavy ? 16 : 10; ctx.lineCap = 'round';
      ctx.beginPath();
      if (heavy) ctx.arc(pl.x, pl.y - 26, 56, pl.dir - 2.0 + prog * 2.6, pl.dir - 0.4 + prog * 2.6);
      else ctx.arc(pl.x, pl.y - 26, 46, pl.dir - 1.1 + prog * 1.4, pl.dir - 0.3 + prog * 1.4);
      ctx.stroke();
      ctx.restore();
    }
    drawWarrior({ ...pl, x: pl.x + Math.cos(pl.dir) * off, y: pl.y + Math.sin(pl.dir) * off },
      { cloth: SKIN.playerCloth || '#7d8aa8', scale: 1.22, belt: true, helmet: SKIN.playerHelmet || '#c9a24a', crest: SKIN.playerCrest || '#3fa8d8', mount: G.riding, horse: SKIN.horse || '#6e4a26' });
  } });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) it.f();

  // mermiler (taş, parabol)
  for (const pr of G.projectiles) {
    const t = pr.t, x = lerp(pr.x0, pr.x1, t), y = lerp(pr.y0, pr.y1, t) - Math.sin(Math.PI * t) * 110;
    drawShadow(lerp(pr.x0, pr.x1, t), lerp(pr.y0, pr.y1, t), 8, 4);
    ctx.fillStyle = '#6f6f68'; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8b8b83'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 4, 0, TAU); ctx.fill();
  }

  // şifa damlaları
  ctx.textAlign = 'center';
  for (const pk of G.pickups) {
    const bob = Math.sin(G.t * 4 + pk.x * 0.1) * 3;
    ctx.globalAlpha = pk.t < 3 ? Math.sin(G.t * 10) * 0.3 + 0.6 : 1;
    ctx.font = '15px sans-serif';
    ctx.fillText('❤️', pk.x, pk.y - 10 + bob);
    ctx.globalAlpha = 1;
  }

  // oklar
  for (const a of G.arrows) {
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.dir);
    if (a.big) ctx.scale(1.7, 1.7); // balista oku
    ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.fillStyle = '#c9ced6';
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // parçacıklar
  for (const pa of G.particles) {
    ctx.globalAlpha = pa.t / pa.max * 0.6;
    ctx.fillStyle = pa.c || '#d9c9a0';
    ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- EN ÜST tabela katmanı: sur/duvar/bina hiçbir tabelayı örtemez ----
  for (const p2 of G.plots) if (!p2.built && vis(p2.x, p2.y)) drawPlotSign(p2);
  for (const b2 of G.buildings) {
    if (!vis(b2.x, b2.y)) continue;
    if (b2.ruined) { // yıkık: tamir bedeli (her zaman görünür — önemli)
      if (BUILDINGS[b2.type]) drawTag(b2.x, b2.y + 14, '🔧 ' + remainText(bcost(repairCost(b2.type)), b2.repPaid), '#ffb0a8', 'rgba(255,120,110,0.45)');
      continue;
    }
    const uc = nextUpCost(b2);
    if (!uc || dist(G.player.x, G.player.y, b2.x, b2.y) > 200) continue;
    drawTag(b2.x, b2.y + 14, '⬆Sv.' + (b2.lv + 1) + ' ' + remainText(bcost(uc), b2.upPaid), '#c8f0b8', 'rgba(140,220,140,0.4)');
  }
  // Konak üstünde köy deposu özeti: biriken ürünler bir bakışta
  if (vis(CAMPFIRE.x, CAMPFIRE.y)) {
    const parts = [];
    for (const [k, icon] of RES_DEF) {
      const v = Math.floor(G.stock[k] || 0);
      if (v > 0) parts.push(icon + v);
    }
    if (parts.length) drawTag(CAMPFIRE.x, CAMPFIRE.y - 112, '🏬 ' + parts.join(' '), '#ffe9b0', 'rgba(255,217,126,0.4)');
  }
  // Fethedilen üslerin ambarı: sancağın üstünde ne birikmiş görünsün
  for (const [oid2, op3] of Object.entries(G.outposts)) {
    if (!op3 || op3.isVillage || !op3.owned || op3.looted) continue;
    const O3 = OUTPOSTS[oid2];
    if (!O3 || !vis(O3.x, O3.y)) continue;
    const par2 = [];
    for (const [k2, ic2] of RES_DEF) {
      const v2 = Math.floor((op3.stock || {})[k2] || 0);
      if (v2 > 0) par2.push(ic2 + v2);
    }
    if (par2.length) drawTag(O3.x, O3.y - 92, '🏳️ ' + par2.join(' '), '#d8f0b8', 'rgba(150,210,120,0.45)');
  }
  // 🏝️ yoldaş hayaletleri: adadaki arkadaşların son bilinen konumları (sözde-canlılık)
  if (ISLAND && G.islandMates && G.islandMates.length) {
    for (const m of G.islandMates) {
      if (!m.pos || !vis(m.pos.x, m.pos.y) || CO.peers[m.id]) continue; // canlı görünüyorsa hayalete gerek yok
      const bob = Math.sin(G.t * 2.4 + (m.pos.x % 7)) * 3;
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = 'rgba(120,180,255,0.35)';
      ctx.beginPath(); ctx.ellipse(m.pos.x, m.pos.y + 4, 14, 6, 0, 0, TAU); ctx.fill();
      ctx.font = '26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🧙', m.pos.x, m.pos.y - 6 + bob);
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#a8d0ff';
      ctx.fillText(m.name, m.pos.x, m.pos.y - 34 + bob);
      ctx.globalAlpha = 1;
    }
  }

  // şantiyeye uçan kaynaklar (yay çizerek)
  ctx.textAlign = 'center';
  for (const f of (G.flyItems || [])) {
    const x = f.x0 + (f.x1 - f.x0) * f.t;
    const y = f.y0 + (f.y1 - f.y0) * f.t - Math.sin(Math.PI * f.t) * 48;
    ctx.font = '15px sans-serif'; ctx.globalAlpha = 0.95;
    ctx.fillText(f.icon, x, y);
  }
  ctx.globalAlpha = 1;

  // hasar yazıları
  ctx.textAlign = 'center';
  for (const f of G.floaters) {
    ctx.font = 'bold ' + f.size + 'px sans-serif';
    ctx.globalAlpha = Math.min(1, f.t * 2);
    ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  drawWeather(); // yağmur/kar/sis/fırtına katmanı (ekran uzayı)

  // gece karanlığı + ışık kaynakları (inde her zaman zifiri)
  // İnde karanlık 0.66'dan 0.5'e indi: taş dokusu ve oda/koridor ayrımı görünsün
  // (referans zindanlar loş değil, aydınlık; atmosferi meşale ışığı veriyor).
  const dark = G.caveRun ? 0.5 : (G.night ? Math.min(1, Math.min(G.dayT / 6, (DAYLEN.night - G.dayT) / 6)) * 0.52 : 0);
  if (dark > 0 && lightCv) {
    const L = lightCv.getContext('2d');
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, VW, VH);
    L.fillStyle = G.caveRun ? `rgba(26,14,52,${dark})` : `rgba(12,16,50,${dark})`;
    L.fillRect(0, 0, VW, VH);
    L.globalCompositeOperation = 'destination-out';
    const punch = (lx, ly, r, a) => {
      const g2 = L.createRadialGradient(lx, ly, r * 0.2, lx, ly, r);
      g2.addColorStop(0, `rgba(255,255,255,${a})`); g2.addColorStop(1, 'rgba(255,255,255,0)');
      L.fillStyle = g2; L.beginPath(); L.arc(lx, ly, r, 0, TAU); L.fill();
    };
    if (G.caveRun) {
      for (const t of (G.caveTorches || [])) punch(t.x - cx, t.y - cy - 20, 330, 0.85); // duvar meşaleleri
      for (const k of (G.caveCrystals || [])) punch(k.x - cx, k.y - cy - 10, 200, 0.55); // kristal ışığı
      if (!G.dead) punch(G.player.x - cx, G.player.y - cy - 20, 230, 0.95); // meşale
      const cc = G.structures.find(s2 => s2.kind === 'cavechest' && s2.alive);
      if (cc) punch(cc.x - cx, cc.y - cy - 10, 110, 0.6);
      const pp = G.props.find(pr2 => pr2.kind === 'portal');
      if (pp) punch(pp.x - cx, pp.y - cy - 16, 130, 0.8);
    } else {
      punch(CAMPFIRE.x - cx, CAMPFIRE.y - cy - 10, 260, 1);
      for (const b of G.buildings) if (b.type === 'watchtower' && !b.ruined) punch(b.x - cx, b.y - cy - 45, 180, 0.9);
      if (!G.dead) punch(G.player.x - cx, G.player.y - cy - 20, 130, 0.8);
    }
    L.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCv, 0, 0, VW, VH);
  }

  // görev oku
  drawQuestArrow(cx, cy);

  // vinyet
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.45, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(30,15,5,0.35)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  // hasar flaşı: kenarlardan kızıl nabız
  if (G.hurtFlash > 0) {
    const hf = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    hf.addColorStop(0, 'rgba(180,20,10,0)'); hf.addColorStop(1, `rgba(180,20,10,${G.hurtFlash * 1.4})`);
    ctx.fillStyle = hf; ctx.fillRect(0, 0, VW, VH);
  }
  // sızma mini oyunu katmanı: zamanlama halkası
  if (G.infil) {
    const f = G.infil;
    ctx.fillStyle = 'rgba(8,6,14,0.78)'; ctx.fillRect(0, 0, VW, VH);
    if (f.phase === 'chain') { // ⛓️ ZİNCİR KIRMA: yoldaşın bileklerindeki halkaları vur
      const cx2 = VW / 2, zY = VH * 0.44;
      // zindan duvarı
      ctx.fillStyle = '#2b2338'; ctx.fillRect(0, zY - 90, VW, 190);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for (let bx = 8; bx < VW; bx += 54) for (let by = zY - 86; by < zY + 96; by += 30) ctx.fillRect(bx, by, 46, 24);
      // meşale ışığı
      const tg2 = ctx.createRadialGradient(cx2, zY - 20, 20, cx2, zY - 20, 240);
      tg2.addColorStop(0, 'rgba(255,190,90,0.16)'); tg2.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = tg2; ctx.fillRect(0, zY - 90, VW, 190);
      // zincire vurulmuş yoldaş
      drawWarrior({ x: cx2, y: zY + 34, dir: -Math.PI / 2, walk: 0, swing: 0, flash: 0, hp: 1, maxHp: 1 },
        { cloth: '#6a5a48', scale: 1.05, belt: true });
      // halkalar (kırılınca kopuk uç sallanır)
      for (const z of f.zincir) {
        const zx = cx2 + z.o;
        if (z.alive) {
          ctx.strokeStyle = '#9aa3b0'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(zx, zY - 4, 9, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#6b7481'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(zx, zY - 13); ctx.lineTo(zx, zY - 30); ctx.stroke();
        } else {
          ctx.strokeStyle = '#5a6270'; ctx.lineWidth = 3;
          const sal = Math.sin(G.t * 5 + zx) * 4;
          ctx.beginPath(); ctx.moveTo(zx, zY - 30); ctx.lineTo(zx + sal, zY - 16); ctx.stroke();
        }
      }
      if (f.shotFx) {
        ctx.strokeStyle = f.shotFx.hit ? '#57d364' : '#ff6b5e'; ctx.lineWidth = 3; ctx.globalAlpha = f.shotFx.t / 0.3;
        const [sx2, sy2] = bowCrossPos(f);
        ctx.beginPath(); ctx.arc(sx2, sy2, 26 - f.shotFx.t * 50, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const [mx3, my3] = bowCrossPos(f);
      ctx.fillStyle = '#e83a2e'; ctx.beginPath(); ctx.arc(mx3, my3, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#57d364'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      for (let qa = 0; qa < 4; qa++) {
        const base = Math.PI / 4 + qa * Math.PI / 2;
        ctx.beginPath(); ctx.arc(mx3, my3, 17, base - 0.4, base + 0.4); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#ffd97e';
      ctx.fillText('⛓️ Zincirleri kır!  (' + f.kirik + '/3)', cx2, zY - 108);
      ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(240,230,205,0.85)';
      ctx.fillText('Halkalar küçük hedef — nişangah tam üstündeyken at. Yoldaşını vurma!', cx2, zY + 118);
      ctx.font = '20px sans-serif';
      ctx.fillText('➳'.repeat(Math.max(0, f.arrows)), cx2, zY + 148);
      return;
    }
    if (f.phase === 'gate') { // 💥 BARUT SABOTAJI: tokmağı sürgünün işaretli yerine çak
      const cx2 = VW / 2, gY = VH * 0.44;
      // kapı
      ctx.fillStyle = '#3a2a16'; ctx.fillRect(cx2 - 150, gY - 130, 300, 190);
      ctx.fillStyle = '#6b4a26'; ctx.fillRect(cx2 - 138, gY - 120, 276, 174);
      ctx.strokeStyle = 'rgba(30,18,6,0.5)'; ctx.lineWidth = 2;
      for (let i2 = -120; i2 <= 120; i2 += 30) { ctx.beginPath(); ctx.moveTo(cx2 + i2, gY - 120); ctx.lineTo(cx2 + i2, gY + 54); ctx.stroke(); }
      ctx.fillStyle = '#54606c'; ctx.fillRect(cx2 - 138, gY - 96, 276, 14); ctx.fillRect(cx2 - 138, gY + 8, 276, 14);
      // barut fıçısı
      ctx.fillStyle = '#4a3520'; ctx.fillRect(cx2 - 26, gY + 12, 52, 44);
      ctx.fillStyle = '#63482c'; ctx.fillRect(cx2 - 26, gY + 18, 52, 8); ctx.fillRect(cx2 - 26, gY + 42, 52, 8);
      ctx.font = '17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💥', cx2, gY + 44);
      // sürgü çubuğu + hedef bandı
      const barY = gY + 96, barX = cx2 - 210, barW = 420;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(barX, barY, barW, 22);
      const yari2 = 0.13 - f.vurus * 0.028;
      ctx.fillStyle = '#2f7a37';
      ctx.fillRect(barX + (f.hedef - yari2) * barW, barY, yari2 * 2 * barW, 22);
      ctx.fillStyle = '#57d364';
      ctx.fillRect(barX + (f.hedef - yari2) * barW, barY, yari2 * 2 * barW, 5);
      // tokmak
      const tp = gateBarPos(f), tx3 = barX + tp * barW;
      ctx.fillStyle = '#ffd257'; ctx.fillRect(tx3 - 3, barY - 8, 6, 38);
      ctx.font = '22px sans-serif'; ctx.fillText('🔨', tx3, barY - 12);
      if (f.vurusFx) {
        ctx.globalAlpha = f.vurusFx.t / 0.3;
        ctx.strokeStyle = f.vurusFx.hit ? '#57d364' : '#ff6b5e'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(barX + f.vurusFx.p * barW, barY + 11, 34 - f.vurusFx.t * 70, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#ffd97e';
      ctx.fillText('💥 Kapıyı sabote et!  (' + f.vurus + '/' + GATE_STRIKES + ')', cx2, gY - 150);
      ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(240,230,205,0.85)';
      ctx.fillText('Tokmak YEŞİL banttayken çak — her isabet kapıyı %9 yıpratır.', cx2, barY + 52);
      ctx.fillText('Iskalarsan gürültü çıkar, o anki hasarla kaçmak zorunda kalırsın.', cx2, barY + 72);
      ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ff9a8a';
      ctx.fillText('kapıda birikmiş hasar: %' + Math.round((f.hasar || 0) * 100), cx2, barY + 98);
      return;
    }
    if (f.phase === 'bow') { // OK YAĞMURU: surdaki nöbetçilere nişan al
      const cx2 = VW / 2, wallY = VH * 0.42;
      // sur bandı + mazgallar
      ctx.fillStyle = '#77777d'; ctx.fillRect(0, wallY, VW, 64);
      ctx.fillStyle = '#8f8f95'; ctx.fillRect(0, wallY, VW, 14);
      ctx.fillStyle = '#a8a8ad';
      for (let bx = 12; bx < VW; bx += 46) ctx.fillRect(bx, wallY - 12, 24, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, wallY + 58, VW, 6);
      // nöbetçiler (sur üstünde)
      for (const t2 of f.targets) {
        if (!t2.alive) continue;
        drawWarrior({ x: cx2 + t2.o, y: wallY - 4, dir: Math.PI / 2, walk: G.t * 2.5, swing: 0, flash: 0, hp: 1, maxHp: 1 },
          { cloth: '#4a4a55', scale: 0.9, belt: true, helmet: '#9a9a9f' });
      }
      // atış geri bildirimi
      if (f.shotFx) {
        ctx.strokeStyle = f.shotFx.hit ? '#57d364' : '#ff6b5e'; ctx.lineWidth = 3; ctx.globalAlpha = f.shotFx.t / 0.3;
        const [sx2, sy2] = bowCrossPos(f);
        ctx.beginPath(); ctx.arc(sx2, sy2, 30 - f.shotFx.t * 60, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // nişangah: kırmızı nokta + 4 yeşil kanat (sallanır)
      const [mx, my] = bowCrossPos(f);
      ctx.fillStyle = '#e83a2e'; ctx.beginPath(); ctx.arc(mx, my, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#57d364'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let qa = 0; qa < 4; qa++) {
        const base = Math.PI / 4 + qa * Math.PI / 2;
        ctx.beginPath(); ctx.arc(mx, my, 22, base - 0.42, base + 0.42); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // metinler + ok sayacı
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#ffd97e';
      ctx.fillText('🏹 Surdaki nöbetçileri indir!  (' + f.kills + ')', cx2, wallY - 64);
      ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(240,230,205,0.85)';
      ctx.fillText('Dokun / [Boşluk] — nişangah nöbetçinin üstündeyken at! Kalan süre: ' + Math.max(0, Math.ceil(15 - f.bowT)) + 'sn', cx2, wallY + 104);
      ctx.font = '20px sans-serif';
      ctx.fillText('➳'.repeat(Math.max(0, f.arrows)), cx2, wallY + 136);
      return; // halka çizimi yok
    }
    const ST = INFIL_STAGES[f.stage];
    const cx2 = VW / 2, cy2 = VH * 0.46, R2 = Math.min(120, VH * 0.16);
    // halka
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(cx2, cy2, R2, 0, TAU); ctx.stroke();
    // yeşil bölge
    ctx.strokeStyle = f.flash > 0 ? '#a8f0b0' : '#57d364'; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.arc(cx2, cy2, R2, f.gC - ST.half, f.gC + ST.half); ctx.stroke();
    // ibre
    ctx.strokeStyle = '#ffd257'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx2 + Math.cos(f.ang) * (R2 - 26), cy2 + Math.sin(f.ang) * (R2 - 26));
    ctx.lineTo(cx2 + Math.cos(f.ang) * (R2 + 24), cy2 + Math.sin(f.ang) * (R2 + 24)); ctx.stroke();
    ctx.lineCap = 'butt';
    // merkez + metinler
    ctx.textAlign = 'center';
    ctx.font = '40px sans-serif'; ctx.fillText('🥷', cx2, cy2 + 14);
    ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#ffd97e';
    ctx.fillText(ST.t + '  (' + (f.stage + 1) + '/3)', cx2, cy2 - R2 - 44);
    ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(240,230,205,0.85)';
    ctx.fillText('Dokun ya da [Boşluk] — ibreyi YEŞİLDE durdur! Kaçırırsan yakalanırsın.', cx2, cy2 + R2 + 46);
    ctx.fillText('Aşamalar hızlanır ve daralır · çok beklersen nöbetçi fark eder', cx2, cy2 + R2 + 66);
  }
}
// Hava katmanı: çizgi yağmur / süzülen kar / sis yumakları / fırtına flaşı
function drawWeather() {
  const w2 = G.weather;
  if (!w2 || w2 === 'clear' || G.caveRun) return;
  ctx.save();
  if (w2 === 'rain' || w2 === 'storm') {
    const firtina = w2 === 'storm';
    // Üç derinlik katmanı: uzak damlalar ince/yavaş/soluk, ön plandakiler kalın/hızlı/uzun
    const kat = firtina
      ? [{ n: 46, sp: 900, uz: 20, kal: 1, al: 0.22, eg: 0.20 }, { n: 40, sp: 1250, uz: 30, kal: 1.6, al: 0.34, eg: 0.24 }, { n: 22, sp: 1750, uz: 46, kal: 2.6, al: 0.42, eg: 0.28 }]
      : [{ n: 34, sp: 620, uz: 15, kal: 0.9, al: 0.18, eg: 0.10 }, { n: 26, sp: 880, uz: 24, kal: 1.4, al: 0.28, eg: 0.13 }, { n: 12, sp: 1240, uz: 38, kal: 2.2, al: 0.36, eg: 0.16 }];
    for (let k = 0; k < kat.length; k++) {
      const L = kat[k];
      ctx.strokeStyle = 'rgba(178,206,236,' + L.al + ')';
      ctx.lineWidth = L.kal; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < L.n; i++) {
        const sk = i * 7919 + k * 104729;
        const x = ((sk % 1013) / 1013 * (VW + 120) + G.t * L.sp * L.eg) % (VW + 120) - 60;
        const y = ((sk % 977) / 977 * (VH + 80) + G.t * L.sp) % (VH + 80) - 40;
        ctx.moveTo(x, y); ctx.lineTo(x - L.uz * L.eg, y + L.uz);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // yere çarpan damlaların sıçrama halkaları
    ctx.strokeStyle = 'rgba(200,224,248,' + (firtina ? 0.3 : 0.22) + ')'; ctx.lineWidth = 1.2;
    const sn = firtina ? 16 : 9;
    for (let i = 0; i < sn; i++) {
      const sk = i * 6151;
      const faz = (G.t * 1.9 + (sk % 100) / 100) % 1;
      const x = (sk % 1009) / 1009 * VW;
      const y = VH * 0.45 + ((sk % 883) / 883) * VH * 0.55;
      ctx.globalAlpha = 1 - faz;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + faz * 9, (2 + faz * 9) * 0.35, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // cama düşmüş iri damlalar (ön plan derinliği)
    ctx.fillStyle = 'rgba(206,228,250,' + (firtina ? 0.16 : 0.11) + ')';
    for (let i = 0; i < (firtina ? 7 : 4); i++) {
      const sk = i * 3571;
      const faz = (G.t * 0.55 + (sk % 100) / 100) % 1;
      const x = (sk % 991) / 991 * VW;
      const y = faz * (VH + 60) - 30;
      ctx.beginPath(); ctx.ellipse(x, y, 3.2, 6.5, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(28,38,58,' + (firtina ? 0.17 : 0.09) + ')';
    ctx.fillRect(0, 0, VW, VH);
    if ((G.wFlash || 0) > 0) { // gökten inen soğuk parlama: iki kez kırpışır, aşağı doğru söner
      const f = G.wFlash;
      const kirpis = f > 0.34 ? 1 : f > 0.26 ? 0.35 : f > 0.2 ? 0.8 : f / 0.25;
      const a = Math.min(0.3, f * 0.72) * kirpis;
      const g3 = ctx.createLinearGradient(0, 0, 0, VH);
      g3.addColorStop(0, 'rgba(206,228,255,' + a + ')');
      g3.addColorStop(0.5, 'rgba(196,218,255,' + (a * 0.4) + ')');
      g3.addColorStop(1, 'rgba(190,210,245,0)');
      ctx.fillStyle = g3; ctx.fillRect(0, 0, VW, VH);
    }
  } else if (w2 === 'snow') {
    // Üç katman: uzak taneler küçük/yavaş, ön plandakiler iri ve yumuşak
    const kat = [{ n: 40, r: 1.2, sp: 34, sal: 22, al: 0.55 }, { n: 26, r: 2.2, sp: 58, sal: 34, al: 0.75 }, { n: 12, r: 3.6, sp: 86, sal: 46, al: 0.9 }];
    for (let k = 0; k < kat.length; k++) {
      const L = kat[k];
      ctx.fillStyle = 'rgba(244,249,255,' + L.al + ')';
      for (let i = 0; i < L.n; i++) {
        const sk = i * 7919 + k * 104729;
        const x = ((sk % 1013) / 1013 * (VW + 60) + Math.sin(G.t * 0.7 + i) * L.sal + G.t * 18) % (VW + 60) - 30;
        const y = ((sk % 977) / 977 * (VH + 60) + G.t * L.sp) % (VH + 60) - 30;
        ctx.beginPath(); ctx.arc(x, y, L.r, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(222,236,255,0.09)'; ctx.fillRect(0, 0, VW, VH);
  } else if (w2 === 'fog') {
    for (let i = 0; i < 5; i++) {
      const x = (i * 331 + G.t * 20) % (VW + 420) - 210;
      const y = 50 + i * VH / 5 + Math.sin(G.t * 0.4 + i * 2) * 24;
      const g2 = ctx.createRadialGradient(x, y, 30, x, y, 250);
      g2.addColorStop(0, 'rgba(202,207,212,0.17)'); g2.addColorStop(1, 'rgba(202,207,212,0)');
      ctx.fillStyle = g2; ctx.fillRect(x - 250, y - 250, 500, 500);
    }
    ctx.fillStyle = 'rgba(192,200,206,0.14)'; ctx.fillRect(0, 0, VW, VH);
  }
  ctx.restore();
}
function drawQuestArrow(cx, cy) {
  if (G.questIdx >= QUESTS.length) return;
  const t = QUESTS[G.questIdx].target();
  if (!t) return;
  const sx = t.x - cx, sy = t.y - cy;
  const margin = 46;
  if (sx > margin && sx < VW - margin && sy > margin && sy < VH - margin) {
    if (dist(t.x, t.y, G.player.x, G.player.y) > 130) {
      const bob = Math.sin(G.t * 4) * 5;
      ctx.fillStyle = '#ffd257'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('▼', sx, sy - 72 + bob);
    }
    return;
  }
  const ang = Math.atan2(sy - VH / 2, sx - VW / 2);
  const ex = clamp(sx, margin, VW - margin), ey = clamp(sy, margin, VH - margin);
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(20,18,30,0.75)'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd257';
  ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-5, -9); ctx.lineTo(-5, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- Ana döngü ----------
let lastT = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (MENU_OPEN) { G.t += dt; render(); requestAnimationFrame(frame); return; } // menüde dünya durur, sahne canlı kalır
  if (G.hitstop > 0) { G.hitstop -= dt; dt *= 0.12; } // vuruş anında kısa zaman donması
  update(dt);
  render();
  requestAnimationFrame(frame);
}
// rAF duraklarsa (arka plan sekmesi) mantık donmasın
setInterval(() => {
  const now = performance.now();
  if (now - lastT > 250 && !MENU_OPEN) { lastT = now; update(0.05); }
}, 100);

// ---------- Başlat ----------
// Harita düzeni: vilayet sırası → özel (editörden) ya da yerleşik düzen (eski "bölge" davranışıyla birebir)
const LAYOUT_IDX = PROV0.idx % BUILTIN_MAPS.length;
let CUSTOM_MAPS = {};
CUSTOM_MAPS = JSON.parse(JSON.stringify(KDC.maps || {}));               // yayındaki harita düzenleri
try { Object.assign(CUSTOM_MAPS, JSON.parse(localStorage.getItem('kd-maps')) || {}); } catch (e) { }
if (ISLAND) {
  // Dostluk Adası: ~5.5 kat alan, tek tohumdan herkese aynı dünya, düşmanlar 3 kademe çetin
  WORLD.w = 11500; WORLD.h = 6200;
  OVERWORLD_W = WORLD.w; CAVE_AREA.x0 = WORLD.w + 2000; // doğu mağara şeridi adada yok
  rng = mulberry32((ISLAND.seed | 0) + 1);
  G.region = REGION0 + 3;
  applyGeography(islandGeo());
  genWorld();
  genIslandExtras();
} else {
  applyGeography(CUSTOM_MAPS[LAYOUT_IDX] || BUILTIN_MAPS[LAYOUT_IDX]);
  genWorld();
}
load();
// Admin düzeni: admin.html'de "kalıcı yap" denmiş dünya yerleşimi bu vilayete her açılışta uygulanır
function applyAdminWorld() {
  if (ISLAND || VISIT) return;
  let d = null;
  try { d = JSON.parse(localStorage.getItem('kd-admin-world-' + PROV0.id)); } catch (e) { }
  if (!d) d = (KDC.worlds || {})[PROV0.id] || null;   // yerelde yoksa yayındaki dünya yerleşimi
  if (!d) return;
  if (d.enemies) {
    G.enemies = [];
    for (const e of d.enemies) {
      spawnEnemy(e.type, e.x, e.y, e.camp || 'admin', e.race);
      const ne = G.enemies[G.enemies.length - 1];
      if (e.hp) { ne.hp = e.hp; ne.maxHp = Math.max(ne.maxHp, e.hp); }
    }
  }
  if (d.nodes) G.nodes = d.nodes.map(n => ({ kind: n.kind, x: n.x, y: n.y, hp: (NODE_DEF[n.kind] || { hp: 30 }).hp, alive: true, respT: 0, seed: Math.random() }));
  if (d.animals) { G.animals = []; for (const a of d.animals) spawnAnimal(a.type, a.x, a.y); }
}
applyAdminWorld();
if (ISLAND) { // kendi meta yüklendikten sonra: ortak durum + başlangıç konumu
  G.player.x = CAMPFIRE.x + 120; G.player.y = CAMPFIRE.y + 40;
  for (const u of [...G.soldiers, ...G.commanders]) { u.x = CAMPFIRE.x + rr(-80, 160); u.y = CAMPFIRE.y + rr(-70, 90); }
  G.islOps = {};
  applyIslandState(ISLAND, true);
}
rebuildPalisade(); // kayıttan gelen kademe/seviyeye göre suru yeniden kur
renderGround();
G.cam.x = clamp(G.player.x - VW / 2, 0, WORLD.w - VW);
G.cam.y = clamp(G.player.y - VH / 2, 0, WORLD.h - VH);
updateHUD();
checkQuests();
markRumors();
document.getElementById('mapTitle').textContent = '🗺️ ' + PROV0.name + ' — ' + WORLD_COUNTRIES[PROV0.country].name + ' (Kademe ' + PROV0.tier + ')';

// ---------- Çevrimiçi başlangıç ----------
G.helpFx = { don: {}, repairs: 0, kills: 0 };
G.islOps = G.islOps || {};
if (ISLAND && NETP) coopConnect('island', 'kd-i-' + ISLAND.id, false); // host, kanaldaki en küçük kimlikle belirlenir
else if (VISIT && NETP) coopConnect('visit', 'kd-v-' + VISIT.host, false);
else if (NETP) coopConnect('visit', 'kd-v-' + NETP.id, true); // kendi köyümün sahibiyim: yoldaş gelirse dünyayı ben yayınlarım
if (ISLAND) {
  $('visitBar').classList.add('island');
  $('visitBar').classList.remove('hidden');
  $('visitLeave').textContent = '⛵ Eve Dön';
  const vt2 = $('visitTime'); if (vt2) vt2.textContent = '';
  document.getElementById('mapTitle').textContent = '🗺️ ' + ISLAND.name + ' (Dostluk Adası)';
  setTimeout(() => {
    banner('🏝️ ' + ISLAND.name.toUpperCase());
    toast('Ortak üs, ortak depo, ortak sefer! Kamplar, kaleler ve Ada Devi hepiniz için bir kez düşer. Kazandığın kaynak/kuşam eve döner.', false);
  }, 600);
} else if (VISIT) {
  G.visitLeft = VISIT.remaining;
  $('visitName').textContent = '🤝 ' + VISIT.name + ' köyündesin';
  $('visitBar').classList.remove('hidden');
  document.getElementById('mapTitle').textContent = '🗺️ ' + VISIT.name + ' köyü (ziyaret)';
  setTimeout(() => {
    banner('🤝 ' + VISIT.name.toUpperCase() + ' KÖYÜ');
    toast('Yardım et: topla, avlan, düşman öldür, yıkıkları onar — hepsi ayrılınca ona kalır. Süre: 10 dk/gün', false);
  }, 600);
} else if (NETP) {
  G.netHelpPending = true; // yardımlar oyun başlayınca uygulanır (menüde kayıt kapalı)
  netQueueUpload(true); // güncel köyü buluta işle
}
$('visitLeave').addEventListener('click', () => { if (VISIT) endVisit(); else if (ISLAND) exitIsland(); });

// ---------- Ana menü ----------
function introBanners() {
  if (G.freshRegion) setTimeout(() => { banner(WORLD_COUNTRIES[PROV0.country].flag + ' ' + PROV0.name.toUpperCase() + ' SEFERİ'); toast('Yeni topraklar... Köyünü yeniden kur. Düşmanlar burada daha güçlü!', true); }, 400);
  else if (G.questIdx === 0) setTimeout(() => { banner('KÜLLERDEN DOĞUŞ'); setTimeout(() => toast('🌍 ' + PROV0.name + '\'ta yeniden doğuyorsun — ' + (RACES[PROV0.race] || {}).name + ' diyarı. Hedef: bilinen cihanın tamamı (Konak → Cihan Haritası)', true), 2800); }, 400);
}
function startGame() {
  if (!MENU_OPEN) return;
  MENU_OPEN = false;
  document.body.classList.remove('menuOpen');
  $('mainMenu').classList.add('hidden');
  audio();
  dedupeUnique();      // eski kayıtlarda oluşmuş çift demirci/kışla vb. temizlenir
  ensureHunters();     // yemek yerelleşti: her üste bir avcı kulübesi arsası şart
  lastT = performance.now();
  introBanners();
}
function buildMenu() {
  const hasSave = !!SAVED0;
  const P = PROV0, C = WORLD_COUNTRIES[P.country];
  $('menuPlay').innerHTML = hasSave
    ? '▶ Devam Et<span class="sub">' + C.flag + ' ' + P.name + ' · Gün ' + ((SAVED0 && SAVED0.day) || 1) + ' · 👑' + ((SAVED0 && SAVED0.dynasty) || 0) + '</span>'
    : '▶ Başla<span class="sub">🌍 ' + WORLD_PROVINCES[0].name + ', ' + WORLD_COUNTRIES[WORLD_PROVINCES[0].country].name + ' — cihan seni bekliyor</span>';
  // kayıt yuvası kartları
  let sh = '';
  for (let n = 0; n < 3; n++) {
    let info = 'boş';
    try {
      const d2 = JSON.parse(localStorage.getItem(slotKey(n)));
      if (d2) {
        const dp = (d2.provinceId && PROV_BY_ID[d2.provinceId]) || provFromLegacy(d2.region);
        info = dp.name + ' · Gün ' + (d2.day || 1) + '<br>👑' + (d2.dynasty || 0);
      }
    } catch (e2) { }
    sh += '<div class="slotCard' + (n === SAVE_SLOT ? ' active' : '') + '" data-slot="' + n + '"><b>' + (n === SAVE_SLOT ? '▶️ ' : '') + 'Yuva ' + (n + 1) + '</b>' + info + '</div>';
  }
  $('menuSlots').innerHTML = sh;
  $('menuSlots').querySelectorAll('.slotCard').forEach(el => el.addEventListener('click', () => {
    const n = parseInt(el.dataset.slot);
    if (n === SAVE_SLOT) return;
    try { localStorage.setItem('kd-slot', String(n)); } catch (e2) { }
    SUPPRESS_SAVE = true; location.reload(); // menü yeni yuvayla tekrar gelir
  }));
  // yükselen közler
  let em = '';
  for (let i = 0; i < 16; i++)
    em += '<i style="left:' + (3 + Math.random() * 94) + '%;animation-delay:' + (Math.random() * 7).toFixed(2) + 's;animation-duration:' + (5.5 + Math.random() * 4).toFixed(2) + 's"></i>';
  $('menuEmbers').innerHTML = em;
  $('menuMute').textContent = muted ? '🔇' : '🔊';
}
$('menuPlay').addEventListener('click', startGame);
$('menuNew').addEventListener('click', () => {
  if (!SAVED0) { startGame(); return; }
  if (!confirm('Yuva ' + (SAVE_SLOT + 1) + '\'deki ilerleme silinip yeni oyun başlatılsın mı?')) return;
  try { localStorage.removeItem(SAVE_KEY); sessionStorage.setItem('kd-resume', '1'); } catch (e2) { }
  SUPPRESS_SAVE = true; location.reload(); // taze dünya direkt başlar
});
$('menuMute').addEventListener('click', e => { e.stopPropagation(); setMute(!muted); $('menuMute').textContent = muted ? '🔇' : '🔊'; });

if (MENU_RESUME) {
  MENU_OPEN = false; // göç / yuva geçişi / yeni oyun: menüsüz devam
  introBanners();
} else {
  document.body.classList.add('menuOpen');
  $('mainMenu').classList.remove('hidden');
  buildMenu();
}
requestAnimationFrame(frame);
