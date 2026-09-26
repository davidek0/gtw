import type { GarminConfig } from "./config.js";

export interface GarminTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshTokenExpiresInSeconds: number | null;
}

export async function exchangeAuthorizationCode(
  config: GarminConfig,
  code: string,
  codeVerifier: string,
): Promise<GarminTokens> {
  return requestTokens(config, {
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshGarminTokens(
  config: GarminConfig,
  refreshToken: string,
): Promise<GarminTokens> {
  return requestTokens(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function getGarminUserId(config: GarminConfig, accessToken: string): Promise<string> {
  const response = await garminRequest(config, accessToken, "/user/id");
  if (!isObject(response) || typeof response.userId !== "string" || !response.userId) {
    throw new Error("Garmin user ID response was invalid");
  }
  return response.userId;
}

export async function getGarminPermissions(
  config: GarminConfig,
  accessToken: string,
): Promise<string[]> {
  const response = await garminRequest(config, accessToken, "/user/permissions");
  const value = Array.isArray(response)
    ? response
    : isObject(response) && Array.isArray(response.permissions)
      ? response.permissions
      : [];
  return value.filter((permission): permission is string => typeof permission === "string");
}

export async function deleteGarminRegistration(
  config: GarminConfig,
  accessToken: string,
): Promise<void> {
  await garminRequest(config, accessToken, "/user/registration", { method: "DELETE" });
}

async function requestTokens(
  config: GarminConfig,
  values: Record<string, string>,
): Promise<GarminTokens> {
  const body = new URLSearchParams({
    ...values,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Garmin token request failed (${response.status}): ${safeError(payload)}`);
  }
  if (
    !isObject(payload) ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    typeof payload.expires_in !== "number"
  ) {
    throw new Error("Garmin token response was invalid");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresInSeconds: payload.expires_in,
    refreshTokenExpiresInSeconds:
      typeof payload.refresh_token_expires_in === "number"
        ? payload.refresh_token_expires_in
        : null,
  };
}

async function garminRequest(
  config: GarminConfig,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Garmin API request failed (${response.status}): ${safeError(payload)}`);
  }
  return payload;
}

function safeError(value: unknown): string {
  if (!isObject(value)) return "No JSON error body";
  const message = value.error_description ?? value.error ?? value.message;
  return typeof message === "string" ? message.slice(0, 500) : "Unrecognized error body";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
