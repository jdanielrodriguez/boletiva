import { MoneyPipe } from './money.pipe';

describe('MoneyPipe', () => {
  const pipe = new MoneyPipe();

  it('formatea un string con 2 decimales', () => {
    expect(pipe.transform('150')).toBe('Q150.00');
    expect(pipe.transform('19.8')).toBe('Q19.80');
    expect(pipe.transform('129.68')).toBe('Q129.68');
  });

  it('formatea un number', () => {
    expect(pipe.transform(150)).toBe('Q150.00');
    expect(pipe.transform(0)).toBe('Q0.00');
  });

  it('agrega separador de miles', () => {
    expect(pipe.transform('1234.56')).toBe('Q1,234.56');
  });

  it('valores nulos o no numéricos → Q0.00', () => {
    expect(pipe.transform(null)).toBe('Q0.00');
    expect(pipe.transform(undefined)).toBe('Q0.00');
    expect(pipe.transform('abc')).toBe('Q0.00');
  });
});
