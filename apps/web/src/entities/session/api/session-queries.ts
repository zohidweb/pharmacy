import type { EmployeeSession } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/shared/api';

export const sessionQueryKey = ['employee-session'] as const;

/** Current employee session; resolves to null when there is none (401). */
export async function fetchSession(): Promise<EmployeeSession | null> {
  try {
    return await apiRequest('sessions.current');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
