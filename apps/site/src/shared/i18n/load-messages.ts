import type { UiLocale } from '@pharmacy/shared-dto';
import type { Messages } from './config';

/**
 * The dictionary as a separate chunk, for client code that needs it rarely (global-error.tsx):
 * a static import would put both dictionaries into the bundle every page loads.
 */
export async function loadMessages(locale: UiLocale): Promise<Messages> {
  const dictionary =
    locale === 'tg'
      ? await import('./messages/tg.json')
      : await import('./messages/ru.json');
  return dictionary.default;
}
