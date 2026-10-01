import { useI18n } from '@affine/i18n';

import * as styles from './share-footer.css';

export const ShareFooter = () => {
  const t = useI18n();
  return (
    <div className={styles.footerContainer}>
      <div className={styles.footer}>
        <div className={styles.description}>
          {t['com.affine.share-page.footer.description']()}
        </div>
      </div>
    </div>
  );
};
