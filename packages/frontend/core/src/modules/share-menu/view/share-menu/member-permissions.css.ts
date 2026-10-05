import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
});

export const description = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  lineHeight: 1.5,
});

export const textarea = style({
  width: '100%',
  minHeight: 260,
  maxHeight: '45vh',
  resize: 'vertical',
  padding: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontFamily: 'monospace',
  fontSize: 13,
  lineHeight: 1.5,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${cssVar('primaryColor')}`,
      outlineOffset: 2,
    },
  },
});

export const error = style({
  fontSize: cssVar('fontSm'),
  color: cssVar('errorColor'),
  overflowWrap: 'anywhere',
});

export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 8,
});

export const restrictedControls = style({
  position: 'fixed',
  bottom: 'calc(24px + env(safe-area-inset-bottom))',
  right: 16,
  maxWidth: 'calc(100vw - 32px)',
  zIndex: 10,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
});
