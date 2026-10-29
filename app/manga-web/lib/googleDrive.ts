import { createReadStream } from "fs";
import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";
import path from "path";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

type OAuthConfig = {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  web?: {
    client_id?: string;
    client_secret?: string;
  };
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
};

function readOAuthConfig() {
  const configured = process.env.MANGA_GOOGLE_DRIVE_OAUTH?.trim();
  if (!configured) return null;

  let value = configured;
  const possiblePath = path.isAbsolute(configured)
    ? configured
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  try {
    value = readFileSync(possiblePath, "utf8");
  } catch {
    // A non-file value can be either inline JSON or a refresh token.
  }

  if (!value.trim().startsWith("{")) {
    return { refresh_token: value.trim() } satisfies OAuthConfig;
  }

  try {
    return JSON.parse(value) as OAuthConfig;
  } catch {
    throw new Error(
      "GOOGLE_DRIVE_OAUTH must be a refresh token, valid JSON, or a JSON file path"
    );
  }
}

function getGoogleAuth() {
  const oauthConfig = readOAuthConfig();
  const oauthClientId =
    oauthConfig?.client_id?.trim() ||
    oauthConfig?.web?.client_id?.trim() ||
    oauthConfig?.installed?.client_id?.trim() ||
    process.env.MANGA_GOOGLE_DRIVE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret =
    oauthConfig?.client_secret?.trim() ||
    oauthConfig?.web?.client_secret?.trim() ||
    oauthConfig?.installed?.client_secret?.trim() ||
    process.env.MANGA_GOOGLE_DRIVE_OAUTH_CLIENT_SECRET?.trim();
  const oauthRefreshToken =
    oauthConfig?.refresh_token?.trim() ||
    process.env.MANGA_GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN?.trim();
  const oauthConfigured = Boolean(
    oauthConfig || oauthClientId || oauthClientSecret || oauthRefreshToken
  );

  if (oauthConfigured) {
    if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) {
      throw new Error(
        "Google Drive OAuth requires client_id, client_secret, and refresh_token. GOOGLE_DRIVE_OAUTH may provide the token or all three values."
      );
    }
    const oauth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    oauth.setCredentials({ refresh_token: oauthRefreshToken });
    return oauth;
  }

  const rawCredentials = process.env.MANGA_GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const configuredPath = process.env.MANGA_GOOGLE_APPLICATION_CREDENTIALS?.trim();
  let credentialsJson = rawCredentials;

  if (!credentialsJson && configuredPath) {
    const credentialPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configuredPath);
    try {
      credentialsJson = readFileSync(credentialPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "file not found";
      throw new Error(
        `Could not read GOOGLE_APPLICATION_CREDENTIALS at ${credentialPath}: ${message}`
      );
    }
  }

  if (!credentialsJson) {
    throw new Error(
      "Google Drive credentials are not configured. Set Google Drive OAuth credentials or service-account credentials."
    );
  }

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(credentialsJson) as {
      client_email?: string;
      private_key?: string;
    };
  } catch {
    throw new Error("Google service-account credentials are not valid JSON");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "Google service-account credentials must include client_email and private_key"
    );
  }

  return new GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] });
}

function getDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}

export async function validateGoogleDriveDestination() {
  const folderId = process.env.MANGA_GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!folderId) return;

  const drive = getDriveClient();
  try {
    const result = await drive.files.get({
      fileId: folderId,
      fields: "id,mimeType,capabilities(canAddChildren)",
      supportsAllDrives: true,
    });
    if (result.data.mimeType !== "application/vnd.google-apps.folder") {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID does not point to a folder");
    }
    if (!result.data.capabilities?.canAddChildren) {
      throw new Error("The configured Google account cannot add files to the Drive folder");
    }
  } catch (error) {
    const status = (error as { code?: number }).code;
    if (status === 404) {
      throw new Error(
        "Google Drive folder was not found. Check GOOGLE_DRIVE_FOLDER_ID and share it with the configured Google account as Editor."
      );
    }
    throw error;
  }
}

export async function uploadEpubToGoogleDrive(
  filePath: string,
  fileName: string
) {
  const folderId = process.env.MANGA_GOOGLE_DRIVE_FOLDER_ID?.trim();
  const drive = getDriveClient();
  const result = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: "application/epub+zip",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType: "application/epub+zip",
      body: createReadStream(filePath),
    },
    fields: "id,name,size,webContentLink,webViewLink",
    supportsAllDrives: true,
  });

  const fileId = result.data.id;
  if (!fileId) throw new Error("Google Drive did not return a file ID");

  if (process.env.MANGA_GOOGLE_DRIVE_MAKE_PUBLIC === "true") {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  }

  return {
    id: fileId,
    name: result.data.name || fileName,
    size: result.data.size ? Number(result.data.size) : null,
    webContentLink:
      result.data.webContentLink ||
      `https://drive.google.com/uc?export=download&id=${fileId}`,
    webViewLink:
      result.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}
