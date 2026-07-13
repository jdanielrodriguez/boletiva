import { of } from 'rxjs';
import { type HasUnsavedChanges, unsavedChangesGuard } from './unsaved-changes.guard';

/** Invoca el guard fuera del contexto de router (es una función pura sobre el componente). */
function run(component: HasUnsavedChanges | Record<string, unknown>): unknown {
  return (unsavedChangesGuard as unknown as (c: unknown) => unknown)(component);
}

describe('unsavedChangesGuard', () => {
  it('deja navegar (true) si el componente no implementa hasUnsavedChanges', () => {
    expect(run({})).toBe(true);
  });

  it('deja navegar (true) si no hay cambios sin guardar', () => {
    const comp: HasUnsavedChanges = {
      hasUnsavedChanges: () => false,
      confirmDiscard: () => of(true),
    };
    expect(run(comp)).toBe(true);
  });

  it('delega en confirmDiscard() cuando hay cambios sin guardar', () => {
    const obs = of(false);
    const comp: HasUnsavedChanges = {
      hasUnsavedChanges: () => true,
      confirmDiscard: () => obs,
    };
    expect(run(comp)).toBe(obs);
  });
});
