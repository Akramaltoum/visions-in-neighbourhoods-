'use strict';

// The web app re-encodes every photo to JPEG in the browser (which also drops
// EXIF/GPS data). The server still checks the bytes and strips metadata itself,
// because a modified client could skip that step.

function isJpeg(buf) {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// Removes APP1-APP15 segments (EXIF, XMP, GPS, ICC) and comments from a JPEG.
// Throws if the file is not a well-formed JPEG.
function stripJpegMetadata(buf) {
  if (!isJpeg(buf)) throw new Error('Not a JPEG');
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('Corrupt JPEG');
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new Error('Corrupt JPEG');
    if (marker === 0xda) { // start of scan: the rest is image data
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('Corrupt JPEG');
}

module.exports = { isJpeg, stripJpegMetadata };
