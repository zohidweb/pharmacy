import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { charOfCode, useBarcodeScanner } from './use-barcode-scanner';

function Harness({ onScan }: { onScan: (code: string) => void }) {
  const [value, setValue] = useState('');
  useBarcodeScanner(onScan, { maxIntervalMs: 35, minLength: 6 });
  return (
    <input
      aria-label="Поиск"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

/** Keys of a code as the scanner sends them, `stepMs` apart; `key` is what a Russian layout gives. */
function type(target: Element, codes: string[], stepMs: number) {
  let at = 1_000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => at);
  for (const code of codes) {
    fireEvent.keyDown(target, { code, key: 'ж' });
    at += stepMs;
  }
  fireEvent.keyDown(target, { code: 'Enter', key: 'Enter' });
  clock.mockRestore();
}

const ean = '4870001000017'.split('').map((digit) => `Digit${digit}`);

describe('useBarcodeScanner', () => {
  it('reads a fast burst by physical keys, independent of the layout', () => {
    const onScan = jest.fn();
    render(<Harness onScan={onScan} />);
    type(document.body, ean, 5);
    expect(onScan).toHaveBeenCalledWith('4870001000017');
  });

  it('ignores slow typing by a person', () => {
    const onScan = jest.fn();
    render(<Harness onScan={onScan} />);
    type(document.body, ean, 120);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores short bursts', () => {
    const onScan = jest.fn();
    render(<Harness onScan={onScan} />);
    type(document.body, ['Digit1', 'Digit2', 'Digit3'], 5);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('takes a scan typed into the search field back out of it', () => {
    const onScan = jest.fn();
    render(<Harness onScan={onScan} />);
    const input = screen.getByLabelText('Поиск') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ибу' } });
    input.focus();
    type(input, ean, 5);
    expect(onScan).toHaveBeenCalledWith('4870001000017');
    expect(input.value).toBe('ибу');
  });

  it('maps physical keys to Latin characters', () => {
    expect(charOfCode('Numpad7', false)).toBe('7');
    expect(charOfCode('KeyQ', true)).toBe('Q');
    expect(charOfCode('KeyQ', false)).toBe('q');
    expect(charOfCode('Minus', false)).toBe('-');
    expect(charOfCode('ShiftLeft', false)).toBeNull();
  });
});
