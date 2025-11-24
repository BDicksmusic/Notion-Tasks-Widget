/**
 * Script to generate PNG and ICO files from SVG icon
 * Run with: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Error: sharp is not installed.');
  console.error('Please install it with: npm install --save-dev sharp');
  process.exit(1);
}

// Check if to-ico is available
let toIco;
try {
  toIco = require('to-ico');
} catch (e) {
  console.warn('Warning: to-ico is not installed. ICO generation will be skipped.');
  console.warn('Install it with: npm install --save-dev to-ico');
}

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');

// Sizes needed for Electron/Windows
const sizes = [16, 32, 48, 64, 128, 256, 512];

async function generateIcons() {
  if (!fs.existsSync(svgPath)) {
    console.error(`Error: SVG file not found at ${svgPath}`);
    process.exit(1);
  }

  console.log('Generating PNG icons from SVG...');

  // Generate PNG files
  for (const size of sizes) {
    const outputPath = path.join(buildDir, `icon-${size}.png`);
    try {
      await sharp(svgPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .png()
        .toFile(outputPath);
      console.log(`✓ Generated icon-${size}.png`);
    } catch (error) {
      console.error(`✗ Failed to generate icon-${size}.png:`, error.message);
    }
  }

  // Generate ICO file (Windows icon)
  // ICO format requires multiple sizes embedded
  const icoPath = path.join(buildDir, 'icon.ico');
  if (toIco) {
    try {
      // Create ICO with multiple sizes (Windows prefers 16, 32, 48, 256)
      const icoSizes = [16, 32, 48, 256];
      const buffers = await Promise.all(
        icoSizes.map(size =>
          sharp(svgPath)
            .resize(size, size, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer()
        )
      );

      // Generate ICO file with multiple resolutions
      const icoBuffer = await toIco(buffers);
      fs.writeFileSync(icoPath, icoBuffer);
      console.log('✓ Generated icon.ico (multi-resolution)');
    } catch (error) {
      console.error('✗ Failed to generate icon.ico:', error.message);
      // Fallback: copy 256px PNG
      try {
        fs.copyFileSync(path.join(buildDir, 'icon-256.png'), icoPath);
        console.log('  Fallback: Created icon.ico from 256px PNG');
      } catch (fallbackError) {
        console.error('  Fallback also failed:', fallbackError.message);
      }
    }
  } else {
    // Fallback: copy 256px PNG (electron-builder can convert it)
    try {
      fs.copyFileSync(path.join(buildDir, 'icon-256.png'), icoPath);
      console.log('✓ Created icon.ico (using 256px PNG - electron-builder will handle conversion)');
    } catch (error) {
      console.error('✗ Failed to create icon.ico:', error.message);
    }
  }

  console.log('\n✓ Icon generation complete!');
  console.log(`  All files are in: ${buildDir}`);
}

generateIcons().catch(console.error);

