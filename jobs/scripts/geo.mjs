// Distance from the phone to a role. The same code as Sponsor Radar's scripts/lib.mjs, kept separate so the two apps stay independent.
const lc = (s) => String(s || '').toLowerCase();

// ---------- distance from you ----------
// `places` is data/places.json: rough coordinates for postcode districts ("LE67") and towns ("milton keynes").
// Adverts give a town, a county or "Near LE67", so distances are rough, good to a few miles.

const PLACE_STOP = new Set(['near', 'and', 'more', 'the', 'of', 'north', 'south', 'east', 'west', 'central', 'greater', 'upon', 'on', 'in', 'uk', 'united', 'kingdom', 'england', 'scotland', 'wales']);
const DISTRICT = /^[a-z]{1,2}\d[a-z\d]?$/i;

// Job Radar stores full postcodes with no space ("NN72QA"). What comes before the last three characters is the district.
const FULL_POSTCODE = /^([a-z]{1,2}\d[a-z\d]?)\s?\d[a-z]{2}$/i;

export function placeCoords(text, places) {
  if (!places || !text) return null;
  const pc = String(text).trim().match(FULL_POSTCODE);
  if (pc) return places.d[pc[1].toUpperCase()] || null;
  const clean = lc(text).replace(/\band \d+ more\b/, '').replace(/\bnear\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const district = (w) => (DISTRICT.test(w) ? places.d[w.toUpperCase()] : null);
  const whole = district(clean) || places.t[clean];
  if (whole) return whole;
  const parts = clean.split(/\s*[,\/|-]\s*|\s+/).filter(Boolean);
  for (const chunk of clean.split(/\s*[,|]\s*/)) if (places.t[chunk]) return places.t[chunk];
  // the longest run of words that names a place, so "South West London" finds London
  for (let n = Math.min(4, parts.length); n >= 1; n -= 1) {
    for (let i = 0; i + n <= parts.length; i += 1) {
      const gram = parts.slice(i, i + n).join(' ');
      if (n === 1 && (PLACE_STOP.has(gram) || gram.length < 3)) continue;
      const hit = places.t[gram] || (n === 1 ? district(gram) : null);
      if (hit) return hit;
    }
  }
  return null;
}

export function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const coordCache = new WeakMap();
// Miles from `origin` ([lat, lon]) to the nearest place the advert names. Null when no place can be measured.
export function distanceMiles(job, origin, places) {
  if (!origin || !places) return null;
  let spots = coordCache.get(job);
  if (!spots || spots.places !== places) {
    const names = job.locations && job.locations.length ? job.locations : [job.location];
    spots = { places, coords: names.map((n) => placeCoords(n, places)).filter(Boolean) };
    coordCache.set(job, spots);
  }
  if (!spots.coords.length) return null;
  return Math.min(...spots.coords.map((c) => milesBetween(origin, c)));
}
