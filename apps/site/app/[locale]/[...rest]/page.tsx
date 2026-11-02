import { notFound } from 'next/navigation';

/** Any address without its own route: the 404 of the language (W1). */
export default function UnknownRoute(): never {
  notFound();
}
