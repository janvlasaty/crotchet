/** Palette offered for the chord line — dark-background safe, all AA on #000. */

export interface ChordColorOption {
  name: string;
  value: string;
}

export const CHORD_COLORS: ChordColorOption[] = [
  { name: 'Oranžová', value: '#ff9800' },
  { name: 'Modrá', value: '#4fc3f7' },
  { name: 'Zelená', value: '#7ed491' },
  { name: 'Žlutá', value: '#ffd54f' },
  { name: 'Růžová', value: '#f48fb1' },
  { name: 'Fialová', value: '#c4a7ff' },
  { name: 'Bílá', value: '#ffffff' },
];

export const DEFAULT_CHORD_COLOR = CHORD_COLORS[0].value;
