import type {
  EventKind,
  EventTarget,
  NotificationTopic,
} from '@pharmacy/shared-dto';

// Topics and kinds of the operator notifications (spec 2026-10-19-operator-notifications, N3–N5, N10).

export const NOTIFICATION_TOPICS: readonly NotificationTopic[] = Object.freeze([
  'billing',
  'keys',
  'services',
  'sync',
  'leads',
]);

export const TOPIC_KINDS: Readonly<
  Record<NotificationTopic, readonly EventKind[]>
> = Object.freeze({
  billing: ['invoice_overdue', 'payment_recorded'],
  keys: ['key_expiring', 'key_revoked'],
  services: ['service_requested'],
  sync: ['sync_stale', 'update_available'],
  // the producer of `connection_requested` comes with the connection requests (ADR-0023)
  leads: [],
});

/** Shown while they last; resolved when gone (N3). */
export const STATE_KINDS: readonly EventKind[] = Object.freeze([
  'invoice_overdue',
  'key_expiring',
  'sync_stale',
  'service_requested',
]);

/** Never resolved; shown 30 days (N4). */
export const EVENT_KINDS: readonly EventKind[] = Object.freeze([
  'payment_recorded',
  'key_revoked',
  'update_available',
]);

export function topicOf(kind: EventKind): NotificationTopic {
  const topic = NOTIFICATION_TOPICS.find((t) => TOPIC_KINDS[t].includes(kind));
  if (!topic) throw new Error(`No topic for the kind ${kind}`);
  return topic;
}

/** The kinds of the topics given. */
export function kindsOf(topics: readonly NotificationTopic[]): EventKind[] {
  return topics.flatMap((topic) => [...TOPIC_KINDS[topic]]);
}

/** Where a notification leads (N10): the network, or «Услуги» for a request. */
export function targetOf(
  kind: EventKind,
  tenantId: string | null,
): EventTarget {
  if (kind === 'service_requested' || tenantId === null) {
    return { screen: 'services' };
  }
  return { screen: 'tenant', id: tenantId };
}
