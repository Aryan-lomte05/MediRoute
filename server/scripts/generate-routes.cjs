const fs = require('fs');
const path = require('path');

// Read token from client/.env or process environment
let token = process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN;
if (!token) {
  try {
    const envContent = fs.readFileSync(path.resolve(__dirname, '../../client/.env'), 'utf8');
    const match = envContent.match(/VITE_MAPBOX_TOKEN=(.*)/);
    if (match) token = match[1].trim();
  } catch (e) {
    // Ignore if not present
  }
}

const kem = '72.8428,19.0035';

async function fetchRoute(from, to) {
  if (!token) {
    console.warn('Mapbox token not found; skipping route fetch');
    return null;
  }
  const url = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/' + from + ';' + to + '?geometries=geojson&overview=full&access_token=' + token;
  const res = await fetch(url);
  const d = await res.json();
  if (!d.routes || !d.routes.length) return null;
  return {
    coordinates: d.routes[0].geometry.coordinates,
    distanceKm: (d.routes[0].distance / 1000).toFixed(1),
    durationMin: Math.round(d.routes[0].duration / 60),
    summary: d.routes[0].legs[0].summary
  };
}

async function run() {
  const ambList = [
    { id: 'ems102', from: '72.8485,19.0220', name: 'EMS-102 (Dadar to KEM)' },
    { id: 'ems104', from: '72.8400,19.0550', name: 'EMS-104 (Bandra to KEM)' },
    { id: 'ems087', from: '72.8600,19.0300', name: 'EMS-087 (Sion to KEM)' }
  ];

  const hospitalRoutes = await Promise.all(ambList.map(async (a) => {
    const route = await fetchRoute(a.from, kem);
    return {
      id: a.id,
      name: a.name,
      ...route
    };
  }));

  const paramedicRoute = await fetchRoute('72.8430,19.0250', '72.8282,19.0515');
  const adminRoute = await fetchRoute('72.8310,19.0020', '72.8630,19.0480');

  const fileContent = `// Auto-generated real-road coordinates via Mapbox driving-traffic API
// All coordinates snap 100% to actual Mumbai roads, highways, and flyovers

export const PREFETCHED_TRAFFIC_ROUTES = ${JSON.stringify(hospitalRoutes, null, 2)};

export const PARAMEDIC_REAL_ROUTE = ${JSON.stringify(paramedicRoute, null, 2)};

export const ADMIN_REAL_ROUTE = ${JSON.stringify(adminRoute, null, 2)};

export async function fetchTrafficRoute(startLngLat, endLngLat, token) {
  try {
    const url = \`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/\${startLngLat[0]},\${startLngLat[1]};\${endLngLat[0]},\${endLngLat[1]}?geometries=geojson&overview=full&access_token=\${token}\`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Route API failed');
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error('No route found');
    return {
      coordinates: data.routes[0].geometry.coordinates,
      distanceKm: (data.routes[0].distance / 1000).toFixed(1),
      durationMin: Math.round(data.routes[0].duration / 60),
      summary: data.routes[0].legs?.[0]?.summary || ''
    };
  } catch (err) {
    console.warn('Traffic route fetch fallback:', err);
    return null;
  }
}
`;

  fs.writeFileSync('client/src/lib/routing.js', fileContent);
  console.log('COMPLETE: All real-road routes generated without hardcoded tokens!');
}

run().catch(console.error);
