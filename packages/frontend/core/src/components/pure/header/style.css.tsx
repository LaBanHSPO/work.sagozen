import type { ComplexStyleRule } from '@vanilla-extract/css';
import { style } from '@vanilla-extract/css';

export const header = style({
  display: 'flex',
  flex: 1,
  justifyContent: 'space-between',
  position: 'relative',
  zIndex: 2,
  '@media': {
    print: {
      display: 'none',
    },
  },
} as ComplexStyleRule);

export const headerItem = style({
  minHeight: '32px',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  selectors: {
    '&.left': {
      justifyContent: 'left',
    },
    '&.right': {
      justifyContent: 'right',
    },
  },
});

export const headerCenter = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '52px',
  flexShrink: 0,
  maxWidth: '60%',
  minWidth: '300px',
  position: 'absolute',
  transform: 'translateX(-50%)',
  left: '50%',
  zIndex: 1,
});

export const headerSideContainer = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  selectors: {
    '&.right': {
      flexDirection: 'row-reverse',
    },
  },
});


export const headerDivider = style({
  height: '20px',
  width: '1px',
  background: 'var(--affine-border-color)',
});
