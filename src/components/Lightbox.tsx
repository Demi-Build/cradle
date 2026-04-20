import { useEffect } from "react";
import { useStore } from "../store";

export function Lightbox() {
  const lightbox = useStore((s) => s.lightbox);
  const close = useStore((s) => s.closeLightbox);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, close]);

  if (!lightbox) return null;

  return (
    <div className="lightbox-backdrop" onClick={close}>
      <img
        className="lightbox-img"
        src={lightbox.src}
        alt={lightbox.alt}
        onClick={(e) => e.stopPropagation()}
      />
      <button className="lightbox-close" onClick={close} aria-label="close">
        ×
      </button>
    </div>
  );
}
