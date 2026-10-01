import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Alert } from './Alert';
import { Avatar, initialsOf } from './Avatar';
import { Card, CardHeader } from './Card';
import { Chip, ChipGroup } from './Chip';
import { CountBadge } from './CountBadge';
import { EmptyState } from './EmptyState';
import { KpiTile } from './KpiTile';
import { StatusPill } from './StatusPill';
import { Stepper } from './Stepper';

describe('StatusPill', () => {
  it('always shows text and, for status tones, an icon', () => {
    const { container } = render(
      <StatusPill tone="warning">Ключ истекает</StatusPill>,
    );

    expect(screen.getByText('Ключ истекает')).toBeTruthy();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('allows a neutral pill without an icon', () => {
    const { container } = render(
      <StatusPill tone="neutral">Офлайн</StatusPill>,
    );

    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('CountBadge', () => {
  it('renders nothing for zero and a hidden label when given', () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container.firstChild).toBeNull();

    rerender(<CountBadge count={2} label="2 запроса" />);
    expect(screen.getByText('2 запроса').className).toContain(
      'ph-visually-hidden',
    );
  });
});

describe('Chip', () => {
  it('is a toggle button with aria-pressed and a count', () => {
    const onClick = jest.fn();
    render(
      <ChipGroup label="Статус счёта">
        <Chip selected count={6} onClick={onClick}>
          Все
        </Chip>
        <Chip selected={false} count={1}>
          Просрочены
        </Chip>
      </ChipGroup>,
    );
    const all = screen.getByRole('button', { name: /Все/ });

    expect(screen.getByRole('group', { name: 'Статус счёта' })).toBeTruthy();
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(all.textContent).toContain('6');
    fireEvent.click(all);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Avatar', () => {
  it('derives up to two initials', () => {
    expect(initialsOf('Шифо Фарм')).toBe('ШФ');
    expect(initialsOf('  тест  пользователь один ')).toBe('ТП');
  });

  it('is decorative unless labelled', () => {
    const { container, rerender } = render(<Avatar name="Тест Оператор" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    rerender(<Avatar name="Тест Оператор" label="Тест Оператор" />);
    expect(screen.getByRole('img', { name: 'Тест Оператор' })).toBeTruthy();
  });
});

describe('Alert', () => {
  it('announces assertive alerts via role=alert', () => {
    render(
      <Alert tone="danger" live="assertive">
        Неверная почта или пароль
      </Alert>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Неверная почта');
  });

  it('is static content by default', () => {
    render(<Alert tone="attention">Ответственность за локальные данные</Alert>);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Stepper', () => {
  it('marks the current step and states completed steps in text', () => {
    const onStepSelect = jest.fn();
    render(
      <Stepper
        label="Шаги"
        steps={[
          { label: 'Компания' },
          { label: 'Первая точка' },
          { label: 'Биллинг' },
        ]}
        current={1}
        completedText="выполнен"
        onStepSelect={onStepSelect}
      />,
    );
    const items = screen.getAllByRole('listitem');

    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[0].textContent).toContain('выполнен');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Компания/ }));
    expect(onStepSelect).toHaveBeenCalledWith(0);
  });
});

describe('display components', () => {
  it('have no axe violations together', async () => {
    const { container } = render(
      <main>
        <Card as="section" aria-labelledby="card-title">
          <CardHeader
            title="Счета"
            titleId="card-title"
            description="За сентябрь"
          />
          <KpiTile
            label="Оплачено"
            value="2 000,00 с"
            hint="2 счёта из 3"
            tone="success"
            icon="receipt"
          />
          <StatusPill tone="success">Активна</StatusPill>
          <CountBadge count={4} label="4 новых" />
          <EmptyState title="Ничего не найдено" description="Измените фильтр" />
          <Alert tone="info" title="Подсказка">
            Текст
          </Alert>
          <Avatar name="Тест Оператор" />
        </Card>
      </main>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
