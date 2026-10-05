import config from './playwright.config';

export default {
  ...config,
  use: { ...config.use, channel: 'chrome', video: 'off' },
};
