/* global google */

let map;
let geocoder;
let placesService;
let directionsService;
let directionsRenderer;
let autocomplete;

let currentLocation = null;
let targetPlace = null;
let targetLabel = '';
let routeSteps = [];
let activeStepIndex = 0;
let watchId = null;
let currentHeading = null;
let compassEnabled = false;
let voiceRecognition = null;
let isListening = false;
let lastVibeAt = 0;
let mapVisible = true;

let currentMarker = null;
let targetMarker = null;

const $ = (id) => document.getElementById(id);
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
    return { intent: 'stop' };
  }

  if (t.includes('missä olen') || t.includes('missä mä oon') || t.includes('sijainti')) {
    return { intent: 'whereami' };
  }

  if (t.includes('kuinka pitkä matka') || t.includes('paljonko matkaa') || t.includes('matka')) {
    return { intent: 'status' };
  }

  if (t.includes('apu') || t.includes('ohje')) {
    return { intent: 'help' };
  }

  const nearbyKeywords = ['lähin', 'lähimpään', 'ruokakauppa', 'kauppa', 'kahvila', 'asema', 'apteekki', 'pizza', 'ravintola'];
  const nearby = nearbyKeywords.some(k => t.includes(k));

  if (nearby) {
    let query = 'kohde';
    if (t.includes('ruokakauppa') || t.includes('kauppa')) query = 'ruokakauppa';
    else if (t.includes('kahvila')) query = 'kahvila';
    else if (t.includes('apteekki')) query = 'apteekki';
    else if (t.includes('asema')) query = 'asema';
    else if (t.includes('pizza') || t.includes('ravintola')) query = 'ravintola';

    return { intent: 'navigate', query, nearby: true };
  }

  const fixes = {
    kamppi: 'Kamppi Helsinki',
    kampiin: 'Kamppi Helsinki',
    jumbolle: 'Jumbo Vantaa',
    jumbo: 'Jumbo Vantaa',
    stokkalle: 'Stockmann Helsinki',
    stokka: 'Stockmann Helsinki'
  };

  for (const [k, v] of Object.entries(fixes)) {
    if (t === k || t.includes(` ${k} `) || t.startsWith(k) || t.endsWith(k)) {
      return { intent: 'navigate', query: v, nearby: false };
    }
  }

  if (t.startsWith('vie ') || t.startsWith('mene ') || t.startsWith('navigoi ') || t.startsWith('ohjaa ')) {
    const cleaned = t
      .replace(/^(vie|mene|navigoi|ohjaa)\s+/i, '')
      .replace(/^(kohteeseen|paikkaan|osoitteeseen)\s+/i, '')
      .trim();
    return { intent: 'navigate', query: cleaned || text, nearby: false };
  }

  return { intent: 'navigate', query: text, nearby: false };
}

async function callAI(text) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      currentLocation,
      activeTarget: targetLabel
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI-virhe');
  return data;
}

async function resolveVoiceQuery(text) {
  try {
    const ai = await callAI(text);
    return ai;
  } catch {
    return localParseCommand(text);
  }
}

function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const query = address.toLowerCase().includes('finland') ? address : `${address}, Finland`;
    geocoder.geocode({ address: query }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        resolve({
          location: {
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng()
          },
          label: results[0].formatted_address || address
        });
      } else {
        reject(new Error('Paikkaa ei löytynyt'));
      }
    });
  });
}

function searchNearbyPlace(query) {
  return new Promise((resolve, reject) => {
    if (!currentLocation) {
      reject(new Error('Sijainti puuttuu'));
      return;
    }

    placesService.textSearch(
      {
        query,
        location: new google.maps.LatLng(currentLocation.lat, currentLocation.lng),
        radius: 5000
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          const r = results[0];
          resolve({
            location: {
              lat: r.geometry.location.lat(),
              lng: r.geometry.location.lng()
            },
            label: r.name || r.formatted_address || query
          });
        } else {
          reject(new Error('Paikkaa ei löytynyt'));
        }
      }
    );
  });
}

function reverseGeocode(latLng) {
  return new Promise((resolve, reject) => {
    geocoder.geocode({ location: latLng }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        resolve(results[0].formatted_address);
      } else {
        reject(new Error('Ei löytynyt'));
      }
    });
  });
}

function getLocationNow(timeoutMs = 8000) {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('Sijaintia ei tueta'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sijainti ei löytynyt ajoissa')), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        currentLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        gpsChip.textContent = 'Sijainti: päällä';
        resolve(currentLocation);
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

  if (watchId) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentLocation = {
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
      if (compassEnabled) {
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
          currentHeading = e.webkitCompassHeading;
        } else if (e.alpha != null) {
          currentHeading = 360 - e.alpha;
        }
      }, true);

      compassEnabled = true;
      compassChip.textContent = 'Kompassi: päällä';
      resolve(true);
    } catch {
      compassChip.textContent = 'Kompassi: pois';
      resolve(false);
    }
  });
}

function clearRoute() {
  routeSteps = [];
  activeStepIndex = 0;

  if (directionsRenderer) {
    directionsRenderer.set('directions', null);
  }

  if (currentMarker) {
    currentMarker.setMap(null);
    currentMarker = null;
  }

  if (targetMarker) {
    targetMarker.setMap(null);
    targetMarker = null;
  }
}

function updateMarkers() {
  if (!map) return;

  if (currentLocation) {
    const pos = { lat: currentLocation.lat, lng: currentLocation.lng };
    if (!currentMarker) {
      currentMarker = new google.maps.Marker({
        position: pos,
        map,
        title: 'Olet tässä'
      });
    } else {
      currentMarker.setPosition(pos);
    }
  }

  if (targetPlace) {
    if (!targetMarker) {
      targetMarker = new google.maps.Marker({
        position: targetPlace,
        map,
        title: targetLabel || 'Kohde'
      });
    } else {
      targetMarker.setPosition(targetPlace);
    }
  }
}

function currentStep() {
  if (!routeSteps.length) return null;
  return routeSteps[Math.min(activeStepIndex, routeSteps.length - 1)];
}

function stepLocation(step, fallback) {
  if (step && step.end_location) {
    return {
      lat: typeof step.end_location.lat === 'function' ? step.end_location.lat() : step.end_location.lat,
      lng: typeof step.end_location.lng === 'function' ? step.end_location.lng() : step.end_location.lng
    };
  }
  return fallback;
}

function maybeAdvanceStep() {
  const step = currentStep();
  if (!step || !currentLocation) return;

  const p = stepLocation(step, targetPlace);
  const d = haversine(currentLocation, p);

  if (d < 28 && activeStepIndex < routeSteps.length - 1) {
    activeStepIndex += 1;
    if (navigator.vibrate) navigator.vibrate(30);
  }
}

async function buildRoute() {
  if (!currentLocation || !targetPlace) return;

  const request = {
    origin: currentLocation,
    destination: targetPlace,
    travelMode: google.maps.TravelMode.WALKING
  };

  const result = await new Promise((resolve, reject) => {
    directionsService.route(request, (response, status) => {
      if (status === 'OK' && response) resolve(response);
      else reject(new Error('Reittiä ei löytynyt'));
    });
  });

  routeSteps = result.routes?.[0]?.legs?.[0]?.steps || [];
  activeStepIndex = 0;
  directionsRenderer.setDirections(result);
  updateMarkers();
}

async function startNavigation() {
  if (!targetPlace) return;

  await enableCompass();
  await getLocationNow();
  watchLocation();

  setMode('Haetaan reitti');
  showHint(`Kohde: ${targetLabel || 'valittu paikka'}`);
  speakFi(`Aloitetaan navigointi kohteeseen ${targetLabel || 'valittu paikka'}.`);

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
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  currentLocation = null;
  targetPlace = null;
  targetLabel = '';
  clearRoute();
  gpsChip.textContent = 'Sijainti: pois';
  compassChip.textContent = compassEnabled ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode('Valmis');
  centerEl.classList.remove('show');
  showHint('Pysäytetty');
}

function updateHUD() {
  if (!currentLocation || !targetPlace) return;

  const step = currentStep();
  const anchor = step ? stepLocation(step, targetPlace) : targetPlace;

  const dTarget = haversine(currentLocation, targetPlace);
  const dAnchor = haversine(currentLocation, anchor);
  const b = bearing(currentLocation, anchor);
  const h = currentHeading;
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
  compassChip.textContent = compassEnabled ? 'Kompassi: päällä' : 'Kompassi: pois';
  setMode(isListening ? 'Kuuntelen' : (targetPlace ? 'Navigointi' : 'Valmis'));

  const show = isListening || !!targetPlace || dTarget < 120 || Math.abs(diff) > 18;
  centerEl.classList.toggle('show', !!show);

  const pct = Math.max(0, Math.min(100, 100 - Math.min(dTarget, 1500) / 15));
  bar.style.width = `${pct}%`;

  if (dTarget < 20 && Date.now() - lastVibeAt > 1200) {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    lastVibeAt = Date.now();
  }

  arrowWrap.style.transform = dTarget < 20 ? 'scale(1.06)' : 'scale(1)';

  if (mapVisible && currentLocation && map) {
    map.panTo(currentLocation);
  }

  maybeAdvanceStep();
}

function updateLoop() {
  if (currentLocation && targetPlace) updateHUD();
  requestAnimationFrame(updateLoop);
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

    if (parsed.intent === 'stop') {
      stopNavigation();
      speakFi('Navigointi pysäytetty.');
      return;
    }

    if (parsed.intent === 'whereami') {
      if (!currentLocation) {
        speakFi('Sijaintia ei vielä ole.');
        return;
      }
      try {
        const addr = await reverseGeocode(currentLocation);
        speakFi(`Olet nyt kohdassa ${addr}.`);
      } catch {
        speakFi(`Sijaintisi tarkkuus on noin ${Math.round(currentLocation.accuracy || 0)} metriä.`);
      }
      return;
    }

    if (parsed.intent === 'status') {
      if (!currentLocation || !targetPlace) {
        speakFi('Aktiivista navigointia ei ole käynnissä.');
        return;
      }
      const d = haversine(currentLocation, targetPlace);
      speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
      return;
    }

    if (parsed.intent === 'help') {
      speakFi('Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
      return;
    }

    if (parsed.intent === 'clarify') {
      speakFi('Minne haluat mennä?');
      return;
    }

    if (parsed.intent === 'navigate') {
      const queryToUse = parsed.query || q;
      destInput.value = queryToUse;
      showHint(`Haetaan: ${queryToUse}`);

      try {
        const place = parsed.nearby
          ? await searchNearbyPlace(queryToUse)
          : await geocodeAddress(queryToUse);

        targetPlace = place.location;
        targetLabel = place.label || queryToUse;
        updateMarkers();
        await startNavigation();
      } catch (e) {
        console.error(e);
        speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
        showHint('Paikkaa ei löytynyt');
      }
      return;
    }

    speakFi('En ymmärtänyt komentoa.');
  } catch (e) {
    console.error(e);
    speakFi('Tapahtui virhe. Yritä uudestaan.');
    showHint('Virhe');
  }
}

function startVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showHint('Puheentunnistus ei ole käytössä');
    speakFi('Tämä selain ei tue puheentunnistusta.');
    return;
  }

  if (isListening) {
    try { voiceRecognition?.stop(); } catch {}
    return;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = 'fi-FI';
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;

  voiceRecognition.onstart = () => {
    isListening = true;
    $('micBtn').textContent = 'Kuuntelen';
    micState.classList.add('show');
    setMode('Kuuntelen');
    centerEl.classList.add('show');
    showHint('Puhu nyt');
    speakFi('Kuuntelen.');
  };

  voiceRecognition.onend = () => {
    isListening = false;
    $('micBtn').textContent = 'Mikki';
    micState.classList.remove('show');
    setMode(targetPlace ? 'Navigointi' : 'Valmis');
    updateHUD();
  };

  voiceRecognition.onerror = (e) => {
    isListening = false;
    $('micBtn').textContent = 'Mikki';
    micState.classList.remove('show');
    setMode(targetPlace ? 'Navigointi' : 'Valmis');
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
  } catch {
    showHint('Puhe ei käynnistynyt');
  }
}

async function handleUserText(text) {
  const transcript = String(text || '').trim();
  if (!transcript) {
    speakFi('En kuullut mitään.');
    return;
  }

  showHint(transcript);

  const parsed = await resolveVoiceQuery(transcript);

  if (parsed.intent === 'stop') {
    stopNavigation();
    speakFi('Navigointi pysäytetty.');
    return;
  }

  if (parsed.intent === 'whereami') {
    if (!currentLocation) {
      speakFi('Sijaintia ei vielä ole.');
      return;
    }
    try {
      const addr = await reverseGeocode(currentLocation);
      speakFi(`Olet nyt kohdassa ${addr}.`);
    } catch {
      speakFi(`Sijaintisi tarkkuus on noin ${Math.round(currentLocation.accuracy || 0)} metriä.`);
    }
    return;
  }

  if (parsed.intent === 'status') {
    if (!currentLocation || !targetPlace) {
      speakFi('Aktiivista navigointia ei ole käynnissä.');
      return;
    }
    const d = haversine(currentLocation, targetPlace);
    speakFi(d < 20 ? 'Olet perillä.' : `Matkaa on noin ${formatDistance(d)}.`);
    return;
  }

  if (parsed.intent === 'help') {
    speakFi('Voit sanoa: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.');
    return;
  }

  if (parsed.intent === 'clarify') {
    speakFi('Minne haluat mennä?');
    return;
  }

  if (parsed.intent === 'navigate') {
    const queryToUse = parsed.query || transcript;
    destInput.value = queryToUse;
    showHint(`Haetaan: ${queryToUse}`);

    try {
      const place = parsed.nearby
        ? await searchNearbyPlace(queryToUse)
        : await geocodeAddress(queryToUse);

      targetPlace = place.location;
      targetLabel = place.label || queryToUse;
      updateMarkers();
      await startNavigation();
    } catch (e) {
      console.error(e);
      speakFi('En löytänyt paikkaa. Kokeile tarkempaa nimeä.');
      showHint('Paikkaa ei löytynyt');
    }
    return;
  }

  speakFi('En ymmärtänyt komentoa.');
}

function toggleMap() {
  mapVisible = !mapVisible;
  mapEl.style.opacity = mapVisible ? '1' : '0.06';
  showHint(mapVisible ? 'Kartta näkyy' : 'Kartta piilossa');
}

function initMap() {
  map = new google.maps.Map(mapEl, {
    center: { lat: 60.1699, lng: 24.9384 },
    zoom: 15,
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    backgroundColor: '#111111'
  });

  geocoder = new google.maps.Geocoder();
  placesService = new google.maps.places.PlacesService(map);
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    preserveViewport: false
  });

  autocomplete = new google.maps.places.Autocomplete(destInput, {
    fields: ['geometry', 'name', 'formatted_address']
  });

  autocomplete.addListener('place_changed', async () => {
    const place = autocomplete.getPlace();
    if (place && place.geometry && place.geometry.location) {
      targetPlace = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      };
      targetLabel = place.formatted_address || place.name || destInput.value;
      updateMarkers();
      await startNavigation();
    }
  });

  destInput.value = 'Kamppi Helsinki';
  setMode('Valmis');
  showHint('Sano: “Vie Kamppiin”');
  updateLoop();
}

window.initMap = initMap;

$('goBtn').addEventListener('click', () => startFromInput(destInput.value));
$('micBtn').addEventListener('click', () => startVoiceRecognition());
$('stopBtn').addEventListener('click', () => {
  try { voiceRecognition?.stop(); } catch {}
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
      mapVisible = true;
      mapEl.style.opacity = '1';
      showHint('Kartta-tila');
    } else {
      mapVisible = false;
      mapEl.style.opacity = '0.06';
      showHint('HUD-tila');
    }
  } else {
    if (dy < 0) {
      if (currentLocation && map) map.setCenter(currentLocation);
      showHint('Keskitetty');
    } else {
      toggleMap();
    }
  }
}, { passive: true });
