import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DialogueCard } from "./DialogueCard";
import type { Beat, BeatChoice } from "./types";

function mkBeat(over: Partial<Beat> = {}): Beat {
  return {
    id: "tree:start",
    kind: "tree",
    label: "start",
    prompt: "Hello.",
    ...over,
  };
}

describe("DialogueCard", () => {
  it("renders kind badge and label", () => {
    const { container } = render(<DialogueCard beat={mkBeat()} mode="full" />);
    expect(container.querySelector(".dc-kind-badge")?.textContent).toBe("tree");
    expect(container.querySelector(".dc-id")?.textContent).toBe("start");
  });

  it("renders the prompt verbatim in full mode", () => {
    const long = "x".repeat(200);
    const { container } = render(<DialogueCard beat={mkBeat({ prompt: long })} mode="full" />);
    expect(container.querySelector(".dc-prompt")?.textContent).toBe(long);
  });

  it("compact mode truncates prompts longer than 140 chars with ellipsis", () => {
    const long = "x".repeat(200);
    const { container } = render(<DialogueCard beat={mkBeat({ prompt: long })} mode="compact" />);
    const text = container.querySelector(".dc-prompt")!.textContent!;
    expect(text.length).toBe(141);
    expect(text.endsWith("…")).toBe(true);
  });

  it("compact mode leaves short prompts untouched", () => {
    const { container } = render(
      <DialogueCard beat={mkBeat({ prompt: "short" })} mode="compact" />,
    );
    expect(container.querySelector(".dc-prompt")?.textContent).toBe("short");
  });

  it("compact mode shows '1 choice' (singular) when there is one choice", () => {
    const choices: BeatChoice[] = [{ text: "go", toBeatId: "tree:b" }];
    const { container } = render(<DialogueCard beat={mkBeat({ choices })} mode="compact" />);
    expect(container.querySelector(".dc-choice-count")?.textContent).toBe("1 choice");
  });

  it("compact mode pluralizes the choice count when N > 1", () => {
    const choices: BeatChoice[] = [
      { text: "a", toBeatId: "tree:a" },
      { text: "b", toBeatId: "tree:b" },
    ];
    const { container } = render(<DialogueCard beat={mkBeat({ choices })} mode="compact" />);
    expect(container.querySelector(".dc-choice-count")?.textContent).toBe("2 choices");
  });

  it("compact mode does NOT render the choice list", () => {
    const choices: BeatChoice[] = [{ text: "go", toBeatId: "tree:b" }];
    const { container } = render(<DialogueCard beat={mkBeat({ choices })} mode="compact" />);
    expect(container.querySelector(".dc-choices")).toBeNull();
  });

  it("compact mode hides the footer when there are no choices", () => {
    const { container } = render(<DialogueCard beat={mkBeat()} mode="compact" />);
    expect(container.querySelector(".dc-footer")).toBeNull();
  });

  it("full mode renders one button per choice with the text", () => {
    const choices: BeatChoice[] = [
      { text: "Yes", toBeatId: "tree:yes" },
      { text: "No", toBeatId: "tree:no" },
    ];
    render(<DialogueCard beat={mkBeat({ choices })} mode="full" />);
    expect(screen.getByRole("button", { name: /Yes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /No/ })).toBeInTheDocument();
  });

  it("full mode strips the 'tree:' prefix in the choice arrow", () => {
    const choices: BeatChoice[] = [{ text: "go", toBeatId: "tree:room_3" }];
    const { container } = render(<DialogueCard beat={mkBeat({ choices })} mode="full" />);
    expect(container.querySelector(".dc-choice-arrow")?.textContent).toBe("→ room_3");
  });

  it("full mode preserves non-tree-prefixed toBeatIds in the arrow", () => {
    const choices: BeatChoice[] = [{ text: "to gate", toBeatId: "quest-gate" }];
    const { container } = render(<DialogueCard beat={mkBeat({ choices })} mode="full" />);
    expect(container.querySelector(".dc-choice-arrow")?.textContent).toBe("→ quest-gate");
  });

  it("clicking a choice fires onChoiceClick with toBeatId", () => {
    const choices: BeatChoice[] = [{ text: "go", toBeatId: "tree:b" }];
    const onChoiceClick = vi.fn();
    render(<DialogueCard beat={mkBeat({ choices })} mode="full" onChoiceClick={onChoiceClick} />);
    fireEvent.click(screen.getByRole("button", { name: /go/ }));
    expect(onChoiceClick).toHaveBeenCalledWith("tree:b");
  });

  it("choice click does NOT trigger onCardClick (stopPropagation)", () => {
    const choices: BeatChoice[] = [{ text: "go", toBeatId: "tree:b" }];
    const onChoiceClick = vi.fn();
    const onCardClick = vi.fn();
    render(
      <DialogueCard
        beat={mkBeat({ choices })}
        mode="full"
        onChoiceClick={onChoiceClick}
        onCardClick={onCardClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /go/ }));
    expect(onChoiceClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("clicking the card root fires onCardClick", () => {
    const onCardClick = vi.fn();
    const { container } = render(
      <DialogueCard beat={mkBeat()} mode="compact" onCardClick={onCardClick} />,
    );
    fireEvent.click(container.querySelector(".dialogue-card")!);
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it("applies entry / terminal / kind classes when flags are set", () => {
    const { container } = render(
      <DialogueCard
        beat={mkBeat({ kind: "success", isEntry: true, isTerminal: true })}
        mode="full"
      />,
    );
    const root = container.querySelector(".dialogue-card")!;
    expect(root.className).toContain("kind-success");
    expect(root.className).toContain("entry");
    expect(root.className).toContain("terminal");
  });

  it("omits entry / terminal classes when flags are unset", () => {
    const { container } = render(<DialogueCard beat={mkBeat()} mode="full" />);
    const root = container.querySelector(".dialogue-card")!;
    expect(root.className).not.toContain(" entry");
    expect(root.className).not.toContain(" terminal");
  });

  it("exposes data-beat-id on the root", () => {
    const { container } = render(<DialogueCard beat={mkBeat({ id: "tree:abc" })} mode="full" />);
    expect(container.querySelector(".dialogue-card")?.getAttribute("data-beat-id")).toBe(
      "tree:abc",
    );
  });
});
