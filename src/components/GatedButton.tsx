// A control the CAPABILITY blocks: rendered, greyed, and carrying its reason
// where BOTH a pointer and the keyboard can reach it.
//
// EXTENDS two things that already exist, and adds no third:
//   • `Tooltip` — the app's ONE tooltip, already used by every tool rail and by
//     this surface's own gate ribbon. It owns the 260ms delay, the portal that
//     stops an `overflow: hidden` ancestor clipping it, and the flip/clamp that
//     keeps it on screen; it now also opens on FOCUS, which is the one thing it
//     lacked and the reason this component needed a tip at all. Widening it was
//     three lines and fixed keyboard reach for every tooltip in the app.
//   • the `disabled` + `title` pair every gated control on this surface already
//     used — and repairs the half of it that never worked. A NATIVE `disabled`
//     button is removed from the tab order, so its `title` is a POINTER-ONLY
//     tooltip: a keyboard user reaches a dead control with the reason nowhere
//     on screen. `aria-disabled` keeps the button focusable and still announces
//     it as disabled, and the click is refused here instead of by the browser.
//     `title` stays on too, so the native tip and a screen reader both carry
//     the reason even before the panel opens.
//
// The greyed treatment is inline (`opacity .45`, default cursor) — the same one
// this app already uses for a rendered-but-blocked chip — so the fix stays
// inside the surface that needs it rather than reaching into the shared
// stylesheet.
//
// It lives beside `Tooltip` rather than inside `dialogue/` because the blocked
// state it renders is not a dialogue idea: the level and world surfaces gate
// controls the same way, and a component parked in one surface's folder is how
// a second copy gets written.
//
// An EMPTY `reason` is a live button: same class, same place, nothing greyed,
// and its `hint` rides the ordinary native `title` like any other live button
// in the editor. That is deliberate — one component renders both states, so a
// control can never be dropped from the layout by going blocked.

import { type CSSProperties, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export function GatedButton({
  className,
  reason,
  hint,
  onClick,
  children,
  style,
  testId,
  ariaLabel,
}: {
  className: string;
  /** Non-empty = blocked, and these are the words the user needs. Empty = the
   *  control is live. */
  reason: string;
  /** The tooltip while the control IS available. */
  hint?: string;
  onClick?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
  ariaLabel?: string;
}) {
  if (!reason) {
    return (
      <button
        className={className}
        title={hint}
        style={style}
        onClick={onClick}
        data-testid={testId}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  return (
    <Tooltip title="Not available" desc={reason}>
      <button
        className={className}
        // NOT `disabled`: that would take the control out of the tab order and
        // strand the reason on hover only.
        aria-disabled="true"
        aria-label={ariaLabel}
        data-blocked="1"
        data-testid={testId}
        title={reason}
        style={{ ...style, opacity: 0.45, cursor: "default" }}
        onClick={(e) => {
          e.preventDefault();
          // A click on a blocked control is not silence: focusing it is what
          // opens the reason, so the pointer and the keyboard end up in the
          // same place instead of each having their own path.
          e.currentTarget.focus();
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
