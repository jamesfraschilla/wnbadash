import { getSavedToolRecordRemote, saveToolRecordRemote } from "./toolVault.js";

export const REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY = "referee_headshot_overrides_v1";
export const REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY = "referee_headshot_preferences_v1";
export const REFEREE_HEADSHOT_EDITOR_REFERENCE_SIZE = 308;
export const REFEREE_HEADSHOT_CHANGE_EVENT = "referee-headshots-updated";
export const REFEREE_HEADSHOT_REMOTE_RECORD_ID = "shared-referee-headshots";
export const REFEREE_HEADSHOT_REMOTE_RECORD_TYPE = "referee_headshots";

export const DEFAULT_REFEREE_HEADSHOT_OVERRIDES = {
  ericlewis: {
    scale: 1.08,
    offsetX: 0,
    offsetY: 4,
    scaleX: 1,
    scaleY: 1,
    exportScale: 1.12,
    exportOffsetYPortrait: 6,
    exportOffsetYLandscape: 8.5,
  },
};

export const DEFAULT_REFEREE_HEADSHOT_PREFERENCES = {
  aliasesByImageId: {},
  alternateNamesByNameKey: {},
  manualRefereesByNameKey: {},
  preferredImageIdsByNameKey: {},
  hiddenImageIds: [],
  uploadedImagesByNameKey: {},
};

export function buildUploadedRefereeImageId(nameKey) {
  const normalizedKey = normalizeNameKey(nameKey);
  return normalizedKey ? `uploaded:${normalizedKey}` : "";
}

export function buildManualRefereeItemId(nameKey) {
  const normalizedKey = normalizeNameKey(nameKey);
  return normalizedKey ? `manual:${normalizedKey}` : "";
}

const IMAGE_MODULES = import.meta.glob(
  [
    "./assets/referees/*.jpg",
    "./assets/referees/*.jpeg",
    "./assets/referees/*.JPG",
    "./assets/referees/*.JPEG",
    "./assets/referees_review_duplicates/*.jpg",
    "./assets/referees_review_duplicates/*.jpeg",
    "./assets/referees_review_duplicates/*.JPG",
    "./assets/referees_review_duplicates/*.JPEG",
  ],
  { eager: true, import: "default" }
);

export function normalizeNameKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

export function sanitizeRefereeHeadshotOverrides(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    return {};
  }

  const next = {};
  Object.entries(rawOverrides).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const normalizedKey = normalizeNameKey(key);
    if (!normalizedKey) return;
    const normalized = {};
    [
      "scale",
      "offsetX",
      "offsetY",
      "scaleX",
      "scaleY",
      "exportScale",
      "exportOffsetYPortrait",
      "exportOffsetYLandscape",
    ].forEach((field) => {
      const parsed = Number(value[field]);
      if (Number.isFinite(parsed)) {
        normalized[field] = parsed;
      }
    });
    if (Object.keys(normalized).length) {
      next[normalizedKey] = normalized;
    }
  });

  return next;
}

export function serializeRefereeHeadshotOverrides(overrides) {
  return JSON.stringify(sanitizeRefereeHeadshotOverrides(overrides), null, 2);
}

export function sanitizeRefereeHeadshotPreferences(rawPreferences) {
  if (!rawPreferences || typeof rawPreferences !== "object" || Array.isArray(rawPreferences)) {
    return { ...DEFAULT_REFEREE_HEADSHOT_PREFERENCES };
  }

  const aliasesByImageId = {};
  Object.entries(rawPreferences.aliasesByImageId || {}).forEach(([imageId, alias]) => {
    const normalizedId = String(imageId || "").trim();
    const normalizedAlias = String(alias || "").trim();
    if (normalizedId && normalizedAlias) {
      aliasesByImageId[normalizedId] = normalizedAlias;
    }
  });

  const alternateNamesByNameKey = {};
  Object.entries(rawPreferences.alternateNamesByNameKey || {}).forEach(([nameKey, value]) => {
    const normalizedKey = normalizeNameKey(nameKey);
    if (!normalizedKey) return;
    const alternateNames = Array.from(
      new Set(
        (Array.isArray(value) ? value : [value])
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
          .filter((entry) => normalizeNameKey(entry) !== normalizedKey)
      )
    );
    if (alternateNames.length) {
      alternateNamesByNameKey[normalizedKey] = alternateNames;
    }
  });

  const manualRefereesByNameKey = {};
  Object.entries(rawPreferences.manualRefereesByNameKey || {}).forEach(([nameKey, displayName]) => {
    const normalizedKey = normalizeNameKey(nameKey);
    const normalizedDisplayName = String(displayName || "").trim();
    if (normalizedKey && normalizedDisplayName) {
      manualRefereesByNameKey[normalizedKey] = normalizedDisplayName;
    }
  });

  const preferredImageIdsByNameKey = {};
  Object.entries(rawPreferences.preferredImageIdsByNameKey || {}).forEach(([nameKey, imageId]) => {
    const normalizedKey = normalizeNameKey(nameKey);
    const normalizedId = String(imageId || "").trim();
    if (normalizedKey && normalizedId) {
      preferredImageIdsByNameKey[normalizedKey] = normalizedId;
    }
  });

  const hiddenImageIds = Array.from(
    new Set(
      (Array.isArray(rawPreferences.hiddenImageIds) ? rawPreferences.hiddenImageIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const uploadedImagesByNameKey = {};
  Object.entries(rawPreferences.uploadedImagesByNameKey || {}).forEach(([nameKey, record]) => {
    const normalizedKey = normalizeNameKey(nameKey);
    const fileName = String(record?.fileName || "").trim();
    const dataUrl = String(record?.dataUrl || "").trim();
    if (normalizedKey && dataUrl) {
      uploadedImagesByNameKey[normalizedKey] = {
        fileName: fileName || `${normalizedKey}.jpg`,
        dataUrl,
      };
    }
  });

  return {
    aliasesByImageId,
    alternateNamesByNameKey,
    manualRefereesByNameKey,
    preferredImageIdsByNameKey,
    hiddenImageIds,
    uploadedImagesByNameKey,
  };
}

export function serializeRefereeHeadshotPreferences(preferences) {
  return JSON.stringify(sanitizeRefereeHeadshotPreferences(preferences), null, 2);
}

export function readStoredRefereeHeadshotPreferences() {
  if (typeof window === "undefined") return { ...DEFAULT_REFEREE_HEADSHOT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REFEREE_HEADSHOT_PREFERENCES };
    return sanitizeRefereeHeadshotPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REFEREE_HEADSHOT_PREFERENCES };
  }
}

export function readStoredRefereeHeadshotOverrides() {
  if (typeof window === "undefined") return { ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES };
  try {
    const raw = window.localStorage.getItem(REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES };
    return {
      ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES,
      ...sanitizeRefereeHeadshotOverrides(JSON.parse(raw)),
    };
  } catch {
    return { ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES };
  }
}

export function writeStoredRefereeHeadshotState(overrides, preferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY,
    serializeRefereeHeadshotOverrides(overrides)
  );
  window.localStorage.setItem(
    REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY,
    serializeRefereeHeadshotPreferences(preferences)
  );
}

export function readStoredRefereeHeadshotState() {
  return {
    overrides: readStoredRefereeHeadshotOverrides(),
    preferences: readStoredRefereeHeadshotPreferences(),
  };
}

export async function loadRemoteRefereeHeadshotState(userId) {
  if (!userId) return null;
  const record = await getSavedToolRecordRemote(userId, REFEREE_HEADSHOT_REMOTE_RECORD_ID);
  if (!record?.payload || typeof record.payload !== "object") return null;
  return {
    overrides: {
      ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES,
      ...sanitizeRefereeHeadshotOverrides(record.payload.overrides),
    },
    preferences: sanitizeRefereeHeadshotPreferences(record.payload.preferences),
  };
}

export async function saveRemoteRefereeHeadshotState(userId, { overrides, preferences }) {
  if (!userId) return null;
  return saveToolRecordRemote(userId, {
    id: REFEREE_HEADSHOT_REMOTE_RECORD_ID,
    type: REFEREE_HEADSHOT_REMOTE_RECORD_TYPE,
    title: "Referee Headshots",
    payload: {
      overrides: sanitizeRefereeHeadshotOverrides(overrides),
      preferences: sanitizeRefereeHeadshotPreferences(preferences),
    },
    updatedAt: new Date().toISOString(),
  });
}

export async function syncRemoteRefereeHeadshotState(userId) {
  const remoteState = await loadRemoteRefereeHeadshotState(userId);
  if (!remoteState) return null;
  writeStoredRefereeHeadshotState(remoteState.overrides, remoteState.preferences);
  broadcastRefereeHeadshotChange();
  return remoteState;
}

export function scaleRefereeOffset(value, targetSize, referenceSize = REFEREE_HEADSHOT_EDITOR_REFERENCE_SIZE) {
  const numericValue = Number(value);
  const numericTarget = Number(targetSize);
  if (!Number.isFinite(numericValue)) return 0;
  if (!Number.isFinite(numericTarget) || numericTarget <= 0) return numericValue;
  return numericValue * (numericTarget / referenceSize);
}

export function buildRefereeHeadshotTransform(override, targetSize = REFEREE_HEADSHOT_EDITOR_REFERENCE_SIZE) {
  const safe = {
    scale: Number.isFinite(override?.scale) ? override.scale : 1,
    offsetX: scaleRefereeOffset(override?.offsetX, targetSize),
    offsetY: scaleRefereeOffset(override?.offsetY, targetSize),
    scaleX: Number.isFinite(override?.scaleX) ? override.scaleX : 1,
    scaleY: Number.isFinite(override?.scaleY) ? override.scaleY : 1,
  };
  return `translate(${safe.offsetX}px, ${safe.offsetY}px) scale(${safe.scale * safe.scaleX}, ${safe.scale * safe.scaleY})`;
}

export function getRefereeHeadshotOverride(fullName, overrides = null, preferences = null) {
  const effectiveOverrides = overrides || readStoredRefereeHeadshotOverrides();
  const key = resolveRefereeHeadshotOverrideKey(fullName, effectiveOverrides, preferences);
  const raw = effectiveOverrides?.[key];
  if (!raw || typeof raw !== "object") return null;
  return {
    scale: Number.isFinite(raw.scale) ? raw.scale : 1,
    offsetX: Number.isFinite(raw.offsetX) ? raw.offsetX : 0,
    offsetY: Number.isFinite(raw.offsetY) ? raw.offsetY : 0,
    scaleX: Number.isFinite(raw.scaleX) ? raw.scaleX : 1,
    scaleY: Number.isFinite(raw.scaleY) ? raw.scaleY : 1,
    exportScale: Number.isFinite(raw.exportScale) ? raw.exportScale : null,
    exportOffsetYPortrait: Number.isFinite(raw.exportOffsetYPortrait) ? raw.exportOffsetYPortrait : null,
    exportOffsetYLandscape: Number.isFinite(raw.exportOffsetYLandscape) ? raw.exportOffsetYLandscape : null,
  };
}

export function buildCanvasAvatarPlacement({
  sourceWidth,
  sourceHeight,
  targetX,
  targetY,
  targetSize,
  override,
  variant,
}) {
  const safeWidth = Math.max(1, Number(sourceWidth) || 1);
  const safeHeight = Math.max(1, Number(sourceHeight) || 1);
  const coverScale = Math.max(targetSize / safeWidth, targetSize / safeHeight);
  const baseScale = Number.isFinite(override?.exportScale)
    ? override.exportScale
    : (Number.isFinite(override?.scale) ? override.scale : 1);
  const scaleX = baseScale * (Number.isFinite(override?.scaleX) ? override.scaleX : 1);
  const scaleY = baseScale * (Number.isFinite(override?.scaleY) ? override.scaleY : 1);
  const offsetX = scaleRefereeOffset(override?.offsetX, targetSize);
  let offsetY = scaleRefereeOffset(override?.offsetY, targetSize);

  if (variant === "portrait" && Number.isFinite(override?.exportOffsetYPortrait)) {
    offsetY = override.exportOffsetYPortrait;
  } else if (variant === "landscape" && Number.isFinite(override?.exportOffsetYLandscape)) {
    offsetY = override.exportOffsetYLandscape;
  }

  const drawWidth = safeWidth * coverScale * scaleX;
  const drawHeight = safeHeight * coverScale * scaleY;

  return {
    drawWidth,
    drawHeight,
    drawX: targetX + (targetSize / 2) - (drawWidth / 2) + offsetX,
    drawY: targetY + (targetSize / 2) - ((targetSize * scaleY) / 2) + offsetY,
  };
}

export function buildRefereeHeadshotImageItems(preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const assetItems = Object.entries(IMAGE_MODULES)
    .map(([path, url]) => {
      const fileName = path.split("/").pop() || "";
      const fullName = fileName.replace(/\.(jpe?g)$/i, "");
      const isDuplicate = path.includes("/referees_review_duplicates/");
      return {
        id: path,
        path,
        fileName,
        fullName,
        nameKey: normalizeNameKey(fullName),
        url,
        source: isDuplicate ? "duplicate review" : "production",
        isDuplicate,
      };
    })
    .sort((a, b) => {
      if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? 1 : -1;
      return a.fullName.localeCompare(b.fullName);
    });

  const manualItems = Object.entries(preferences.manualRefereesByNameKey || {})
    .map(([nameKey, displayName]) => {
      const normalizedKey = normalizeNameKey(nameKey);
      const uploaded = preferences.uploadedImagesByNameKey?.[normalizedKey];
      return {
        id: buildManualRefereeItemId(normalizedKey),
        path: "",
        fileName: String(displayName || "").trim(),
        fullName: String(displayName || "").trim(),
        nameKey: normalizedKey,
        url: String(uploaded?.dataUrl || "").trim(),
        source: "manual",
        isDuplicate: false,
        isManual: true,
      };
    })
    .filter((item) => item.nameKey && item.fullName)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return [...assetItems, ...manualItems];
}

export function getAssignedRefereeName(item, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  if (item?.isManual) {
    return String(preferences?.manualRefereesByNameKey?.[item.nameKey] || item?.fullName || "").trim();
  }
  return String(preferences?.aliasesByImageId?.[item?.id] || item?.fullName || "").trim();
}

export function getAssignedRefereeNameKey(item, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  return normalizeNameKey(getAssignedRefereeName(item, preferences));
}

export function getRefereeAlternateNames(nameKey, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const normalizedKey = normalizeNameKey(nameKey);
  if (!normalizedKey) return [];
  return Array.from(
    new Set(
      (Array.isArray(preferences?.alternateNamesByNameKey?.[normalizedKey])
        ? preferences.alternateNamesByNameKey[normalizedKey]
        : []
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .filter((value) => normalizeNameKey(value) !== normalizedKey)
    )
  );
}

export function buildRefereeHeadshotGroups(items, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const groups = new Map();
  items.forEach((item) => {
    const nameKey = getAssignedRefereeNameKey(item, preferences) || item.nameKey;
    const group = groups.get(nameKey) || {
      nameKey,
      displayName: getAssignedRefereeName(item, preferences) || item.fullName,
      items: [],
    };
    group.items.push(item);
    groups.set(nameKey, group);
  });
  return groups;
}

function buildRefereeHeadshotGroupNameKeys(group, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const nameKeys = new Set();
  const addNameKey = (value) => {
    const normalizedKey = normalizeNameKey(value);
    if (normalizedKey) {
      nameKeys.add(normalizedKey);
    }
  };

  addNameKey(group?.nameKey);
  addNameKey(group?.displayName);
  (group?.items || []).forEach((item) => {
    addNameKey(item?.nameKey);
    addNameKey(item?.fullName);
    addNameKey(getAssignedRefereeName(item, preferences));
  });
  getRefereeAlternateNames(group?.nameKey, preferences).forEach(addNameKey);

  return Array.from(nameKeys);
}

function findRefereeHeadshotGroupByNameKey(nameKey, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const normalizedKey = normalizeNameKey(nameKey);
  if (!normalizedKey) return null;
  const groups = buildRefereeHeadshotGroups(buildRefereeHeadshotImageItems(preferences), preferences);
  if (groups.has(normalizedKey)) {
    return groups.get(normalizedKey);
  }
  for (const group of groups.values()) {
    if (buildRefereeHeadshotGroupNameKeys(group, preferences).includes(normalizedKey)) {
      return group;
    }
  }
  return null;
}

export function resolveRefereeHeadshotNameKey(fullName, preferences = null) {
  const effectivePreferences = preferences || readStoredRefereeHeadshotPreferences();
  const normalizedKey = normalizeNameKey(fullName);
  if (!normalizedKey) return "";
  const group = findRefereeHeadshotGroupByNameKey(normalizedKey, effectivePreferences);
  return group?.nameKey || normalizedKey;
}

export function choosePreferredRefereeHeadshot(groupItems, nameKey, preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const uploaded = preferences.uploadedImagesByNameKey?.[nameKey];
  const visibleItems = groupItems.filter((item) => !preferences.hiddenImageIds.includes(item.id));
  const preferredId = preferences.preferredImageIdsByNameKey?.[nameKey];
  if (preferredId === buildUploadedRefereeImageId(nameKey) && uploaded?.dataUrl) {
    return {
      id: preferredId,
      fileName: uploaded.fileName,
      fullName: nameKey,
      nameKey,
      url: uploaded.dataUrl,
      source: "uploaded replacement",
      isDuplicate: false,
      isUploaded: true,
    };
  }
  if (!visibleItems.length) {
    if (uploaded?.dataUrl) {
      return {
        id: buildUploadedRefereeImageId(nameKey),
        fileName: uploaded.fileName,
        fullName: nameKey,
        nameKey,
        url: uploaded.dataUrl,
        source: "uploaded replacement",
        isDuplicate: false,
        isUploaded: true,
      };
    }
    return null;
  }
  const preferred = visibleItems.find((item) => item.id === preferredId);
  if (preferred) return preferred;
  return visibleItems.find((item) => item.source === "production") || visibleItems[0];
}

export function buildRefereeHeadshotLookup(preferences = DEFAULT_REFEREE_HEADSHOT_PREFERENCES) {
  const items = buildRefereeHeadshotImageItems(preferences);
  const groups = buildRefereeHeadshotGroups(items, preferences);
  const lookup = new Map();
  groups.forEach((group, nameKey) => {
    const uploaded = preferences.uploadedImagesByNameKey?.[nameKey];
    const groupNameKeys = buildRefereeHeadshotGroupNameKeys(group, preferences);
    if (uploaded?.dataUrl) {
      groupNameKeys.forEach((groupNameKey) => lookup.set(groupNameKey, uploaded.dataUrl));
      return;
    }
    const preferred = choosePreferredRefereeHeadshot(group.items, nameKey, preferences);
    if (preferred?.url) {
      groupNameKeys.forEach((groupNameKey) => lookup.set(groupNameKey, preferred.url));
    }
  });
  return lookup;
}

export function getRefereeHeadshotUrl(fullName, preferences = null) {
  const effectivePreferences = preferences || readStoredRefereeHeadshotPreferences();
  const lookup = buildRefereeHeadshotLookup(effectivePreferences);
  const resolvedKey = resolveRefereeHeadshotNameKey(fullName, effectivePreferences);
  return lookup.get(resolvedKey) || lookup.get(normalizeNameKey(fullName)) || null;
}

export function resolveRefereeHeadshotOverrideKey(fullName, overrides = null, preferences = null) {
  const effectiveOverrides = overrides || readStoredRefereeHeadshotOverrides();
  const effectivePreferences = preferences || readStoredRefereeHeadshotPreferences();
  const normalizedKey = normalizeNameKey(fullName);
  const resolvedKey = resolveRefereeHeadshotNameKey(fullName, effectivePreferences);
  const candidates = [];

  if (resolvedKey) candidates.push(resolvedKey);
  if (normalizedKey && normalizedKey !== resolvedKey) candidates.push(normalizedKey);

  const group = findRefereeHeadshotGroupByNameKey(resolvedKey || normalizedKey, effectivePreferences);
  (group?.items || []).forEach((item) => {
    const itemKey = normalizeNameKey(item?.nameKey || item?.fullName);
    if (itemKey && !candidates.includes(itemKey)) {
      candidates.push(itemKey);
    }
  });

  return candidates.find((key) => effectiveOverrides?.[key]) || resolvedKey || normalizedKey;
}

export function broadcastRefereeHeadshotChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFEREE_HEADSHOT_CHANGE_EVENT, {
    detail: { updatedAt: Date.now() },
  }));
}
