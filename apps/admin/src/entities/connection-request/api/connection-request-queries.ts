import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest, type ConnectionRequestListQuery } from '@/shared/api';

export const connectionRequestKeys = {
  all: ['connection-requests'] as const,
  list: (query: ConnectionRequestListQuery) =>
    ['connection-requests', 'list', query] as const,
  detail: (id: string) => ['connection-requests', 'detail', id] as const,
};

export function useConnectionRequestList(query: ConnectionRequestListQuery) {
  return useQuery({
    queryKey: connectionRequestKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest('connectionRequests.list', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useConnectionRequest(id: string) {
  return useQuery({
    queryKey: connectionRequestKeys.detail(id),
    queryFn: ({ signal }) =>
      apiRequest('connectionRequests.get', { params: { id }, signal }),
    enabled: id !== '',
  });
}
