import { songContent as skakalPes } from './skakal-pes.cho';
import { songContent as kockaLezeDirou } from './kocka-leze-dirou.cho';
import { songContent as holkaModrooka } from './holka-modrooka.cho';
import { songContent as kdeDomovMuj } from './kde-domov-muj.cho';
import { songContent as okoloTrebone } from './okolo-trebone.cho';
import { songContent as jaDoLesaNepojedu } from './ja-do-lesa-nepojedu.cho';
import { songContent as achSynkuSynku } from './ach-synku-synku.cho';
import { songContent as sedlakSedlak } from './sedlak-sedlak.cho';
import { songContent as toJeZlatePosiceni } from './to-je-zlate-posiceni.cho';
import { songContent as travaZelena } from './trava-zelena.cho';
import { songContent as naTyLouceZeleny } from './na-ty-louce-zeleny.cho';
import { songContent as podNasimOkynkem } from './pod-nasim-okynkem.cho';
import { songContent as pecNamSpadla } from './pec-nam-spadla.cho';
import { songContent as selZahradnikDoZahrady } from './sel-zahradnik-do-zahrady.cho';
import { songContent as travickaZelena } from './travicka-zelena.cho';
import { songContent as beskydebeskyde } from './beskyde-beskyde.cho';
import { songContent as cervenySatecku } from './cerveny-satecku.cho';
import { songContent as oRebickuZahradnicky } from './o-rebicku-zahradnicky.cho';
import { songContent as uzTyPilkyDorezaly } from './uz-ty-pilky-dorezaly.cho';
import { songContent as jaJsemZKutneHory } from './ja-jsem-z-kutne-hory.cho';

export const songFiles = [
  { id: 'skakal-pes', content: skakalPes },
  { id: 'kocka-leze-dirou', content: kockaLezeDirou },
  { id: 'holka-modrooka', content: holkaModrooka },
  { id: 'kde-domov-muj', content: kdeDomovMuj },
  { id: 'okolo-trebone', content: okoloTrebone },
  { id: 'ja-do-lesa-nepojedu', content: jaDoLesaNepojedu },
  { id: 'ach-synku-synku', content: achSynkuSynku },
  { id: 'sedlak-sedlak', content: sedlakSedlak },
  { id: 'to-je-zlate-posiceni', content: toJeZlatePosiceni },
  { id: 'trava-zelena', content: travaZelena },
  { id: 'na-ty-louce-zeleny', content: naTyLouceZeleny },
  { id: 'pod-nasim-okynkem', content: podNasimOkynkem },
  { id: 'pec-nam-spadla', content: pecNamSpadla },
  { id: 'sel-zahradnik-do-zahrady', content: selZahradnikDoZahrady },
  { id: 'travicka-zelena', content: travickaZelena },
  { id: 'beskyde-beskyde', content: beskydebeskyde },
  { id: 'cerveny-satecku', content: cervenySatecku },
  { id: 'o-rebicku-zahradnicky', content: oRebickuZahradnicky },
  { id: 'uz-ty-pilky-dorezaly', content: uzTyPilkyDorezaly },
  { id: 'ja-jsem-z-kutne-hory', content: jaJsemZKutneHory },
];

// Local-only synthetic fixtures from scripts/gen-songs.mjs. The directory is
// gitignored, so this glob resolves to nothing in a clean checkout.
const generated = import.meta.glob<{ songContent: string }>('./generated/*.cho.ts', { eager: true });

for (const [path, mod] of Object.entries(generated)) {
  const id = path.replace('./generated/', '').replace('.cho.ts', '');
  songFiles.push({ id, content: mod.songContent });
}

// Local-only imports from scripts/import-song.mjs. Also gitignored, so this
// resolves to nothing in a clean checkout.
const imported = import.meta.glob<{ songContent: string }>('../../imported-songs/*.cho.ts', {
  eager: true,
});

for (const [path, mod] of Object.entries(imported)) {
  const slug = path.replace('../../imported-songs/', '').replace('.cho.ts', '');
  // Namespaced so a local import can never shadow a curated song: ids are the
  // IndexedDB primary key and seeding uses put(), so a clash would silently
  // overwrite. Kept URL-safe (no slash) — ids go into /play/:id.
  songFiles.push({ id: `imported--${slug}`, content: mod.songContent });
}
