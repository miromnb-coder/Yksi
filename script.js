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
  listening: false,
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
  ttsVoice: null
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
  el.hint.textContent = text;
  el.hint.classList.add('show');
  clearTimeout(showHint.t);
  showHint.t = setTimeout(() => el.hint.classList.remove('show'), ms);
}

function setMode(text) {
  el.modeChip.textContent = `Tila: ${text}`;
  el.stateLine.textContent = text;
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

function bestFinnishVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find(v => /^fi\b/i.test(v.lang)) ||
         voices.find(v => /finn/i.test(v.name)) ||
         voices.find(v => /siri/i.test(v.name)) ||
         voices.find(v => v.default) ||
         null;
}

function speak(text) {
  const clean = String(text || '').trim();
  if (!clean || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fi-FI';
    u.rate = 0.94;
    u.pitch = 1.0;
    u.volume = 1.0;
    const voice = bestFinnishVoice();
    if (voice) u.voice = voice;
    state.ttsVoice = voice || null;
    window.speechSynthesis.speak(u);
  } catch {}
}

function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuery(text) {
  const t = normalizeText(text);

  if (t.includes('lähin kauppa') || t.includes('kauppa')) return { q: 'supermarket', nearby: true };
  if (t.includes('lähin ruokakauppa') || t.includes('ruokakauppa')) return { q: 'supermarket', nearby: true };
  if (t.includes('lähin kahvila') || t.includes('kahvila')) return { q: 'cafe', nearby: true };
  if (t.includes('lähin apteekki') || t.includes('apteekki')) return { q: 'pharmacy', nearby: true };
  if (t.includes('lähin ravintola') || t.includes('ravintola') || t.includes('pizza')) return { q: 'restaurant', nearby: true };
  if (t.includes('bussi')) return { q: 'bus stop', nearby: true };
  if (t.includes('juna') || t.includes('asema')) return { q: 'train station', nearby: true };
  if (t.includes('wc') || t.includes('vessa')) return { q: 'toilet', nearby: true };
  if (t.includes('kuntosali')) return { q: 'gym', nearby: true };

  return { q: text, nearby: false };
}

function localParseCommand(text) {
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
      reply: 'Voit sanoa esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.',
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
    reply: 'En ymmärtänyt täysin. Sano esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.',
    query: '',
    nearby: false
  };
}

function normalizeAiResult(data) {
  if (!data || typeof data !== 'object') return null;
  const intent = String(data.intent || '').trim() || 'clarify';
  const query = String(data.query || data.destination_query || '').trim();
  const nearby = Boolean(data.nearby ?? (String(data.search_mode || '').toLowerCase() === 'nearby'));
  const reply = String(data.reply || '').trim();
  return { intent, query, nearby, reply };
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

async function resolveCommand(text) {
  const ai = await callAI(text);
  const parsed = normalizeAiResult(ai);
  if (parsed) return parsed;
  return localParseCommand(text);
}

function searchVariants(rawQuery, nearby) {
  const t = normalizeText(rawQuery);
  const variants = new Set();

  if (!t) return [];

  variants.add(rawQuery.trim());

  if (ALIASES[t]) {
    for (const v of ALIASES[t]) variants.add(v);
  }

  if (!/finland|suomi|helsinki|espoo|vantaa|tampere|turku|oulu|jyväskylä|rovaniemi/i.test(rawQuery)) {
    variants.add(`${rawQuery}, Finland`);
  }

  if (nearby) {
    if (t.includes('kauppa') || t.includes('ruokakauppa')) {
      variants.add('ruokakauppa');
      variants.add('grocery store');
      variants.add('supermarket');
    }
    if (t.includes('kahvila')) {
      variants.add('kahvila');
      variants.add('cafe');
    }
    if (t.includes('apteekki')) {
      variants.add('apteekki');
      variants.add('pharmacy');
    }
    if (t.includes('asema')) {
      variants.add('asema');
      variants.add('station');
    }
    if (t.includes('ravintola') || t.includes('pizza')) {
      variants.add('ravintola');
      variants.add('restaurant');
    }
  }

  return [...variants].filter(Boolean);
}

function geocodePlace(query, nearby = false) {
  return new Promise((resolve, reject) => {
    const q = String(query || '').trim();
    if (!q) {
      reject(new Error('Tyhjä kohde'));
      return;
    }

    const variants = searchVariants(q, nearby);

    const tryNext = (index) => {
      if (index >= variants.length) {
        reject(new Error('Paikkaa ei löytynyt'));
        return;
      }

      const currentQuery = variants[index];
      const params = new URLSearchParams({
        format: 'jsonv2',
        q: currentQuery,
        limit: '5',
        addressdetails: '1',
        'accept-language': 'fi'
      });

      if (nearby && state.current) {
        const lat = state.current.lat;
        const lng = state.current.lng;
        params.set('viewbox', `${lng - 0.15},${lat + 0.10},${lng + 0.15},${lat - 0.10}`);
        params.set('bounded', '1');
      }

      fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'Accept': 'application/json' }
      })
        .then(r => r.json())
        .then((data) => {
          if (!Array.isArray(data) || !data.length) {
            tryNext(index + 1);
            return;
          }

          const best = data[0];
          resolve({
            lat: parseFloat(best.lat),
            lng: parseFloat(best.lon),
            label: best.display_name || q
          });
        })
        .catch(() => tryNext(index + 1));
    };

    tryNext(0);
  });
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
  if (Array.isArray(loc) && loc.length >= 2) {
    return { lat: loc[1], lng: loc[0] };
  }
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
  el.cam.style.opacity = v ? '1' : '0.08';
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
    el.cam.style.opacity = '1';
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
  el.cam.srcObject = null;
  state.cameraOn = false;
}

async function requestCompass() {
  if (state.compassOn) return true;

  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        el.compassChip.textContent = 'Kompassi: kieltty';
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
    el.compassChip.textContent = 'Kompassi: päällä';
    return true;
  } catch (e) {
    console.error(e);
    el.compassChip.textContent = 'Kompassi: pois';
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
        el.gpsChip.textContent = 'Sijainti: päällä';
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
      el.gpsChip.textContent = 'Sijainti: päällä';
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
      speak('Haen uuden reitin.');
    } catch (e) {
      console.error(e);
    } finally {
      state.routeLoading = false;
    }
  }
}

function updateHUD() {
  if (!state.current || !state.target) {
    el.distance.textContent = '—';
    el.sub.textContent = state.listening ? 'Kuuntelen' : 'Valmis';
    el.center.classList.toggle('show', state.listening);
    el.bar.style.width = '0%';
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

  el.arrowSvg.style.transform = `rotate(${rot}deg)`;

  if (dTarget < 20) {
    el.distance.textContent = 'NYT';
    el.sub.textContent = 'Perillä pian';
  } else {
    el.distance.textContent = formatDistance(dAnchor);
    el.sub.textContent = stepInstruction(step) || (Math.abs(diff) < 20 ? 'Oikea suunta' : 'Käänny');
  }

  const show = state.listening || !!state.target || dTarget < 120 || Math.abs(diff) > 18;
  el.center.classList.toggle('show', !!show);

  const pct = Math.max(0, Math.min(100, 100 - Math.min(dTarget, 1500) / 15));
  el.bar.style.width = `${pct}%`;

  if (dTarget < 20 && Date.now() - state.lastVibeAt > 1200) {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    state.lastVibeAt = Date.now();
  }

  el.arrowWrap.style.transform = dTarget < 20 ? 'scale(1.06)' : 'scale(1)';
  maybeAdvanceStep();
  maybeReroute();
}

async function stopNavigation() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  state.target = null;
  state.targetLabel = '';
  state.lastQuery = '';
  state.lastIntent = '';
  clearRoute();
  el.gpsChip.textContent = 'Sijainti: pois';
  el.compassChip.textContent = state.compassOn ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode('Valmis');
  updateHUD();
  showHint('Pysäytetty');
  speak('Navigointi pysäytetty.');
}

async function blobToBase64(blob) {
  return await new Promise((resolve, reject) => {
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

async function ensureSession() {
  await startCamera();
  await getLocationNow().catch(() => {});
  await requestCompass();
  watchLocation();
  updateHUD();
}

async function startNavigationToQuery(query, nearby = false, spokenReply = '') {
  const q = String(query || '').trim();
  if (!q) {
    speak('Kirjoita kohde ensin.');
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

    if (spokenReply) speak(spokenReply);
    else speak(`Selvä, etsitään ${state.targetLabel}.`);

    updateHUD();
    await buildRoute();
    setMode('Navigointi');
    showHint(`Kohde: ${state.targetLabel}`);
  } catch (e) {
    console.error(e);
    speak('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
    showHint('Paikkaa ei löytynyt');
  }
}

async function handleCommand(text) {
  const transcript = String(text || '').trim();
  if (!transcript) {
    speak('En kuullut mitään.');
    return;
  }

  showHint(transcript);

  const parsed = await resolveCommand(transcript);
  state.lastIntent = parsed.intent || '';

  if (parsed.query) state.lastQuery = parsed.query;

  if (parsed.intent === 'stop') {
    await stopNavigation();
    return;
  }

  if (parsed.intent === 'whereami') {
    if (!state.current) {
      speak(parsed.reply || 'Sijaintia ei vielä ole.');
      return;
    }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${state.current.lat}&lon=${state.current.lng}`);
      const data = await r.json();
      if (data?.display_name) {
        speak(`Olet nyt kohdassa ${data.display_name}.`);
      } else {
        speak(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
      }
    } catch {
      speak(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
    }
    return;
  }

  if (parsed.intent === 'status') {
    if (!state.current || !state.target) {
      speak('Aktiivista navigointia ei ole käynnissä.');
      return;
    }
    const d = haversine(state.current, state.target);
    speak(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
    return;
  }

  if (parsed.intent === 'help') {
    speak(parsed.reply || 'Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
    return;
  }

  if (parsed.intent === 'clarify') {
    speak(parsed.reply || 'Minne haluat mennä?');
    return;
  }

  if (parsed.intent === 'navigate') {
    await startNavigationToQuery(parsed.query || transcript, parsed.nearby, parsed.reply);
    return;
  }

  speak(parsed.reply || 'En ymmärtänyt komentoa.');
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;
  if (state.listening) {
    try { state.speechRec?.stop(); } catch {}
    return true;
  }

  state.speechRec = new SpeechRecognition();
  state.speechRec.lang = 'fi-FI';
  state.speechRec.continuous = false;
  state.speechRec.interimResults = false;
  state.speechRec.maxAlternatives = 1;

  state.speechRec.onstart = () => {
    state.listening = true;
    el.micBtn.textContent = 'Kuuntelen';
    el.micState.classList.add('show');
    setMode('Kuuntelen');
    el.center.classList.add('show');
    showHint('Puhu nyt');
    speak('Kuuntelen.');
  };

  state.speechRec.onend = () => {
    state.listening = false;
    el.micBtn.textContent = 'Mikki';
    el.micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');
    updateHUD();
  };

  state.speechRec.onerror = (e) => {
    state.listening = false;
    el.micBtn.textContent = 'Mikki';
    el.micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');
    console.log('speech error', e);
    showHint('Puhe ei onnistunut');
    speak('Puheentunnistus epäonnistui.');
  };

  state.speechRec.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript || '';
    handleCommand(transcript);
  };

  try {
    state.speechRec.start();
    return true;
  } catch {
    return false;
  }
}

async function startRecordingVoice() {
  if (state.recording) return;

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

    el.micBtn.textContent = 'Puhu';
    el.micState.classList.add('show');
    setMode('Kuuntelen');
    showHint('Puhu nyt');
    speak('Kuuntelen.');

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(state.chunks, { type: mimeType || 'audio/webm' });
        const transcript = await transcribeAudioBlob(blob, mimeType || blob.type);
        await handleCommand(transcript);
      } catch (e) {
        console.error(e);
        showHint('Puhe ei onnistunut');
        speak('Puheentunnistus epäonnistui.');
      } finally {
        state.recording = false;
        state.listening = false;
        el.micBtn.textContent = 'Mikki';
        el.micState.classList.remove('show');
        if (state.stream) {
          state.stream.getTracks().forEach(t => t.stop());
          state.stream = null;
        }
        state.recorder = null;
        updateHUD();
      }
    };

    recorder.start();
    state.recordTimer = setTimeout(() => stopRecording(), 7000);
  } catch (e) {
    console.error(e);
    showHint('Mikrofoni ei auennut');
    speak('Mikrofoni ei auennut.');
  }
}

function stopRecording() {
  clearTimeout(state.recordTimer);
  if (!state.recording) return;
  try {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.stop();
    }
  } catch {}
}

async function startVoice() {
  const speechOk = startSpeechRecognition();
  if (!speechOk) {
    await startRecordingVoice();
  }
}

async function startSession() {
  await startCamera();
  await getLocationNow().catch(() => {});
  await requestCompass();
  watchLocation();
  updateHUD();
  showHint('Sano: “Vie Kamppiin”');
  setMode('Valmis');
  if (!state.cameraOn) {
    el.stateLine.textContent = 'Kamera ei vielä auennut. Paina Aloita uudestaan ja salli kamera.';
  } else {
    el.stateLine.textContent = 'Kamera on päällä. Paina Mikki tai kirjoita kohde.';
  }
}

async function goFromInput() {
  const q = String(el.dest.value || '').trim();
  if (!q) {
    speak('Kirjoita kohde ensin.');
    showHint('Kirjoita kohde ensin');
    return;
  }

  await ensureSession();
  const parsed = await resolveCommand(q);

  if (parsed.intent === 'navigate') {
    await startNavigationToQuery(parsed.query || q, parsed.nearby, parsed.reply);
    return;
  }

  if (parsed.intent === 'stop') {
    await stopNavigation();
    return;
  }

  await handleCommand(q);
}

function updateLoop() {
  if (state.current && state.target) {
    updateHUD();
  }
  requestAnimationFrame(updateLoop);
}

el.startBtn.addEventListener('click', () => {
  startSession();
});

el.micBtn.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startVoice();
});

el.stopBtn.addEventListener('click', () => {
  try { state.speechRec?.stop(); } catch {}
  try { state.recorder?.stop(); } catch {}
  stopNavigation();
  stopCamera();
});

el.dest.addEventListener('keydown', (e) => {
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
      el.cam.style.opacity = '1';
      state.mapVisible = true;
      showHint('Kamera-tila');
    } else {
      el.cam.style.opacity = '0.08';
      state.mapVisible = false;
      showHint('HUD-tila');
    }
  } else {
    if (dy < 0) {
      speak('Keskitetty.');
      showHint('Keskitetty');
    } else {
      state.mapVisible = !state.mapVisible;
      el.cam.style.opacity = state.mapVisible ? '1' : '0.08';
      showHint(state.mapVisible ? 'Kamera näkyy' : 'Kamera piilossa');
    }
  }
}, { passive: true });

window.addEventListener('load', () => {
  updateLoop();
  setMode('Valmis');
  showHint('Paina Aloita');
});
