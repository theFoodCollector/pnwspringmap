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

  console.log('🚀 Build complete! Files are ready in ./dist/');
}

async function geocodeTrips(token, distDir) {
  const tripsPath = path.join(__dirname, 'trips.json');
  const trips = JSON.parse(fs.readFileSync(tripsPath, 'utf8'));

  const resolved = await Promise.all(trips.map(async (trip) => {
    if (!trip.address) {
      console.error(`❌ Trip "${trip.name}" is missing an address field`);
      process.exit(1);
    }
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trip.address)}.json?limit=1&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.features || data.features.length === 0) {
      console.error(`❌ Could not geocode address for "${trip.name}": ${trip.address}`);
      process.exit(1);
    }
    const coords = data.features[0].center;
    console.log(`✅ Geocoded "${trip.name}" → [${coords}]`);
    return { ...trip, coords };
  }));

  const outPath = path.join(distDir, 'trips.json');
  fs.writeFileSync(outPath, JSON.stringify(resolved, null, 2));
  console.log(`✅ Geocoded trips.json written to: ${outPath}`);
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
