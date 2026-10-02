import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const container = style({
  width: '360px',
  maxHeight: '448px',
  display: 'flex',
  flexDirection: 'column',
  selectors: {
    '&[data-mobile]': { width: '100%' },
  },
});

export const header = style({
  padding: '4px 8px 8px',
  fontSize: '14px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const scrollRoot = style({ flex: 1, minHeight: 0 });
export const scrollViewport = style({ padding: '8px' });

export const row = style({
  padding: '10px 8px',
  fontSize: '14px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const time = style({
  display: 'block',
  marginTop: '4px',
  fontSize: '12px',
  color: cssVarV2('text/secondary'),
});

export const identity = style({
  marginTop: '4px',
  fontSize: '12px',
  color: cssVarV2('text/secondary'),
  overflowWrap: 'anywhere',
});

export const empty = style({
  padding: '32px 16px',
  textAlign: 'center',
  color: cssVarV2('text/secondary'),
});

export const status = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px',
});
