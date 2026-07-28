const fs = require("node:fs");

const PLACES_API_URL = process.env.BB_ADMIN_PLACES_API_URL || "http://127.0.0.1:3000/api/places";
const GEOCODE_API_KEY = process.env[["GOOGLE", "MAPS", "API", "KEY"].join("_")]
  || process.env.GOOGLE_PLACE_API_KEY
  || "";
const WEATHER_CACHE_PATH = process.env.BB_WEATHER_CACHE_PATH || "/tmp/bb-weather.json";
const WEATHER_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CITY_LABELS_KO = { Seoul: "서울" };

let placesCache = { expiresAt: 0, places: [] };
const geocodeCache = new Map();

function normalizeLocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  const ts = typeof raw.ts === "string" && Number.isFinite(Date.parse(raw.ts)) ? raw.ts : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, ts };
}

function distanceMeters(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pickAddressPart(result, types) {
  const parts = Array.isArray(result?.address_components) ? result.address_components : [];
  return parts.find(part => types.some(type => part.types?.includes(type)))?.long_name || "";
}

function coarseAddress(results) {
  for (const result of results) {
    const dong = pickAddressPart(result, ["sublocality_level_2", "sublocality_level_3", "neighborhood"]);
    const gu = pickAddressPart(result, ["sublocality_level_1", "administrative_area_level_2"]);
    const city = pickAddressPart(result, ["locality", "administrative_area_level_1"])
      .replace(/특별시$|광역시$|특별자치시$|특별자치도$|도$/, "");
    const area = gu && dong ? `${gu} ${dong}` : dong || gu;
    if (area && city && area !== city) return `${area}, ${city}`;
    if (area || city) return area || city;
  }
  return "";
}

async function resolveLocationLabel(raw, { fetchImpl = fetch } = {}) {
  const location = normalizeLocation(raw);
  if (!location) return "";
  let alias = "";
  try {
    const now = Date.now();
    if (placesCache.expiresAt <= now) {
      const response = await fetchImpl(PLACES_API_URL, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`places API ${response.status}`);
      const data = await response.json();
      placesCache = { expiresAt: now + 30_000, places: Array.isArray(data?.places) ? data.places : [] };
    }
    const matches = placesCache.places
      .map(place => ({ ...place, distance: distanceMeters(location, { lat: Number(place.lat), lng: Number(place.lng) }) }))
      .filter(place => place.name && Number.isFinite(place.distance) && place.distance <= Number(place.radiusM || 100))
      .sort((a, b) => a.distance - b.distance);
    alias = matches[0]?.name ? String(matches[0].name) : "";
  } catch (_) {}

  let area = "";
  if (GEOCODE_API_KEY) {
    const key = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
    const cached = geocodeCache.get(key);
    if (cached?.expiresAt > Date.now()) area = cached.label;
    else {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("latlng", `${location.lat},${location.lng}`);
        url.searchParams.set("language", "ko");
        url.searchParams.set("key", GEOCODE_API_KEY);
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`geocode ${response.status}`);
        area = coarseAddress((await response.json())?.results || []);
        geocodeCache.set(key, { label: area, expiresAt: Date.now() + 86_400_000 });
      } catch (_) {}
    }
  }
  return alias && area ? `${alias} (${area})` : alias || area;
}

function buildTimeLabel(value, timeZone = "Asia/Seoul") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone, year: "numeric", month: "long", day: "numeric", weekday: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date).reduce((map, part) => ({ ...map, [part.type]: part.value }), {});
  const hour = Number(parts.hour);
  const period = hour >= 6 && hour < 11 ? "오전" : hour < 14 ? "점심" : hour < 18 ? "오후" : hour < 22 ? "저녁" : "밤";
  return `${parts.year}년 ${parts.month} ${parts.day}일 ${parts.weekday} ${period} ${parts.hour}:${parts.minute}`;
}

function readWeatherSnapshot(now = Date.now()) {
  try {
    const data = JSON.parse(fs.readFileSync(WEATHER_CACHE_PATH, "utf8"));
    const observedAt = Number(data?.updated_at) * 1000;
    const temp = Number(data?.temp_c);
    if (!Number.isFinite(observedAt) || !Number.isFinite(temp) || Math.abs(now - observedAt) > WEATHER_MAX_AGE_MS) return null;
    const desc = String(data.desc || "").trim();
    const city = CITY_LABELS_KO[String(data.city || "").trim()] || String(data.city || "").trim();
    const label = `${Math.round(temp)}도${desc ? `, ${desc}` : ""}${city ? ` (${city})` : ""}`;
    return { label, observedAt: new Date(observedAt).toISOString() };
  } catch (_) { return null; }
}

module.exports = { normalizeLocation, distanceMeters, resolveLocationLabel, buildTimeLabel, readWeatherSnapshot };
