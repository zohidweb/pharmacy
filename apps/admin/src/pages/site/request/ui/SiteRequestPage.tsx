'use client';

import type { ConnectionRequest } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  buttonClassName,
  Card,
  CardHeader,
  Dialog,
  Icon,
  Spinner,
  TextareaField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import {
  connectionRequestKeys,
  RequestStatusPill,
  useConnectionRequest,
} from '@/entities/connection-request';
import { attentionKeys } from '@/entities/event';
import { useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const NOTE_MAX = 1000;
const REASON_MIN = 5;
const REASON_MAX = 500;

const isOpen = (request: ConnectionRequest) =>
  request.status === 'new' || request.status === 'in_progress';

/**
 * What every action does with its answer: the card shows the saved request at once, the list and the menu
 * counter are read again. A refused action (409 `request_already_decided`) reads the card again too.
 */
function useRequestRefresh(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: connectionRequestKeys.all });
    void queryClient.invalidateQueries({ queryKey: attentionKeys.counts });
  };
  return {
    onSuccess: (saved: ConnectionRequest) => {
      queryClient.setQueryData(connectionRequestKeys.detail(id), saved);
      refresh();
    },
    onError: refresh,
  };
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2 flex flex-col' : 'flex flex-col'}>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="m-0 text-sm">{children}</dd>
    </div>
  );
}

function RequestData({ request }: { request: ConnectionRequest }) {
  const t = useTranslations('siteRequest');
  const tLocales = useTranslations('locales');
  const dash = '—';
  return (
    <Card
      as="section"
      aria-labelledby="request-data-title"
      className="flex flex-col gap-4"
    >
      <CardHeader title={t('dataTitle')} titleId="request-data-title" />
      {request.anonymizedAt && (
        <Alert tone="info">
          {t('anonymized', { at: formatDateTime(request.anonymizedAt) })}
        </Alert>
      )}
      <dl className="m-0 grid grid-cols-2 gap-4">
        <Field label={t('fields.networkName')}>{request.networkName}</Field>
        <Field label={t('fields.city')}>{request.city}</Field>
        <Field label={t('fields.storeCount')}>{request.storeCount}</Field>
        <Field label={t('fields.contactName')}>
          {request.contactName ?? dash}
        </Field>
        <Field label={t('fields.phone')}>
          <span className="tabular-nums">{request.phone ?? dash}</span>
        </Field>
        <Field label={t('fields.email')}>{request.email ?? dash}</Field>
        <Field label={t('fields.inn')}>
          <span className="tabular-nums">{request.inn ?? dash}</span>
        </Field>
        <Field label={t('fields.callTime')}>{request.callTime ?? dash}</Field>
        <Field label={t('fields.locale')}>{tLocales(request.locale)}</Field>
        <Field label={t('fields.createdAt')}>
          {formatDateTime(request.createdAt)}
        </Field>
        <Field label={t('fields.comment')} wide>
          <span className="whitespace-pre-wrap">{request.comment ?? dash}</span>
        </Field>
      </dl>
    </Card>
  );
}

function SimilarTenants({ request }: { request: ConnectionRequest }) {
  const t = useTranslations('siteRequest.similar');
  if (request.similarTenants.length === 0) return null;
  return (
    <Alert tone="warning" title={t('title')}>
      <span className="flex flex-col gap-1">
        {t('description')}
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {request.similarTenants.map((tenant) => (
            <li key={tenant.id}>
              <Link
                href={routes.company(tenant.id)}
                className="text-primary hover:text-primary-hover"
              >
                {tenant.name}
              </Link>
            </li>
          ))}
        </ul>
      </span>
    </Alert>
  );
}

function OperatorNote({ request }: { request: ConnectionRequest }) {
  const t = useTranslations('siteRequest.note');
  const toast = useToast();
  const [note, setNote] = useState(request.operatorNote ?? '');
  const sync = useRequestRefresh(request.id);
  const save = useMutation({
    mutationFn: () =>
      apiRequest('connectionRequests.note', {
        params: { id: request.id },
        body: { note: note.trim() },
      }),
    ...sync,
    onSuccess: (saved) => {
      sync.onSuccess(saved);
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(save.error);
  const tooLong = note.trim().length > NOTE_MAX;
  const dirty = note.trim() !== (request.operatorNote ?? '');
  return (
    <Card
      as="section"
      aria-labelledby="request-note-title"
      className="flex flex-col gap-4"
    >
      <CardHeader title={t('title')} titleId="request-note-title" />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextareaField
        label={t('label')}
        hint={t('hint')}
        rows={3}
        value={note}
        disabled={request.anonymizedAt !== null}
        error={tooLong ? t('tooLong') : undefined}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          disabled={!dirty || tooLong || request.anonymizedAt !== null}
          onClick={() => save.mutate()}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

function RejectDialog({
  request,
  open,
  onClose,
}: {
  request: ConnectionRequest;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('siteRequest.rejectDialog');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const sync = useRequestRefresh(request.id);
  const reject = useMutation({
    mutationFn: (value: string) =>
      apiRequest('connectionRequests.reject', {
        params: { id: request.id },
        body: { reason: value },
      }),
    ...sync,
    onSuccess: (saved) => {
      sync.onSuccess(saved);
      toast.show(t('done'));
      close();
    },
  });
  const error = useApiErrorMessage(reject.error);
  const length = reason.trim().length;
  const invalid = length < REASON_MIN || length > REASON_MAX;

  function close() {
    setReason('');
    setTouched(false);
    reject.reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('title')}
      description={t('description')}
      closeLabel={tCommon('close')}
      icon="circle-alert"
      tone="danger"
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={reject.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) reject.mutate(reason.trim());
            }}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextareaField
        label={t('reason')}
        rows={3}
        required
        value={reason}
        error={touched && invalid ? t('reasonError') : undefined}
        onChange={(event) => setReason(event.target.value)}
      />
    </Dialog>
  );
}

function SpamDialog({
  request,
  open,
  onClose,
}: {
  request: ConnectionRequest;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('siteRequest.spamDialog');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const sync = useRequestRefresh(request.id);
  const markSpam = useMutation({
    mutationFn: () =>
      apiRequest('connectionRequests.markSpam', { params: { id: request.id } }),
    ...sync,
    onSuccess: (saved) => {
      sync.onSuccess(saved);
      toast.show(t('done'));
      close();
    },
  });
  const error = useApiErrorMessage(markSpam.error);

  function close() {
    markSpam.reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('title')}
      description={t('description')}
      closeLabel={tCommon('close')}
      icon="ban"
      tone="danger"
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={markSpam.isPending}
            onClick={() => markSpam.mutate()}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </Dialog>
  );
}

function Processing({ request }: { request: ConnectionRequest }) {
  const t = useTranslations('siteRequest.processing');
  const toast = useToast();
  const tActions = useTranslations('siteRequest.actions');
  const { data: session } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [markingSpam, setMarkingSpam] = useState(false);
  const sync = useRequestRefresh(request.id);
  const take = useMutation({
    mutationFn: () =>
      apiRequest('connectionRequests.take', { params: { id: request.id } }),
    ...sync,
    onSuccess: (saved) => {
      sync.onSuccess(saved);
      toast.show(tActions('taken'));
    },
  });
  const takeError = useApiErrorMessage(take.error);
  const open = isOpen(request);
  const mine =
    request.status === 'in_progress' &&
    request.assignedTo?.id === session?.operator.id;
  return (
    <>
      <Card
        as="section"
        aria-labelledby="request-processing-title"
        className="flex flex-col gap-4"
      >
        <CardHeader
          title={t('title')}
          titleId="request-processing-title"
          actions={<RequestStatusPill status={request.status} />}
        />
        <dl className="m-0 flex flex-col gap-3">
          <Field label={t('assignedTo')}>
            {request.assignedTo?.fullName ?? t('nobody')}
          </Field>
          {request.decidedAt && (
            <Field label={t('decidedAt')}>
              {formatDateTime(request.decidedAt)}
            </Field>
          )}
          {request.rejectReason && (
            <Field label={t('rejectReason')}>
              <span className="whitespace-pre-wrap">
                {request.rejectReason}
              </span>
            </Field>
          )}
          {request.tenantId && (
            <Field label={t('tenant')}>
              <Link
                href={routes.company(request.tenantId)}
                className="text-primary hover:text-primary-hover"
              >
                {t('openTenant')}
              </Link>
            </Field>
          )}
        </dl>
        {open && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {takeError && (
              <Alert tone="danger" live="assertive">
                {takeError}
              </Alert>
            )}
            {!mine && (
              <Button
                variant="secondary"
                iconStart="user-check"
                block
                loading={take.isPending}
                onClick={() => take.mutate()}
              >
                {request.status === 'in_progress'
                  ? tActions('takeOver')
                  : tActions('take')}
              </Button>
            )}
            <Link
              href={routes.companyCreateFromRequest(request.id)}
              className={buttonClassName({ block: true })}
            >
              <Icon name="building-2" size="sm" />
              <span>{tActions('createTenant')}</span>
            </Link>
            <Button
              variant="destructive"
              iconStart="circle-alert"
              block
              onClick={() => setRejecting(true)}
            >
              {tActions('reject')}
            </Button>
            <Button
              variant="tertiary"
              iconStart="ban"
              block
              onClick={() => setMarkingSpam(true)}
            >
              <span className="text-danger">{tActions('spam')}</span>
            </Button>
          </div>
        )}
      </Card>
      <RejectDialog
        request={request}
        open={rejecting}
        onClose={() => setRejecting(false)}
      />
      <SpamDialog
        request={request}
        open={markingSpam}
        onClose={() => setMarkingSpam(false)}
      />
    </>
  );
}

function SiteRequestView() {
  const t = useTranslations('siteRequest');
  const id = useSearchParams()?.get('id') ?? '';
  const request = useConnectionRequest(id);
  return (
    <>
      <PageHeader
        title={request.data?.networkName ?? t('title')}
        subtitle={t('subtitle')}
      />
      <div className="flex flex-col gap-4 p-6">
        <Link
          href={routes.siteRequests()}
          className="inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
        >
          <Icon name="arrow-left" size="sm" />
          {t('back')}
        </Link>
        <QueryState query={request}>
          {(data) => (
            <div className="grid grid-cols-3 items-start gap-4">
              <div className="col-span-2 flex flex-col gap-4">
                <SimilarTenants request={data} />
                <RequestData request={data} />
                <OperatorNote request={data} />
              </div>
              <div className="flex flex-col gap-4">
                <Processing request={data} />
              </div>
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

/** «Сайт → Заявки → карточка»: one connection request, its processing and the creation of the network (S2). */
export function SiteRequestPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <SiteRequestView />
    </Suspense>
  );
}
