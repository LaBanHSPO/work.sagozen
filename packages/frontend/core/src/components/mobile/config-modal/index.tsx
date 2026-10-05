import { Button, IconButton, Modal, SafeArea } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { ArrowLeftSmallIcon } from '@blocksuite/icons/rc';
import clsx from 'clsx';
import {
  type CSSProperties,
  forwardRef,
  type HTMLProps,
  type ReactNode,
} from 'react';

import * as styles from './styles.css';

interface ConfigModalProps {
  onBack?: () => void;
  onDone?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children: ReactNode;
  variant?: 'popup' | 'page';
}

/**
 * A modal with a page header for configuring something on mobile (preferable to be fullscreen)
 */
export const ConfigModal = ({
  onBack,
  onDone,
  open,
  onOpenChange,
  title,
  children,
  variant = 'page',
}: ConfigModalProps) => {
  const t = useI18n();
  return (
    <Modal
      preserveEditingFocusOnAction
      onOpenChange={onOpenChange}
      open={open}
      fullScreen={variant === 'page'}
      width="100%"
      minHeight={0}
      animation="slideBottom"
      withoutCloseButton
      contentOptions={{
        className:
          variant === 'page'
            ? styles.pageModalContent
            : styles.popupModalContent,
      }}
    >
      {variant === 'page' ? (
        <SafeArea top className={styles.pageHeader}>
          <header className={styles.pageHeaderInner}>
            <div className={styles.pageHeaderActions}>
              {onBack ? (
                <IconButton
                  size="24"
                  style={{ width: 44, height: 44 }}
                  aria-label={t['com.affine.backButton']()}
                  onClick={onBack}
                >
                  <ArrowLeftSmallIcon />
                </IconButton>
              ) : null}
            </div>
            <div className={styles.pageTitle}>{title}</div>
            <div className={styles.pageHeaderActions}>
              {onDone ? (
                <Button
                  style={{ fontSize: 17, fontWeight: 600 }}
                  className={styles.doneButton}
                  variant="plain"
                  onClick={onDone}
                >
                  {t['Done']()}
                </Button>
              ) : null}
            </div>
          </header>
        </SafeArea>
      ) : null}
      <div
        className={
          variant === 'page' ? styles.pageContent : styles.popupContent
        }
      >
        {variant === 'page' ? null : (
          <div className={styles.popupTitle}>{title}</div>
        )}
        {children}
        {variant === 'popup' && onDone ? (
          <div className={styles.bottomDoneButtonContainer}>
            <Button
              variant="primary"
              className={styles.bottomDoneButton}
              onClick={onDone}
            >
              {t['Done']()}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export const ConfigRow = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  function ConfigRow({ children, className, ...attrs }, ref) {
    return (
      <div className={clsx(styles.rowItem, className)} ref={ref} {...attrs}>
        {children}
      </div>
    );
  }
);

export interface SettingGroupProps extends Omit<
  HTMLProps<HTMLDivElement>,
  'title'
> {
  title?: ReactNode;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

export const ConfigRowGroup = forwardRef<HTMLDivElement, SettingGroupProps>(
  function ConfigRowGroup(
    { children, title, className, contentClassName, contentStyle, ...attrs },
    ref
  ) {
    return (
      <div className={clsx(styles.group, className)} ref={ref} {...attrs}>
        {title ? <div className={styles.groupTitle}>{title}</div> : null}
        <div
          className={clsx(styles.groupContent, contentClassName)}
          style={contentStyle}
        >
          {children}
        </div>
      </div>
    );
  }
);

ConfigModal.RowGroup = ConfigRowGroup;
ConfigModal.Row = ConfigRow;
