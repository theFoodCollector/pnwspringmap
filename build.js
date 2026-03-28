const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env file not found');
    process.exit(1);
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return envVars;
}

// Process HTML file and replace tokens
async function processHtml() {
  const envVars = loadEnv();
  const htmlPath = path.join(__dirname, 'index.html');
  
  if (!fs.existsSync(htmlPath)) {
    console.error('index.html not found');
    process.exit(1);
  }
  
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');
  
  // Replace Mapbox token
  if (envVars.MAPBOX_TOKEN) {
    // Replace the development token with production token from .env
    htmlContent = htmlContent.replace(
      /mapboxgl\.accessToken\s*=\s*['"][^'"]+['"];/,
      `mapboxgl.accessToken = '${envVars.MAPBOX_TOKEN}';`
    );
    console.log('✅ Mapbox token injected from .env');
  } else {
    console.error('❌ MAPBOX_TOKEN not found in .env file');
    process.exit(1);
  }
  
  // Write processed HTML to dist folder
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
  }
  
  const outputPath = path.join(distDir, 'index.html');
  fs.writeFileSync(outputPath, htmlContent);
  console.log(`✅ Processed HTML saved to: ${outputPath}`);
  
  copyFile('.gitignore', distDir);

  // Geocode trips and write resolved trips.json to dist
  await geocodeTrips(envVars.MAPBOX_TOKEN, distDir);

  // Geocode routes and write resolved routes.json to dist
  await geocodeRoutes(envVars.MAPBOX_TOKEN, distDir);

  console.log('🚀 Build complete! Files are ready in ./dist/');
}

async function geocodeTrips(token, distDir) {
  const tripsPath = path.join(__dirname, 'trips.json');
  const cachePath = path.join(__dirname, 'geocache.json');

  const trips = JSON.parse(fs.readFileSync(tripsPath, 'utf8'));
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};

  let cacheUpdated = false;

  const resolved = await Promise.all(trips.map(async (trip) => {
    if (!trip.address) {
      console.error(`❌ Trip "${trip.name}" is missing an address field`);
      process.exit(1);
    }

    if (cache[trip.address]) {
      console.log(`✅ Using cached coords for "${trip.name}"`);
      return { ...trip, coords: cache[trip.address] };
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trip.address)}.json?limit=1&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.features || data.features.length === 0) {
      console.error(`❌ Could not geocode address for "${trip.name}": ${trip.address}`);
      console.error(`   Run "npm run dev" locally to populate geocache.json, then commit it.`);
      process.exit(1);
    }
    const coords = data.features[0].center;
    console.log(`✅ Geocoded "${trip.name}" → [${coords}]`);
    cache[trip.address] = coords;
    cacheUpdated = true;
    return { ...trip, coords };
  }));

  if (cacheUpdated) {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    console.log(`✅ geocache.json updated — commit this file to avoid re-geocoding in CI`);
  }

  const outPath = path.join(distDir, 'trips.json');
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log(`✅ Geocoded trips.json written to: ${outPath}`);
}

async function geocodeRoutes(token, distDir) {
  const routesPath = path.join(__dirname, 'routes.json');
  if (!fs.existsSync(routesPath)) {
    console.log('ℹ️  No routes.json found, skipping route geocoding');
    return;
  }

  const cachePath = path.join(__dirname, 'geocache.json');
  const tripsPath = path.join(__dirname, 'trips.json');

  const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const trips = JSON.parse(fs.readFileSync(tripsPath, 'utf8'));

  // Build a name→address lookup for ref resolution
  const tripsByName = {};
  trips.forEach(t => { tripsByName[t.name] = t.address; });

  let cacheUpdated = false;

  const resolved = await Promise.all(routes.map(async (route) => {
    const resolvedPoints = await Promise.all(route.points.map(async (point) => {
      let address;
      if (point.ref) {
        address = tripsByName[point.ref];
        if (!address) {
          console.error(`❌ Route "${route.name}" references unknown trip name: "${point.ref}"`);
          process.exit(1);
        }
      } else if (point.address) {
        address = point.address;
      } else {
        console.error(`❌ Route "${route.name}" has a point with neither ref nor address`);
        process.exit(1);
      }

      if (cache[address]) {
        console.log(`✅ Using cached coords for route point "${address}"`);
        return { ...point, coords: cache[address] };
      }

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?limit=1&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.features || data.features.length === 0) {
        console.error(`❌ Could not geocode route point address: ${address}`);
        process.exit(1);
      }
      const coords = data.features[0].center;
      console.log(`✅ Geocoded route point "${address}" → [${coords}]`);
      cache[address] = coords;
      cacheUpdated = true;
      return { ...point, coords };
    }));

    // Fetch road-following geometry from Directions API
    const profile = route.profile || 'walking';
    const coords = resolvedPoints.map(p => p.coords).filter(Boolean);
    const geometry = await fetchRouteGeometry(token, profile, coords, route.name);

    return { ...route, points: resolvedPoints, geometry };
  }));

  if (cacheUpdated) {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    console.log(`✅ geocache.json updated with route points`);
  }

  const outPath = path.join(distDir, 'routes.json');
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log(`✅ Geocoded routes.json written to: ${outPath}`);
}

async function fetchRouteGeometry(token, profile, coords, routeName) {
  if (coords.length < 2) return null;
  const coordStr = coords.map(c => c.join(',')).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) {
    console.warn(`⚠️  Could not get directions for "${routeName}", falling back to straight lines`);
    return null;
  }
  console.log(`✅ Got ${profile} directions for "${routeName}"`);
  return data.routes[0].geometry.coordinates;
}

function copyFile(filename, targetDir) {
  const srcPath = path.join(__dirname, filename);
  const destPath = path.join(targetDir, filename);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✅ Copied ${filename}`);
  }
}

// Run the build
processHtml();
