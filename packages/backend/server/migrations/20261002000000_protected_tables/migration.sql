CREATE TABLE "protected_tables" (
    "workspace_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "block_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "protected_tables_pkey" PRIMARY KEY ("workspace_id","doc_id","block_id")
);

CREATE TABLE "protected_table_columns" (
    "workspace_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "block_id" VARCHAR NOT NULL,
    "id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "protected_table_columns_pkey" PRIMARY KEY ("workspace_id","doc_id","block_id","id")
);

CREATE TABLE "protected_table_rows" (
    "workspace_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "block_id" VARCHAR NOT NULL,
    "id" VARCHAR NOT NULL,
    "position" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    CONSTRAINT "protected_table_rows_pkey" PRIMARY KEY ("workspace_id","doc_id","block_id","id")
);

CREATE TABLE "protected_table_grants" (
    "workspace_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "block_id" VARCHAR NOT NULL,
    "scope" VARCHAR NOT NULL,
    "resource_id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_write" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "protected_table_grants_pkey" PRIMARY KEY ("workspace_id","doc_id","block_id","scope","resource_id","user_id"),
    CONSTRAINT "protected_table_grants_scope_check" CHECK ("scope" IN ('row', 'column')),
    CONSTRAINT "protected_table_grants_write_requires_read_check" CHECK (NOT "can_write" OR "can_read")
);

CREATE INDEX "protected_table_grants_user_idx" ON "protected_table_grants"("workspace_id","doc_id","block_id","user_id");

ALTER TABLE "protected_tables" ADD CONSTRAINT "protected_tables_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "protected_table_columns" ADD CONSTRAINT "protected_table_columns_table_fkey" FOREIGN KEY ("workspace_id","doc_id","block_id") REFERENCES "protected_tables"("workspace_id","doc_id","block_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "protected_table_rows" ADD CONSTRAINT "protected_table_rows_table_fkey" FOREIGN KEY ("workspace_id","doc_id","block_id") REFERENCES "protected_tables"("workspace_id","doc_id","block_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "protected_table_grants" ADD CONSTRAINT "protected_table_grants_table_fkey" FOREIGN KEY ("workspace_id","doc_id","block_id") REFERENCES "protected_tables"("workspace_id","doc_id","block_id") ON DELETE CASCADE ON UPDATE CASCADE;
