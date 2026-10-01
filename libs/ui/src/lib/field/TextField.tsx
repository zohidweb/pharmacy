import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../cx';
import { Field, controlClassName, type FieldProps } from './Field';

type FieldOwnProps = Omit<FieldProps, 'children'>;

export interface TextFieldProps
  extends
    FieldOwnProps,
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'className' | 'id' | 'required' | 'size'
    > {
  /** Element inside the field at the end (e.g. show-password IconButton). */
  endAdornment?: ReactNode;
  /** Monospace value (keys, codes). */
  mono?: boolean;
  /** The input element, e.g. to return focus after an on-screen keypad. */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  required,
  requiredText,
  hideLabel,
  className,
  endAdornment,
  mono = false,
  type = 'text',
  ...inputProps
}: TextFieldProps) {
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
          <input
            type={type}
            required={required}
            className={cx(
              controlClassName,
              'h-(--ph-input-height)',
              mono && 'font-mono',
              Boolean(endAdornment) && 'pe-12',
            )}
            {...control}
            {...inputProps}
          />
          {endAdornment && (
            <div className="absolute end-1 flex items-center">
              {endAdornment}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export interface TextareaFieldProps
  extends
    FieldOwnProps,
    Omit<
      TextareaHTMLAttributes<HTMLTextAreaElement>,
      'className' | 'id' | 'required'
    > {}

export function TextareaField({
  label,
  hint,
  error,
  required,
  requiredText,
  hideLabel,
  className,
  rows = 3,
  ...textareaProps
}: TextareaFieldProps) {
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
        <textarea
          rows={rows}
          required={required}
          className={cx(controlClassName, 'resize-y py-3')}
          {...control}
          {...textareaProps}
        />
      )}
    </Field>
  );
}
