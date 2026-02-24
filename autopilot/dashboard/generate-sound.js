// Generate a minimal valid MP3 file (silent audio)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal valid MP3 file structure:
// This creates a valid MP3 with a single silent frame
// MP3 frame: 11 bits of frame sync (all 1s), followed by audio data
function createMinimalMP3() {
  // MP3 frame header for MPEG-1 Layer III, 128kbps, 44.1kHz, mono
  // Frame sync (11 bits): 0xFF 0xFB
  // MPEG version (2 bits): 11 (MPEG-1)
  // Layer (2 bits): 01 (Layer III)
  // Protection bit (1 bit): 1 (no CRC)
  // Bitrate (4 bits): 1001 (128kbps)
  // Sample rate (2 bits): 00 (44.1kHz)
  // Padding bit (1 bit): 0
  // Private bit (1 bit): 0
  // Channel mode (2 bits): 11 (mono)
  // Mode extension (2 bits): 00
  // Copyright (1 bit): 0
  // Original (1 bit): 0
  // Emphasis (2 bits): 00

  // Create a minimal MP3 with ID3v2 tag (for maximum compatibility) and a few silent frames
  const id3Header = Buffer.from([
    0x49, 0x44, 0x33, // ID3 identifier
    0x03, 0x00,       // ID3 version 2.3.0
    0x00,             // Flags
    0x00, 0x00, 0x00, 0x00 // Size (0 - minimal)
  ]);

  // Create a few silent MP3 frames (417 bytes each for 128kbps MPEG-1 Layer III)
  // This is a pre-computed silent frame
  const silentFrame = Buffer.alloc(417, 0);
  // Set frame sync and header
  silentFrame[0] = 0xFF;
  silentFrame[1] = 0xFB;
  silentFrame[2] = 0x90; // 128kbps, 44.1kHz
  silentFrame[3] = 0x00; // Mono, no padding

  // Create 5 silent frames for ~0.1 seconds of silence
  const frames = Buffer.concat([
    silentFrame,
    silentFrame,
    silentFrame,
    silentFrame,
    silentFrame,
  ]);

  return Buffer.concat([id3Header, frames]);
}

const publicDir = path.join(__dirname, 'public');
const mp3Data = createMinimalMP3();

console.log('Generating notification-sound.mp3...');
fs.writeFileSync(path.join(publicDir, 'notification-sound.mp3'), mp3Data);
console.log('Notification sound generated successfully!');
