/*
 * REST contract of the platform-operator login (ADR-0008: login + password, server session in
 * Redis, `__Host-op_sid` cookie on the admin origin). Shapes only: apps/api implements them as
 * class-validator DTO classes; frontends import these types with `import type` (ADR-0015).
 */

/** POST /api/v1/operator/sessions */
export interface OperatorLoginRequest {
  /** Work e-mail used as the operator login. */
  login: string;
  password: string;
}

export type OperatorRole = 'full_access';

export interface OperatorProfile {
  id: string;
  fullName: string;
  login: string;
  role: OperatorRole;
}

/** 201 from POST /operator/sessions and 200 from GET /operator/sessions/current */
export interface OperatorSession {
  operator: OperatorProfile;
  /** ISO instant of the password authentication (step-up age, ADR-0008). */
  authenticatedAt: string;
}

/** POST /api/v1/operator/impersonations (ADR-0008, «От имени»): needs a fresh step-up. */
export interface ImpersonationRequest {
  tenantId: string;
  /** Stated in the tenant's audit log. */
  reason: string;
}

export interface ImpersonationHandoff {
  impersonationId: string;
  /** One-time code (TTL ≤ 60 s) posted in a form body to `handoffUrl`, never in a URL. */
  handoffCode: string;
  /** Endpoint on the client-product origin that exchanges the code for a read-only session. */
  handoffUrl: string;
}
