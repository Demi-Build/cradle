import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (s: string) => s,
}));

vi.mock("../start/envImages", () => ({
  envImageFor: () => "/env/whisperbrook.png",
}));

import { RecentCard } from "./RecentCard";
import type { RecentProject } from "../../lib/recents";

function mkRecent(over: Partial<RecentProject> = {}): RecentProject {
  return {
    path: "/tmp/world",
    name: "world",
    lastOpenedAt: Date.now(),
    ...over,
  };
}

describe("RecentCard", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null); // resolveAsset → no portrait
  });

  it("renders storyTitle when present", () => {
    render(
      <RecentCard
        recent={mkRecent({ storyTitle: "The Saga", name: "raw_name" })}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("The Saga")).toBeInTheDocument();
    expect(screen.queryByText("raw_name")).toBeNull();
  });

  it("falls back to name when storyTitle is absent", () => {
    render(
      <RecentCard recent={mkRecent({ name: "raw_name" })} onClick={() => {}} />,
    );
    expect(screen.getByText("raw_name")).toBeInTheDocument();
  });

  it("truncates synopsis longer than 120 chars with an ellipsis", () => {
    const long = "x".repeat(200);
    const { container } = render(
      <RecentCard recent={mkRecent({ synopsis: long })} onClick={() => {}} />,
    );
    const syn = container.querySelector(".card-syn")!;
    expect(syn.textContent).toMatch(/…$/);
    expect(syn.textContent!.length).toBe(121);
  });

  it("renders the synopsis verbatim when ≤ 120 chars", () => {
    const { container } = render(
      <RecentCard recent={mkRecent({ synopsis: "short" })} onClick={() => {}} />,
    );
    expect(container.querySelector(".card-syn")?.textContent).toBe("short");
  });

  it("renders the path instead of synopsis when synopsis is missing", () => {
    const { container } = render(
      <RecentCard recent={mkRecent({ path: "/foo/bar" })} onClick={() => {}} />,
    );
    expect(container.querySelector(".path")?.textContent).toBe("/foo/bar");
    expect(container.querySelector(".card-syn")).toBeNull();
  });

  it("validation pill defaults to 'validated' when status is undefined", () => {
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={() => {}} />,
    );
    const pill = container.querySelector(".validation")!;
    expect(pill.textContent).toContain("validated");
    expect(pill.className).toBe("validation ");
  });

  it("validation pill renders 'warnings' with class 'warn'", () => {
    const { container } = render(
      <RecentCard recent={mkRecent({ validation: "warn" })} onClick={() => {}} />,
    );
    const pill = container.querySelector(".validation")!;
    expect(pill.textContent).toContain("warnings");
    expect(pill.className).toBe("validation warn");
  });

  it("validation pill renders 'failed' with class 'err'", () => {
    const { container } = render(
      <RecentCard
        recent={mkRecent({ validation: "failed" })}
        onClick={() => {}}
      />,
    );
    const pill = container.querySelector(".validation")!;
    expect(pill.textContent).toContain("failed");
    expect(pill.className).toBe("validation err");
  });

  it("validation pill renders 'bundled' with default class", () => {
    const { container } = render(
      <RecentCard
        recent={mkRecent({ validation: "bundled" })}
        onClick={() => {}}
      />,
    );
    const pill = container.querySelector(".validation")!;
    expect(pill.textContent).toContain("bundled");
    expect(pill.className).toBe("validation ");
  });

  it("renders em-dash for undefined stat counts", () => {
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={() => {}} />,
    );
    const stats = container.querySelectorAll(".stats .s b");
    expect(stats).toHaveLength(4);
    for (const b of stats) expect(b.textContent).toBe("—");
  });

  it("renders concrete numbers when stat counts are present", () => {
    const { container } = render(
      <RecentCard
        recent={mkRecent({ rooms: 5, npcs: 3, events: 2, quests: 1 })}
        onClick={() => {}}
      />,
    );
    const stats = Array.from(container.querySelectorAll(".stats .s b")).map(
      (b) => b.textContent,
    );
    expect(stats).toEqual(["5", "3", "2", "1"]);
  });

  it("seed line renders only when seed is a number", () => {
    const { container, rerender } = render(
      <RecentCard recent={mkRecent({ seed: 42 })} onClick={() => {}} />,
    );
    expect(container.querySelector(".foot")?.textContent).toContain("seed 42");
    rerender(<RecentCard recent={mkRecent({ seed: "abc" })} onClick={() => {}} />);
    expect(container.querySelector(".foot")?.textContent).not.toContain("seed");
  });

  it("cost rendered with two decimals when present", () => {
    const { container } = render(
      <RecentCard recent={mkRecent({ cost: 1.234 })} onClick={() => {}} />,
    );
    expect(container.querySelector(".foot")?.textContent).toContain("$1.23");
  });

  it("cost line absent when cost is undefined", () => {
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={() => {}} />,
    );
    expect(container.querySelector(".foot")?.textContent).not.toContain("$");
  });

  it("onClick fires when the card is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={onClick} />,
    );
    fireEvent.click(container.querySelector(".card")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("pin button is absent when onTogglePin is not provided", () => {
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={() => {}} />,
    );
    expect(container.querySelector(".card-pin")).toBeNull();
  });

  it("pin click fires onTogglePin and does NOT bubble to onClick", () => {
    const onClick = vi.fn();
    const onTogglePin = vi.fn();
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={onClick} onTogglePin={onTogglePin} />,
    );
    fireEvent.click(container.querySelector(".card-pin")!);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pin gets the 'on' class when recent.pinned is true", () => {
    const { container } = render(
      <RecentCard
        recent={mkRecent({ pinned: true })}
        onClick={() => {}}
        onTogglePin={() => {}}
      />,
    );
    expect(container.querySelector(".card-pin")?.className).toContain("on");
  });

  it("env chip uses envChipLabel of primaryEnv", () => {
    const { container } = render(
      <RecentCard
        recent={mkRecent({ primaryEnv: "village" })}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".env-chip")?.textContent).toBe("village");
  });

  it("env chip falls back to 'world' when primaryEnv is missing", () => {
    const { container } = render(
      <RecentCard recent={mkRecent()} onClick={() => {}} />,
    );
    expect(container.querySelector(".env-chip")?.textContent).toBe("world");
  });
});
