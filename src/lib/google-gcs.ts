import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { getGoogleSttGcsBucket, loadGoogleCredentials } from "./google-auth";

async function getStorageAccessToken(): Promise<string> {
  const credentials = loadGoogleCredentials();
  if (!credentials) {
    throw new Error("Google credentials not configured");
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Failed to obtain Google Cloud Storage access token");
  }
  return token.token;
}

export async function uploadAudioToGcs(
  filePath: string,
  originalFilename: string,
): Promise<{ bucket: string; gcsUri: string; objectName: string }> {
  const bucket = getGoogleSttGcsBucket();
  if (!bucket) {
    throw new Error("GOOGLE_STT_GCS_BUCKET is not configured");
  }

  const safeName = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectName = `transcriber-stt/${randomUUID()}-${safeName}`;
  const content = await readFile(filePath);
  const token = await getStorageAccessToken();
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}` +
    `/o?uploadType=media&name=${encodeURIComponent(objectName)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: content,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GCS upload failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return {
    bucket,
    gcsUri: `gs://${bucket}/${objectName}`,
    objectName,
  };
}

export async function deleteGcsObject(bucket: string, objectName: string): Promise<void> {
  const token = await getStorageAccessToken();
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}` +
    `/o/${encodeURIComponent(objectName)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`GCS delete failed (${response.status}): ${body.slice(0, 300)}`);
  }
}
