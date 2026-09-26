import { requireEnvironmentVariable } from "../env.js";

export interface GarminConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  redirectUri: string;
  webhookToken: string;
  tokenEncryptionKey: string;
}

export function getGarminConfig(): GarminConfig {
  const publicBaseUrl = requireEnvironmentVariable("PUBLIC_BASE_URL").replace(/\/$/, "");

  return {
    clientId: requireEnvironmentVariable("GARMIN_CLIENT_ID"),
    clientSecret: requireEnvironmentVariable("GARMIN_CLIENT_SECRET"),
    authorizationUrl:
      process.env.GARMIN_AUTHORIZATION_URL?.trim() || "https://connect.garmin.com/oauth2Confirm",
    tokenUrl: requireEnvironmentVariable("GARMIN_TOKEN_URL"),
    apiBaseUrl:
      process.env.GARMIN_API_BASE_URL?.trim() || "https://apis.garmin.com/wellness-api/rest",
    redirectUri: `${publicBaseUrl}/api/garmin/callback`,
    webhookToken: requireEnvironmentVariable("GARMIN_WEBHOOK_TOKEN"),
    tokenEncryptionKey: requireEnvironmentVariable("TOKEN_ENCRYPTION_KEY"),
  };
}
