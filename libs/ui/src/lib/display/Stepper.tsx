'use client';

/*
 * Stepper — progress of a multi-step form (e.g. company creation wizard).
 * Ordered list; the current step has aria-current="step"; completed steps carry a check icon
 * and localized state text, not only a color.
 */
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

export interface StepperStep {
  label: string;
}

export interface StepperProps {
  /** Localized name of the list, e.g. "Шаги создания компании". */
  label: string;
  steps: ReadonlyArray<StepperStep>;
  /** Zero-based index of the current step. */
  current: number;
  /** Localized hidden state text, e.g. "выполнен". */
  completedText: string;
  /** When provided, completed and current steps become buttons. */
  onStepSelect?: (index: number) => void;
  /** Layout only. */
  className?: string;
}

export function Stepper({
  label,
  steps,
  current,
  completedText,
  onStepSelect,
  className,
}: StepperProps) {
  return (
    <ol
      aria-label={label}
      className={cx('m-0 flex list-none flex-wrap gap-4 p-0', className)}
    >
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const content = (
          <>
            <span
              className={cx(
                'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                done && 'bg-success-subtle text-success',
                active && 'bg-primary text-on-primary',
                !done && !active && 'bg-surface-sunken text-fg-subtle',
              )}
            >
              {done ? <Icon name="check" size="sm" /> : index + 1}
            </span>
            <span
              className={cx(
                'text-sm',
                active ? 'font-medium text-fg' : 'text-fg-muted',
              )}
            >
              {step.label}
              {done && (
                <span className="ph-visually-hidden">, {completedText}</span>
              )}
            </span>
          </>
        );
        return (
          <li key={step.label} aria-current={active ? 'step' : undefined}>
            {onStepSelect && index <= current ? (
              <button
                type="button"
                onClick={() => onStepSelect(index)}
                className="flex min-h-(--ph-button-height) items-center gap-2 rounded-full bg-transparent pe-2"
              >
                {content}
              </button>
            ) : (
              <span className="flex min-h-(--ph-button-height) items-center gap-2">
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
