import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

export const storeKeys = {
  detail: (id: string) => ['stores', 'detail', id] as const,
};

export function useStore(id: string) {
  return useQuery({
    queryKey: storeKeys.detail(id),
    queryFn: ({ signal }) =>
      apiRequest('stores.get', { params: { id }, signal }),
    enabled: id !== '',
  });
}
