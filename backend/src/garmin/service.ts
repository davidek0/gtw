import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "../db/client.js";
import { garminConnections, garminHealthRecords, garminOAuthStates } from "../db/schema.js";
import {
  deleteGarminRegistration,
  exchangeAuthorizationCode,
  getGarminPermissions,
  getGarminUserId,
  refreshGarminTokens,
} from "./client.js";
import { getGarminConfig } from "./config.js";
import {
  createPkceChallenge,
  decryptSecret,
  encryptSecret,
  randomUrlSafeString,
  sha256,
} from "./crypto.js";

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000;

export async function createGarminAuthorization(subjectId: string): Promise<string> {
  const config = getGarminConfig();
  const state = randomUrlSafeString(32);
  const verifier = randomUrlSafeString(64);

  await db.insert(garminOAuthStates).values({
    subjectId,
    stateHash: sha256(state),
    encryptedCodeVerifier: encryptSecret(verifier, config.tokenEncryptionKey),
    expiresAt: new Date(Date.now() + OAUTH_STATE_LIFETIME_MS),
  });

  const url = new URL(config.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  return url.toString();
}

export async function completeGarminAuthorization(code: string, state: string): Promise<string> {
  const config = getGarminConfig();
  const [oauthState] = await db
    .select()
    .from(garminOAuthStates)
    .where(
      and(
        eq(garminOAuthStates.stateHash, sha256(state)),
        isNull(garminOAuthStates.usedAt),
        gt(garminOAuthStates.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!oauthState) throw new Error("Garmin authorization state is invalid or expired");

  const verifier = decryptSecret(oauthState.encryptedCodeVerifier, config.tokenEncryptionKey);
  const tokens = await exchangeAuthorizationCode(config, code, verifier);
  const [garminUserId, permissions] = await Promise.all([
    getGarminUserId(config, tokens.accessToken),
    getGarminPermissions(config, tokens.accessToken),
  ]);
  const now = new Date();

  await db.transaction(async (transaction) => {
    const [savedConnection] = await transaction
      .insert(garminConnections)
      .values({
        subjectId: oauthState.subjectId,
        garminUserId,
        encryptedAccessToken: encryptSecret(tokens.accessToken, config.tokenEncryptionKey),
        encryptedRefreshToken: encryptSecret(tokens.refreshToken, config.tokenEncryptionKey),
        accessTokenExpiresAt: expiryDate(tokens.expiresInSeconds),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresInSeconds
          ? expiryDate(tokens.refreshTokenExpiresInSeconds)
          : null,
        permissions,
        updatedAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: garminConnections.subjectId,
        set: {
          garminUserId,
          encryptedAccessToken: encryptSecret(tokens.accessToken, config.tokenEncryptionKey),
          encryptedRefreshToken: encryptSecret(tokens.refreshToken, config.tokenEncryptionKey),
          accessTokenExpiresAt: expiryDate(tokens.expiresInSeconds),
          refreshTokenExpiresAt: tokens.refreshTokenExpiresInSeconds
            ? expiryDate(tokens.refreshTokenExpiresInSeconds)
            : null,
          permissions,
          updatedAt: now,
          revokedAt: null,
        },
      })
      .returning({ id: garminConnections.id });
    await transaction
      .update(garminHealthRecords)
      .set({ connectionId: savedConnection.id })
      .where(eq(garminHealthRecords.garminUserId, garminUserId));
    await transaction
      .update(garminOAuthStates)
      .set({ usedAt: now })
      .where(eq(garminOAuthStates.id, oauthState.id));
  });

  return oauthState.subjectId;
}

export async function getGarminConnectionStatus(subjectId: string) {
  const [connection] = await db
    .select({
      subjectId: garminConnections.subjectId,
      garminUserId: garminConnections.garminUserId,
      permissions: garminConnections.permissions,
      connectedAt: garminConnections.connectedAt,
      updatedAt: garminConnections.updatedAt,
      revokedAt: garminConnections.revokedAt,
    })
    .from(garminConnections)
    .where(eq(garminConnections.subjectId, subjectId))
    .limit(1);
  return connection ?? null;
}

export async function listGarminHealthRecords(subjectId: string, limit: number, summaryType?: string) {
  const conditions = [eq(garminConnections.subjectId, subjectId)];
  if (summaryType) conditions.push(eq(garminHealthRecords.summaryType, summaryType));

  return db
    .select({
      id: garminHealthRecords.id,
      summaryType: garminHealthRecords.summaryType,
      startedAt: garminHealthRecords.startedAt,
      endedAt: garminHealthRecords.endedAt,
      data: garminHealthRecords.data,
      receivedAt: garminHealthRecords.receivedAt,
    })
    .from(garminHealthRecords)
    .innerJoin(garminConnections, eq(garminHealthRecords.connectionId, garminConnections.id))
    .where(and(...conditions))
    .orderBy(desc(garminHealthRecords.startedAt), desc(garminHealthRecords.receivedAt))
    .limit(limit);
}

export async function disconnectGarmin(subjectId: string): Promise<boolean> {
  const config = getGarminConfig();
  const [connection] = await db
    .select()
    .from(garminConnections)
    .where(and(eq(garminConnections.subjectId, subjectId), isNull(garminConnections.revokedAt)))
    .limit(1);
  if (!connection) return false;

  const accessToken = await validAccessToken(connection);
  await deleteGarminRegistration(config, accessToken);
  await db
    .update(garminConnections)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(garminConnections.id, connection.id));
  return true;
}

async function validAccessToken(connection: typeof garminConnections.$inferSelect): Promise<string> {
  const config = getGarminConfig();
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return decryptSecret(connection.encryptedAccessToken, config.tokenEncryptionKey);
  }

  const refreshToken = decryptSecret(connection.encryptedRefreshToken, config.tokenEncryptionKey);
  const tokens = await refreshGarminTokens(config, refreshToken);
  const accessToken = tokens.accessToken;
  await db
    .update(garminConnections)
    .set({
      encryptedAccessToken: encryptSecret(accessToken, config.tokenEncryptionKey),
      encryptedRefreshToken: encryptSecret(tokens.refreshToken, config.tokenEncryptionKey),
      accessTokenExpiresAt: expiryDate(tokens.expiresInSeconds),
      refreshTokenExpiresAt: tokens.refreshTokenExpiresInSeconds
        ? expiryDate(tokens.refreshTokenExpiresInSeconds)
        : connection.refreshTokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(garminConnections.id, connection.id));
  return accessToken;
}

function expiryDate(expiresInSeconds: number): Date {
  return new Date(Date.now() + Math.max(0, expiresInSeconds * 1000 - TOKEN_EXPIRY_BUFFER_MS));
}
