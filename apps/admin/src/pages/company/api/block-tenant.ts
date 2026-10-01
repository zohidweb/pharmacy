import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest } from '@/shared/api';

export function useBlockTenant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiRequest('tenants.block', { params: { id }, body: { reason } }),
    onSuccess: (tenant) => {
      queryClient.setQueryData(tenantKeys.detail(id), tenant);
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
    },
  });
}

export function useUnblockTenant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('tenants.unblock', { params: { id } }),
    onSuccess: (tenant) => {
      queryClient.setQueryData(tenantKeys.detail(id), tenant);
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
    },
  });
}
