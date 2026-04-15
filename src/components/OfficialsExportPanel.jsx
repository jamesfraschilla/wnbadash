import { useMemo, useState } from "react";
import { getOfficialSortMeta, orderOfficials } from "../officialAssignments.js";
import dinFontUrl from "../assets/fonts/DIN.ttf";
import dinAltFontUrl from "../assets/fonts/DINalt.ttf";
import styles from "./OfficialsExportPanel.module.css";

const EXPORT_SPECS = {
  portrait: {
    label: "Portrait",
    logicalWidth: 384,
    logicalHeight: 648,
    outputWidth: 1536,
    outputHeight: 2592,
  },
  landscape: {
    label: "Landscape",
    logicalWidth: 660,
    logicalHeight: 510,
    outputWidth: 3300,
    outputHeight: 2550,
  },
  was: {
    label: "WAS",
    outputWidth: 3840,
    outputHeight: 2160,
    boxX: 0,
    boxY: 0,
    boxWidth: 802,
    boxHeight: 1300,
  },
};

const IMAGE_MODULES = import.meta.glob(
  [
    "../assets/referees/*.jpg",
    "../assets/referees/*.jpeg",
    "../assets/referees/*.JPG",
    "../assets/referees/*.JPEG",
  ],
  { eager: true, import: "default" }
);

const refereeHeadshotMap = Object.entries(IMAGE_MODULES).reduce((map, [path, url]) => {
  const fileName = path.split("/").pop() || "";
  const baseName = fileName.replace(/\.(jpe?g)$/i, "");
  map.set(normalizeNameKey(baseName), url);
  return map;
}, new Map());

const loadedImageCache = new Map();
let exportFontsPromise = null;
const EXPORT_FONT_FAMILIES = {
  header: "\"DIN\"",
  body: "\"DINalt\", sans-serif",
};

function normalizeNameKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function readOfficialName(official) {
  const first = String(official?.firstName || "").trim();
  const last = String(official?.familyName || "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return String(
    official?.name ||
    official?.fullName ||
    official?.displayName ||
    official?.officialName ||
    ""
  ).trim();
}

function splitOfficialName(official) {
  const explicitFirst = String(official?.firstName || "").trim();
  const explicitLast = String(official?.familyName || "").trim();
  if (explicitFirst || explicitLast) {
    const fullName = `${explicitFirst} ${explicitLast}`.trim();
    return {
      firstName: explicitFirst || fullName,
      lastName: explicitLast || fullName,
      fullName,
    };
  }

  const fullName = readOfficialName(official);
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: "", lastName: "", fullName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0], fullName };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
    fullName,
  };
}

function normalizeOfficial(official, index) {
  const nameParts = splitOfficialName(official);
  const fullName = nameParts.fullName || `${nameParts.firstName} ${nameParts.lastName}`.trim();
  const sortMeta = getOfficialSortMeta(official);

  return {
    id: official?.personId || official?.officialId || `${fullName || "official"}-${index}`,
    fullName,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    firstUpper: nameParts.firstName.toUpperCase(),
    lastUpper: nameParts.lastName.toUpperCase(),
    jerseyNumber: String(
      official?.jerseyNum ??
      official?.jerseyNumber ??
      official?.number ??
      official?.shirtNumber ??
      ""
    ).trim(),
    roleKey: sortMeta.role,
    isAlternate: sortMeta.isAlternate,
    headshotUrl: refereeHeadshotMap.get(normalizeNameKey(fullName)) || null,
  };
}

function buildOfficialsData(officials, publishedOrder) {
  const rawOfficials = Array.isArray(officials) ? officials : [];
  const orderedPrimary = orderOfficials(rawOfficials, publishedOrder).map((official, index) => normalizeOfficial(official, index));
  const hasCrewChief = orderedPrimary.some((official) => official.roleKey === "crewChief");
  const primary = hasCrewChief
    ? orderedPrimary
    : orderedPrimary.map((official, index) => (
      index === 0 ? { ...official, roleKey: "crewChief" } : official
    ));

  const alternates = rawOfficials
    .map((official, index) => normalizeOfficial(official, index))
    .filter((official) => official.isAlternate)
    .map((official) => official.fullName)
    .filter(Boolean);

  return { primary, alternates };
}

function getInitials(fullName) {
  const parts = String(fullName || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function getThemeMode() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getColors(themeMode) {
  const dark = themeMode === "dark";
  return {
    background: dark ? "#000000" : "#ffffff",
    text: dark ? "#ffffff" : "#000000",
    crewChiefText: dark ? "#FFD700" : "#C8102E",
    fallbackBox: "#E8E8E8",
    fallbackText: "#000000",
  };
}

function getOfficialsHeader(gameTimeLocal) {
  const raw = String(gameTimeLocal || "").trim();
  if (!raw) return "TONIGHT'S OFFICIALS";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "TONIGHT'S OFFICIALS";
  return parsed.getHours() < 17 ? "TODAY'S OFFICIALS" : "TONIGHT'S OFFICIALS";
}

function ensureExportFonts() {
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

function makeScaledLogicalCanvas(logicalWidth, logicalHeight, scale, background) {
  const pixelWidth = Math.round(logicalWidth * scale);
  const pixelHeight = Math.round(logicalHeight * scale);
  const { canvas, context } = makeCanvas(pixelWidth, pixelHeight, background);
  context.scale(scale, scale);
  return { canvas, context };
}

function downloadCanvas(canvas, fileName) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = fileName;
  link.click();
}

function drawContain(context, source, targetX, targetY, targetWidth, targetHeight) {
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = targetX + (targetWidth - drawWidth) / 2;
  const drawY = targetY + (targetHeight - drawHeight) / 2;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

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

function getPortraitNameText(official) {
  const prefix = official.jerseyNumber ? `#${official.jerseyNumber} ` : "";
  return `${prefix}${official.firstUpper} ${official.lastUpper}`.trim();
}

function getVisibleNameText(official) {
  const prefix = official.jerseyNumber ? `#${official.jerseyNumber} ` : "";
  const fullName = [official.firstName, official.lastName].filter(Boolean).join(" ");
  return `${prefix}${fullName}`.trim();
}

function getLandscapeLineOne(official) {
  return `${official.jerseyNumber ? `#${official.jerseyNumber} ` : ""}${official.firstUpper}`.trim();
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (loadedImageCache.has(url)) return loadedImageCache.get(url);

  const promise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  loadedImageCache.set(url, promise);
  return promise;
}

async function buildLoadedImageMap(officials) {
  const entries = await Promise.all(
    officials.map(async (official) => [official.id, await loadImage(official.headshotUrl)])
  );
  return new Map(entries);
}

function drawRoundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawFallbackAvatar(context, x, y, size, radius, fullName) {
  drawRoundedRectPath(context, x, y, size, size, radius);
  context.fillStyle = "#E8E8E8";
  context.fill();

  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  setCanvasFont(context, {
    weight: 700,
    size: Math.max(18, size * 0.28),
    family: EXPORT_FONT_FAMILIES.body,
  });
  context.fillText(getInitials(fullName), x + size / 2, y + size / 2);
}

function drawAvatar(context, image, official, x, y, size, radius, variant) {
  if (!image) {
    drawFallbackAvatar(context, x, y, size, radius, official.fullName);
    return;
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const coverScale = Math.max(size / sourceWidth, size / sourceHeight);
  let drawWidth = sourceWidth * coverScale;
  let drawHeight = sourceHeight * coverScale;
  let drawX = x + (size - drawWidth) / 2;
  let drawY = y;

  if (official.fullName === "Eric Lewis") {
    const scale = 1.12;
    const shift = variant === "landscape" ? 8.5 : 6;
    drawWidth *= scale;
    drawHeight *= scale;
    drawX = x + (size - drawWidth) / 2;
    drawY = y + shift;
  }

  context.save();
  drawRoundedRectPath(context, x, y, size, size, radius);
  context.clip();
  context.fillStyle = "#E8E8E8";
  context.fillRect(x, y, size, size);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function drawPortraitTemplate(primaryOfficials, alternates, imageMap, themeMode, gameTimeLocal, scale = 1) {
  const width = EXPORT_SPECS.portrait.logicalWidth;
  const height = EXPORT_SPECS.portrait.logicalHeight;
  const colors = getColors(themeMode);
  const { canvas, context } = makeScaledLogicalCanvas(width, height, scale, colors.background);

  const padding = { left: 24, top: 24, right: 24, bottom: 18 };
  const contentWidth = width - padding.left - padding.right;
  const textFamily = EXPORT_FONT_FAMILIES.body;
  const headerFamily = EXPORT_FONT_FAMILIES.header;
  const headerHeight = 28.8;
  const headerGap = 10;
  const portraitTargetShift = height * 0.04;
  const tileHeights = primaryOfficials.map((official) => (
    120 + 8 + 23 + (official.roleKey === "crewChief" ? 13 : 0)
  ));
  const tileStackHeight = tileHeights.length
    ? tileHeights.reduce((sum, item) => sum + item, 0) + ((tileHeights.length - 1) * 18)
    : 18;

  const footerText = alternates.length ? `Alternate: ${alternates.join(", ")}` : "";
  const footerHeight = footerText ? 16 : 0;
  const headerText = getOfficialsHeader(gameTimeLocal);
  const footerTop = height - padding.bottom - footerHeight;
  const baseHeaderY = padding.top;
  const baseListTop = baseHeaderY + headerHeight + headerGap;
  const availableTopShift = Math.max(0, footerTop - baseListTop - tileStackHeight);
  const topShift = Math.min(portraitTargetShift, availableTopShift);
  const headerY = baseHeaderY + topShift;
  const listTop = baseListTop + topShift;
  const listBottom = footerTop;

  drawCenteredText(context, headerText, padding.left, headerY, contentWidth, {
    size: headerHeight,
    family: headerFamily,
    weight: 700,
    color: colors.text,
  });

  if (!primaryOfficials.length) {
    setCanvasFont(context, {
      weight: 600,
      size: 18,
      family: textFamily,
    });
    context.fillStyle = colors.text;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Officials not posted.", width / 2, listTop + (listBottom - listTop) / 2);
  } else {
    let currentY = listTop;
    primaryOfficials.forEach((official, index) => {
      const roleHeight = official.roleKey === "crewChief" ? 11 : 0;
      const blockHeight = 120 + 8 + 23 + (roleHeight ? 2 + roleHeight : 0);
      const image = imageMap.get(official.id);

      drawAvatar(context, image, official, (width - 120) / 2, currentY, 120, 18, "portrait");
      currentY += 128;

      drawCenteredText(context, getPortraitNameText(official), padding.left, currentY, contentWidth, {
        size: 23,
        minSize: 15.5,
        family: textFamily,
        weight: 700,
        color: colors.text,
      });
      currentY += 23;

      if (official.roleKey === "crewChief") {
        currentY += 2;
        drawCenteredText(context, "CREW CHIEF", padding.left, currentY, contentWidth, {
          size: 11,
          family: textFamily,
          weight: 600,
          color: colors.crewChiefText,
        });
        currentY += 11;
      }

      if (index < primaryOfficials.length - 1) {
        const nextY = currentY + 18;
        currentY = Math.min(nextY, listBottom - blockHeight);
      }
    });
  }

  if (footerText) {
    drawCenteredText(context, footerText, padding.left, footerTop + 6, contentWidth, {
      size: 10,
      minSize: 8,
      family: textFamily,
      weight: 600,
      color: colors.text,
    });
  }

  return canvas;
}

function drawLandscapeTemplate(primaryOfficials, alternates, imageMap, themeMode, gameTimeLocal, scale = 1) {
  const width = EXPORT_SPECS.landscape.logicalWidth;
  const height = EXPORT_SPECS.landscape.logicalHeight;
  const colors = getColors(themeMode);
  const { canvas, context } = makeScaledLogicalCanvas(width, height, scale, colors.background);

  const padding = { left: 22, top: 12, right: 22, bottom: 18 };
  const contentWidth = width - padding.left - padding.right;
  const textFamily = EXPORT_FONT_FAMILIES.body;
  const headerFamily = EXPORT_FONT_FAMILIES.header;
  const footerText = alternates.length ? `Alternate: ${alternates.join(", ")}` : "";
  const headerText = getOfficialsHeader(gameTimeLocal);
  const footerBlockHeight = footerText ? 18 : 0;
  const footerGap = footerText ? 6 : 0;
  const rowAreaHeight = 360;
  const headerGap = 12;
  const headerDownShift = 28;
  const maxTileContentHeight = primaryOfficials.length
    ? Math.max(
      ...primaryOfficials.map((official) => (
        170 + 10 + 23 + 15 + (official.roleKey === "crewChief" ? 14 : 0)
      ))
    )
    : 0;
  const contentBlockHeight = 50 + headerGap + rowAreaHeight + footerGap + footerBlockHeight;
  const availableHeight = height - padding.top - padding.bottom;
  const blockOffset = Math.max(0, (availableHeight - contentBlockHeight) / 2);
  const baseHeaderY = padding.top + blockOffset;
  const headerY = baseHeaderY + headerDownShift;
  const rowAreaY = baseHeaderY + 50 + headerGap;
  const rowContentOffset = Math.max(0, (rowAreaHeight - maxTileContentHeight) / 2);
  const rowY = rowAreaY + rowContentOffset;
  const footerY = footerText ? rowAreaY + rowAreaHeight + footerGap : null;

  drawCenteredText(context, headerText, padding.left, headerY, contentWidth, {
    size: 50,
    family: headerFamily,
    weight: 700,
    color: colors.text,
  });

  if (!primaryOfficials.length) {
    context.fillStyle = colors.text;
    context.textAlign = "center";
    context.textBaseline = "middle";
    setCanvasFont(context, {
      weight: 600,
      size: 20,
      family: textFamily,
    });
    context.fillText("Officials not posted.", width / 2, rowAreaY + (rowAreaHeight / 2));
  } else {
    const count = primaryOfficials.length;
    const gap = 12;
    const tileWidth = count === 1
      ? contentWidth
      : (contentWidth - gap * (count - 1)) / count;

    primaryOfficials.forEach((official, index) => {
      const tileX = padding.left + index * (tileWidth + gap);
      const avatarX = tileX + (tileWidth - 170) / 2;
      const avatarY = rowY;
      const image = imageMap.get(official.id);

      drawAvatar(context, image, official, avatarX, avatarY, 170, 20, "landscape");

      let textY = avatarY + 170 + 10;
      drawCenteredText(context, getLandscapeLineOne(official), tileX, textY, tileWidth, {
        size: 23,
        minSize: 15.5,
        family: textFamily,
        weight: 700,
        color: colors.text,
      });
      textY += 23;

      drawCenteredText(context, official.lastUpper, tileX, textY, tileWidth, {
        size: 15,
        minSize: 11,
        family: textFamily,
        weight: 600,
        color: colors.text,
      });
      textY += 15;

      if (official.roleKey === "crewChief") {
        textY += 4;
        drawCenteredText(context, "CREW CHIEF", tileX, textY, tileWidth, {
          size: 10,
          family: textFamily,
          weight: 600,
          color: colors.crewChiefText,
        });
      }
    });
  }

  if (footerText && footerY != null) {
    drawCenteredText(context, footerText, padding.left, footerY, contentWidth, {
      size: 12,
      minSize: 9,
      family: textFamily,
      weight: 600,
      color: colors.text,
    });
  }

  return canvas;
}

async function buildExportCanvas(format, primaryOfficials, alternates, themeMode, gameTimeLocal) {
  const imageMap = await buildLoadedImageMap(primaryOfficials);
  const portraitSpec = EXPORT_SPECS.portrait;
  const landscapeSpec = EXPORT_SPECS.landscape;
  const portraitScale = portraitSpec.outputWidth / portraitSpec.logicalWidth;
  const landscapeScale = landscapeSpec.outputWidth / landscapeSpec.logicalWidth;

  if (format === "portrait") {
    return drawPortraitTemplate(primaryOfficials, alternates, imageMap, themeMode, gameTimeLocal, portraitScale);
  }

  if (format === "landscape") {
    return drawLandscapeTemplate(primaryOfficials, alternates, imageMap, themeMode, gameTimeLocal, landscapeScale);
  }

  const portraitCanvas = drawPortraitTemplate(
    primaryOfficials,
    alternates,
    imageMap,
    themeMode,
    gameTimeLocal,
    portraitScale
  );
  const spec = EXPORT_SPECS.was;
  const colors = getColors(themeMode);
  const { canvas, context } = makeCanvas(spec.outputWidth, spec.outputHeight, "#ffffff");
  context.fillStyle = colors.background;
  context.fillRect(spec.boxX, spec.boxY, spec.boxWidth, spec.boxHeight);
  drawContain(context, portraitCanvas, spec.boxX, spec.boxY, spec.boxWidth, spec.boxHeight);
  return canvas;
}

function VisibleOfficialTile({ official }) {
  return (
    <div className={styles.officialTile}>
      <div className={styles.avatarFrame}>
        {official.headshotUrl ? (
          <img
            className={styles.avatarImage}
            src={official.headshotUrl}
            alt={official.fullName}
            style={official.fullName === "Eric Lewis" ? { transform: "translateY(4px) scale(1.08)" } : undefined}
          />
        ) : (
          <div className={styles.avatarFallback}>{getInitials(official.fullName)}</div>
        )}
      </div>
      <div className={styles.nameText}>{getVisibleNameText(official)}</div>
      {official.roleKey === "crewChief" ? <div className={styles.roleText}>Crew Chief</div> : null}
    </div>
  );
}

function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

export default function OfficialsExportPanel({ officials, gameId, publishedOrder, gameTimeLocal = "" }) {
  const { primary, alternates } = useMemo(
    () => buildOfficialsData(officials, publishedOrder),
    [officials, publishedOrder]
  );
  const [busyFormat, setBusyFormat] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const handleExport = async (format) => {
    if (busyFormat) return;
    setBusyFormat(format);

    try {
      await ensureExportFonts();
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const canvas = await buildExportCanvas(format, primary, alternates, getThemeMode(), gameTimeLocal);
      downloadCanvas(canvas, `officials-${gameId || "game"}-${format}.png`);
      setExportOpen(false);
    } catch (error) {
      console.error("Failed to export officials graphic.", error);
    } finally {
      setBusyFormat("");
    }
  };

  return (
    <section className={styles.container} aria-label="Tonight's officials">
      <div className={styles.contentColumn}>
        {primary.length ? (
          <div className={styles.officialsShell}>
            <div className={styles.officialsRow}>
            {primary.map((official) => (
              <VisibleOfficialTile key={official.id} official={official} />
            ))}
            </div>
            <div className={styles.downloadWrap}>
              <button
                type="button"
                className={styles.downloadButton}
                onClick={() => setExportOpen((current) => !current)}
                aria-label="Open referee export formats"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.downloadIcon}>
                  <path
                    d="M12 3v10m0 0 4-4m-4 4-4-4M5 16v3h14v-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {exportOpen ? (
                <div className={styles.exportMenu}>
                  {["portrait", "landscape", "was"].map((format) => {
                    const busy = busyFormat === format;
                    return (
                      <button
                        key={format}
                        type="button"
                        className={styles.exportButton}
                        onClick={() => handleExport(format)}
                        disabled={Boolean(busyFormat)}
                      >
                        {busy ? <Spinner /> : EXPORT_SPECS[format].label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>Officials not posted.</div>
        )}
        {alternates.length ? (
          <div className={styles.footer}>{`Alternate: ${alternates.join(", ")}`}</div>
        ) : null}
      </div>
    </section>
  );
}
