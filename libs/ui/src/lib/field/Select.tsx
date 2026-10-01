/*
 * Select — native <select> (ADR-0007): keyboard, typeahead and the listbox come from the browser.
 * Chrome/Edge 135+ render the customizable picker (appearance: base-select, styles/controls.css);
 * older engines fall back to the regular native picker with the same behavior.
 */
import type { SelectHTMLAttributes } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import { Field, controlClassName, type FieldProps } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends
    Omit<FieldProps, 'children'>,
    Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      'className' | 'id' | 'required' | 'children' | 'multiple'
    > {
  options: ReadonlyArray<SelectOption>;
  /** First, non-selectable option shown while nothing is chosen. */
  placeholder?: string;
}

export function Select({
  label,
  hint,
  error,
  required,
  requiredText,
  hideLabel,
  className,
  options,
  placeholder,
  ...selectProps
}: SelectProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredText={requiredText}
      hideLabel={hideLabel}
      className={className}
    >
      {(control) => (
        <div className="relative flex items-center">
          <select
            required={required}
            className={cx(
              controlClassName,
              'ph-select h-(--ph-input-height) cursor-pointer pe-10',
            )}
            {...control}
            {...selectProps}
          >
            {placeholder !== undefined && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute end-3 text-fg-muted">
            <Icon name="chevron-down" size="sm" />
          </span>
        </div>
      )}
    </Field>
  );
}
