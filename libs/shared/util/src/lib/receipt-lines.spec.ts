import {
  receiptCenter,
  receiptRow,
  receiptRule,
  receiptWrap,
} from './receipt-lines';

describe('receipt lines', () => {
  it('pads a row to the paper width', () => {
    expect(receiptRow('ИТОГО', '29,20', 20)).toEqual(['ИТОГО          29,20']);
    expect(receiptRow('ИТОГО', '29,20', 20)[0]).toHaveLength(20);
  });

  it('wraps a long name and puts the value on its own line', () => {
    expect(receiptRow('Амоксициллин 500 мг, капс. №16', '14,00', 16)).toEqual([
      'Амоксициллин 500',
      'мг, капс. №16',
      '           14,00',
    ]);
  });

  it('counts a Tajik letter as one column after NFC', () => {
    const decomposed = 'Ҳ'.normalize('NFD') + 'исоб';
    expect(receiptRow(decomposed, '1', 8)[0]).toHaveLength(8);
  });

  it('splits words longer than the line', () => {
    expect(receiptWrap('ПМ-0000000045', 5)).toEqual(['ПМ-00', '00000', '045']);
  });

  it('centers and draws rules', () => {
    expect(receiptCenter('Шифо', 10)).toEqual(['   Шифо']);
    expect(receiptRule(4, '=')).toBe('====');
  });
});
