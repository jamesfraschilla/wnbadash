import dinFontUrl from "../assets/fonts/DIN.ttf";
import dinAltFontUrl from "../assets/fonts/DINalt.ttf";
import { playerHeadshotUrls, teamLogoUrl } from "../api.js";

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const NAVY = "#15284a";
const WEDGE = "#24211f";
const PAPER = "#efebe2";
const WHITE = "#ffffff";
const SHADOW = "rgba(0, 0, 0, 0.28)";
const EXPORT_FONT_FAMILIES = {
  header: "\"DIN\"",
  body: "\"DINalt\", sans-serif",
};
const SUPABASE_FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1`
  : "";

const loadedImageCache = new Map();
let exportFontsPromise = null;

function setCanvasFont(context, { weight, size, family }) {
  context.font = `${weight} ${size}px ${family}`;
}

function fitTextSize(context, text, maxWidth, baseSize, minSize, family, weight) {
  let size = baseSize;
  while (size > minSize) {
    setCanvasFont(context, { weight, size, family });
    if (context.measureText(text).width <= maxWidth) {
      return size;
    }
    size -= 0.5;
  }
  return minSize;
}

function drawCenteredText(context, text, x, y, width, options) {
  const {
    size,
    minSize = size,
    family,
    weight,
    color,
    baseline = "top",
  } = options;
  const finalSize = fitTextSize(context, text, width, size, minSize, family, weight);
  setCanvasFont(context, { weight, size: finalSize, family });
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = baseline;
  context.fillText(text, x + width / 2, y);
  return finalSize;
}

function makeCanvas(width, height, background) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function drawContainBottom(context, source, targetX, targetY, targetWidth, targetHeight) {
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = targetX + (targetWidth - drawWidth) / 2;
  const drawY = targetY + targetHeight - drawHeight;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

function drawContain(context, source, targetX, targetY, targetWidth, targetHeight) {
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = targetX + (targetWidth - drawWidth) / 2;
  const drawY = targetY + (targetHeight - drawHeight) / 2;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

function normalizeLastName(player) {
  const explicitLast = String(player?.familyName || "").trim();
  if (explicitLast) return explicitLast.toUpperCase();
  const fullName = String(player?.fullName || "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return String(parts[parts.length - 1] || fullName || "PLAYER").toUpperCase();
}

function getPlayerExportLabel(player) {
  const jersey = String(player?.jerseyNum || "").trim();
  const lastName = normalizeLastName(player);
  return `${jersey ? `#${jersey} ` : ""}${lastName}`.trim();
}

function buildPlayerHeadshotCandidates(player) {
  const personId = String(player?.personId || "").trim();
  if (!personId) return [];
  return playerHeadshotUrls(personId, player?.teamId)
    .filter((url, index, urls) => url && urls.indexOf(url) === index);
}

function buildProxyUrl(url) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl || !SUPABASE_FUNCTIONS_BASE) return safeUrl;
  return `${SUPABASE_FUNCTIONS_BASE}/export-image?url=${encodeURIComponent(safeUrl)}`;
}

function clipDiagnosticUrl(url) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (safeUrl.length <= 160) return safeUrl;
  return `${safeUrl.slice(0, 157)}...`;
}

function decodeImageFromObjectUrl(blob, url) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      loadedImageCache.delete(url);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

function decodeImageFromDataUrl(blob, url) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => {
        loadedImageCache.delete(url);
        resolve(null);
      };
      image.src = String(reader.result || "");
    };
    reader.onerror = () => {
      loadedImageCache.delete(url);
      resolve(null);
    };
    reader.readAsDataURL(blob);
  });
}

function loadImage(url, onStage = null) {
  if (!url) return Promise.resolve(null);
  if (loadedImageCache.has(url)) return loadedImageCache.get(url);

  const promise = fetch(url, { mode: "cors" })
    .then((response) => {
      onStage?.({
        stage: "fetch",
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
      });
      if (!response.ok) {
        throw new Error(`Image request failed: ${response.status}`);
      }
      return response.blob();
    })
    .then(async (blob) => {
      onStage?.({
        stage: "blob",
        ok: true,
        contentType: blob.type || "",
        size: blob.size,
      });
      if (typeof createImageBitmap === "function") {
        try {
          const bitmap = await createImageBitmap(blob);
          onStage?.({
            stage: "bitmap",
            ok: true,
            width: bitmap.width,
            height: bitmap.height,
          });
          return bitmap;
        } catch {
          onStage?.({
            stage: "bitmap",
            ok: false,
          });
          // Fall through to Image() decoding below for browsers with partial support.
        }
      }

      const objectUrlImage = await decodeImageFromObjectUrl(blob, url);
      if (objectUrlImage) {
        onStage?.({
          stage: "object_url",
          ok: true,
          width: objectUrlImage.width || objectUrlImage.naturalWidth || 0,
          height: objectUrlImage.height || objectUrlImage.naturalHeight || 0,
        });
        return objectUrlImage;
      }

      onStage?.({
        stage: "object_url",
        ok: false,
      });

      const dataUrlImage = await decodeImageFromDataUrl(blob, url);
      onStage?.({
        stage: "data_url",
        ok: Boolean(dataUrlImage),
        width: dataUrlImage ? (dataUrlImage.width || dataUrlImage.naturalWidth || 0) : 0,
        height: dataUrlImage ? (dataUrlImage.height || dataUrlImage.naturalHeight || 0) : 0,
      });
      return dataUrlImage;
    })
    .catch((error) => {
      onStage?.({
        stage: "error",
        ok: false,
        message: error instanceof Error ? error.message : String(error || "unknown"),
      });
      loadedImageCache.delete(url);
      return null;
    });

  loadedImageCache.set(url, promise);
  return promise;
}

async function loadFirstImage(urls, diagnostic = null) {
  for (const url of urls) {
    const proxiedUrl = buildProxyUrl(url);
    const attempt = {
      sourceUrl: clipDiagnosticUrl(url),
      proxiedUrl: clipDiagnosticUrl(proxiedUrl),
      stages: [],
      success: false,
    };
    diagnostic?.attempts?.push(attempt);
    const image = await loadImage(proxiedUrl, (stage) => {
      attempt.stages.push(stage);
    });
    if (image) {
      attempt.success = true;
      return image;
    }
  }
  return null;
}

function drawFallbackPlayer(context, label, x, y, width, height) {
  context.save();
  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.beginPath();
  context.roundRect(x + 24, y + 12, width - 48, height - 20, 28);
  context.fill();
  drawCenteredText(context, label, x, y + height / 2 - 20, width, {
    size: 34,
    minSize: 20,
    family: EXPORT_FONT_FAMILIES.body,
    weight: 700,
    color: "rgba(255, 255, 255, 0.52)",
    baseline: "middle",
  });
  context.restore();
}

function drawArrow(context, centerX, startY, endY) {
  const headHeight = 28;
  const stemWidth = 14;
  context.save();
  context.fillStyle = WHITE;
  context.shadowColor = SHADOW;
  context.shadowBlur = 12;
  context.shadowOffsetY = 4;
  context.fillRect(centerX - stemWidth / 2, startY, stemWidth, endY - startY - headHeight);
  context.beginPath();
  context.moveTo(centerX, endY);
  context.lineTo(centerX - 26, endY - headHeight);
  context.lineTo(centerX + 26, endY - headHeight);
  context.closePath();
  context.fill();
  context.restore();
}

function drawBackdrop(context) {
  const gradient = context.createLinearGradient(0, 0, 0, EXPORT_HEIGHT);
  gradient.addColorStop(0, "#17305c");
  gradient.addColorStop(1, NAVY);
  context.fillStyle = gradient;
  context.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

  context.fillStyle = WEDGE;
  context.beginPath();
  context.moveTo(1552, 0);
  context.lineTo(EXPORT_WIDTH, 0);
  context.lineTo(EXPORT_WIDTH, 276);
  context.closePath();
  context.fill();

  context.strokeStyle = PAPER;
  context.lineWidth = 20;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(1570, -4);
  context.lineTo(EXPORT_WIDTH + 6, 284);
  context.stroke();

  context.strokeStyle = "rgba(255, 255, 255, 0.32)";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(1578, -6);
  context.lineTo(EXPORT_WIDTH + 8, 274);
  context.stroke();
}

function drawHeader(context) {
  context.save();
  context.shadowColor = SHADOW;
  context.shadowBlur = 24;
  context.shadowOffsetY = 6;
  drawCenteredText(context, "MATCH-UPS", 0, 96, EXPORT_WIDTH, {
    size: 122,
    minSize: 72,
    family: EXPORT_FONT_FAMILIES.header,
    weight: 700,
    color: WHITE,
  });
  context.restore();
}

function drawPlayerRow(context, players, images, headshotY, labelY) {
  const leftPadding = 72;
  const usableWidth = EXPORT_WIDTH - leftPadding * 2;
  const slotWidth = usableWidth / 5;
  const headshotWidth = 282;
  const headshotHeight = 190;

  players.forEach((player, index) => {
    const centerX = leftPadding + slotWidth * index + slotWidth / 2;
    const headshotX = centerX - headshotWidth / 2;
    const image = images[index];
    const label = getPlayerExportLabel(player);

    if (image) {
      drawContainBottom(context, image, headshotX, headshotY, headshotWidth, headshotHeight);
    } else {
      drawFallbackPlayer(context, label, headshotX, headshotY, headshotWidth, headshotHeight);
    }

    context.save();
    context.shadowColor = SHADOW;
    context.shadowBlur = 14;
    context.shadowOffsetY = 5;
    drawCenteredText(context, label, centerX - slotWidth / 2, labelY, slotWidth, {
      size: 42,
      minSize: 24,
      family: EXPORT_FONT_FAMILIES.body,
      weight: 700,
      color: WHITE,
    });
    context.restore();
  });
}

function drawLogo(context, logoImage) {
  if (!logoImage) return;
  const boxWidth = 124;
  const boxHeight = 100;
  const x = EXPORT_WIDTH - boxWidth - 34;
  const y = 30;
  drawContain(context, logoImage, x, y, boxWidth, boxHeight);
}

function buildFileName({ leftTeam, rightTeam }) {
  const left = String(leftTeam?.tricode || leftTeam?.teamAbbreviation || leftTeam?.fullName || "LEFT")
    .trim()
    .replace(/\s+/g, "-");
  const right = String(rightTeam?.tricode || rightTeam?.teamAbbreviation || rightTeam?.fullName || "RIGHT")
    .trim()
    .replace(/\s+/g, "-");
  return `${left}-vs-${right}-matchups.png`.toLowerCase();
}

export function downloadCanvas(canvas, fileName) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = fileName;
  link.click();
}

export function ensureMatchupExportFonts() {
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    return Promise.resolve();
  }
  if (exportFontsPromise) return exportFontsPromise;

  const waitForFont = async (family) => {
    if (!document.fonts?.load || !document.fonts?.check) return;
    await document.fonts.load(`16px "${family}"`);
    if (document.fonts.ready) {
      await document.fonts.ready;
    }
    if (!document.fonts.check(`16px "${family}"`)) {
      throw new Error(`${family} font did not finish loading.`);
    }
  };

  const loadFont = async (family, url) => {
    const alreadyLoaded = Array.from(document.fonts || []).some(
      (fontFace) => fontFace.family === family && fontFace.status === "loaded"
    );
    if (!alreadyLoaded) {
      const fontFace = new FontFace(family, `url(${url})`);
      await fontFace.load();
      document.fonts.add(fontFace);
    }
    await waitForFont(family);
  };

  exportFontsPromise = Promise.all([
    loadFont("DIN", dinFontUrl),
    loadFont("DINalt", dinAltFontUrl),
  ]).then(() => undefined);

  return exportFontsPromise;
}

export async function exportMatchupGraphic({ league = "nba", leftPlayers, rightPlayers, logoTeamId, leftTeam, rightTeam }) {
  await ensureMatchupExportFonts();
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const diagnostics = {
    leftPlayers: [],
    rightPlayers: [],
    logo: null,
  };

  const buildPlayerDiagnostic = (player) => ({
    label: getPlayerExportLabel(player),
    personId: String(player?.personId || "").trim(),
    teamId: String(player?.teamId || "").trim(),
    attempts: [],
  });

  const leftPlayerDiagnostics = (leftPlayers || []).map((player) => buildPlayerDiagnostic(player));
  const rightPlayerDiagnostics = (rightPlayers || []).map((player) => buildPlayerDiagnostic(player));
  diagnostics.leftPlayers = leftPlayerDiagnostics;
  diagnostics.rightPlayers = rightPlayerDiagnostics;
  diagnostics.logo = {
    teamId: String(logoTeamId || "").trim(),
    attempts: [],
  };

  const [leftImages, rightImages, logoImage] = await Promise.all([
    Promise.all((leftPlayers || []).map((player, index) => loadFirstImage(buildPlayerHeadshotCandidates(player), leftPlayerDiagnostics[index]))),
    Promise.all((rightPlayers || []).map((player, index) => loadFirstImage(buildPlayerHeadshotCandidates(player), rightPlayerDiagnostics[index]))),
    loadFirstImage(logoTeamId ? [teamLogoUrl(logoTeamId, league)] : [], diagnostics.logo),
  ]);

  const { canvas, context } = makeCanvas(EXPORT_WIDTH, EXPORT_HEIGHT, NAVY);
  drawBackdrop(context);
  drawHeader(context);
  drawLogo(context, logoImage);
  drawPlayerRow(context, leftPlayers, leftImages, 286, 484);
  drawPlayerRow(context, rightPlayers, rightImages, 700, 896);

  const leftPadding = 72;
  const usableWidth = EXPORT_WIDTH - leftPadding * 2;
  const slotWidth = usableWidth / 5;
  Array.from({ length: 5 }, (_, index) => {
    const centerX = leftPadding + slotWidth * index + slotWidth / 2;
    drawArrow(context, centerX, 566, 640);
  });

  downloadCanvas(canvas, buildFileName({ leftTeam, rightTeam }));
  return diagnostics;
}
