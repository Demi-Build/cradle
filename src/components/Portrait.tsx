import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../lib/invoke";
import { useStore } from "../store";

export function Portrait({ hint, alt, size = 180 }: { hint: string | null | undefined; alt: string; size?: number }) {
  const worldPath = useStore((s) => s.worldPath);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    if (!hint || !worldPath) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveAsset(worldPath, hint);
        if (cancelled) return;
        if (resolved) setSrc(convertFileSrc(resolved));
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hint, worldPath]);

  if (!hint || failed) {
    return (
      <div className="portrait portrait-missing" style={{ width: size, height: size }}>
        <span>no image</span>
      </div>
    );
  }
  if (!src) {
    return <div className="portrait portrait-loading" style={{ width: size, height: size }} />;
  }
  return (
    <img
      className="portrait"
      src={src}
      alt={alt}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
