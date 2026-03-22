const $ = (id) => document.getElementById(id);

const state = {
  current: null,
  target: null,
  targetLabel: '',
  lastQuery: '',
  lastIntent: '',
  routeSteps: [],
  activeStepIndex: 0,
  watchId: null,
  currentHeading: null,
  compassEnabled: false,
  isListening: false,
  recording: false,
  recorder: null,
  stream: null,
  chunks: [],
  mapVisible: true,
  lastVibeAt: 0,
  routeLine: null,
  currentMarker: null,
  targetMarker: null,
  routeLoading: false
};

let map;

const centerEl = $('center');
const arrowSvg = $('arrowSvg');
const arrowWrap = $('arrowWrap');
const distanceEl = $('distance');
const subEl = $('sub');
const gpsChip = $('gpsChip');
const compassChip = $('compassChip');
const modeChip = $('modeChip');
const bar = $('bar');
const hint = $('hint');
const micState = $('micState');
const destInput = $('dest');
const mapEl = $('map');

const PLACE_ALIASES = {
  kamppi: ['Kamppi Helsinki', 'Kamppi'],
  kampiin: ['Kamppi Helsinki', 'Kamppi'],
  stockmann: ['Stockmann Helsinki'],
  stokka: ['Stockmann Helsinki'],
  stokkalle: ['Stockmann Helsinki'],
  jumbo: ['Jumbo Vantaa'],
  jumbolle: ['Jumbo Vantaa'],
  rautatieasema: ['Helsingin päärautatieasema', 'Helsingin rautatieasema'],
  päärautatieasema: ['Helsingin päärautatieasema'],
  asema: ['asema'],
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
  hint.textContent = text;
  hint.classList.add('show');
  clearTimeout(showHint.t);
  showHint.t = setTimeout(() => hint.classList.remove('show'), ms);
}

function setMode(text) {
  modeChip.textContent = `Tila: ${text}`;
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
  if (Math.abs(d) < 10) return 0;
  if (d >= 10 && d < 40) return 30;
  if (d >= 40 && d < 85) return 90;
  if (d >= 85 && d < 140) return 135;
  if (d >= 140) return 180;
  if (d <= -10 && d > -40) return -30;
  if (d <= -40 && d > -85) return -90;
  if (d <= -85 && d > -140) return -135;
  if (d <= -140) return 180;
  return 0;
}

function speakFi(text) {
  const clean = String(text || '').trim();
  if (!clean || !('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fi-FI';
    u.rate = 0.96;
    u.pitch = 1.0;
    u.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find(v => /^fi\b/i.test(v.lang)) ||
      voices.find(v => /finn/i.test(v.name)) ||
      voices.find(v => /siri/i.test(v.name)) ||
      null;

    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {}
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, '');
}

function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  for (const [needle, values] of Object.entries(PLACE_ALIASES)) {
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

  if (t.includes('sinne') || t.includes('samaan paikkaan') || t.includes('sama paikka')) {
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

async function callAI(text) {
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
}

function normalizeAiResult(data) {
  if (!data || typeof data !== 'object') return null;

  const intent = String(data.intent || '').trim();
  const query = String(data.query || data.destination_query || '').trim();
  const nearby = Boolean(data.nearby ?? (String(data.search_mode || '').toLowerCase() === 'nearby'));
  const reply = String(data.reply || '').trim();

  return {
    intent: intent || 'clarify',
    query,
    nearby,
    reply
  };
}

async function resolveVoiceQuery(text) {
  try {
    const ai = await callAI(text);
    const normalized = normalizeAiResult(ai);
    if (normalized) return normalized;
  } catch {}

  return localParseCommand(text);
}

function searchVariants(rawQuery, nearby) {
  const t = normalizeText(rawQuery);
  const variants = new Set();

  if (!t) return [];

  variants.add(rawQuery.trim());

  const aliasValues = PLACE_ALIASES[t];
  if (aliasValues) {
    for (const v of aliasValues) variants.add(v);
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

function geocodePlace(query, searchMode = 'exact') {
  return new Promise((resolve, reject) => {
    const q = String(query || '').trim();
    if (!q) {
      reject(new Error('Tyhjä kohde'));
      return;
    }

    const variants = searchVariants(q, searchMode === 'nearby');

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

      if (searchMode === 'nearby' && state.current) {
        const lat = state.current.lat;
        const lng = state.current.lng;
        params.set('viewbox', `${lng - 0.15},${lat + 0.10},${lng + 0.15},${lat - 0.10}`);
        params.set('bounded', '1');
      }

      fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'Accept': 'application/json' }
      })
        .then((r) => r.json())
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
    .then((r) => r.json())
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

function currentStep() {
  if (!state.routeSteps.length) return null;
  return state.routeSteps[Math.min(state.activeStepIndex, state.routeSteps.length - 1)];
}

function setMapVisible(v) {
  state.mapVisible = v;
  mapEl.style.opacity = v ? '1' : '0.06';
}

function updateMarkers() {
  if (!map) return;

  if (state.current) {
    const pos = [state.current.lat, state.current.lng];
    if (!state.currentMarker) {
      state.currentMarker = L.circleMarker(pos, {
        radius: 8,
        weight: 2,
        color: '#fff',
        fillColor: '#fff',
        fillOpacity: 1
      }).addTo(map);
    } else {
      state.currentMarker.setLatLng(pos);
    }
  }

  if (state.target) {
    const pos = [state.target.lat, state.target.lng];
    if (!state.targetMarker) {
      state.targetMarker = L.circleMarker(pos, {
        radius: 7,
        weight: 2,
        color: '#fff',
        fillColor: 'rgba(255,255,255,.18)',
        fillOpacity: 1
      }).addTo(map);
    } else {
      state.targetMarker.setLatLng(pos);
    }
  }
}

function drawRoute(routeGeojson) {
  if (state.routeLine) {
    map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  if (routeGeojson) {
    state.routeLine = L.geoJSON(routeGeojson, {
      style: {
        color: '#ffffff',
        weight: 5,
        opacity: 0.8
      }
    }).addTo(map);

    map.fitBounds(state.routeLine.getBounds(), { padding: [40, 40] });
  }

  updateMarkers();
}

function maybeAdvanceStep() {
  const step = currentStep();
  if (!step || !state.current) return;

  const p = stepLocation(step, state.target);
  const d = haversine(state.current, p);

  if (d < 28 && state.activeStepIndex < state.routeSteps.length - 1) {
    state.activeStepIndex += 1;
    if (navigator.vibrate) navigator.vibrate(30);
  }
}

function updateHUD() {
  if (!state.current || !state.target) return;

  const step = currentStep();
  const anchor = step ? stepLocation(step, state.target) : state.target;

  const dTarget = haversine(state.current, state.target);
  const dAnchor = haversine(state.current, anchor);
  const b = bearing(state.current, anchor);
  const h = state.currentHeading;
  const diff = h == null ? 0 : diffAngle(b, h);
  const rot = arrowRotationFromDiff(diff);

  arrowSvg.style.transform = `rotate(${rot}deg)`;

  if (dTarget < 20) {
    distanceEl.textContent = 'NYT';
    subEl.textContent = 'Perillä pian';
  } else {
    distanceEl.textContent = formatDistance(dAnchor);
    const stepText = step?.instructions ? stripHtml(step.instructions) : '';
    subEl.textContent = stepText || (Math.abs(diff) < 20 ? 'Oikea suunta' : 'Käänny');
  }

  gpsChip.textContent = 'Sijainti: päällä';
  compassChip.textContent = state.compassEnabled ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode(state.isListening ? 'Kuuntelen' : (state.target ? 'Navigointi' : 'Valmis'));

  const show = state.isListening || !!state.target || dTarget < 120 || Math.abs(diff) > 18;
  centerEl.classList.toggle('show', !!show);

  const pct = Math.max(0, Math.min(100, 100 - Math.min(dTarget, 1500) / 15));
  bar.style.width = `${pct}%`;

  if (dTarget < 20 && Date.now() - state.lastVibeAt > 1200) {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    state.lastVibeAt = Date.now();
  }

  arrowWrap.style.transform = dTarget < 20 ? 'scale(1.06)' : 'scale(1)';

  if (state.mapVisible && state.current) {
    map.panTo([state.current.lat, state.current.lng], { animate: true });
  }

  maybeAdvanceStep();
}

function reverseGeocode(latLng) {
  return fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latLng.lat}&lon=${latLng.lng}`)
    .then(r => r.json())
    .then(data => {
      if (data && data.display_name) return data.display_name;
      throw new Error('Ei löytynyt');
    });
}

function getLocationNow(timeoutMs = 8000) {
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
        gpsChip.textContent = 'Sijainti: päällä';
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
      gpsChip.textContent = 'Sijainti: päällä';
      updateMarkers();
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

function enableCompass() {
  return new Promise(async (resolve) => {
    try {
      if (state.compassEnabled) {
        resolve(true);
        return;
      }

      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          compassChip.textContent = 'Kompassi: kieltty';
          resolve(false);
          return;
        }
      }

      window.addEventListener('deviceorientation', (e) => {
        if (typeof e.webkitCompassHeading === 'number') {
          state.currentHeading = e.webkitCompassHeading;
        } else if (e.alpha != null) {
          state.currentHeading = 360 - e.alpha;
        }
      }, true);

      state.compassEnabled = true;
      compassChip.textContent = 'Kompassi: päällä';
      resolve(true);
    } catch {
      compassChip.textContent = 'Kompassi: pois';
      resolve(false);
    }
  });
}

function clearRoute() {
  state.routeSteps = [];
  state.activeStepIndex = 0;

  if (state.routeLine) {
    map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  if (state.currentMarker) {
    map.removeLayer(state.currentMarker);
    state.currentMarker = null;
  }

  if (state.targetMarker) {
    map.removeLayer(state.targetMarker);
    state.targetMarker = null;
  }
}

async function buildRoute() {
  if (!state.current || !state.target) return;

  const route = await getRoute(state.current, state.target);
  state.routeSteps = extractSteps(route);
  state.activeStepIndex = 0;
  drawRoute(route.geometry);
  updateMarkers();
}

async function startNavigation() {
  if (!state.target) return;

  await enableCompass();
  await getLocationNow();
  watchLocation();

  setMode('Haetaan reitti');
  showHint(`Kohde: ${state.targetLabel || 'valittu paikka'}`);
  speakFi(`Aloitetaan navigointi kohteeseen ${state.targetLabel || 'valittu paikka'}.`);

  try {
    await buildRoute();
    setMode('Navigointi');
    updateHUD();
  } catch (e) {
    console.error(e);
    setMode('Valmis');
    showHint('Reittiä ei löytynyt');
    speakFi('Reittiä ei löytynyt. Yritä toista paikkaa.');
    clearRoute();
  }
}

function stopNavigation() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  state.current = null;
  state.target = null;
  state.targetLabel = '';
  state.lastQuery = '';
  state.lastIntent = '';
  clearRoute();
  gpsChip.textContent = 'Sijainti: pois';
  compassChip.textContent = state.compassEnabled ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode('Valmis');
  centerEl.classList.remove('show');
  showHint('Pysäytetty');
}

async function startFromInput(query) {
  const q = String(query || '').trim();
  if (!q) {
    speakFi('Kirjoita kohde ensin.');
    showHint('Kirjoita kohde ensin');
    return;
  }

  await enableCompass();
  setMode('Haetaan paikka');

  try {
    const parsed = await resolveVoiceQuery(q);
    state.lastIntent = parsed.intent || '';
    if (parsed.query) state.lastQuery = parsed.query;

    if (parsed.intent === 'stop') {
      stopNavigation();
      speakFi(parsed.reply || 'Navigointi pysäytetty.');
      return;
    }

    if (parsed.intent === 'whereami') {
      if (!state.current) {
        speakFi(parsed.reply || 'Sijaintia ei vielä ole.');
        return;
      }
      try {
        const addr = await reverseGeocode(state.current);
        speakFi(`Olet nyt kohdassa ${addr}.`);
      } catch {
        speakFi(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
      }
      return;
    }

    if (parsed.intent === 'status') {
      if (!state.current || !state.target) {
        speakFi('Aktiivista navigointia ei ole käynnissä.');
        return;
      }
      const d = haversine(state.current, state.target);
      speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
      return;
    }

    if (parsed.intent === 'help') {
      speakFi(parsed.reply || 'Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
      return;
    }

    if (parsed.intent === 'clarify') {
      speakFi(parsed.reply || 'Minne haluat mennä?');
      return;
    }

    if (parsed.intent === 'navigate') {
      const queryToUse = parsed.query || q;
      destInput.value = queryToUse;
      showHint(`Haetaan: ${queryToUse}`);

      try {
        const place = await geocodePlace(queryToUse, parsed.nearby ? 'nearby' : 'exact');
        state.target = { lat: place.lat, lng: place.lng };
        state.targetLabel = place.label || queryToUse;
        updateMarkers();

        if (parsed.reply) speakFi(parsed.reply);
        await startNavigation();
      } catch (e) {
        console.error(e);
        speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
        showHint('Paikkaa ei löytynyt');
      }
      return;
    }

    speakFi(parsed.reply || 'En ymmärtänyt komentoa.');
  } catch (e) {
    console.error(e);
    speakFi('Tapahtui virhe. Yritä uudestaan.');
    showHint('Virhe');
  }
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
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

async function handleUserText(text) {
  const transcript = String(text || '').trim();
  if (!transcript) {
    speakFi('En kuullut mitään.');
    return;
  }

  showHint(transcript);

  const parsed = await resolveVoiceQuery(transcript);
  state.lastIntent = parsed.intent || '';
  if (parsed.query) state.lastQuery = parsed.query;

  if (parsed.intent === 'stop') {
    stopNavigation();
    speakFi(parsed.reply || 'Navigointi pysäytetty.');
    return;
  }

  if (parsed.intent === 'whereami') {
    if (!state.current) {
      speakFi(parsed.reply || 'Sijaintia ei vielä ole.');
      return;
    }
    try {
      const addr = await reverseGeocode(state.current);
      speakFi(`Olet nyt kohdassa ${addr}.`);
    } catch {
      speakFi(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
    }
    return;
  }

  if (parsed.intent === 'status') {
    if (!state.current || !state.target) {
      speakFi('Aktiivista navigointia ei ole käynnissä.');
      return;
    }
    const d = haversine(state.current, state.target);
    speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
    return;
  }

  if (parsed.intent === 'help') {
    speakFi(parsed.reply || 'Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
    return;
  }

  if (parsed.intent === 'clarify') {
    speakFi(parsed.reply || 'Minne haluat mennä?');
    return;
  }

  if (parsed.intent === 'navigate') {
    const queryToUse = parsed.query || transcript;
    destInput.value = queryToUse;
    showHint(`Haetaan: ${queryToUse}`);

    try {
      const place = await geocodePlace(queryToUse, parsed.nearby ? 'nearby' : 'exact');
      state.target = { lat: place.lat, lng: place.lng };
      state.targetLabel = place.label || queryToUse;
      updateMarkers();

      if (parsed.reply) speakFi(parsed.reply);
      await startNavigation();
    } catch (e) {
      console.error(e);
      speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
      showHint('Paikkaa ei löytynyt');
    }
    return;
  }

  speakFi(parsed.reply || 'En ymmärtänyt komentoa.');
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  if (state.isListening) {
    try { voiceRecognition?.stop(); } catch {}
    return true;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = 'fi-FI';
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;

  voiceRecognition.onstart = () => {
    state.isListening = true;
    $('micBtn').textContent = 'Kuuntelen';
    micState.classList.add('show');
    setMode('Kuuntelen');
    centerEl.classList.add('show');
    showHint('Puhu nyt');
    speakFi('Kuuntelen.');
  };

  voiceRecognition.onend = () => {
    state.isListening = false;
    $('micBtn').textContent = 'Mikki';
    micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');
    updateHUD();
  };

  voiceRecognition.onerror = (e) => {
    state.isListening = false;
    $('micBtn').textContent = 'Mikki';
    micState.classList.remove('show');
    setMode(state.target ? 'Navigointi' : 'Valmis');
    showHint('Puhe ei onnistunut');
    console.log('speech error', e);
    speakFi('Puheentunnistus epäonnistui.');
  };

  voiceRecognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript || '';
    handleUserText(transcript);
  };

  try {
    voiceRecognition.start();
    return true;
  } catch {
    return false;
  }
}

async function startRecording() {
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
    state.isListening = true;

    $('micBtn').textContent = 'Puhu';
    micState.classList.add('show');
    setMode('Kuuntelen');
    showHint('Puhu nyt');
    speakFi('Kuuntelen.');

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(state.chunks, { type: mimeType || 'audio/webm' });
        const transcript = await transcribeAudioBlob(blob, mimeType || blob.type);
        await handleUserText(transcript);
      } catch (e) {
        console.error(e);
        showHint('Puhe ei onnistunut');
        speakFi('Puheentunnistus epäonnistui.');
      } finally {
        state.recording = false;
        state.isListening = false;
        $('micBtn').textContent = 'Mikki';
        micState.classList.remove('show');
        if (state.stream) {
          state.stream.getTracks().forEach(t => t.stop());
          state.stream = null;
        }
        state.recorder = null;
        updateHUD();
      }
    };

    recorder.start();
    state.recordTimer = setTimeout(() => stopRecording(), 8000);
  } catch (e) {
    console.error(e);
    state.recording = false;
    micState.classList.remove('show');
    showHint('Mikrofoni ei auennut');
    speakFi('Mikrofoni ei auennut.');
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

async function startVoiceInput() {
  const speechOk = startSpeechRecognition();
  if (!speechOk) {
    await startRecording();
  }
}

async function startFromInput(query) {
  const q = String(query || '').trim();
  if (!q) {
    speakFi('Kirjoita kohde ensin.');
    showHint('Kirjoita kohde ensin');
    return;
  }

  await enableCompass();
  setMode('Haetaan paikka');

  try {
    const parsed = await resolveVoiceQuery(q);
    state.lastIntent = parsed.intent || '';
    if (parsed.query) state.lastQuery = parsed.query;

    if (parsed.intent === 'stop') {
      stopNavigation();
      speakFi(parsed.reply || 'Navigointi pysäytetty.');
      return;
    }

    if (parsed.intent === 'whereami') {
      if (!state.current) {
        speakFi(parsed.reply || 'Sijaintia ei vielä ole.');
        return;
      }
      try {
        const addr = await reverseGeocode(state.current);
        speakFi(`Olet nyt kohdassa ${addr}.`);
      } catch {
        speakFi(`Sijaintisi tarkkuus on noin ${Math.round(state.current.accuracy || 0)} metriä.`);
      }
      return;
    }

    if (parsed.intent === 'status') {
      if (!state.current || !state.target) {
        speakFi('Aktiivista navigointia ei ole käynnissä.');
        return;
      }
      const d = haversine(state.current, state.target);
      speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
      return;
    }

    if (parsed.intent === 'help') {
      speakFi(parsed.reply || 'Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
      return;
    }

    if (parsed.intent === 'clarify') {
      speakFi(parsed.reply || 'Minne haluat mennä?');
      return;
    }

    if (parsed.intent === 'navigate') {
      const queryToUse = parsed.query || q;
      destInput.value = queryToUse;
      showHint(`Haetaan: ${queryToUse}`);

      try {
        const place = await geocodePlace(queryToUse, parsed.nearby ? 'nearby' : 'exact');
        state.target = { lat: place.lat, lng: place.lng };
        state.targetLabel = place.label || queryToUse;
        updateMarkers();

        if (parsed.reply) speakFi(parsed.reply);
        await startNavigation();
      } catch (e) {
        console.error(e);
        speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
        showHint('Paikkaa ei löytynyt');
      }
      return;
    }

    speakFi(parsed.reply || 'En ymmärtänyt komentoa.');
  } catch (e) {
    console.error(e);
    speakFi('Tapahtui virhe. Yritä uudestaan.');
    showHint('Virhe');
  }
}

function updateLoop() {
  if (state.current && state.target) {
    maybeAdvanceStep();
    updateHUD();
  }
  requestAnimationFrame(updateLoop);
}

function initLeafletMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([60.1699, 24.9384], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  setMapVisible(true);
  showHint('Sano: “Vie Kamppiin”');
  setMode('Valmis');
  updateLoop();
}

$('goBtn').addEventListener('click', () => startFromInput(destInput.value));
$('micBtn').addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startVoiceInput();
});
$('stopBtn').addEventListener('click', () => {
  try { voiceRecognition?.stop(); } catch {}
  try { state.recorder?.stop(); } catch {}
  stopNavigation();
  speakFi('Navigointi pysäytetty.');
});

destInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    startFromInput(destInput.value);
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
      setMapVisible(true);
      showHint('Kartta-tila');
    } else {
      setMapVisible(false);
      showHint('HUD-tila');
    }
  } else {
    if (dy < 0) {
      if (state.current && map) map.setView([state.current.lat, state.current.lng], map.getZoom());
      showHint('Keskitetty');
    } else {
      setMapVisible(!state.mapVisible);
    }
  }
}, { passive: true });

window.addEventListener('load', () => {
  initLeafletMap();
});
