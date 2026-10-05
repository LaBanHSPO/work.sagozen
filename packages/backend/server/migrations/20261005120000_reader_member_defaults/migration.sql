BEGIN;

ALTER TABLE "workspace_access_policies"
  ALTER COLUMN "member_default_doc_role" SET DEFAULT 'reader';

-- Intentional baseline reset: all existing member defaults, including none and
-- explicit document overrides, become reader. Grants and other policy fields
-- remain unchanged; existing permission-generation triggers handle invalidation.
UPDATE "workspace_access_policies"
SET "member_default_doc_role" = 'reader';

UPDATE "doc_access_policies"
SET "member_default_role" = 'reader';

COMMIT;
