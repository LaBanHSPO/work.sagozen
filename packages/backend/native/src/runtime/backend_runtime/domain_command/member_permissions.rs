use std::collections::{BTreeMap, BTreeSet};

use affine_core::access_control::{CommandQuotaFacts, DocRole, DomainCommand};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};

use super::{
  lock_permission_facts, lock_workspace, lock_workspace_doc_update, lock_workspace_storage_shared,
  roles::load_doc_default_role,
};
use crate::runtime::{RuntimeError, RuntimeResult, backend_runtime::permission::PermissionAuthorizer};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::runtime::backend_runtime) struct GetInput {
  actor_user_id: String,
  workspace_id: String,
  doc_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::runtime::backend_runtime) struct SetInput {
  actor_user_id: String,
  workspace_id: String,
  doc_id: String,
  expected_revision: String,
  rules: Rules,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rules {
  default_role: String,
  members: Vec<MemberRule>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemberRule {
  user_id: String,
  role: String,
}

struct LockedRules {
  default_role: DocRole,
  active_members: BTreeSet<String>,
  owners: BTreeSet<String>,
  members: BTreeMap<String, DocRole>,
  revision: String,
  can_edit: bool,
}

impl LockedRules {
  fn snapshot(&self) -> Value {
    json!({
      "rules": {
        "defaultRole": self.default_role.as_str(),
        "members": self.members.iter().map(|(user_id, role)| {
          json!({"userId": user_id, "role": role.as_str()})
        }).collect::<Vec<_>>()
      },
      "revision": self.revision,
      "canEdit": self.can_edit,
    })
  }
}

async fn revision(transaction: &mut Transaction<'_, Postgres>, workspace_id: &str) -> RuntimeResult<String> {
  sqlx::query_scalar::<_, i64>(
    "SELECT generation FROM workspace_sync_permission_generations WHERE workspace_id=$1 FOR UPDATE",
  )
  .bind(workspace_id)
  .fetch_optional(&mut **transaction)
  .await
  .map(|generation| generation.unwrap_or(0).to_string())
  .map_err(|error| RuntimeError::database("load member permissions revision", error))
}

async fn load_locked(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: &str,
  workspace_id: &str,
  doc_id: &str,
) -> RuntimeResult<LockedRules> {
  lock_permission_facts(transaction, actor_user_id, workspace_id, Some(doc_id)).await?;
  let can_edit = authorizer
    .doc_member_permissions_can_edit_in(transaction, workspace_id, actor_user_id, doc_id)
    .await?;
  // Lock membership and all principals, not just the editable subset. Owners and
  // guest/group grants remain outside the replacement contract.
  let active_members = sqlx::query_scalar::<_, String>(
    "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND state='active' ORDER BY user_id FOR UPDATE",
  )
  .bind(workspace_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("lock member permissions members", error))?
  .into_iter()
  .collect::<BTreeSet<_>>();
  let rows = sqlx::query(
    "SELECT principal_type,principal_id,role FROM doc_grants WHERE workspace_id=$1 AND doc_id=$2 \
     ORDER BY principal_type,principal_id FOR UPDATE",
  )
  .bind(workspace_id)
  .bind(doc_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("lock member permissions grants", error))?;
  let mut owners = BTreeSet::new();
  let mut members = BTreeMap::new();
  for row in rows {
    let principal_type: String = row.get("principal_type");
    let user_id: String = row.get("principal_id");
    let role: String = row.get("role");
    if principal_type != "user" {
      continue;
    }
    let role = DocRole::parse(&role).ok_or_else(|| RuntimeError::invalid_state("invalid_stored_doc_role"))?;
    if role == DocRole::Owner {
      owners.insert(user_id);
    } else if active_members.contains(&user_id) {
      members.insert(user_id, role);
    }
  }
  Ok(LockedRules {
    default_role: load_doc_default_role(transaction, workspace_id, doc_id).await?,
    active_members,
    owners,
    members,
    revision: revision(transaction, workspace_id).await?,
    can_edit,
  })
}

pub(super) async fn get(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  input: GetInput,
) -> RuntimeResult<Value> {
  lock_document_source(transaction, &input.workspace_id, &input.doc_id).await?;
  Ok(
    load_locked(
      authorizer,
      transaction,
      &input.actor_user_id,
      &input.workspace_id,
      &input.doc_id,
    )
    .await?
    .snapshot(),
  )
}

pub(super) async fn set(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  mut input: SetInput,
) -> RuntimeResult<Value> {
  lock_document_source(transaction, &input.workspace_id, &input.doc_id).await?;
  // Match the quota/storage lock hierarchy: owner user BEFORE workspace/facts.
  // Capture once, before any edits, and retain the original entitlement grant.
  let quota = super::super::load_command_quota_in(transaction, authorizer.deployment, &input.workspace_id).await?;
  let mut current = load_locked(
    authorizer,
    transaction,
    &input.actor_user_id,
    &input.workspace_id,
    &input.doc_id,
  )
  .await?;
  if !current.can_edit {
    return Err(RuntimeError::invalid_input("doc_member_permissions_edit_denied"));
  }
  if current.revision != input.expected_revision {
    return Err(RuntimeError::invalid_state("doc_member_permissions_revision_changed"));
  }
  let default_role = DocRole::parse(&input.rules.default_role)
    .filter(|role| !matches!(role, DocRole::Owner | DocRole::External))
    .ok_or_else(|| RuntimeError::invalid_input("invalid_doc_default_role"))?;
  let mut members = BTreeMap::new();
  for rule in std::mem::take(&mut input.rules.members) {
    let role = DocRole::parse(&rule.role)
      .filter(|role| {
        matches!(
          role,
          DocRole::Reader | DocRole::Commenter | DocRole::Editor | DocRole::Manager
        )
      })
      .ok_or_else(|| RuntimeError::invalid_input("invalid_doc_member_role"))?;
    if !current.active_members.contains(&rule.user_id) {
      return Err(RuntimeError::invalid_input("doc_member_permissions_inactive_member"));
    }
    if current.owners.contains(&rule.user_id) {
      return Err(RuntimeError::invalid_input("doc_owner_must_transfer"));
    }
    if members.insert(rule.user_id, role).is_some() {
      return Err(RuntimeError::invalid_input("duplicate_doc_member_rule"));
    }
  }

  // Authorize every effect against the INITIAL locked facts before any writes.
  // In particular, mixed contraction/expansion retains the quota checks, and a
  // self-demotion cannot deny a later change or become a partial commit.
  if current.default_role != default_role {
    authorize_change(
      authorizer,
      transaction,
      &input,
      quota.as_ref().map(|quota| quota.facts()),
      &DomainCommand::SetDocDefaultRole {
        doc_id: input.doc_id.clone(),
        current_role: current.default_role,
        new_role: default_role,
      },
    )
    .await?;
  }
  let targets = current
    .members
    .keys()
    .chain(members.keys())
    .cloned()
    .collect::<BTreeSet<_>>();
  for user_id in &targets {
    let old_role = current.members.get(user_id).copied();
    let new_role = members.get(user_id).copied();
    if old_role != new_role {
      authorize_change(
        authorizer,
        transaction,
        &input,
        quota.as_ref().map(|quota| quota.facts()),
        &DomainCommand::TransitionDocRole {
          doc_id: input.doc_id.clone(),
          current_role: old_role,
          new_role,
          target_active_member: true,
        },
      )
      .await?;
    }
  }

  if current.default_role != default_role {
    sqlx::query(
      "INSERT INTO doc_access_policies(workspace_id,doc_id,member_default_role) VALUES($1,$2,$3) \
       ON CONFLICT(workspace_id,doc_id) DO UPDATE SET member_default_role=EXCLUDED.member_default_role,updated_at=clock_timestamp()",
    )
    .bind(&input.workspace_id).bind(&input.doc_id).bind(default_role.as_str())
    .execute(&mut **transaction).await
    .map_err(|error| RuntimeError::database("replace member default role", error))?;
  }
  for user_id in targets {
    let old_role = current.members.get(&user_id).copied();
    let new_role = members.get(&user_id).copied();
    if old_role == new_role {
      continue;
    }
    if let Some(role) = new_role {
      sqlx::query(
        "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role,granted_by) \
         VALUES($1,$2,'user',$3,$4,$5) ON CONFLICT(workspace_id,doc_id,principal_type,principal_id) \
         DO UPDATE SET role=EXCLUDED.role,granted_by=EXCLUDED.granted_by,updated_at=clock_timestamp()",
      )
      .bind(&input.workspace_id)
      .bind(&input.doc_id)
      .bind(&user_id)
      .bind(role.as_str())
      .bind(&input.actor_user_id)
      .execute(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("replace member grant", error))?;
    } else {
      sqlx::query(
        "DELETE FROM doc_grants WHERE workspace_id=$1 AND doc_id=$2 AND principal_type='user' AND principal_id=$3",
      )
      .bind(&input.workspace_id)
      .bind(&input.doc_id)
      .bind(&user_id)
      .execute(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("remove omitted member grant", error))?;
    }
  }
  current.default_role = default_role;
  current.members = members;
  current.revision = revision(transaction, &input.workspace_id).await?;
  Ok(current.snapshot())
}

async fn authorize_change(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  input: &SetInput,
  quota: Option<CommandQuotaFacts<'_>>,
  command: &DomainCommand,
) -> RuntimeResult<()> {
  let quota = command.effect().requires_quota_guard().then_some(quota).flatten();
  authorizer
    .authorize_member_rules_command_in(
      transaction,
      &input.actor_user_id,
      &input.workspace_id,
      &input.doc_id,
      command,
      quota,
    )
    .await?;
  Ok(())
}

/// Use the same source fence and deterministic root/document lock ordering as
/// lifecycle mutations. A real snapshot or updates is sufficient; metadata and
/// workspace-root Yjs need not exist for an ordinary document.
async fn lock_document_source(
  transaction: &mut Transaction<'_, Postgres>,
  workspace_id: &str,
  doc_id: &str,
) -> RuntimeResult<()> {
  if workspace_id == doc_id {
    return Err(RuntimeError::invalid_input("doc_is_workspace"));
  }
  lock_workspace_storage_shared(transaction, workspace_id).await?;
  let mut doc_ids = [workspace_id, doc_id];
  doc_ids.sort_unstable();
  for id in doc_ids {
    lock_workspace_doc_update(transaction, workspace_id, id).await?;
  }
  lock_workspace(transaction, workspace_id).await?;
  let exists = sqlx::query_scalar::<_, bool>(
    "SELECT EXISTS(SELECT 1 FROM snapshots WHERE workspace_id=$1 AND guid=$2 FOR SHARE) \
     OR EXISTS(SELECT 1 FROM updates WHERE workspace_id=$1 AND guid=$2 FOR SHARE)",
  )
  .bind(workspace_id)
  .bind(doc_id)
  .fetch_one(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("lock member permissions document source", error))?;
  if !exists {
    return Err(RuntimeError::invalid_input("doc_not_found"));
  }
  Ok(())
}
