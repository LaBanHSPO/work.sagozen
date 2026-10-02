CREATE TABLE "workspace_member_audit_logs" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_user_id" VARCHAR NOT NULL,
    "actor_name" VARCHAR NOT NULL,
    "actor_email" VARCHAR,
    "target_user_id" VARCHAR,
    "target_name" VARCHAR,
    "target_email" VARCHAR,
    "action" VARCHAR NOT NULL,
    "detail" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_member_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workspace_member_audit_logs_workspace_id_created_at_id_idx"
    ON "workspace_member_audit_logs"("workspace_id", "created_at", "id");

ALTER TABLE "workspace_member_audit_logs"
    ADD CONSTRAINT "workspace_member_audit_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
