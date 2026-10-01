import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';
import { icons } from './icons';

describe('Icon', () => {
  it('is hidden from assistive technology when decorative', () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('role')).toBe(false);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('exposes an accessible name when labelled', () => {
    render(<Icon name="triangle-alert" label="Warning" />);

    expect(screen.getByRole('img', { name: 'Warning' })).toBeTruthy();
  });

  it('renders the Lucide geometry of the requested icon', () => {
    const { container } = render(<Icon name="key-round" />);

    expect(container.querySelectorAll('svg > *')).toHaveLength(
      icons['key-round'].length,
    );
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe(
      'currentColor',
    );
  });

  it('maps sizes to icon tokens and keeps layout classes', () => {
    const { container } = render(<Icon name="x" size="sm" className="ms-2" />);
    const classes = container.querySelector('svg')?.classList;

    expect(classes?.contains('size-icon-sm')).toBe(true);
    expect(classes?.contains('ms-2')).toBe(true);
  });

  it('defines geometry for every icon', () => {
    for (const nodes of Object.values(icons)) {
      expect(nodes.length).toBeGreaterThan(0);
    }
  });
});
