'use client';

import {
  PAYMENT_QR_RECIPIENT_MAX,
  PAYMENT_QR_TEMPLATE_MAX,
  paymentQrHasAmount,
  paymentQrLink,
  paymentQrTemplateProblem,
  type PaymentQrTemplateProblem,
} from '@pharmacy/shared-domain';
import type { OwnerStore } from '@pharmacy/shared-dto';
import { Alert, Button, Dialog, TextField, useToast } from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  apiFieldErrors,
  apiRequest,
  useApiErrorMessage,
  withFreshAuth,
} from '@/shared/api';
import { QrSvg } from '@/shared/ui';

const PROBLEMS: readonly PaymentQrTemplateProblem[] = [
  'scheme',
  'length',
  'characters',
  'placeholder',
];
// the placeholders as text: use-intl reads braces of a message as its arguments
const PLACEHOLDERS = { amount: '{amount}', ref: '{ref}' };
/** The check QR (spec 2026-11-03-pos-store-ideas, R8): 1,00 somoni. */
const CHECK_AMOUNT_MINOR = 100;

/**
 * «QR для оплаты» of a store (spec 2026-11-03-pos-store-ideas, D37, D38, D42): the payment link the bank gave the store
 * and the recipient, checked by a QR of 1,00 somoni before it is saved; saving asks for a fresh sign-in.
 */
export function PaymentQrDialog({
  store,
  onClose,
}: {
  store: OwnerStore;
  onClose: () => void;
}) {
  const t = useTranslations('ownerStores.paymentQr');
  const tStores = useTranslations('ownerStores');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState(store.paymentQr?.template ?? '');
  const [recipient, setRecipient] = useState(store.paymentQr?.recipient ?? '');
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);

  const save = useMutation({
    mutationFn: (paymentQr: { template: string; recipient: string } | null) =>
      withFreshAuth(() =>
        apiRequest('stores.paymentQr', {
          params: { id: store.id },
          body: { paymentQr },
        }),
      ),
    onSuccess: (_store, paymentQr) => {
      void queryClient.invalidateQueries({ queryKey: ['stores', 'overview'] });
      toast.show(paymentQr ? t('saved') : t('removed'));
      onClose();
    },
  });
  const fieldErrors = apiFieldErrors(save.error);
  const serverError = (field: string) =>
    fieldErrors.find((error) => error.field === field)?.code;
  const shownAtFields = fieldErrors.some((error) =>
    error.field.startsWith('paymentQr.'),
  );
  const error = useApiErrorMessage(shownAtFields ? null : save.error);

  const link = template.trim();
  const problem = link === '' ? null : paymentQrTemplateProblem(link);
  const name = recipient.trim();
  const templateCode =
    link === '' ? (touched ? 'required' : undefined) : (problem ?? undefined);
  const recipientCode =
    name === ''
      ? touched
        ? 'required'
        : undefined
      : name.length > PAYMENT_QR_RECIPIENT_MAX
        ? 'length'
        : undefined;
  const templateError = (code: string | undefined) =>
    code === undefined
      ? undefined
      : PROBLEMS.includes(code as PaymentQrTemplateProblem)
        ? t(`problems.${code as PaymentQrTemplateProblem}`, PLACEHOLDERS)
        : code === 'required'
          ? t('templateRequired')
          : t('invalid');
  const recipientError = (code: string | undefined) =>
    code === undefined
      ? undefined
      : code === 'required'
        ? t('recipientRequired')
        : code === 'length'
          ? t('recipientLength')
          : t('invalid');
  const valid =
    link !== '' &&
    problem === null &&
    name !== '' &&
    name.length <= PAYMENT_QR_RECIPIENT_MAX;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={store.name}
      closeLabel={tStores('close')}
      icon="qr-code"
      tone="info"
      size="lg"
      footer={
        <>
          {store.paymentQr && (
            <Button
              variant="destructive"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
              className="me-auto"
            >
              {t('remove')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tStores('cancel')}
          </Button>
          <Button
            variant="secondary"
            iconStart="qr-code"
            disabled={!valid}
            onClick={() => setChecking(true)}
          >
            {t('check')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) save.mutate({ template: link, recipient: name });
            }}
          >
            {tStores('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('template')}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          maxLength={PAYMENT_QR_TEMPLATE_MAX}
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value);
            setChecking(false);
          }}
          error={templateError(
            serverError('paymentQr.template') ?? templateCode,
          )}
          hint={t('templateHint', PLACEHOLDERS)}
        />
        {valid && !paymentQrHasAmount(link) && (
          <Alert tone="info">{t('noAmount', PLACEHOLDERS)}</Alert>
        )}
        <TextField
          label={t('recipient')}
          autoComplete="off"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          error={recipientError(
            serverError('paymentQr.recipient') ?? recipientCode,
          )}
          hint={t('recipientHint')}
        />
        {checking && valid && (
          <figure className="m-0 flex flex-col items-center gap-2 rounded-md border border-border bg-surface p-4">
            <QrSvg
              text={paymentQrLink(link, {
                amountMinor: CHECK_AMOUNT_MINOR,
                ref: `${store.code}-TEST`,
              })}
              label={t('checkLabel')}
              className="w-(--ph-pay-qr-size)"
            />
            <figcaption className="text-center text-sm text-fg-muted">
              <span className="block font-bold text-fg">{name}</span>
              {t('checkHint')}
            </figcaption>
          </figure>
        )}
      </div>
    </Dialog>
  );
}
