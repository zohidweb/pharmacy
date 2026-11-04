import { type RefObject, useEffect, useRef, useState } from 'react';
import { loadCodeDetector } from './detector';

export type CameraScanStatus =
  | 'starting'
  | 'scanning'
  | 'denied'
  | 'no_camera'
  | 'busy'
  | 'timeout'
  | 'failed';

export interface CameraScanState {
  status: CameraScanStatus;
  /** The video the frames are read from; the window renders it while the scan is active. */
  videoRef: RefObject<HTMLVideoElement | null>;
  torch: { available: boolean; on: boolean; toggle(): void };
  /** Starts the camera again after an error or the timeout. */
  retry(): void;
}

/** No code for this long — the camera is switched off (spec D33). */
const IDLE_MS = 60_000;
/** One frame at a time, the next one this long after the answer: at most 10 a second on a weak tablet. */
const FRAME_GAP_MS = 100;

function statusOf(error: unknown): CameraScanStatus {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'no_camera';
  }
  if (name === 'NotReadableError') return 'busy';
  return 'failed';
}

/**
 * The rear camera while `active` (ADR-0025, п. 6): the frames are read in the browser and never kept or sent; the first
 * code stops the camera and goes to `onCode`. The stream stops when `active` goes false, on unmount, on `pagehide` and
 * after 60 s without a code.
 */
export function useCameraScan({
  active,
  onCode,
}: {
  active: boolean;
  onCode: (code: string) => void;
}): CameraScanState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const [status, setStatus] = useState<CameraScanStatus>('starting');
  const [torch, setTorch] = useState({ available: false, on: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      stopped = true;
      clearTimeout(frameTimer);
      clearTimeout(idleTimer);
      stream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const fail = (error: unknown) => {
      if (stopped) return;
      stop();
      setStatus(statusOf(error));
    };

    setStatus('starting');
    setTorch({ available: false, on: false });
    void (async () => {
      try {
        // the permission first: a refusal is told before the reader is loaded
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (stopped || !video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play();
        const [track] = stream.getVideoTracks();
        trackRef.current = track ?? null;
        const capabilities = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setTorch({ available: capabilities?.torch === true, on: false });

        const detector = await loadCodeDetector();
        if (stopped) return;
        setStatus('scanning');
        idleTimer = setTimeout(() => {
          stop();
          setStatus('timeout');
        }, IDLE_MS);

        const frame = async (): Promise<void> => {
          if (stopped) return;
          const code =
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              ? await detector.detect(video)
              : null;
          if (stopped) return;
          if (code) {
            stop();
            navigator.vibrate?.(80);
            handler.current(code);
            return;
          }
          frameTimer = setTimeout(() => {
            frame().catch(fail);
          }, FRAME_GAP_MS);
        };
        await frame();
      } catch (error) {
        fail(error);
      }
    })();

    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [active, attempt]);

  const toggle = () => {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    track
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(
        () => setTorch((current) => ({ ...current, on })),
        () => setTorch({ available: false, on: false }),
      );
  };

  return {
    status,
    videoRef,
    torch: { ...torch, toggle },
    retry: () => setAttempt((value) => value + 1),
  };
}
