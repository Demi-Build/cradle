import { useStore } from "../../store";
import { ExpandableText } from "../ExpandableText";

export function RoomStory({ roomId }: { roomId: string }) {
  const beats = useStore((s) => s.worldBeats);
  const beat = beats.find((b) => b.room_id === roomId);
  if (!beat) return null;
  const hasAny =
    beat.summary || beat.faction_presence || beat.boss_name || beat.boss_lore ||
    typeof beat.escalation === "number";
  if (!hasAny) return null;

  return (
    <section className="room-story">
      <div className="room-story-head">
        <span className="room-story-label">Story</span>
        {typeof beat.escalation === "number" && (
          <span className="chip chip-muted">escalation {beat.escalation}</span>
        )}
        {beat.boss_name && <span className="chip">{beat.boss_name}</span>}
      </div>

      {beat.summary && (
        <p className="room-story-summary">
          <ExpandableText text={beat.summary} limit={400} />
        </p>
      )}

      {beat.faction_presence && (
        <details className="room-story-detail">
          <summary>Faction presence</summary>
          <p><ExpandableText text={beat.faction_presence} limit={500} /></p>
        </details>
      )}

      {beat.boss_lore && (
        <details className="room-story-detail">
          <summary>Boss lore</summary>
          <p><ExpandableText text={beat.boss_lore} limit={500} /></p>
        </details>
      )}
    </section>
  );
}
