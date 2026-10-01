import { sentry, tracker } from '@affine/track';

tracker.init();
tracker.opt_out_tracking();
sentry.disable();
