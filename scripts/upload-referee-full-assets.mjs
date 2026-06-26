import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "referee-headshots-full";
const DEFAULT_SOURCE_DIR = "src/assets";
const STORAGE_PREFIX = "static";
const REFEREE_ASSET_ROOTS = new Set(["referees", "referees_review_duplicates"]);

async function loadEnvFile(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || process.env[key]) return;
    process.env[key] = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
  });
}

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    return fullPath;
  }));
  return files.flat();
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const sourceDir = path.resolve(process.argv[2] || DEFAULT_SOURCE_DIR);
  const stat = await fs.stat(sourceDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const files = (await walkFiles(sourceDir))
    .filter((filePath) => {
      if (!/\.(jpe?g|png|webp)$/i.test(filePath)) return false;
      const [assetRoot] = path.relative(sourceDir, filePath).split(path.sep);
      return REFEREE_ASSET_ROOTS.has(assetRoot);
    })
    .sort((left, right) => left.localeCompare(right));

  let uploaded = 0;
  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).split(path.sep).join("/");
    const storagePath = `${STORAGE_PREFIX}/${relativePath}`;
    const body = await fs.readFile(filePath);
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, body, {
      contentType: contentTypeFor(filePath),
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) {
      throw new Error(`Upload failed for ${relativePath}: ${error.message}`);
    }
    uploaded += 1;
  }

  console.log(`Uploaded ${uploaded} referee full-res assets to ${BUCKET}/${STORAGE_PREFIX}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
