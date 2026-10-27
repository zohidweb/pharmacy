import type { UpdateTenantRequest } from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest } from '@/shared/api';

/** The name, city and INN of a network (spec 2026-10-26-pilot-small-gaps, P9). */
export function useUpdateTenant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTenantRequest) =>
      apiRequest('tenants.update', { params: { id }, body }),
    onSuccess: (tenant) => {
      queryClient.setQueryData(tenantKeys.detail(id), tenant);
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
    },
  });
}
