mod authorizer;
mod store;
mod telemetry;
mod types;

pub(super) use authorizer::{PermissionAuthorizer, active_workspace_owner_or_admin_in};
pub(super) use telemetry::PermissionTelemetry;
#[cfg(test)]
pub(super) use telemetry::PermissionTelemetryEvent;
pub(super) use types::{AuthorizedSearchScope, DocReadScope, SearchActor};

#[cfg(test)]
mod tests;
