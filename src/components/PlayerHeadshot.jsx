import { useEffect, useMemo, useState } from "react";
import { playerHeadshotUrls } from "../api.js";

export default function PlayerHeadshot({
  personId,
  teamId = null,
  className,
  style,
  alt = "",
  draggable = false,
  fallback = null,
  onLoad,
}) {
  const sources = useMemo(() => playerHeadshotUrls(personId, teamId), [personId, teamId]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setExhausted(false);
  }, [sources]);

  const source = sources[sourceIndex] || null;

  if (!source || exhausted) {
    return fallback;
  }

  return (
    <img
      className={className}
      src={source}
      style={style}
      alt={alt}
      draggable={draggable}
      onLoad={onLoad}
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex((current) => current + 1);
          return;
        }
        setExhausted(true);
      }}
    />
  );
}
