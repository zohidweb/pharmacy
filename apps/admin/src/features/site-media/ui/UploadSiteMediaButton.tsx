'use client';

import type { SiteMedia, SiteMediaType } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Dialog,
  TextField,
  useToast,
  type ButtonVariant,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'use-intl';
import {
  isSiteMediaType,
  siteKeys,
  siteMediaTypes,
  useSiteMediaSizeText,
} from '@/entities/site-content';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { fileToBase64, SITE_MEDIA_MAX_BYTES } from '@/shared/lib';

/** The longest caption the API takes (`alt`, 200 characters). */
const ALT_MAX = 200;

export interface UploadSiteMediaButtonProps {
  /** The picture is stored (or the same file was already in the library). */
  onUploaded: (media: SiteMedia) => void;
  /** Types the caller can use (a favicon: PNG and WebP); all three by default. */
  accept?: readonly SiteMediaType[];
  variant?: ButtonVariant;
}

/**
 * «Загрузить»: a hidden file input behind a button. The type and the size are checked before anything is
 * sent (spec 2026-10-28-public-site-design, S7); then the operator gives the picture a caption and the file
 * goes to the library as base64 JSON.
 */
export function UploadSiteMediaButton({
  onUploaded,
  accept = siteMediaTypes,
  variant = 'secondary',
}: UploadSiteMediaButtonProps) {
  const t = useTranslations('site.media');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const sizeText = useSiteMediaSizeText();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<'type' | 'size' | null>(null);
  const [alt, setAlt] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The dialog was closed while the file was on its way: the picture is stored, but nobody waits for it any more.
  const cancelled = useRef(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const upload = useMutation({
    mutationFn: async (chosen: File) => {
      if (!isSiteMediaType(chosen.type)) throw new Error('unsupported type');
      return apiRequest('siteMedia.upload', {
        body: {
          contentType: chosen.type,
          dataBase64: await fileToBase64(chosen),
          alt: alt.trim(),
        },
      });
    },
    onSuccess: (media) => {
      void queryClient.invalidateQueries({ queryKey: siteKeys.mediaAll });
      toast.show(t('uploaded'));
      if (cancelled.current) return;
      close();
      onUploaded(media);
    },
  });
  const error = useApiErrorMessage(upload.error);

  const close = () => {
    cancelled.current = true;
    setFile(null);
    setAlt('');
    upload.reset();
  };

  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    // The same file can be chosen again after a refusal.
    event.target.value = '';
    if (!chosen) return;
    if (!isSiteMediaType(chosen.type) || !accept.includes(chosen.type)) {
      setRejected('type');
    } else if (chosen.size > SITE_MEDIA_MAX_BYTES) {
      setRejected('size');
    } else {
      setRejected(null);
      setFile(chosen);
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button
        variant={variant}
        iconStart="upload"
        onClick={() => input.current?.click()}
      >
        {t('upload')}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        accept={accept.join(',')}
        onChange={onChoose}
      />
      {rejected && (
        <Alert tone="danger" live="assertive">
          {t(`errors.${rejected}`)}
        </Alert>
      )}
      <Dialog
        open={file !== null}
        onClose={close}
        title={t('dialog.title')}
        closeLabel={tCommon('close')}
        size="md"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              form="site-media-upload-form"
              loading={upload.isPending}
            >
              {t('dialog.submit')}
            </Button>
          </>
        }
      >
        <form
          id="site-media-upload-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            cancelled.current = false;
            upload.mutate(file);
          }}
        >
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          {file && previewUrl && (
            <div className="flex items-center gap-3">
              <img
                src={previewUrl}
                alt=""
                className="size-16 shrink-0 rounded-md border border-border bg-surface-sunken object-contain"
              />
              <p className="m-0 min-w-0 break-words text-sm text-fg-muted">
                {file.name}
                <br />
                {sizeText(file.size)}
              </p>
            </div>
          )}
          <TextField
            label={t('dialog.alt')}
            hint={t('dialog.altHint')}
            maxLength={ALT_MAX}
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
        </form>
      </Dialog>
    </div>
  );
}
