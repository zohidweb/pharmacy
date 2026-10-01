import { Icon, type IconSize } from '../icon/Icon';

export interface SpinnerProps {
  size?: IconSize;
  /** Accessible name when the spinner is the only indication of progress. */
  label?: string;
}

/** Busy indicator; decorative by default (the owner sets aria-busy / live text). */
export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <span className="inline-flex animate-spin motion-reduce:animate-none">
      <Icon name="loader-circle" size={size} label={label} />
    </span>
  );
}
