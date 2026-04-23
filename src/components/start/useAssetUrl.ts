import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../../lib/invoke";

export function useAssetUrl(worldPath: string, hint: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!worldPath || !hint) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveAsset(worldPath, hint);
        if (import.meta.env.DEV) console.log("[cradle:asset]", { worldPath, hint, resolved });
        if (cancelled) return;
        if (resolved) setUrl(convertFileSrc(resolved));
      } catch {
        // swallow; caller falls back
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldPath, hint]);
  return url;
}
