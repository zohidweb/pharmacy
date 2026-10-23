'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { BoundTerminal, EmployeeSession } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Dialog,
  Select,
  TextField,
  type ButtonVariant,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { useBoundTerminal } from '@/entities/terminal';
import { apiRequest, useApiErrorMessage, withFreshAuth } from '@/shared/api';
import {
  bindTerminalSchema,
  isBindTerminalErrorKey,
  type BindTerminalPayload,
  type BindTerminalValues,
} from '../model/bind-terminal-schema';

/** Stores this browser can become a till of: cloud stores of the scope (offline ones bind on the store). */
function bindableStores(session: EmployeeSession | null | undefined) {
  return (session?.stores ?? []).filter((store) => store.mode !== 'offline');
}

/**
 * Whether the employee may bind this browser here: `terminals:create`, a password session (the
 * binding asks for a fresh password, a PIN session cannot confirm one) and a store to bind to.
 */
export function canBindTerminal(
  session: EmployeeSession | null | undefined,
): boolean {
  return (
    canWrite(session, 'terminals:create') &&
    session?.auth === 'password' &&
    bindableStores(session).length > 0
  );
}

/**
 * «Привязать этот компьютер как кассу» (auth design 2026-10-02, section 8): POST /terminals with the
 * store and the till's name, under a fresh password; the answer sets the device-cookie, so this
 * browser becomes the till and its sign-in screen offers the PIN of the store's cashiers.
 */
export function BindTerminalButton({
  variant = 'secondary',
  unboundOnly = false,
}: {
  variant?: ButtonVariant;
  /** Only while this browser is not a till (the POS screens: a bound one signs in by PIN). */
  unboundOnly?: boolean;
}) {
  const t = useTranslations('bindTerminal');
  const { data: session } = useSession();
  const terminal = useBoundTerminal({ enabled: unboundOnly });
  const [open, setOpen] = useState(false);
  if (!canBindTerminal(session)) return null;
  if (unboundOnly && terminal.data !== null) return null;
  return (
    <>
      <Button
        variant={variant}
        iconStart="monitor"
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      {open && session && (
        <BindTerminalDialog session={session} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function BindTerminalDialog({
  session,
  onClose,
}: {
  session: EmployeeSession;
  onClose: () => void;
}) {
  const t = useTranslations('bindTerminal');
  const queryClient = useQueryClient();
  const current = useBoundTerminal();
  const stores = bindableStores(session);
  const [bound, setBound] = useState<BoundTerminal | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BindTerminalValues, unknown, BindTerminalPayload>({
    resolver: zodResolver(bindTerminalSchema),
    defaultValues: {
      storeId:
        stores.find((store) => store.id === session.currentStoreId)?.id ??
        (stores.length === 1 ? stores[0].id : ''),
      name: '',
    },
  });
  const bind = useMutation({
    mutationFn: (values: BindTerminalPayload) =>
      withFreshAuth(() => apiRequest('terminals.bind', { body: values })),
    onSuccess: (terminal) => {
      setBound(terminal);
      // the terminal of this browser (and the binding remembered for the buffer), the lists of terminals
      void queryClient.invalidateQueries({ queryKey: ['terminal'] });
      void queryClient.invalidateQueries({ queryKey: ['terminals'] });
      void queryClient.invalidateQueries({ queryKey: ['me', 'terminals'] });
    },
  });
  const submitError = useApiErrorMessage(bind.error);
  const message = (value: string | undefined) =>
    isBindTerminalErrorKey(value) ? t(`errors.${value}`) : undefined;
  const previous = current.data ?? null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      icon="monitor"
      size="md"
      footer={
        bound ? (
          <Button onClick={onClose}>{t('close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="bind-terminal-form"
              loading={bind.isPending}
            >
              {t('submit')}
            </Button>
          </>
        )
      }
    >
      {bound ? (
        <Alert tone="success" live="polite">
          {t('done', { name: bound.name, store: bound.store.name })}
        </Alert>
      ) : (
        <form
          id="bind-terminal-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => bind.mutate(values))}
        >
          {submitError && (
            <Alert tone="danger" live="assertive">
              {submitError}
            </Alert>
          )}
          {previous && (
            <Alert tone="warning">
              {t('rebind', {
                name: previous.name,
                store: previous.store.name,
              })}
            </Alert>
          )}
          <Select
            label={t('store')}
            required
            options={stores.map((store) => ({
              value: store.id,
              label: store.name,
            }))}
            placeholder="—"
            error={message(errors.storeId?.message)}
            {...register('storeId')}
          />
          <TextField
            label={t('name')}
            required
            maxLength={60}
            hint={t('nameHint')}
            autoComplete="off"
            error={message(errors.name?.message)}
            {...register('name')}
          />
        </form>
      )}
    </Dialog>
  );
}
