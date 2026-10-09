import { FISHING_SPOTS, RELICS } from '../../../shared/activities.ts';
import { ZONES, type ZoneId } from '../../../shared/world.ts';
import type { FishRecord } from '../game/fishing.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ZONE_ORDER: ZoneId[] = ['town', 'medieval', 'arctic', 'space', 'jungle', 'cyberpunk', 'prehistoric', 'ancient', 'ocean'];

/** Makes an element with a class and text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

/**
 * The explorer's journal (J, or in the menu): every relic, found or with a riddle for where
 * it hides, and every fish, with the biggest you've caught.
 */
export class Journal {
  constructor(
    private found: Set<string>,
    private fish: Record<string, FishRecord>,
  ) {
    for (const tab of document.querySelectorAll<HTMLButtonElement>('.journal-tabs button')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab as 'relics' | 'fish'));
    }
    this.render();
  }

  showTab(tab: 'relics' | 'fish'): void {
    for (const t of document.querySelectorAll<HTMLButtonElement>('.journal-tabs button')) t.classList.toggle('active', t.dataset.tab === tab);
    $('journal-relics').hidden = tab !== 'relics';
    $('journal-fish').hidden = tab !== 'fish';
  }

  render(): void {
    const total = RELICS.length;
    const found = RELICS.filter((r) => this.found.has(r.id)).length;
    const species = FISHING_SPOTS.reduce((n, s) => n + s.fish.length, 0);
    const caught = Object.keys(this.fish).length;
    $('journal-summary').textContent = `Relics found: ${found} of ${total} · Kinds of fish caught: ${caught} of ${species}`;

    const relics = $('journal-relics');
    relics.replaceChildren(
      ...ZONE_ORDER.map((zone) => {
        const list = RELICS.filter((r) => r.zone === zone);
        const done = list.filter((r) => this.found.has(r.id)).length;
        const section = el('section', 'journal-zone');
        const head = el('h3', '', ZONES[zone].name);
        head.append(el('span', done === list.length ? 'count complete' : 'count', `${done}/${list.length}`));
        section.append(head);
        const ul = el('ul', '');
        for (const r of list) {
          const have = this.found.has(r.id);
          const li = el('li', have ? 'found' : 'missing');
          li.append(el('strong', '', have ? r.name : '???'), el('span', '', have ? '' : r.hint));
          ul.append(li);
        }
        section.append(ul);
        return section;
      }),
    );

    const fish = $('journal-fish');
    fish.replaceChildren(
      ...FISHING_SPOTS.map((spot) => {
        const section = el('section', 'journal-zone');
        section.append(el('h3', '', spot.name));
        const ul = el('ul', '');
        for (const f of spot.fish) {
          const rec = this.fish[f.name];
          const li = el('li', rec ? 'found' : 'missing');
          li.append(el('strong', '', rec ? f.name : '???'), el('em', `rarity ${f.rarity}`, f.rarity));
          if (rec) li.append(el('span', '', `×${rec.count} · best ${rec.best < 1 ? `${Math.round(rec.best * 1000)} g` : `${rec.best.toFixed(1)} kg`}`));
          ul.append(li);
        }
        section.append(ul);
        return section;
      }),
    );
  }
}
