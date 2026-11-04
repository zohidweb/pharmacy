import { useEffect, useState } from 'react';

// the last answer of the tab: a field mounted again shows its button at once
let known = false;

/**
 * Whether the camera button is shown (ADR-0025, п. 6): a secure context and a `videoinput` device. Before a permission
 * the browser lists the kinds of devices without their names, which is enough; a plugged camera shows the button.
 */
export function useCameraAvailable(): boolean {
  const [available, setAvailable] = useState(known);

  useEffect(() => {
    const media = window.isSecureContext ? navigator.mediaDevices : undefined;
    if (!media?.enumerateDevices) return;
    let cancelled = false;
    const check = () => {
      media.enumerateDevices().then(
        (devices) => {
          known = devices.some((device) => device.kind === 'videoinput');
          if (!cancelled) setAvailable(known);
        },
        () => undefined,
      );
    };
    check();
    media.addEventListener('devicechange', check);
    return () => {
      cancelled = true;
      media.removeEventListener('devicechange', check);
    };
  }, []);

  return available;
}
