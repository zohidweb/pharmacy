import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ImpersonationHandoff } from '@pharmacy/shared-dto';
import { apiRequest } from '@/shared/api';

/**
 * Hands the one-time code to the client product by a top-level POST form (ADR-0008, «От имени»):
 * the code travels in the request body, never in a URL, and opens a read-only session there.
 */
export function submitHandoff(handoff: ImpersonationHandoff): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = handoff.handoffUrl;
  form.target = '_blank';
  const code = document.createElement('input');
  code.type = 'hidden';
  code.name = 'code';
  code.value = handoff.handoffCode;
  form.append(code);
  document.body.append(form);
  form.submit();
  form.remove();
}

export function useImpersonate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: { tenantId: string; reason: string }) =>
      apiRequest('operator.impersonations.create', {
        body: request,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (_handoff, request) => {
      void queryClient.invalidateQueries({
        queryKey: ['tenants', 'detail', request.tenantId],
      });
    },
  });
}
