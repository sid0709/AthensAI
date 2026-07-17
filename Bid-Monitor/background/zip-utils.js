const ZipUtils = (() => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function stringToBytes(text) {
    return new TextEncoder().encode(text);
  }

  function createMockPdfBytes(folderName) {
    const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 50 100 Td (${folderName}) Tj ET
endstream endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000274 00000 n 
0000000370 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF`;
    return stringToBytes(pdf);
  }

  function writeUint32LE(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function writeUint16LE(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = stringToBytes(entry.name);
      const dataBytes = entry.data instanceof Uint8Array ? entry.data : stringToBytes(String(entry.data));
      const checksum = crc32(dataBytes);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      writeUint32LE(localView, 0, 0x04034b50);
      writeUint16LE(localView, 4, 20);
      writeUint16LE(localView, 6, 0);
      writeUint16LE(localView, 8, 0);
      writeUint16LE(localView, 10, 0);
      writeUint16LE(localView, 12, 0);
      writeUint32LE(localView, 14, checksum);
      writeUint32LE(localView, 18, dataBytes.length);
      writeUint32LE(localView, 22, dataBytes.length);
      writeUint16LE(localView, 26, nameBytes.length);
      writeUint16LE(localView, 28, 0);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      writeUint32LE(centralView, 0, 0x02014b50);
      writeUint16LE(centralView, 4, 20);
      writeUint16LE(centralView, 6, 20);
      writeUint16LE(centralView, 8, 0);
      writeUint16LE(centralView, 10, 0);
      writeUint16LE(centralView, 12, 0);
      writeUint16LE(centralView, 14, 0);
      writeUint32LE(centralView, 16, checksum);
      writeUint32LE(centralView, 20, dataBytes.length);
      writeUint32LE(centralView, 24, dataBytes.length);
      writeUint16LE(centralView, 28, nameBytes.length);
      writeUint16LE(centralView, 30, 0);
      writeUint16LE(centralView, 32, 0);
      writeUint16LE(centralView, 34, 0);
      writeUint16LE(centralView, 36, 0);
      writeUint32LE(centralView, 38, 0);
      writeUint32LE(centralView, 42, offset);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + dataBytes.length;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const part of centralParts) centralSize += part.length;

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32LE(endView, 0, 0x06054b50);
    writeUint16LE(endView, 4, 0);
    writeUint16LE(endView, 6, 0);
    writeUint16LE(endView, 8, entries.length);
    writeUint16LE(endView, 10, entries.length);
    writeUint32LE(endView, 12, centralSize);
    writeUint32LE(endView, 16, centralOffset);
    writeUint16LE(endView, 20, 0);

    const totalSize =
      localParts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
    const output = new Uint8Array(totalSize);
    let cursor = 0;

    for (const part of localParts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    for (const part of centralParts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    output.set(end, cursor);
    return output;
  }

  function bytesToDataUrl(bytes, mimeType) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }

  return {
    createZip,
    createMockPdfBytes,
    stringToBytes,
    bytesToDataUrl,
  };
})();
