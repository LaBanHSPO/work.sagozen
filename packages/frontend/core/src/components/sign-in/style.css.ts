import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';


export const captchaWrapper = style({
  margin: 'auto',
  marginBottom: '4px',
  textAlign: 'center',
});


export const authInput = style({
  backgroundColor: cssVarV2.button.signinbutton.background,
});

export const signInButton = style({
  backgroundColor: cssVarV2.button.signinbutton.background,
});
