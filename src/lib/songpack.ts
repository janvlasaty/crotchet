/**
 * Song packs — a whole library in one file, built by
 * `scripts/build-songpack.mjs` and imported from the home screen menu.
 *
 * Shape: { format: 'crotchet-songpack', version: 1, count, songs: [{ id, chordpro }] }
 * A bare array of the same entries is accepted too, so a hand-made JSON works.
 */

export interface PackEntry {
  id: string;
  chordpro: string;
}

const FORMAT = 'crotchet-songpack';
const SUPPORTED_VERSION = 1;

/** Read a picked file into text, transparently gunzipping a `.gz` pack. */
async function readPackText(file: File): Promise<string> {
  const gzipped =
    file.name.endsWith('.gz') ||
    file.type === 'application/gzip' ||
    file.type === 'application/x-gzip';

  if (!gzipped) return file.text();

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Tento prohlížeč neumí rozbalit .gz — použij nezabalený .json.');
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Parse and validate a picked pack file. Throws with a user-facing message. */
export async function readSongPack(file: File): Promise<PackEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readPackText(file));
  } catch {
    throw new Error('Soubor není platný JSON.');
  }

  const raw = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown> | null)?.songs;

  if (!Array.isArray(raw)) {
    throw new Error('Soubor neobsahuje seznam písní.');
  }
  if (!Array.isArray(parsed)) {
    const meta = parsed as Record<string, unknown>;
    if (meta.format !== undefined && meta.format !== FORMAT) {
      throw new Error('Neznámý formát balíčku.');
    }
    if (typeof meta.version === 'number' && meta.version > SUPPORTED_VERSION) {
      throw new Error('Balíček je z novější verze aplikace.');
    }
  }

  const songs: PackEntry[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, chordpro } = entry as Partial<PackEntry>;
    // Later duplicates would just overwrite the earlier row; drop them here so
    // the reported count matches what actually lands in the library.
    if (typeof id !== 'string' || !id || typeof chordpro !== 'string' || seen.has(id)) continue;
    seen.add(id);
    songs.push({ id, chordpro });
  }

  if (!songs.length) throw new Error('V balíčku nejsou žádné použitelné písně.');
  return songs;
}
