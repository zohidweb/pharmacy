'use client';

/*
 * use-intl's provider as a client boundary: a server layout passes it only the message groups its
 * client components need (error and 404 screens), never the whole dictionaries.
 */
export { IntlProvider as IntlClientProvider } from 'use-intl';
