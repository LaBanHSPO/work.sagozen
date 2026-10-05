import { cssVar, lightCssVariables } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

export const appStyle = style({
  width: '100%',
  position: 'relative',
  height: '100dvh',
  flexGrow: '1',
  display: 'flex',
  backgroundColor: cssVar('backgroundPrimaryColor'),
  selectors: {
    '&.noisy-background::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      opacity: `var(--affine-noise-opacity, 0)`,
      backgroundRepeat: 'repeat',
      backgroundSize: '50px',
      // TODO(@Peng): figure out how to use vanilla-extract webpack plugin to inject img url
      backgroundImage: `var(--noise-background)`,
    },
  },
});
globalStyle(`html[data-theme="light"] ${appStyle}`, {
  vars: {
    '--affine-noise-opacity': '0.2',
  },
});
globalStyle(`html[data-theme="dark"] ${appStyle}`, {
  vars: {
    '--affine-noise-opacity': '1',
  },
  '@media': {
    print: {
      vars: lightCssVariables,
    },
  },
});

export const browserAppViewContainer = style({
  display: 'flex',
  flexFlow: 'row',
  height: '100%',
  width: '100%',
  position: 'relative',
});

export const mainContainerStyle = style({
  position: 'relative',
  zIndex: 0,
  width: '100%',
  display: 'flex',
  flex: 1,
  maxWidth: '100%',

});
