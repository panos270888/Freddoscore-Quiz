import * as admin from "firebase-admin";
import { google } from "googleapis";
import * as XLSX from "xlsx";

admin.initializeApp();
const db = admin.firestore();

const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!SERVICE_ACCOUNT_PATH) {
  throw new Error(
    "GOOGLE_APPLICATION_CREDENTIALS environment variable not set"
  );
}

// 🔴 PASTE YOUR GOOGLE SHEET FILE ID HERE
const DRIVE_FILE_ID = "1BcLkjk6ZODCjGVffOXMJBPoVXq4qFRAQtl6JKM4thXM";

/* ===================================================== */
/* ================= DRIVE DOWNLOAD ===================== */
/* ===================================================== */

async function downloadSheet(): Promise<Buffer> {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  const response = await drive.files.export(
    {
      fileId: DRIVE_FILE_ID,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(response.data as ArrayBuffer);
}

/* ===================================================== */
/* ================= DATA HELPERS ======================= */
/* ===================================================== */

function toBoolean(value: any): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string")
    return ["true", "1", "yes"].includes(value.toLowerCase());
  return false;
}

function clean(value: any): string | null {
  if (value === undefined || value === null) return null;
  const v = value.toString().trim();
  return v.length === 0 ? null : v;
}

/* -------- Drive Link Auto Conversion -------- */

function convertDriveLink(url: string): string {
  if (!url) return url;

  // Already converted
  if (url.includes("uc?export=view&id=")) {
    return url;
  }

  // Normal share link
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    const fileId = match[1];
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  return url;
}

function isImageUrl(value: string | null) {
  if (!value) return false;

  return (
    value.startsWith("http") &&
    (
      value.includes("drive.google.com") ||
      value.includes(".png") ||
      value.includes(".jpg") ||
      value.includes(".jpeg") ||
      value.includes("firebasestorage")
    )
  );
}

function buildHints(row: any) {
  const rawHints = [
    clean(row.hint1),
    clean(row.hint2),
    clean(row.hint3),
    clean(row.hint4),
  ];

  return rawHints
    .filter((h) => h !== null)
    .map((hint) => {
      const converted = convertDriveLink(hint!);

      return {
        type: isImageUrl(converted) ? "image" : "text",
        value: converted,
      };
    });
}

function transformRow(row: any) {
  return {
    text: clean(row.text),
    hints: buildHints(row),
    answer: {
      canonical: clean(row.answer),
    },
    metadata: {
      category: clean(row.category),
      difficulty: clean(row.difficulty),
      createdBy: clean(row.createdBy) ?? "manual",
      isActive: toBoolean(row.isActive),
      version: Number(row.version ?? 1),
    },
  };
}

/* ===================================================== */
/* ================= MAIN IMPORT ======================== */
/* ===================================================== */

async function run() {
  console.log("Downloading sheet from Google Drive...");

  const fileBuffer = await downloadSheet();

  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as any[];

  console.log(`Found ${rows.length} rows`);

  let processed = 0;

  for (const row of rows) {
    if (!row.text || !row.answer) {
      console.log("Skipping empty row");
      continue;
    }

    const doc = transformRow(row);

    const docId =
      row.question_id?.toString().trim() ||
      doc.text!
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .substring(0, 100);

    await db.collection("questions").doc(docId).set(doc, {
      merge: true,
    });

    processed++;
  }

  console.log(`Import completed. ${processed} questions upserted.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});