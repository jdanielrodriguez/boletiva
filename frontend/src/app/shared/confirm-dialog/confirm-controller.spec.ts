import { ConfirmController } from './confirm-controller';

describe('ConfirmController', () => {
  it('ask abre el modal con la peticion', () => {
    const c = new ConfirmController();
    expect(c.request()).toBeNull();
    const onConfirm = jasmine.createSpy('onConfirm');
    c.ask({ title: 't', message: 'm', onConfirm });
    expect(c.request()?.title).toBe('t');
  });

  it('accept cierra el modal y ejecuta onConfirm', () => {
    const c = new ConfirmController();
    const onConfirm = jasmine.createSpy('onConfirm');
    c.ask({ title: 't', message: 'm', onConfirm });
    c.accept();
    expect(c.request()).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel cierra el modal y ejecuta onCancel si existe', () => {
    const c = new ConfirmController();
    const onConfirm = jasmine.createSpy('onConfirm');
    const onCancel = jasmine.createSpy('onCancel');
    c.ask({ title: 't', message: 'm', onConfirm, onCancel });
    c.cancel();
    expect(c.request()).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancel sin onCancel es no-op seguro', () => {
    const c = new ConfirmController();
    c.ask({ title: 't', message: 'm', onConfirm: () => undefined });
    expect(() => c.cancel()).not.toThrow();
    expect(c.request()).toBeNull();
  });

  it('close cierra sin ejecutar nada', () => {
    const c = new ConfirmController();
    const onConfirm = jasmine.createSpy('onConfirm');
    const onCancel = jasmine.createSpy('onCancel');
    c.ask({ title: 't', message: 'm', onConfirm, onCancel });
    c.close();
    expect(c.request()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('accept/cancel sin peticion abierta no lanzan', () => {
    const c = new ConfirmController();
    expect(() => c.accept()).not.toThrow();
    expect(() => c.cancel()).not.toThrow();
  });
});
