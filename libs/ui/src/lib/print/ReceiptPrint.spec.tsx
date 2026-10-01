import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { printReceipt, ReceiptPreview, ReceiptPrint } from './ReceiptPrint';

const lines = ['   Шифо', 'ИТОГО      29,20', ''];

describe('ReceiptPreview', () => {
  it('shows the same fixed-width lines as the printout', () => {
    render(
      <ReceiptPreview
        lines={lines}
        paperWidth="58"
        label="Предпросмотр чека"
      />,
    );
    const paper = screen.getByRole('figure', { name: 'Предпросмотр чека' });
    expect(paper.getAttribute('data-receipt-width')).toBe('58');
    expect(paper.querySelector('pre')?.textContent).toBe(lines.join('\n'));
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ReceiptPreview
        lines={lines}
        paperWidth="80"
        label="Предпросмотр чека"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ReceiptPrint', () => {
  it('renders a print root outside the app with one element per line', () => {
    render(<ReceiptPrint lines={lines} paperWidth="80" />);
    const root = document.body.querySelector(':scope > .ph-print-root');
    expect(root?.getAttribute('data-receipt-width')).toBe('80');
    expect(root?.querySelectorAll('.ph-print-line')).toHaveLength(3);
  });

  it('prints after the fonts are ready', async () => {
    const print = jest
      .spyOn(window, 'print')
      .mockImplementation(() => undefined);
    await printReceipt();
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
