document.addEventListener('click', () => {
  try {
    speechSynthesis.cancel();
    speechSynthesis.resume();
  } catch {}
}, { once: true });

const $ = (id) => document.getElementById(id);

const el = {
  cam: $('cam'),
  center: $('center'),
  arrowSvg: $('arrowSvg'),
  arrowWrap: $('arrowWrap'),
  distance: $('distance'),
  sub: $('sub'),
  gpsChip: $('gpsChip'),
  compassChip: $('compassChip'),
  modeChip: $('modeChip'),
  bar: $('bar'),
  hint: $('hint'),
  micState: $('micState'),
  dest: $('dest'),
  startBtn: $('startBtn'),
  micBtn: $('micBtn'),
  stopBtn: $('stopBtn'),
  stateLine: $('stateLine')
};

const state = {
  cameraOn: false,
  compassOn: false,
  conversationMode: false,
  listening: false,
  processingVoice: false,
  recording: false,
  speechRec: null,
  recorder: null,
  stream: null,
  chunks: [],
  current: null,
  target: null,
  targetLabel: '',
  lastQuery: '',
  lastIntent: '',
  lastHeading: null,
  watchId: null,
  route: null,
  routeSteps: [],
  activeStepIndex: 0,
  lastVibeAt: 0,
  lastRouteAt: 0,
  routeLoading: false,
  mapVisible: true,
  relistenTimer: null,
  _voiceInitDone: false,
  _voiceUnlocked: false,
  _voices: [],
  _voiceQueue: []
};

const ALIASES = {
  kamppi: ['Kamppi Helsinki', 'Kamppi'],
  kampiin: ['Kamppi Helsinki', 'Kamppi'],
  stockmann: ['Stockmann Helsinki'],
  stokka: ['Stockmann Helsinki'],
  stokkalle: ['Stockmann Helsinki'],
  jumbo: ['Jumbo Vantaa'],
  jumbolle: ['Jumbo Vantaa'],
  rautatieasema: ['Helsingin päärautatieasema', 'Helsingin rautatieasema'],
  päärautatieasema: ['Helsingin päärautatieasema'],
  kauppa: ['ruokakauppa'],
  ruokakauppa: ['ruokakauppa'],
  kahvila: ['kahvila'],
  apteekki: ['apteekki'],
  ravintola: ['ravintola'],
  pizza: ['ravintola'],
  prisma: ['Prisma'],
  citymarket: ['K-Citymarket'],
  kmarket: ['K-Market']
};

function showHint(text, ms = 1800) {
  if (!el.hint) return;
  el.hint.textContent = text;
  el.hint.classList.add('show');
  clearTimeout(showHint.t);
  showHint.t = setTimeout(() => el.hint.classList.remove('show'), ms);
}

function setMode(text) {
  if (el.modeChip) el.modeChip.textContent = `Tila: ${text}`;
  if (el.stateLine) el.stateLine.textContent = text;
}

function toRad(v) { return v * Math.PI / 180; }
function toDeg(v) { return v * 180 / Math.PI; }

function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function bearing(from, to) {
  const φ1 = toRad(from.lat), φ2 = toRad(to.lat);
  const λ1 = toRad(from.lng), λ2 = toRad(to.lng);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function diffAngle(a, b) {
  let d = ((a - b) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function arrowRotationFromDiff(d) {
  if (Math.abs(d) < 8) return 0;
  if (d >= 8 && d < 30) return 25;
  if (d >= 30 && d < 60) return 75;
  if (d >= 60 && d < 120) return 135;
  if (d >= 120) return 180;
  if (d <= -8 && d > -30) return -25;
  if (d <= -30 && d > -60) return -75;
  if (d <= -60 && d > -120) return -135;
  if (d <= -120) return 180;
  return 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilSpeechIdle(timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) return true;
    } catch {}
    await wait(50);
  }
  return false;
}

function refreshVoices() {
  try {
    state._voices = window.speechSynthesis?.getVoices?.() || [];
  } catch {
    state._voices = [];
  }
}

function initVoiceSystem() {
  if (state._voiceInitDone) return;
  state._voiceInitDone = true;

  refreshVoices();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      refreshVoices();
      flushVoiceQueue();
    };
  }

  const unlock = async () => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      refreshVoices();
      state._voiceUnlocked = true;
      flushVoiceQueue();
    } catch {}
  };

  document.addEventListener('click', unlock, { once: true, passive: true });
  document.addEventListener('touchstart', unlock, { once: true, passive: true });
  document.addEventListener('pointerdown', unlock, { once: true, passive: true });
}

async function unlockUltraVoice() {
  try {
    if (!('speechSynthesis' in window)) return false;

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    refreshVoices();

    if (!state._voices.length) {
      await wait(150);
      refreshVoices();
    }

    state._voiceUnlocked = true;
    flushVoiceQueue();
    return true;
  } catch {
    return false;
  }
}

function pickBestVoice() {
  const voices = (state._voices && state._voices.length)
    ? state._voices
    : (window.speechSynthesis?.getVoices?.() || []);

  if (!voices.length) return null;

  const score = (v) => {
    let s = 0;
    const lang = String(v.lang || '').toLowerCase();
    const name = String(v.name || '').toLowerCase();

    if (lang.startsWith('fi')) s += 100;
    if (name.includes('siri')) s += 80;
    if (name.includes('finn')) s += 70;
    if (v.localService) s += 10;
    if (v.default) s += 5;
    return s;
  };

  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

function flushVoiceQueue() {
  if (!state._voiceQueue.length) return;
  const items = [...state._voiceQueue];
  state._voiceQueue = [];

  items.forEach((item, idx) => {
    setTimeout(() => {
      speakFi(item.text, item.options || {});
    }, idx * 300);
  });
}

function scheduleRelisten(delay = 450) {
  clearTimeout(state.relistenTimer);
  if (!state.conversationMode) return;

  state.relistenTimer = setTimeout(() => {
    if (state.conversationMode && !state.listening && !state.recording && !state.processingVoice) {
      startVoiceInput();
    }
  }, delay);
}

function speakFi(text, options = {}) {
  const clean = String(text || '').trim();
  if (!clean || !('speechSynthesis' in window)) return;

  const shouldRelisten = options.relisten !== false && state.conversationMode;
  const rate = typeof options.rate === 'number' ? options.rate : 0.90;
  const pitch = typeof options.pitch === 'number' ? options.pitch : 1.03;
  const volume = typeof options.volume === 'number' ? options.volume : 1.0;

  const doSpeak = () => {
    try {
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'fi-FI';
      utter.rate = rate;
      utter.pitch = pitch;
      utter.volume = volume;

      const voice = pickBestVoice();
      if (voice) utter.voice = voice;

      utter.onend = () => {
        if (typeof options.onEnd === 'function') options.onEnd();
        if (shouldRelisten) scheduleRelisten(250);
      };

      utter.onerror = () => {
        if (shouldRelisten) scheduleRelisten(250);
      };

      window.speechSynthesis.cancel();

      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utter);
        } catch {
          if (shouldRelisten) scheduleRelisten(250);
        }
      }, 80);
    } catch {
      if (shouldRelisten) scheduleRelisten(250);
    }
  };

  if (!state._voiceUnlocked) {
    state._voiceQueue.push({ text: clean, options });
    return;
  }

  doSpeak();
}

function speakFiAsync(text, options = {}) {
  return new Promise((resolve) => {
    speakFi(text, {
      ...options,
      onEnd: () => {
        if (typeof options.onEnd === 'function') options.onEnd();
        resolve();
      }
    });
  });
}

function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIntent(intent) {
  const value = String(intent || '').trim().toLowerCase();
  if (['navigate', 'stop', 'whereami', 'status', 'help', 'clarify'].includes(value)) return value;
  return 'clarify';
}

function fallbackReply(intent) {
  switch (intent) {
    case 'stop':
      return 'Navigointi pysäytetty.';
    case 'whereami':
      return 'Kerron sijaintisi.';
    case 'status':
      return 'Tarkistan matkan.';
    case 'help':
      return 'Voit sanoa: vie Kamppiin, lähin kauppa, lopeta, missä olen.';
    case 'navigate':
      return 'Selvä, etsitään paikka.';
    default:
      return 'Minne haluat mennä?';
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function localParseCommand(text) {
  if (
  t === 'moi' ||
  t === 'hei' ||
  t === 'hello' ||
  t === 'hi' ||
  t === 'terve'
) {
  return {
    intent: 'chat',
    reply: 'Moi! Minne haluat mennä?',
    query: '',
    nearby: false
  };
}
  const t = normalizeText(text);

  if (t.includes('lopeta') || t.includes('pysäytä') || t.includes('pysayta') || t.includes('seis')) {
    return { intent: 'stop', reply: 'Navigointi pysäytetty.', query: '', nearby: false };
  }

  if (t.includes('missä olen') || t.includes('missä mä oon') || t.includes('sijainti')) {
    return { intent: 'whereami', reply: 'Kerron sijaintisi.', query: '', nearby: false };
  }

  if (t.includes('kuinka pitkä matka') || t.includes('paljonko matkaa') || t.includes('matka')) {
    return { intent: 'status', reply: 'Katsotaan matka.', query: '', nearby: false };
  }

  if (t.includes('apu') || t.includes('ohje')) {
    return {
      intent: 'help',
      reply: 'Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen.',
      query: '',
      nearby: false
    };
  }

  const nearbyKeywords = ['lähin', 'lähimpään', 'ruokakauppa', 'kauppa', 'kahvila', 'asema', 'apteekki', 'ravintola', 'pizza'];
  const nearby = nearbyKeywords.some(k => t.includes(k));

  if (nearby) {
    let query = 'kohde';
    if (t.includes('ruokakauppa') || t.includes('kauppa')) query = 'ruokakauppa';
    else if (t.includes('kahvila')) query = 'kahvila';
    else if (t.includes('apteekki')) query = 'apteekki';
    else if (t.includes('asema')) query = 'asema';
    else if (t.includes('ravintola') || t.includes('pizza')) query = 'ravintola';

    return {
      intent: 'navigate',
      reply: `Selvä, etsitään ${query}.`,
      query,
      nearby: true
    };
  }

  for (const [needle, values] of Object.entries(ALIASES)) {
    if (t === needle || t.includes(` ${needle} `) || t.startsWith(needle) || t.endsWith(needle)) {
      return {
        intent: 'navigate',
        reply: `Selvä, etsitään ${values[0]}.`,
        query: values[0],
        nearby: false
      };
    }
  }

  if (t.startsWith('vie ') || t.startsWith('mene ') || t.startsWith('navigoi ') || t.startsWith('ohjaa ')) {
    const cleaned = t
      .replace(/^(vie|mene|navigoi|ohjaa)\s+/i, '')
      .replace(/^(kohteeseen|paikkaan|osoitteeseen)\s+/i, '')
      .trim();

    const query = cleaned || state.lastQuery || 'kohde';
    return {
      intent: 'navigate',
      reply: `Selvä, etsitään ${query}.`,
      query,
      nearby: false
    };
  }

  if (t.includes('sinne') || t.includes('sama paikka') || t.includes('samaan paikkaan')) {
    return {
      intent: 'navigate',
      reply: state.lastQuery ? `Selvä, etsitään sama paikka: ${state.lastQuery}.` : 'Minne haluat mennä?',
      query: state.lastQuery,
      nearby: false
    };
  }

  return {
    intent: 'clarify',
    reply: 'En ymmärtänyt täysin. Sano esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen.',
    query: '',
    nearby: false
  };
}

async function callAI(text) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        currentLocation: state.current,
        activeTarget: state.targetLabel,
        lastQuery: state.lastQuery,
        lastIntent: state.lastIntent
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI-virhe');
    return data;
  } catch {
    return null;
  }
}

async function converseWithAI(transcript) {
  const ai = await callAI(transcript);
  if (!ai) return localParseCommand(transcript);

  return {
    intent: normalizeIntent(ai.intent),
    query: String(ai.query || '').trim(),
    nearby: Boolean(ai.nearby),
    reply: String(ai.reply || '').trim() || fallbackReply(normalizeIntent(ai.intent))
  };
}

function categoryForNearby(query) {
  const t = normalizeText(query);

  if (t.includes('supermarket') || t.includes('ruokakauppa') || t.includes('kauppa')) {
    return { label: 'kauppa', overpass: 'shop=supermarket' };
  }
  if (t.includes('cafe') || t.includes('kahvila')) {
    return { label: 'kahvila', overpass: 'amenity=cafe' };
  }
  if (t.includes('pharmacy') || t.includes('apteekki')) {
    return { label: 'apteekki', overpass: 'amenity=pharmacy' };
  }
  if (t.includes('restaurant') || t.includes('ravintola') || t.includes('pizza')) {
    return { label: 'ravintola', overpass: 'amenity=restaurant' };
  }
  if (t.includes('bus stop') || t.includes('bussi')) {
    return { label: 'bussipysäkki', overpass: 'highway=bus_stop' };
  }
  if (t.includes('train station') || t.includes('juna') || t.includes('asema')) {
    return { label: 'asema', overpass: 'railway=station' };
  }
  if (t.includes('toilet') || t.includes('wc') || t.includes('vessa')) {
    return { label: 'wc', overpass: 'amenity=toilets' };
  }
  if (t.includes('gym') || t.includes('kuntosali')) {
    return { label: 'kuntosali', overpass: 'leisure=fitness_centre' };
  }
  return null;
}

function pointFromElement(elm) {
  if (typeof elm.lat === 'number' && typeof elm.lon === 'number') return { lat: elm.lat, lng: elm.lon };
  if (elm.center && typeof elm.center.lat === 'number' && typeof elm.center.lon === 'number') {
    return { lat: elm.center.lat, lng: elm.center.lon };
  }
  return null;
}

async function searchExactPlace(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Tyhjä kohde');

  const variants = [];
  variants.push(q);

  const lower = normalizeText(q);
  if (ALIASES[lower]) variants.push(...ALIASES[lower]);

  if (!/finland|suomi|helsinki|espoo|vantaa|tampere|turku|oulu|jyväskylä|rovaniemi/i.test(q)) {
    variants.push(`${q}, Finland`);
  }

  for (const item of [...new Set(variants)]) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      q: item,
      limit: '5',
      addressdetails: '1',
      'accept-language': 'fi'
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });

    const data = await res.json().catch(() => []);
    if (Array.isArray(data) && data.length) {
      const best = data[0];
      return {
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        label: best.display_name || q
      };
    }
  }

  throw new Error('Paikkaa ei löytynyt');
}

async function searchNearbyPlace(query) {
  if (!state.current) throw new Error('Sijainti puuttuu');

  const category = categoryForNearby(query);
  if (!category) return searchExactPlace(query);

  const lat = state.current.lat;
  const lng = state.current.lng;
  const radius = Math.max(1200, Math.min(3500, Math.round((state.current.accuracy || 50) * 20)));

  const overpassQuery = `
[out:json][timeout:25];
(
  node(around:${radius},${lat},${lng})[${category.overpass}];
  way(around:${radius},${lat},${lng})[${category.overpass}];
  relation(around:${radius},${lat},${lng})[${category.overpass}];
);
out center tags;
`.trim();

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: overpassQuery
  });

  const data = await res.json().catch(() => null);
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  const points = elements
    .map((e) => {
      const p = pointFromElement(e);
      if (!p) return null;
      return {
        lat: p.lat,
        lng: p.lng,
        label: e.tags?.name || category.label
      };
    })
    .filter(Boolean);

  if (!points.length) return searchExactPlace(query);

  points.sort((a, b) => haversine(state.current, a) - haversine(state.current, b));
  return points[0];
}

async function geocodePlace(query, nearby = false) {
  if (nearby) {
    try {
      return await searchNearbyPlace(query);
    } catch {
      return searchExactPlace(query);
    }
  }
  return searchExactPlace(query);
}

function getRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  return fetch(url)
    .then(r => r.json())
    .then((data) => {
      if (!data.routes || !data.routes.length) throw new Error('Reittiä ei löytynyt');
      return data.routes[0];
    });
}

function extractSteps(route) {
  const steps = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) steps.push(step);
  }
  return steps;
}

function stepLocation(step, fallback) {
  const loc = step?.maneuver?.location;
  if (Array.isArray(loc) && loc.length >= 2) return { lat: loc[1], lng: loc[0] };
  return fallback;
}

function stepInstruction(step) {
  if (!step) return '';
  const type = String(step?.maneuver?.type || '').toLowerCase();
  const modifier = String(step?.maneuver?.modifier || '').toLowerCase();
  const name = String(step?.name || '').trim();

  const turnMap = {
    left: 'vasemmalle',
    right: 'oikealle',
    'slight left': 'hieman vasemmalle',
    'slight right': 'hieman oikealle',
    'sharp left': 'jyrkästi vasemmalle',
    'sharp right': 'jyrkästi oikealle'
  };

  if (type === 'arrive') return 'Perillä';
  if (type === 'depart') return 'Lähde liikkeelle';
  if (type === 'roundabout') return 'Aja liikenneympyrään';
  if (type === 'rotary') return 'Aja kiertoliittymään';
  if (type === 'fork') return `Pidä ${turnMap[modifier] || 'suunta'}`;
  if (type === 'merge') return `Liity ${name ? name : 'tiehen'}`;
  if (type === 'on ramp') return 'Aja rampille';
  if (type === 'off ramp') return 'Poistu rampista';
  if (type === 'turn') return `Käänny ${turnMap[modifier] || 'suuntaan'}${name ? `, ${name}` : ''}`;
  if (type === 'continue') return name ? `Jatka ${name}` : 'Jatka eteenpäin';
  if (type === 'new name') return name ? `Jatka ${name}` : 'Jatka';
  return name ? `Jatka ${name}` : 'Jatka';
}

function currentStep() {
  if (!state.routeSteps.length) return null;
  return state.routeSteps[Math.min(state.activeStepIndex, state.routeSteps.length - 1)];
}

function setCameraVisible(v) {
  if (el.cam) el.cam.style.opacity = v ? '1' : '0.08';
  state.mapVisible = v;
}

async function startCamera() {
  if (state.cameraOn) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    showHint('Kamera ei ole käytettävissä');
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });

    el.cam.srcObject = stream;
    try { await el.cam.play(); } catch {}
    state.stream = stream;
    state.cameraOn = true;
    if (el.cam) el.cam.style.opacity = '1';
    return true;
  } catch (e) {
    console.error(e);
    showHint('Kamera ei auennut');
    return false;
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  if (el.cam) el.cam.srcObject = null;
  state.cameraOn = false;
}

async function requestCompass() {
  if (state.compassOn) return true;

  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        if (el.compassChip) el.compassChip.textContent = 'Kompassi: pois';
        return false;
      }
    }

    window.addEventListener('deviceorientation', (e) => {
      if (typeof e.webkitCompassHeading === 'number') {
        state.lastHeading = e.webkitCompassHeading;
      } else if (e.alpha != null) {
        state.lastHeading = 360 - e.alpha;
      }
    }, true);

    state.compassOn = true;
    if (el.compassChip) el.compassChip.textContent = 'Kompassi: päällä';
    return true;
  } catch (e) {
    console.error(e);
    if (el.compassChip) el.compassChip.textContent = 'Kompassi: pois';
    return false;
  }
}

function getLocationNow(timeoutMs = 9000) {
  if (!navigator.geolocation) return Promise.reject(new Error('Sijaintia ei tueta'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sijainti ei löytynyt ajoissa')), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        state.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        if (el.gpsChip) el.gpsChip.textContent = 'Sijainti: päällä';
        resolve(state.current);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0
      }
    );
  });
}

function watchLocation() {
  if (!navigator.geolocation) return;
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.current = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      if (el.gpsChip) el.gpsChip.textContent = 'Sijainti: päällä';
      updateHUD();
    },
    () => {},
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

function clearRoute() {
  state.route = null;
  state.routeSteps = [];
  state.activeStepIndex = 0;
  state.lastRouteAt = 0;
  state.routeLoading = false;
}

async function buildRoute() {
  if (!state.current || !state.target) return;
  const route = await getRoute(state.current, state.target);
  state.route = route;
  state.routeSteps = extractSteps(route);
  state.activeStepIndex = 0;
  state.lastRouteAt = Date.now();
}

function maybeAdvanceStep() {
  const step = currentStep();
  if (!step || !state.current) return;
  const p = stepLocation(step, state.target);
  const d = haversine(state.current, p);
  if (d < 28 && state.activeStepIndex < state.routeSteps.length - 1) {
    state.activeStepIndex += 1;
    if (navigator.vibrate) navigator.vibrate(28);
  }
}

async function maybeReroute() {
  if (!state.target || !state.current || state.routeLoading) return;
  if (Date.now() - state.lastRouteAt < 18000) return;
  const step = currentStep();
  if (!step) return;
  const p = stepLocation(step, state.target);
  const dStep = haversine(state.current, p);
  if (dStep > 180) {
    state.routeLoading = true;
    try {
      await buildRoute();
      speakFi('Haen uuden reitin.');
    } catch (e) {
      console.error(e);
    } finally {
      state.routeLoading = false;
    }
  }
}

function updateHUD() {
  if (!state.current || !state.target) {
    if (el.distance) el.distance.textContent = '—';
    if (el.sub) el.sub.textContent = state.listening ? 'Kuuntelen' : 'Valmis';
    if (el.center) el.center.classList.toggle('show', state.listening);
    if (el.bar) el.bar.style.width = '0%';
    return;
  }

  const step = currentStep();
  const anchor = step ? stepLocation(step, state.target) : state.target;

  const dTarget = haversine(state.current, state.target);
  const dAnchor = haversine(state.current, anchor);
  const b = bearing(state.current, anchor);
  const h = state.lastHeading;
  const diff = h == null ? 0 : diffAngle(b, h);
  const rot = arrowRotationFromDiff(diff);

  if (el.arrowSvg) el.arrowSvg.style.transform = `rotate(${rot}deg)`;

  if (dTarget < 20) {
    if (el.distance) el.distance.textContent = 'NYT';
    if (el.sub) el.sub.textContent = 'Perillä pian';
  } else {
    if (el.distance) el.distance.textContent = formatDistance(dAnchor);
    if (el.sub) el.sub.textContent = stepInstruction(step) || (Math.abs(diff) < 20 ? 'Oikea suunta' : 'Käänny');
  }

  const show = state.listening || !!state.target || dTarget < 120 || Math.abs(diff) > 18;
  if (el.center) el.center.classList.toggle('show', !!show);

  const pct = Math.max(0, Math.min(100, 100 - Math.min(dTarget, 1500) / 15));
  if (el.bar) el.bar.style.width = `${pct}%`;

  if (dTarget < 20 && Date.now() - state.lastVibeAt > 1200) {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    state.lastVibeAt = Date.now();
  }

  if (el.arrowWrap) el.arrowWrap.style.transform = dTarget < 20 ? 'scale(1.06)' : 'scale(1)';
  maybeAdvanceStep();
  maybeReroute();
}

function stopNavigation() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  state.target = null;
  state.targetLabel = '';
  state.lastQuery = '';
  state.lastIntent = '';
  clearRoute();

  if (el.gpsChip) el.gpsChip.textContent = 'Sijainti: pois';
  if (el.compassChip) el.compassChip.textContent = state.compassOn ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode('Valmis');
  updateHUD();
  showHint('Pysäytetty');
}

async function startNavigationToQuery(query, nearby = false, spokenReply = '') {
  const q = String(query || '').trim();
  if (!q) {
    speakFi('Kirjoita kohde ensin.');
    showHint('Kirjoita kohde ensin');
    return;
  }

  await ensureSession();
  setMode('Haetaan paikka');
  showHint(`Haetaan: ${q}`);

  try {
    const place = await geocodePlace(q, nearby);
    state.target = { lat: place.lat, lng: place.lng };
    state.targetLabel = place.label || q;
    state.lastQuery = q;
    state.lastIntent = 'navigate';

    speakFi(spokenReply || `Selvä, etsitään ${state.targetLabel}.`);
    updateHUD();

    try {
      await buildRoute();
    } catch {
      state.routeSteps = [];
    }

    setMode('Navigointi');
    showHint(`Kohde: ${state.targetLabel}`);
  } catch (e) {
    console.error(e);
    speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
    showHint('Paikkaa ei löytynyt');
  }
}

async function handleVoiceText(text) {
  const transcript = String(text || '').trim();
  if (!transcript) {
    speakFi('En kuullut mitään.');
    return null;
  }

  showHint('Kuulin: ' + transcript);

  const data = await converseWithAI(transcript);

  state.lastIntent = data.intent || 'clarify';
  if (data.query) state.lastQuery = data.query;

  if (data.intent === 'stop') {
    stopNavigation();
    speakFi(data.reply || 'Navigointi pysäytetty.');
    return data;
  }

  if (data.intent === 'whereami') {
    if (!state.current) {
      speakFi(data.reply || 'Sijaintia ei vielä ole.');
      return data;
    }

    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${state.current.lat}&lon=${state.current.lng}`);
      const place = await r.json();
      if (place?.display_name) {
        speakFi(`Olet nyt kohdassa ${place.display_name}.`);
      } else {
        speakFi(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
      }
    } catch {
      speakFi(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
    }
    return data;
  }

  if (data.intent === 'status') {
    if (!state.current || !state.target) {
      speakFi('Aktiivista navigointia ei ole käynnissä.');
      return data;
    }
    const d = haversine(state.current, state.target);
    speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
    return data;
  }

  if (data.intent === 'help') {
    speakFi(data.reply || 'Voit sanoa esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen.');
    return data;
  }

  if (data.intent === 'clarify') {
    speakFi(data.reply || 'Minne haluat mennä?');
    return data;
  }

  if (data.intent === 'navigate') {
    await startNavigationToQuery(data.query || transcript, data.nearby, data.reply);
    return data;
  }

  speakFi(data.reply || 'Selvä.');
  return data;
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudioBlob(blob, mimeType) {
  const audioBase64 = await blobToBase64(blob);
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      mimeType: mimeType || blob.type || 'audio/webm'
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Transkriptio epäonnistui');
  return data.text || '';
}

async function handleRecordedVoice(blob, mimeType) {
  try {
    const transcript = await transcribeAudioBlob(blob, mimeType);
    state.processingVoice = true;
    await handleVoiceText(transcript);
  } catch (e) {
    console.error(e);
    showHint('Puhe ei onnistunut');
    speakFi('Puheentunnistus epäonnistui.');
  } finally {
    state.processingVoice = false;
  }
}

async function ensureSession() {
  await startCamera();
  await getLocationNow().catch(() => {});
  await requestCompass();
  watchLocation();
  updateHUD();
}

function stopVoiceCapture(hardStop = true) {
  clearTimeout(state.relistenTimer);

  if (state.speechRec) {
    try { state.speechRec.stop(); } catch {}
  }

  if (state.recorder && state.recorder.state !== 'inactive') {
    try { state.recorder.stop(); } catch {}
  }

  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }

  state.listening = false;
  state.recording = false;
  if (el.micBtn) el.micBtn.textContent = 'Mikki';
  if (el.micState) el.micState.classList.remove('show');

  if (hardStop) state.conversationMode = false;
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  if (state.listening || state.recording) return true;

  state.speechRec = new SpeechRecognition();
  state.speechRec.lang = 'fi-FI';
  state.speechRec.continuous = false;
  state.speechRec.interimResults = false;
  state.speechRec.maxAlternatives = 1;

  state.speechRec.onstart = () => {
    state.listening = true;
    if (el.micBtn) el.micBtn.textContent = 'Kuuntelen';
    if (el.micState) el.micState.classList.add('show');
    setMode('Kuuntelen');
    if (el.center) el.center.classList.add('show');
    showHint('Puhu nyt');
    speakFi('Kuuntelen.', { relisten: false });
  };

  state.speechRec.onend = () => {
    state.listening = false;
    if (el.micBtn) el.micBtn.textContent = 'Mikki';
    if (el.micState) el.micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');

    if (state.conversationMode && !state.processingVoice) {
      scheduleRelisten(250);
    }

    updateHUD();
  };

  state.speechRec.onerror = (e) => {
    console.log('speech error', e);
    state.listening = false;
    if (el.micBtn) el.micBtn.textContent = 'Mikki';
    if (el.micState) el.micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');
    showHint('Puhe ei onnistunut');
    speakFi('Puheentunnistus epäonnistui.');
  };

  state.speechRec.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript || '';
    state.processingVoice = true;

    handleVoiceText(transcript)
      .catch((err) => console.error(err))
      .finally(() => {
        state.processingVoice = false;
      });
  };

  try {
    state.speechRec.start();
    return true;
  } catch {
    return false;
  }
}

async function startRecordingVoice() {
  if (state.recording || state.listening) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.stream = stream;

    const preferredTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4'
    ];

    const mimeType = preferredTypes.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    const options = mimeType ? { mimeType } : undefined;

    const recorder = new MediaRecorder(stream, options);
    state.recorder = recorder;
    state.chunks = [];
    state.recording = true;
    state.listening = true;

    if (el.micBtn) el.micBtn.textContent = 'Puhu';
    if (el.micState) el.micState.classList.add('show');
    setMode('Kuuntelen');
    showHint('Puhu nyt');
    speakFi('Kuuntelen.', { relisten: false });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(state.chunks, { type: mimeType || 'audio/webm' });
        await handleRecordedVoice(blob, mimeType || blob.type);
      } finally {
        state.recording = false;
        state.listening = false;
        if (el.micBtn) el.micBtn.textContent = 'Mikki';
        if (el.micState) el.micState.classList.remove('show');
        if (state.stream) {
          state.stream.getTracks().forEach(t => t.stop());
          state.stream = null;
        }
        state.recorder = null;
        if (state.conversationMode && !state.processingVoice) {
          scheduleRelisten(250);
        }
        updateHUD();
      }
    };

    recorder.start();
    state.recordTimer = setTimeout(() => stopVoiceCapture(false), 7000);
  } catch (e) {
    console.error(e);
    showHint('Mikrofoni ei auennut');
    speakFi('Mikrofoni ei auennut.');
    state.recording = false;
    state.listening = false;
    if (el.micBtn) el.micBtn.textContent = 'Mikki';
    if (el.micState) el.micState.classList.remove('show');
  }
}

async function startVoiceInput() {
  if (!state.conversationMode) state.conversationMode = true;
  await waitUntilSpeechIdle(1500);

  const ok = startSpeechRecognition();
  if (!ok) {
    await startRecordingVoice();
  }
}

async function startSession() {
  await unlockUltraVoice();
  await startCamera();
  await getLocationNow().catch(() => {});
  await requestCompass();
  watchLocation();
  updateHUD();

  showHint('Sano: “Vie Kamppiin”');
  setMode('Valmis');

  if (!state.cameraOn) {
    if (el.stateLine) el.stateLine.textContent = 'Kamera ei vielä auennut. Paina Aloita uudestaan ja salli kamera.';
  } else {
    if (el.stateLine) el.stateLine.textContent = 'Kamera on päällä. Paina Mikki tai kirjoita kohde.';
  }
}

async function goFromInput() {
  const q = String(el.dest?.value || '').trim();
  if (!q) {
    speakFi('Kirjoita kohde ensin.');
    showHint('Kirjoita kohde ensin');
    return;
  }

  await ensureSession();
  const parsed = await converseWithAI(q);

  if (parsed.intent === 'navigate') {
    await startNavigationToQuery(parsed.query || q, parsed.nearby, parsed.reply);
    return;
  }

  if (parsed.intent === 'stop') {
    stopNavigation();
    speakFi(parsed.reply || 'Navigointi pysäytetty.', { relisten: false });
    return;
  }

  await handleVoiceText(q);
}

function updateLoop() {
  if (state.current && state.target) {
    updateHUD();
  }
  requestAnimationFrame(updateLoop);
}

el.startBtn?.addEventListener('click', async () => {
  await startSession();
});

el.micBtn?.addEventListener('click', async () => {
  await unlockUltraVoice();

  if (state.listening || state.recording) {
    stopVoiceCapture(true);
    return;
  }

  state.conversationMode = true;
  await startVoiceInput();
});

el.stopBtn?.addEventListener('click', () => {
  stopVoiceCapture(true);
  stopNavigation();
  stopCamera();
  speakFi('Navigointi pysäytetty.', { relisten: false });
  setMode('Valmis');
});

el.dest?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goFromInput();
  }
});

let sx = 0;
let sy = 0;
let tracking = false;

document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  sx = t.clientX;
  sy = t.clientY;
  tracking = true;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (!tracking) return;
  tracking = false;

  const t = e.changedTouches[0];
  const dx = t.clientX - sx;
  const dy = t.clientY - sy;

  if (Math.abs(dx) < 35 && Math.abs(dy) < 35) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) {
      setCameraVisible(true);
      showHint('Kamera-tila');
    } else {
      setCameraVisible(false);
      showHint('HUD-tila');
    }
  } else {
    if (dy < 0) {
      speakFi('Keskitetty.', { relisten: false });
      showHint('Keskitetty');
    } else {
      state.mapVisible = !state.mapVisible;
      setCameraVisible(state.mapVisible);
      showHint(state.mapVisible ? 'Kamera näkyy' : 'Kamera piilossa');
    }
  }
}, { passive: true });

window.addEventListener('load', () => {
  initVoiceSystem();
  updateLoop();
  setMode('Valmis');
  showHint('Paina Aloita');

  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.getVoices(); } catch {}
  }
});
