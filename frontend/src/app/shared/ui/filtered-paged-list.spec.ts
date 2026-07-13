import { FilteredPagedList, type StatefulEntity } from './filtered-paged-list';

interface Item extends StatefulEntity {
  name: string;
}

function make(): FilteredPagedList<Item> {
  return new FilteredPagedList<Item>(2, (it, q) => it.name.toLowerCase().includes(q));
}

const items: Item[] = [
  { name: 'Alpha', status: 'published' },
  { name: 'Beta', status: 'draft' },
  { name: 'Gamma', status: 'published', hidden: true },
  { name: 'Delta', status: 'published', disabled: true },
  { name: 'Epsilon', status: 'draft' },
];

describe('FilteredPagedList', () => {
  it('pagina segun el tamano de pagina', () => {
    const list = make();
    list.items.set(items);
    expect(list.totalPages()).toBe(3);
    expect(list.pageItems().length).toBe(2);
    expect(list.pageItems()[0].name).toBe('Alpha');
  });

  it('goToPage acota el rango [1, totalPages]', () => {
    const list = make();
    list.items.set(items);
    list.goToPage(99);
    expect(list.page()).toBe(3);
    list.goToPage(-5);
    expect(list.page()).toBe(1);
  });

  it('displayState prioriza disabled > hidden > status', () => {
    const list = make();
    expect(list.displayState({ name: 'x', status: 'published', disabled: true, hidden: true })).toBe('disabled');
    expect(list.displayState({ name: 'x', status: 'published', hidden: true })).toBe('hidden');
    expect(list.displayState({ name: 'x', status: 'draft' })).toBe('draft');
  });

  it('filtra por estado de display', () => {
    const list = make();
    list.items.set(items);
    list.setStatus('draft');
    expect(list.filtered().map((i) => i.name)).toEqual(['Beta', 'Epsilon']);
    list.setStatus('hidden');
    expect(list.filtered().map((i) => i.name)).toEqual(['Gamma']);
    list.setStatus('disabled');
    expect(list.filtered().map((i) => i.name)).toEqual(['Delta']);
  });

  it('busca por texto via matcher (case-insensitive) y marca hasFilter', () => {
    const list = make();
    list.items.set(items);
    expect(list.hasFilter()).toBe(false);
    list.setSearch('ta');
    expect(list.filtered().map((i) => i.name)).toEqual(['Beta', 'Delta']);
    expect(list.hasFilter()).toBe(true);
  });

  it('setSearch/setStatus resetean a la pagina 1', () => {
    const list = make();
    list.items.set(items);
    list.goToPage(3);
    expect(list.page()).toBe(3);
    list.setSearch('a');
    expect(list.page()).toBe(1);
    list.goToPage(2);
    list.setStatus('published');
    expect(list.page()).toBe(1);
  });
});
