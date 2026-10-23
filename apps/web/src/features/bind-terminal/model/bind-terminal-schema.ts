import { z } from 'zod';

/** Error messages are i18n keys under `bindTerminal.errors` (ADR-0015: no English texts in schemas). */
export type BindTerminalErrorKey = 'required' | 'tooLong';

export function isBindTerminalErrorKey(
  value: unknown,
): value is BindTerminalErrorKey {
  return value === 'required' || value === 'tooLong';
}

const error = (key: BindTerminalErrorKey) => ({ error: key });

// The API checks the same: BindTerminalDto, 1–60 characters after trimming.
export const bindTerminalSchema = z.object({
  storeId: z.string().min(1, error('required')),
  name: z.string().trim().min(1, error('required')).max(60, error('tooLong')),
});

export type BindTerminalValues = z.input<typeof bindTerminalSchema>;
export type BindTerminalPayload = z.output<typeof bindTerminalSchema>;
