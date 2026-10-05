use affine_core::auth::{
  ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER, ACCESS_TOKEN_TYPE, CLOCK_TOLERANCE_SECONDS,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[cfg(test)]
#[derive(Serialize)]
struct AccessTokenHeader<'a> {
  alg: &'static str,
  typ: &'static str,
  kid: &'a str,
}

#[derive(Deserialize)]
struct ParsedAccessTokenHeader {
  alg: String,
  typ: String,
  kid: String,
}

#[cfg(test)]
#[derive(Serialize)]
struct AccessTokenClaims<'a> {
  sub: &'a str,
  sid: &'a str,
  typ: &'static str,
  iss: &'static str,
  aud: &'static str,
  iat: i64,
  exp: i64,
}

#[derive(Deserialize)]
struct ParsedAccessTokenClaims {
  sub: String,
  sid: String,
  typ: String,
  iss: String,
  aud: String,
  iat: i64,
  exp: i64,
}

pub(crate) struct AuthSessionAccessTokenVerification {
  pub(crate) status: &'static str,
  pub(crate) user_id: Option<String>,
  pub(crate) auth_session_id: Option<String>,
}

fn invalid_access_token() -> AuthSessionAccessTokenVerification {
  AuthSessionAccessTokenVerification {
    status: "invalid",
    user_id: None,
    auth_session_id: None,
  }
}

fn decode_segment<T: for<'de> Deserialize<'de>>(segment: &str) -> Option<T> {
  let bytes = URL_SAFE_NO_PAD.decode(segment).ok()?;
  serde_json::from_slice(&bytes).ok()
}

pub(crate) fn auth_session_access_token_key_id(token: &str) -> Option<String> {
  let mut segments = token.split('.');
  let header: ParsedAccessTokenHeader = decode_segment(segments.next()?)?;
  segments.next()?;
  segments.next()?;
  if segments.next().is_some() || header.alg != "HS256" || header.typ != "JWT" {
    return None;
  }
  Some(header.kid)
}

#[cfg(test)]
pub(crate) fn sign_auth_session_access_token(
  user_id: &str,
  auth_session_id: &str,
  key_id: &str,
  secret: &[u8],
  issued_at: i64,
  expires_at: i64,
) -> Result<String, &'static str> {
  if user_id.is_empty() || auth_session_id.is_empty() || key_id.is_empty() {
    return Err("access_token_invalid_identity");
  }
  if secret.len() < 32 {
    return Err("access_token_signing_key_too_short");
  }
  if expires_at <= issued_at {
    return Err("access_token_invalid_expiry");
  }
  let header = URL_SAFE_NO_PAD.encode(
    serde_json::to_vec(&AccessTokenHeader {
      alg: "HS256",
      typ: "JWT",
      kid: key_id,
    })
    .map_err(|_| "access_token_encode_failed")?,
  );
  let claims = URL_SAFE_NO_PAD.encode(
    serde_json::to_vec(&AccessTokenClaims {
      sub: user_id,
      sid: auth_session_id,
      typ: ACCESS_TOKEN_TYPE,
      iss: ACCESS_TOKEN_ISSUER,
      aud: ACCESS_TOKEN_AUDIENCE,
      iat: issued_at,
      exp: expires_at,
    })
    .map_err(|_| "access_token_encode_failed")?,
  );
  let signing_input = format!("{header}.{claims}");
  let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| "access_token_signing_key_invalid")?;
  mac.update(signing_input.as_bytes());
  let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
  Ok(format!("{signing_input}.{signature}"))
}

pub(crate) fn verify_auth_session_access_token(
  token: &str,
  expected_key_id: &str,
  secret: &[u8],
  now: i64,
) -> AuthSessionAccessTokenVerification {
  let segments = token.split('.').collect::<Vec<_>>();
  if segments.len() != 3 {
    return invalid_access_token();
  }
  let Some(header) = decode_segment::<ParsedAccessTokenHeader>(segments[0]) else {
    return invalid_access_token();
  };
  if header.alg != "HS256" || header.typ != "JWT" || header.kid != expected_key_id {
    return invalid_access_token();
  }
  let Ok(signature) = URL_SAFE_NO_PAD.decode(segments[2]) else {
    return invalid_access_token();
  };
  let Ok(mut mac) = HmacSha256::new_from_slice(secret) else {
    return invalid_access_token();
  };
  mac.update(format!("{}.{}", segments[0], segments[1]).as_bytes());
  if mac.verify_slice(&signature).is_err() {
    return invalid_access_token();
  }
  let Some(claims) = decode_segment::<ParsedAccessTokenClaims>(segments[1]) else {
    return invalid_access_token();
  };
  if claims.typ != ACCESS_TOKEN_TYPE
    || claims.iss != ACCESS_TOKEN_ISSUER
    || claims.aud != ACCESS_TOKEN_AUDIENCE
    || claims.iat > now + CLOCK_TOLERANCE_SECONDS
  {
    return invalid_access_token();
  }
  if claims.exp + CLOCK_TOLERANCE_SECONDS <= now {
    return AuthSessionAccessTokenVerification {
      status: "expired",
      user_id: None,
      auth_session_id: None,
    };
  }
  if claims.exp <= claims.iat {
    return invalid_access_token();
  }
  AuthSessionAccessTokenVerification {
    status: "valid",
    user_id: Some(claims.sub),
    auth_session_id: Some(claims.sid),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn access_token_vector_and_policy() {
    let secret = || vec![7; 32];
    let token =
      sign_auth_session_access_token("user-1", "session-1", "key-1", &secret(), 1_700_000_000, 1_700_000_900).unwrap();
    assert_eq!(auth_session_access_token_key_id(&token), Some("key-1".into()));
    let valid = verify_auth_session_access_token(&token, "key-1", &secret(), 1_700_000_100);
    assert_eq!(valid.status, "valid");
    assert_eq!(valid.user_id.as_deref(), Some("user-1"));
    assert_eq!(
      verify_auth_session_access_token(&token, "key-1", &secret(), 1_700_000_929).status,
      "valid"
    );
    assert_eq!(
      verify_auth_session_access_token(&token, "key-1", &secret(), 1_700_000_930).status,
      "expired"
    );
    assert_eq!(
      verify_auth_session_access_token(&token, "key-1", &secret(), 1_700_001_000).status,
      "expired"
    );
    assert_eq!(
      verify_auth_session_access_token(&token, "wrong-key", &secret(), 1_700_000_100).status,
      "invalid"
    );
    assert_eq!(
      verify_auth_session_access_token(&token, "key-1", &[8; 32], 1_700_000_100).status,
      "invalid"
    );
    assert_eq!(
      verify_auth_session_access_token(&token, "key-1", &secret(), 1_699_999_000).status,
      "invalid"
    );
    assert_eq!(
      verify_auth_session_access_token("malformed", "key-1", &secret(), 1_700_000_100).status,
      "invalid"
    );
  }
}
