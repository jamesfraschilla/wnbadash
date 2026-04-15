import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDrawing,
  deleteDrawingRecord,
  listDrawingShares,
  listDrawings,
  updateDrawingRecord,
  updateDrawingShares,
} from "../accountData.js";
import ShareDialog from "../components/ShareDialog.jsx";
import { useAuth } from "../auth/useAuth.js";
import styles from "./Drawing.module.css";

const TOOL_PEN = "pen";
const TOOL_ERASER = "eraser";

const defaultColors = ["#111111", "#1f6feb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed"];

function formatDrawingTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function Drawing() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const strokesRef = useRef([]);
  const canvasSizeRef = useRef({ width: 1, height: 1 });

  const [params] = useSearchParams();
  const [tool, setTool] = useState(TOOL_PEN);
  const [color, setColor] = useState(defaultColors[0]);
  const [size, setSize] = useState(4);
  const [courtMode, setCourtMode] = useState("half");
  const [undoCount, setUndoCount] = useState(0);
  const [selectedDrawingId, setSelectedDrawingId] = useState(null);
  const [boardTitle, setBoardTitle] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [savingBoard, setSavingBoard] = useState(false);
  const [shareDrawing, setShareDrawing] = useState(null);

  const backParam = params.get("back");
  const gameIdParam = params.get("gameId");
  const boardIdParam = params.get("boardId");
  const backUrl = backParam && backParam.startsWith("/") ? backParam : "/";

  const { data: drawings = [] } = useQuery({
    queryKey: ["drawings", gameIdParam || "all"],
    queryFn: () => listDrawings(gameIdParam || null),
    enabled: Boolean(user?.id),
  });

  const { data: shareRecipients = [] } = useQuery({
    queryKey: ["drawing-shares", shareDrawing?.id],
    queryFn: () => listDrawingShares(shareDrawing.id),
    enabled: Boolean(shareDrawing?.id),
  });

  const selectedDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === selectedDrawingId) || null,
    [drawings, selectedDrawingId]
  );
  const canManageSelectedDrawing = Boolean(selectedDrawing && (selectedDrawing.owner_id === user?.id || isAdmin));

  useEffect(() => {
    if (!boardIdParam || !drawings.length) return;
    if (selectedDrawingId === boardIdParam) return;
    const matchingDrawing = drawings.find((drawing) => drawing.id === boardIdParam);
    if (matchingDrawing) {
      loadDrawing(matchingDrawing);
    }
  }, [boardIdParam, drawings, selectedDrawingId]);

  const applyCanvasSize = (canvas, width, height) => {
    const ratio = window.devicePixelRatio || 1;
    canvasSizeRef.current = { width, height };
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return undefined;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      applyCanvasSize(canvas, rect.width, rect.height);
      redrawAll();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => observer.disconnect();
  }, [courtMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const prevent = (event) => event.preventDefault();
    canvas.addEventListener("touchstart", prevent, { passive: false });
    canvas.addEventListener("touchmove", prevent, { passive: false });
    canvas.addEventListener("touchend", prevent, { passive: false });
    canvas.addEventListener("gesturestart", prevent);
    canvas.addEventListener("gesturechange", prevent);
    canvas.addEventListener("gestureend", prevent);
    return () => {
      canvas.removeEventListener("touchstart", prevent);
      canvas.removeEventListener("touchmove", prevent);
      canvas.removeEventListener("touchend", prevent);
      canvas.removeEventListener("gesturestart", prevent);
      canvas.removeEventListener("gesturechange", prevent);
      canvas.removeEventListener("gestureend", prevent);
    };
  }, []);

  const drawLine = (start, end, stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = stroke.tool === TOOL_ERASER ? "#000000" : stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.globalCompositeOperation = stroke.tool === TOOL_ERASER ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  };

  const drawStrokePath = (stroke) => {
    const canvas = canvasRef.current;
    if (!canvas || !stroke || !stroke.points.length) return;
    const ctx = canvas.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = stroke.tool === TOOL_ERASER ? "#000000" : stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.globalCompositeOperation = stroke.tool === TOOL_ERASER ? "destination-out" : "source-over";
    const { width, height } = canvasSizeRef.current;
    ctx.beginPath();
    stroke.points.forEach((pt, index) => {
      const x = pt.x * width;
      const y = pt.y * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  };

  const redrawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((stroke) => drawStrokePath(stroke));
  };

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const getNormalizedPoint = (point) => {
    const { width, height } = canvasSizeRef.current;
    if (!width || !height) return { x: 0, y: 0 };
    return { x: point.x / width, y: point.y / height };
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
    const point = getPoint(event);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    const newStroke = {
      tool,
      color,
      size,
      points: [getNormalizedPoint(point)],
    };
    currentStrokeRef.current = newStroke;
    drawLine(point, point, newStroke);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getPoint(event);
    if (!point || !lastPointRef.current) return;
    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    drawLine(lastPointRef.current, point, stroke);
    stroke.points.push(getNormalizedPoint(point));
    lastPointRef.current = point;
  };

  const handlePointerUp = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    drawingRef.current = false;
    lastPointRef.current = null;
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length) {
      strokesRef.current.push(stroke);
      setUndoCount(strokesRef.current.length);
    }
    currentStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const loadDrawing = (drawing) => {
    setSelectedDrawingId(drawing?.id || null);
    setBoardTitle(drawing?.title || "");
    setCourtMode(drawing?.court_mode === "full" ? "full" : "half");
    strokesRef.current = Array.isArray(drawing?.strokes) ? drawing.strokes : [];
    setUndoCount(strokesRef.current.length);
    requestAnimationFrame(redrawAll);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    setUndoCount(0);
  };

  const startNewBoard = () => {
    setSelectedDrawingId(null);
    setBoardTitle("");
    setStatusMessage("");
    clearCanvas();
  };

  const undoLast = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    setUndoCount(strokesRef.current.length);
    redrawAll();
  };

  const invalidateDrawings = () => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["drawings"] }),
      queryClient.invalidateQueries({ queryKey: ["drawing-shares"] }),
    ]);
  };

  const saveBoard = async () => {
    if (savingBoard) return;
    const payload = {
      gameId: gameIdParam || null,
      title: boardTitle,
      courtMode,
      strokes: strokesRef.current,
    };
    try {
      setSavingBoard(true);
      setStatusMessage("Saving...");
      const saved = selectedDrawing
        ? await updateDrawingRecord(selectedDrawing.id, payload, user?.id)
        : await createDrawing(payload, user?.id);
      await invalidateDrawings();
      loadDrawing(saved);
      setStatusMessage("Board saved.");
    } catch (error) {
      setStatusMessage(error?.message || "Unable to save board.");
    } finally {
      setSavingBoard(false);
    }
  };

  const deleteBoard = async () => {
    if (!selectedDrawing) return;
    const confirmed = window.confirm(`Delete "${selectedDrawing.title || "Untitled"}"?`);
    if (!confirmed) return;
    await deleteDrawingRecord(selectedDrawing.id, user?.id);
    await invalidateDrawings();
    startNewBoard();
    setStatusMessage("Board deleted.");
  };

  const toolLabel = useMemo(() => (tool === TOOL_PEN ? "Pen" : "Eraser"), [tool]);

  const courtClass = courtMode === "full" ? styles.courtFull : styles.courtHalf;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <Link className={styles.backButton} to={backUrl}>
          Back
        </Link>
        <button type="button" className={styles.secondaryButton} onClick={startNewBoard}>
          New Board
        </button>
        {selectedDrawing ? (
          <>
            {canManageSelectedDrawing ? (
              <button type="button" className={styles.secondaryButton} onClick={() => setShareDrawing(selectedDrawing)}>
                Share
              </button>
            ) : null}
            {canManageSelectedDrawing ? (
              <button type="button" className={styles.deleteButton} onClick={deleteBoard}>
                Delete
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={styles.workspace}>
        <section className={styles.canvasArea}>
          <div className={`${styles.sidebarCard} ${styles.detailsCard}`}>
            <div className={styles.panelTitle}>Board Details</div>
            <div className={styles.detailsRow}>
              <label className={styles.detailsField}>
                <span className={styles.detailsLabel}>Name</span>
                <input
                  type="text"
                  value={boardTitle}
                  onChange={(event) => setBoardTitle(event.target.value)}
                  placeholder="Untitled"
                />
              </label>
              <button
                type="button"
                className={`${styles.primaryButton} ${styles.detailsSaveButton}`}
                onClick={saveBoard}
                disabled={savingBoard}
              >
                {savingBoard ? "Saving..." : selectedDrawing ? "Update Board" : "Save Board"}
              </button>
            </div>
            {selectedDrawing ? (
              <div className={styles.metaText}>
                Last saved {formatDrawingTime(selectedDrawing.updated_at)}
              </div>
            ) : null}
            {statusMessage ? <div className={styles.statusMessage}>{statusMessage}</div> : null}
          </div>
          <div className={styles.controls}>
            <div className={styles.toolGroup}>
              <span className={styles.toolLabel}>Tool</span>
              <button
                type="button"
                className={`${styles.toolButton} ${tool === TOOL_PEN ? styles.toolActive : ""}`}
                onClick={() => setTool(TOOL_PEN)}
              >
                Pen
              </button>
              <button
                type="button"
                className={`${styles.toolButton} ${tool === TOOL_ERASER ? styles.toolActive : ""}`}
                onClick={() => setTool(TOOL_ERASER)}
              >
                Eraser
              </button>
              <span className={styles.toolChip}>{toolLabel}</span>
            </div>

            <div className={styles.toolGroup}>
              <span className={styles.toolLabel}>Thickness</span>
              <input
                type="range"
                min="2"
                max="18"
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
              />
              <span className={styles.toolChip}>{size}px</span>
            </div>

            <div className={styles.toolGroup}>
              <span className={styles.toolLabel}>Color</span>
              <div className={styles.colorSwatches}>
                {defaultColors.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`${styles.colorButton} ${color === swatch ? styles.colorActive : ""}`}
                    style={{ backgroundColor: swatch }}
                    onClick={() => setColor(swatch)}
                    aria-label={`Use color ${swatch}`}
                  />
                ))}
                <input
                  className={styles.colorPicker}
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  disabled={tool === TOOL_ERASER}
                  aria-label="Pick custom color"
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.iconButton}
              onClick={undoLast}
              disabled={undoCount === 0}
              aria-label="Undo"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
                <path
                  d="M12.5 6.5c-2.8 0-5.1 1.4-6.5 3.5V7H3v8h8v-3H7.7c1-1.6 2.7-2.7 4.8-2.7 3 0 5.5 2.5 5.5 5.5 0 1.9-.9 3.6-2.4 4.6l1.8 2.3C19.6 20.2 21 18 21 15.5c0-5-4.1-9-9.1-9z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button type="button" className={styles.clearButton} onClick={clearCanvas}>
              Clear
            </button>
          </div>

          <div className={`${styles.courtWrap} ${courtClass}`} ref={containerRef}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>

          <div className={styles.courtToggle}>
            <button
              type="button"
              className={`${styles.toggleButton} ${courtMode === "half" ? styles.toggleActive : ""}`}
              onClick={() => setCourtMode("half")}
            >
              Half Court
            </button>
            <button
              type="button"
              className={`${styles.toggleButton} ${courtMode === "full" ? styles.toggleActive : ""}`}
              onClick={() => setCourtMode("full")}
            >
              Full Court
            </button>
          </div>
        </section>
      </div>

      <ShareDialog
        open={Boolean(shareDrawing)}
        title={shareDrawing ? `Share Board: ${shareDrawing.title || "Untitled"}` : "Share Board"}
        initialSelectedIds={shareRecipients}
        onClose={() => setShareDrawing(null)}
        onSave={async (userIds) => {
          await updateDrawingShares(shareDrawing.id, userIds, user?.id);
          await invalidateDrawings();
          setShareDrawing(null);
          setStatusMessage("Sharing updated.");
        }}
      />
    </div>
  );
}
