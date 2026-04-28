import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../lib/invoke";
import { useStore } from "../store";

export function AudioPlayer({ hint, name, kind }: { hint: string; name: string; kind: string }) {
  const worldPath = useStore((s) => s.worldPath);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setErr(null);
    if (!worldPath || !hint) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveAsset(worldPath, hint);
        if (cancelled) return;
        if (resolved) setSrc(convertFileSrc(resolved));
        else setErr("audio file not found");
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldPath, hint]);

  return (
    <section className="audio-player-card">
      <header>
        <span className="audio-kind">{kind}</span>
        <span className="audio-name">{name}</span>
      </header>
      {err && <p className="detail-error">{err}</p>}
      {src && <audio controls src={src} preload="metadata" className="audio-el" />}
      {!src && !err && <p className="audio-loading">Loading…</p>}
    </section>
  );
}
