import type {
  MigrateStoreToCloudRequest,
  StoreDetails,
  UpdateStoreLicenseSettingsRequest,
  UpdateStoreRequest,
} from '@pharmacy/shared-dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { storeKeys } from '@/entities/store';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest } from '@/shared/api';

function useStoreMutation<Body>(
  id: string,
  request: (body: Body) => Promise<StoreDetails>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (store) => {
      queryClient.setQueryData(storeKeys.detail(id), store);
      void queryClient.invalidateQueries({
        queryKey: tenantKeys.detail(store.tenantId),
      });
    },
  });
}

export function useUpdateStore(id: string) {
  return useStoreMutation(id, (body: UpdateStoreRequest) =>
    apiRequest('stores.update', { params: { id }, body }),
  );
}

export function useUpdateLicenseSettings(id: string) {
  return useStoreMutation(id, (body: UpdateStoreLicenseSettingsRequest) =>
    apiRequest('stores.updateLicenseSettings', { params: { id }, body }),
  );
}

export function useMigrateToCloud(id: string) {
  return useStoreMutation(id, (body: MigrateStoreToCloudRequest) =>
    apiRequest('stores.migrateToCloud', {
      params: { id },
      body,
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}

export function useRequestSync(id: string) {
  return useMutation({
    mutationFn: () => apiRequest('stores.requestSync', { params: { id } }),
  });
}
