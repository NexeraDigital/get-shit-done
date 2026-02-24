// Generate minimal valid PNG files for PWA icons
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create a minimal 1x1 PNG file with specified color
// PNG file format structure for a 1x1 pixel
async function createMinimalPNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk (image header)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);  // width
  ihdr.writeUInt32BE(height, 4);  // height
  ihdr.writeUInt8(8, 8);          // bit depth
  ihdr.writeUInt8(2, 9);          // color type (RGB)
  ihdr.writeUInt8(0, 10);         // compression method
  ihdr.writeUInt8(0, 11);         // filter method
  ihdr.writeUInt8(0, 12);         // interlace method

  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk (image data)
  // For a simple solid color image, we need to create pixel data
  const bytesPerPixel = 3; // RGB
  const bytesPerRow = width * bytesPerPixel + 1; // +1 for filter byte
  const pixelData = Buffer.alloc(height * bytesPerRow);

  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    pixelData[rowStart] = 0; // filter type: None

    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * bytesPerPixel;
      pixelData[pixelStart] = r;
      pixelData[pixelStart + 1] = g;
      pixelData[pixelStart + 2] = b;
    }
  }

  // Compress the pixel data using zlib
  const zlib = await import('zlib');
  const compressed = zlib.deflateSync(pixelData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk (image trailer)
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  // Calculate CRC32
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calculateCRC32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function calculateCRC32(buffer) {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function generateIcons() {
  const publicDir = path.join(__dirname, 'public');

  // GSD brand color: gray-900 (#1f2937)
  const r = 0x1f;
  const g = 0x29;
  const h = 0x37;

  // Generate icon-192.png (192x192)
  console.log('Generating icon-192.png...');
  const icon192 = await createMinimalPNG(192, 192, r, g, h);
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), icon192);

  // Generate icon-512.png (512x512)
  console.log('Generating icon-512.png...');
  const icon512 = await createMinimalPNG(512, 512, r, g, h);
  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), icon512);

  // Generate badge-72.png (72x72)
  console.log('Generating badge-72.png...');
  const badge72 = await createMinimalPNG(72, 72, r, g, h);
  fs.writeFileSync(path.join(publicDir, 'badge-72.png'), badge72);

  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
