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
function processHtml() {
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
  
  // Copy other necessary files
  copyFile('trips.json', distDir);
  copyFile('.gitignore', distDir);
  
  console.log('🚀 Build complete! Files are ready in ./dist/');
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
