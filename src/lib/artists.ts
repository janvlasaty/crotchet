/** Artist naming and alphabetical indexing, shared by the home and artist screens. */

export const UNKNOWN_ARTIST = 'Neznámý interpret';

/** First letter for the alphabet strip; diacritics folded, non-letters bucketed under #. */
export function indexLetter(name: string): string {
  const first = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}
