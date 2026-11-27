/**
 * Raw SMF (Standard MIDI File) meta-event insertion.
 *
 * Exists because @tonejs/midi 2.0.28 has an upstream encoder bug: its
 * encodeKeySignature writes `key: keyIndex + 7` where the MIDI spec wants
 * the signed sharps count (keyIndex - 7), producing invalid files (e.g.
 * F# is written as "20 sharps", which strict parsers reject). Until that
 * is fixed upstream, we encode MIDI with @tonejs/midi as usual and splice
 * a correct key_signature meta event into the first track ourselves.
 */

/**
 * Returns a copy of `bytes` with a key_signature meta event
 * (FF 59 02 sf mi) inserted at tick 0 of the first track.
 *
 * @param sharps Signed sharps count: positive = sharps, negative = flats.
 * @param mode   'major' (mi = 0) or 'minor' (mi = 1).
 */
export function insertKeySignatureMetaEvent(
  bytes: Uint8Array,
  sharps: number,
  mode: 'major' | 'minor'
): Uint8Array {
  if (sharps < -7 || sharps > 7) {
    throw new Error(`insertKeySignatureMetaEvent: sharps ${sharps} out of range -7..7`);
  }
  // Header chunk: "MThd" + length(4) + format(2) + ntrks(2) + division(2).
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') {
    throw new Error('insertKeySignatureMetaEvent: not a Standard MIDI File');
  }
  const headerLength = readUint32(bytes, 4);
  const trackStart = 8 + headerLength;
  if (
    bytes.length < trackStart + 8 ||
    String.fromCharCode(...bytes.slice(trackStart, trackStart + 4)) !== 'MTrk'
  ) {
    throw new Error('insertKeySignatureMetaEvent: first track chunk not found');
  }
  const trackLength = readUint32(bytes, trackStart + 4);
  const dataStart = trackStart + 8;

  // Meta event: delta-time 0, FF 59, length 02, sharps (signed byte), mode.
  const event = new Uint8Array([0x00, 0xff, 0x59, 0x02, sharps & 0xff, mode === 'minor' ? 1 : 0]);

  const out = new Uint8Array(bytes.length + event.length);
  out.set(bytes.slice(0, dataStart), 0);
  out.set(event, dataStart);
  out.set(bytes.slice(dataStart), dataStart + event.length);
  writeUint32(out, trackStart + 4, trackLength + event.length);
  return out;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
