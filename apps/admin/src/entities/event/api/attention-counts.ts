import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

export const attentionKeys = {
  counts: ['attention-counts'] as const,
  notifications: ['notifications'] as const,
};

/** Sidebar counters; refreshed every minute while the admin is open. */
export function useAttentionCounts() {
  return useQuery({
    queryKey: attentionKeys.counts,
    queryFn: ({ signal }) => apiRequest('attention.counts', { signal }),
    refetchInterval: 60_000,
  });
}
