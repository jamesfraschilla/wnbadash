import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAuth } from "../auth/useAuth.js";
import {
  broadcastRefereeHeadshotChange,
  buildUploadedRefereeImageId,
  buildRefereeHeadshotGroups,
  buildRefereeHeadshotImageItems,
  buildRefereeHeadshotTransform,
  choosePreferredRefereeHeadshot,
  DEFAULT_REFEREE_HEADSHOT_OVERRIDES,
  DEFAULT_REFEREE_HEADSHOT_PREFERENCES,
  getAssignedRefereeName,
  getAssignedRefereeNameKey,
  normalizeNameKey,
  REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY,
  REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY,
  loadRemoteRefereeHeadshotState,
  saveRemoteRefereeHeadshotState,
  sanitizeRefereeHeadshotPreferences,
  sanitizeRefereeHeadshotOverrides,
  serializeRefereeHeadshotPreferences,
  serializeRefereeHeadshotOverrides,
  writeStoredRefereeHeadshotState,
} from "../refereeHeadshots.js";
import styles from "./RefereeHeadshotsPreview.module.css";

const DUPLICATE_FILE_NAMES = new Set([
  "Agon Abazi.jpg",
  "Marcy Williams.jpg",
  "Tyler Mirkovich.jpg",
]);

function readInitialOverrides() {
  if (typeof window === "undefined") return DEFAULT_REFEREE_HEADSHOT_OVERRIDES;
  try {
    const raw = window.localStorage.getItem(REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY);
    if (!raw) return DEFAULT_REFEREE_HEADSHOT_OVERRIDES;
    return {
      ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES,
      ...sanitizeRefereeHeadshotOverrides(JSON.parse(raw)),
    };
  } catch {
    return DEFAULT_REFEREE_HEADSHOT_OVERRIDES;
  }
}

function readInitialPreferences() {
  if (typeof window === "undefined") return DEFAULT_REFEREE_HEADSHOT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_REFEREE_HEADSHOT_PREFERENCES;
    return sanitizeRefereeHeadshotPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_REFEREE_HEADSHOT_PREFERENCES;
  }
}

function buildOverrideDraft(overrides, key) {
  const current = overrides?.[key] || {};
  return {
    scale: Number.isFinite(current.scale) ? current.scale : 1,
    offsetX: Number.isFinite(current.offsetX) ? current.offsetX : 0,
    offsetY: Number.isFinite(current.offsetY) ? current.offsetY : 0,
    scaleX: Number.isFinite(current.scaleX) ? current.scaleX : 1,
    scaleY: Number.isFinite(current.scaleY) ? current.scaleY : 1,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadImageFileAsDataUrl(file) {
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Unable to decode image file."));
    nextImage.src = rawDataUrl;
  });

  const maxEdge = 1400;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export default function RefereeHeadshotsPreview({ embedded = false }) {
  const { user } = useAuth();
  const [overrides, setOverrides] = useState(readInitialOverrides);
  const [preferences, setPreferences] = useState(readInitialPreferences);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState("");
  const [showOnlyEdited, setShowOnlyEdited] = useState(false);
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef(null);

  const allItems = useMemo(buildRefereeHeadshotImageItems, []);
  const savedOverridesSignatureRef = useRef(serializeRefereeHeadshotOverrides(readInitialOverrides()));
  const savedPreferencesSignatureRef = useRef(serializeRefereeHeadshotPreferences(readInitialPreferences()));

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allItems
      .filter((item) => {
        if (showOnlyDuplicates && !item.isDuplicate) return false;
        if (showOnlyEdited && !overrides[item.nameKey]) return false;
        if (!showHidden && preferences.hiddenImageIds.includes(item.id)) return false;
        if (!query) return true;
        const assignedName = getAssignedRefereeName(item, preferences).toLowerCase();
        return assignedName.includes(query) || item.fullName.toLowerCase().includes(query) || item.fileName.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const assignedA = getAssignedRefereeName(a, preferences);
        const assignedB = getAssignedRefereeName(b, preferences);
        const assignedCompare = assignedA.localeCompare(assignedB);
        if (assignedCompare !== 0) return assignedCompare;
        const duplicateCompare = Number(a.isDuplicate) - Number(b.isDuplicate);
        if (duplicateCompare !== 0) return duplicateCompare;
        return a.fileName.localeCompare(b.fileName);
      });
  }, [allItems, overrides, preferences.hiddenImageIds, search, showHidden, showOnlyDuplicates, showOnlyEdited]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId("");
      return;
    }
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0].id);
    }
  }, [filteredItems, selectedId]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) || allItems[0] || null;
  const selectedKey = selectedItem?.nameKey || "";
  const selectedDraft = buildOverrideDraft(overrides, selectedKey);
  const editedCount = Object.keys(sanitizeRefereeHeadshotOverrides(overrides)).length;
  const selectedAssignedName = selectedItem ? getAssignedRefereeName(selectedItem, preferences) : "";
  const selectedAssignedNameKey = selectedItem ? getAssignedRefereeNameKey(selectedItem, preferences) : "";
  const groups = useMemo(() => buildRefereeHeadshotGroups(allItems, preferences), [allItems, preferences]);
  const selectedGroup = selectedAssignedNameKey ? groups.get(selectedAssignedNameKey) || null : null;
  const selectedPreferredItem = selectedGroup
    ? choosePreferredRefereeHeadshot(selectedGroup.items, selectedAssignedNameKey, preferences)
    : null;
  const selectedIsHidden = selectedItem ? preferences.hiddenImageIds.includes(selectedItem.id) : false;
  const selectedUploadedImage = selectedAssignedNameKey
    ? preferences.uploadedImagesByNameKey?.[selectedAssignedNameKey] || null
    : null;
  const selectedUploadedImageId = selectedAssignedNameKey ? buildUploadedRefereeImageId(selectedAssignedNameKey) : "";
  const selectedUsesUploadedImage = selectedPreferredItem?.id === selectedUploadedImageId;
  const currentOverridesSignature = useMemo(() => serializeRefereeHeadshotOverrides(overrides), [overrides]);
  const currentPreferencesSignature = useMemo(() => serializeRefereeHeadshotPreferences(preferences), [preferences]);
  const hasUnsavedChanges =
    currentOverridesSignature !== savedOverridesSignatureRef.current
    || currentPreferencesSignature !== savedPreferencesSignatureRef.current;

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) return undefined;
    loadRemoteRefereeHeadshotState(user.id)
      .then((remoteState) => {
        if (cancelled || !remoteState) return;
        setOverrides(remoteState.overrides);
        setPreferences(remoteState.preferences);
        savedOverridesSignatureRef.current = serializeRefereeHeadshotOverrides(remoteState.overrides);
        savedPreferencesSignatureRef.current = serializeRefereeHeadshotPreferences(remoteState.preferences);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Auto-save to localStorage and broadcast changes when overrides change
  useEffect(() => {
    const serialized = JSON.stringify(sanitizeRefereeHeadshotOverrides(overrides));
    window.localStorage.setItem(REFEREE_HEADSHOT_OVERRIDE_STORAGE_KEY, serialized);
    broadcastRefereeHeadshotChange();
  }, [overrides]);

  // Auto-save to localStorage and broadcast changes when preferences change
  useEffect(() => {
    const serialized = JSON.stringify(sanitizeRefereeHeadshotPreferences(preferences));
    window.localStorage.setItem(REFEREE_HEADSHOT_PREFERENCES_STORAGE_KEY, serialized);
    broadcastRefereeHeadshotChange();
  }, [preferences]);

  useEffect(() => {
    setAssignmentDraft(selectedAssignedName);
  }, [selectedAssignedName, selectedId]);

  const updateSelectedOverride = (field, rawValue) => {
    if (!selectedKey) return;
    const nextValue = (() => {
      const baseFallback = field.startsWith("offset") ? 0 : 1;
      const parsed = parseNumber(rawValue, baseFallback);
      if (field === "scale") return clamp(parsed, 0.6, 1.8);
      if (field === "scaleX" || field === "scaleY") return clamp(parsed, 0.7, 1.3);
      return clamp(parsed, -120, 120);
    })();

    setOverrides((current) => ({
      ...current,
      [selectedKey]: {
        ...current[selectedKey],
        [field]: nextValue,
      },
    }));
  };

  const resetSelected = () => {
    if (!selectedKey) return;
    setOverrides((current) => {
      const next = { ...current };
      if (DEFAULT_REFEREE_HEADSHOT_OVERRIDES[selectedKey]) {
        next[selectedKey] = { ...DEFAULT_REFEREE_HEADSHOT_OVERRIDES[selectedKey] };
      } else {
        delete next[selectedKey];
      }
      return next;
    });
  };

  const resetAll = () => {
    setOverrides(DEFAULT_REFEREE_HEADSHOT_OVERRIDES);
  };

  const updateAssignment = () => {
    if (!selectedItem) return;
    const nextAlias = String(assignmentDraft || "").trim();
    setPreferences((current) => {
      const next = {
        ...current,
        aliasesByImageId: { ...(current.aliasesByImageId || {}) },
      };
      if (nextAlias && normalizeNameKey(nextAlias) !== selectedItem.nameKey) {
        next.aliasesByImageId[selectedItem.id] = nextAlias;
      } else {
        delete next.aliasesByImageId[selectedItem.id];
      }
      return sanitizeRefereeHeadshotPreferences(next);
    });
  };

  const toggleHidden = () => {
    if (!selectedItem) return;
    setPreferences((current) => {
      const hiddenSet = new Set(current.hiddenImageIds || []);
      if (hiddenSet.has(selectedItem.id)) hiddenSet.delete(selectedItem.id);
      else hiddenSet.add(selectedItem.id);
      return sanitizeRefereeHeadshotPreferences({
        ...current,
        hiddenImageIds: Array.from(hiddenSet),
      });
    });
  };

  const chooseSelectedPhoto = () => {
    if (!selectedItem) return;
    const nameKey = getAssignedRefereeNameKey(selectedItem, preferences);
    if (!nameKey) return;
    setPreferences((current) => sanitizeRefereeHeadshotPreferences({
      ...current,
      preferredImageIdsByNameKey: {
        ...(current.preferredImageIdsByNameKey || {}),
        [nameKey]: selectedItem.id,
      },
    }));
  };

  const handleCopyOverrides = async () => {
    const payload = serializeRefereeHeadshotOverrides(overrides);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyMessage("Copied overrides JSON.");
    } catch {
      setCopyMessage("Clipboard copy failed.");
    }
  };

  const handleCopyPreferences = async () => {
    const payload = serializeRefereeHeadshotPreferences(preferences);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyMessage("Copied image preferences JSON.");
    } catch {
      setCopyMessage("Clipboard copy failed.");
    }
  };

  useEffect(() => {
    if (!copyMessage) return undefined;
    const timeoutId = window.setTimeout(() => setCopyMessage(""), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copyMessage]);

  useEffect(() => {
    if (!saveMessage) return undefined;
    const timeoutId = window.setTimeout(() => setSaveMessage(""), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [saveMessage]);

  useEffect(() => {
    if (!uploadMessage) return undefined;
    const timeoutId = window.setTimeout(() => setUploadMessage(""), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [uploadMessage]);

  const handleSaveChanges = async () => {
    const nextOverridesSignature = serializeRefereeHeadshotOverrides(overrides);
    const nextPreferencesSignature = serializeRefereeHeadshotPreferences(preferences);
    try {
      writeStoredRefereeHeadshotState(overrides, preferences);
      if (user?.id) {
        await saveRemoteRefereeHeadshotState(user.id, { overrides, preferences });
      }
      savedOverridesSignatureRef.current = nextOverridesSignature;
      savedPreferencesSignatureRef.current = nextPreferencesSignature;
      broadcastRefereeHeadshotChange();
      setSaveMessage("Saved changes.");
    } catch (error) {
      setSaveMessage(error?.message || "Unable to save changes.");
    }
  };

  const handleUploadButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedAssignedNameKey) return;
    try {
      const dataUrl = await loadImageFileAsDataUrl(file);
      setPreferences((current) => sanitizeRefereeHeadshotPreferences({
        ...current,
        uploadedImagesByNameKey: {
          ...(current.uploadedImagesByNameKey || {}),
          [selectedAssignedNameKey]: {
            fileName: file.name,
            dataUrl,
          },
        },
      }));
      setUploadMessage("Replacement image saved.");
    } catch (error) {
      setUploadMessage(error?.message || "Upload failed.");
    } finally {
      event.target.value = "";
    }
  };

  const removeUploadedReplacement = () => {
    if (!selectedAssignedNameKey) return;
    setPreferences((current) => {
      const nextUploads = { ...(current.uploadedImagesByNameKey || {}) };
      const nextPreferred = { ...(current.preferredImageIdsByNameKey || {}) };
      delete nextUploads[selectedAssignedNameKey];
      if (nextPreferred[selectedAssignedNameKey] === buildUploadedRefereeImageId(selectedAssignedNameKey)) {
        delete nextPreferred[selectedAssignedNameKey];
      }
      return sanitizeRefereeHeadshotPreferences({
        ...current,
        preferredImageIdsByNameKey: nextPreferred,
        uploadedImagesByNameKey: nextUploads,
      });
    });
    setUploadMessage("Uploaded replacement removed.");
  };

  const chooseUploadedPhoto = () => {
    if (!selectedAssignedNameKey || !selectedUploadedImageId) return;
    setPreferences((current) => sanitizeRefereeHeadshotPreferences({
      ...current,
      preferredImageIdsByNameKey: {
        ...(current.preferredImageIdsByNameKey || {}),
        [selectedAssignedNameKey]: selectedUploadedImageId,
      },
    }));
  };

  return (
    <div className={styles.page}>
      {!embedded ? (
        <div className={styles.hero}>
          <div>
            <h1 className={styles.title}>Referee Headshot Crop Tool</h1>
            <p className={styles.subtitle}>
              This page includes all current referee assets plus duplicate review files.
              Adjustments apply everywhere after you save changes.
            </p>
          </div>
          <div className={styles.summary}>
            <span>{allItems.length} total headshots</span>
            <span>{editedCount} edited override entries</span>
            <span>{DUPLICATE_FILE_NAMES.size} duplicate review names</span>
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleUploadFile}
        />
        <input
          className={styles.search}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search headshots"
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showOnlyEdited}
            onChange={(event) => setShowOnlyEdited(event.target.checked)}
          />
          <span>Edited only</span>
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showOnlyDuplicates}
            onChange={(event) => setShowOnlyDuplicates(event.target.checked)}
          />
          <span>Duplicate review only</span>
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          <span>Show hidden</span>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={resetAll}>Reset All</button>
        <button type="button" className={styles.secondaryButton} onClick={handleCopyPreferences}>Copy Image Preferences</button>
        <button type="button" className={styles.primaryButton} onClick={handleCopyOverrides}>Copy Overrides JSON</button>
        {copyMessage ? <span className={styles.copyMessage}>{copyMessage}</span> : null}
        <button type="button" className={styles.primaryButton} onClick={handleSaveChanges} disabled={!hasUnsavedChanges}>
          Save Changes
        </button>
        {saveMessage ? <span className={styles.copyMessage}>{saveMessage}</span> : null}
      </div>

      <div className={styles.workspace}>
        <aside className={styles.controls}>
          {selectedItem ? (
            <>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>{selectedItem.fullName}</div>
                <div className={styles.badges}>
                  <span className={styles.badge}>{selectedItem.source}</span>
                  {DUPLICATE_FILE_NAMES.has(selectedItem.fileName) ? <span className={styles.badgeWarn}>duplicate name</span> : null}
                  {selectedPreferredItem?.id === selectedItem.id ? <span className={styles.badgeEdited}>chosen</span> : null}
                  {selectedIsHidden ? <span className={styles.badgeWarn}>hidden</span> : null}
                </div>
              </div>

              <div className={styles.selectedPreview}>
                <div className={styles.selectedCropFrame}>
                  <img
                    src={selectedUsesUploadedImage && selectedUploadedImage ? selectedUploadedImage.dataUrl : selectedItem.url}
                    alt={selectedItem.fullName}
                    className={styles.cropImage}
                    style={{ transform: buildRefereeHeadshotTransform(selectedDraft, 200) }}
                  />
                </div>
                <div className={styles.previewLabel}>{selectedAssignedName || selectedItem.fullName}</div>
              </div>

              <div className={styles.controlList}>
                <label className={styles.assignmentField}>
                  <span>Referee group</span>
                  <input
                    type="text"
                    value={assignmentDraft}
                    onChange={(event) => setAssignmentDraft(event.target.value)}
                    onBlur={updateAssignment}
                    placeholder="Assign to referee name"
                  />
                </label>

                <label className={styles.control}>
                  <span>Scale</span>
                  <input
                    type="range"
                    min="0.6"
                    max="1.8"
                    step="0.01"
                    value={selectedDraft.scale}
                    onChange={(event) => updateSelectedOverride("scale", event.target.value)}
                  />
                  <input
                    type="number"
                    min="0.6"
                    max="1.8"
                    step="0.01"
                    value={selectedDraft.scale}
                    onChange={(event) => updateSelectedOverride("scale", event.target.value)}
                  />
                </label>

                <label className={styles.control}>
                  <span>Offset X</span>
                  <input
                    type="range"
                    min="-120"
                    max="120"
                    step="1"
                    value={selectedDraft.offsetX}
                    onChange={(event) => updateSelectedOverride("offsetX", event.target.value)}
                  />
                  <input
                    type="number"
                    min="-120"
                    max="120"
                    step="1"
                    value={selectedDraft.offsetX}
                    onChange={(event) => updateSelectedOverride("offsetX", event.target.value)}
                  />
                </label>

                <label className={styles.control}>
                  <span>Offset Y</span>
                  <input
                    type="range"
                    min="-120"
                    max="120"
                    step="1"
                    value={selectedDraft.offsetY}
                    onChange={(event) => updateSelectedOverride("offsetY", event.target.value)}
                  />
                  <input
                    type="number"
                    min="-120"
                    max="120"
                    step="1"
                    value={selectedDraft.offsetY}
                    onChange={(event) => updateSelectedOverride("offsetY", event.target.value)}
                  />
                </label>

                <label className={styles.control}>
                  <span>Scale X</span>
                  <input
                    type="range"
                    min="0.7"
                    max="1.3"
                    step="0.01"
                    value={selectedDraft.scaleX}
                    onChange={(event) => updateSelectedOverride("scaleX", event.target.value)}
                  />
                  <input
                    type="number"
                    min="0.7"
                    max="1.3"
                    step="0.01"
                    value={selectedDraft.scaleX}
                    onChange={(event) => updateSelectedOverride("scaleX", event.target.value)}
                  />
                </label>

                <label className={styles.control}>
                  <span>Scale Y</span>
                  <input
                    type="range"
                    min="0.7"
                    max="1.3"
                    step="0.01"
                    value={selectedDraft.scaleY}
                    onChange={(event) => updateSelectedOverride("scaleY", event.target.value)}
                  />
                  <input
                    type="number"
                    min="0.7"
                    max="1.3"
                    step="0.01"
                    value={selectedDraft.scaleY}
                    onChange={(event) => updateSelectedOverride("scaleY", event.target.value)}
                  />
                </label>
              </div>

              <div className={styles.panelActions}>
                <button type="button" className={styles.secondaryButton} onClick={handleUploadButtonClick}>
                  Upload Replacement
                </button>
                {selectedUploadedImage ? (
                  <button type="button" className={styles.secondaryButton} onClick={removeUploadedReplacement}>
                    Remove Upload
                  </button>
                ) : null}
                {selectedUploadedImage ? (
                  <button type="button" className={styles.secondaryButton} onClick={chooseUploadedPhoto}>
                    Use Uploaded Photo
                  </button>
                ) : null}
                <button type="button" className={styles.secondaryButton} onClick={chooseSelectedPhoto}>
                  Use This Photo
                </button>
                <button type="button" className={styles.secondaryButton} onClick={toggleHidden}>
                  {selectedIsHidden ? "Restore Photo" : "Hide Photo"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={resetSelected}>Reset Selected</button>
              </div>
              {uploadMessage ? <div className={styles.uploadMessage}>{uploadMessage}</div> : null}

              {selectedGroup ? (
                <div className={styles.groupPanel}>
                  <div className={styles.groupTitle}>
                    Matched Photos for {selectedGroup.displayName} ({selectedGroup.items.length})
                  </div>
                  <div className={styles.groupList}>
                    {selectedUploadedImage ? (
                      <button
                        type="button"
                        className={styles.groupItem}
                        onClick={chooseUploadedPhoto}
                      >
                        <img src={selectedUploadedImage.dataUrl} alt={selectedUploadedImage.fileName} className={styles.groupThumb} />
                        <div className={styles.groupMeta}>
                          <span>{selectedUploadedImage.fileName}</span>
                          <span>uploaded replacement</span>
                          {selectedUsesUploadedImage ? <span>chosen</span> : null}
                        </div>
                      </button>
                    ) : null}
                    {selectedGroup.items.map((item) => {
                      const isPreferred = selectedPreferredItem?.id === item.id;
                      const isHidden = preferences.hiddenImageIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`${styles.groupItem} ${item.id === selectedItem.id ? styles.groupItemSelected : ""}`.trim()}
                          onClick={() => setSelectedId(item.id)}
                        >
                          <img src={item.url} alt={item.fullName} className={styles.groupThumb} />
                          <div className={styles.groupMeta}>
                            <span>{item.fileName}</span>
                            <span>{item.source}</span>
                            {isPreferred ? <span>chosen</span> : null}
                            {isHidden ? <span>hidden</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyPanel}>No headshots match the current filter.</div>
          )}
        </aside>

        <div className={styles.grid}>
          {filteredItems.map((item) => {
            const draft = buildOverrideDraft(overrides, item.nameKey);
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.card} ${item.id === selectedId ? styles.cardSelected : ""}`.trim()}
                onClick={() => setSelectedId(item.id)}
              >
                <div className={styles.cropFrame}>
                  <img
                    src={item.url}
                    alt={item.fullName}
                    className={styles.cropImage}
                    style={{ transform: buildRefereeHeadshotTransform(draft) }}
                  />
                </div>
                <div className={styles.meta}>
                  <div className={styles.name}>{item.fullName}</div>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{item.source}</span>
                    {overrides[item.nameKey] ? <span className={styles.badgeEdited}>edited</span> : null}
                    {DUPLICATE_FILE_NAMES.has(item.fileName) ? <span className={styles.badgeWarn}>duplicate name</span> : null}
                    {preferences.hiddenImageIds.includes(item.id) ? <span className={styles.badgeWarn}>hidden</span> : null}
                    {(() => {
                      const nameKey = getAssignedRefereeNameKey(item, preferences);
                      const group = groups.get(nameKey);
                      const preferred = group ? choosePreferredRefereeHeadshot(group.items, nameKey, preferences) : null;
                      return preferred?.id === item.id ? <span className={styles.badgeEdited}>chosen</span> : null;
                    })()}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
