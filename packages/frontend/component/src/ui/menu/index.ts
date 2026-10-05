import { type ComponentProps, createElement, useContext } from 'react';

export * from './menu.types';
import { DesktopMenuContext } from './desktop/context';
import { ContextMenu } from './desktop/context-menu';
import { DesktopMenuItem } from './desktop/item';
import { DesktopMenu } from './desktop/root';
import { DesktopMenuSeparator } from './desktop/separator';
import { DesktopMenuSub } from './desktop/sub';
import { MenuTrigger } from './menu-trigger';
import type { MenuItemProps, MenuSubProps } from './menu.types';
import { MobileMenuItem } from './mobile/item';
import { MobileMenu } from './mobile/root';
import { MobileMenuSeparator } from './mobile/separator';
import { MobileMenuSub } from './mobile/sub';

const MenuItem = (props: MenuItemProps) => {
  const { type } = useContext(DesktopMenuContext);
  return createElement(
    environment.isMobile && type !== 'context-menu'
      ? MobileMenuItem
      : DesktopMenuItem,
    props
  );
};
const MenuSeparator = (props: ComponentProps<typeof DesktopMenuSeparator>) => {
  const { type } = useContext(DesktopMenuContext);
  return createElement(
    environment.isMobile && type !== 'context-menu'
      ? MobileMenuSeparator
      : DesktopMenuSeparator,
    props
  );
};
const MenuSub = (props: MenuSubProps) => {
  const { type } = useContext(DesktopMenuContext);
  return createElement(
    environment.isMobile && type !== 'context-menu'
      ? MobileMenuSub
      : DesktopMenuSub,
    props
  );
};
const Menu = environment.isMobile ? MobileMenu : DesktopMenu;

export {
  ContextMenu,
  DesktopMenu,
  DesktopMenuItem,
  DesktopMenuSeparator,
  DesktopMenuSub,
  MobileMenu,
  MobileMenuItem,
  MobileMenuSeparator,
  MobileMenuSub,
};

export { Menu, MenuItem, MenuSeparator, MenuSub, MenuTrigger };
export * from './mobile/hook';
