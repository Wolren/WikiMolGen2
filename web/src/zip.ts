/**
 * A minimal ZIP writer for a batch of PNGs.
 *
 * The entries are stored, not deflated: PNGs are compressed already, and store-only
 * keeps the writer small and dependency free. The archive has the usual three parts:
 * local headers, a central directory, and the end record.
 */

/** CRC-32 table for the polynomial 0xEDB88320, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date and time, as the ZIP format stores them. */
function dosDateTime(date: Date): { time: number; day: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** One stored entry, kept until `finish` builds the archive. */
interface Entry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
  time: number;
  day: number;
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly parts: Uint8Array[] = [];
  private offset = 0;

  private push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.offset += bytes.length;
  }

  /** Add one file. The name must be unique inside the archive. */
  add(name: string, data: Uint8Array): void {
    const encoded = utf8(name);
    const stamp = dosDateTime(new Date());
    const entry: Entry = {
      name: encoded,
      data,
      crc: crc32(data),
      offset: this.offset,
      time: stamp.time,
      day: stamp.day,
    };
    this.entries.push(entry);
    this.push(this.localHeader(entry));
    this.push(data);
  }

  /** The local file header and its two fixed records. */
  private localHeader(entry: Entry): Uint8Array {
    const header = new Uint8Array(30 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    // Bit 11 marks a UTF-8 name; store-only is method 0.
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, entry.time, true);
    view.setUint16(12, entry.day, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.name.length, true);
    view.setUint16(28, 0, true);
    header.set(entry.name, 30);
    return header;
  }

  /** The central directory record for one entry. */
  private centralHeader(entry: Entry): Uint8Array {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, entry.time, true);
    view.setUint16(14, entry.day, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.name, 46);
    return header;
  }

  /** Close the archive: central directory plus the end record. */
  finish(): Uint8Array {
    const central: Uint8Array[] = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const record = this.centralHeader(entry);
      central.push(record);
      centralSize += record.length;
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, this.offset, true);
    central.push(end);

    const total = this.parts.reduce((sum, part) => sum + part.length, 0) + centralSize + 22;
    const archive = new Uint8Array(total);
    let at = 0;
    for (const part of [...this.parts, ...central]) {
      archive.set(part, at);
      at += part.length;
    }
    return archive;
  }

  /** How many files the archive holds. */
  get size(): number {
    return this.entries.length;
  }
}
