import { sentry, tracker } from '@affine/track';
import { useEffect } from 'react';

export function Telemetry() {
  useEffect(() => {
    sentry.disable();
    tracker.opt_out_tracking();
  }, []);

  return null;
}
