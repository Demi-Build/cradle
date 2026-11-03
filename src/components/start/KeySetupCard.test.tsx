import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/** First run: the key file is the only source of provider keys, so until it
 *  exists the start screen invites you to add one — and stops the moment the
 *  file is there. */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

const providerKeys = vi.fn();
vi.mock("../../lib/invoke", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/invoke")>();
  return {
    ...actual,
    api: { ...actual.api, providerKeys: (...a: unknown[]) => providerKeys(...a) },
  };
});

import { KeySetupCard } from "./KeySetupCard";
import { resetKeySetupCard } from "./keySetupSession";
import { useStore } from "../../store";

function status(exists: boolean | undefined, envFile: string | null = "/repo/canon-ai/.env") {
  return {
    env_file: envFile,
    env_file_exists: exists,
    keys: [],
    vars: [],
    backend: "env_file",
    warning: null,
    config_dir: "/cfg",
  };
}

beforeEach(() => {
  providerKeys.mockReset();
  resetKeySetupCard();
  useStore.setState({ settings: { open: false, pane: "keys", focusVar: null } } as never);
});

describe("the first-run key setup card", () => {
  it("shows where the keys will go when there is no key file yet, and opens Settings → API keys", async () => {
    providerKeys.mockResolvedValue(status(false));
    render(<KeySetupCard />);
    const card = await screen.findByTestId("key-setup-card");
    expect(screen.getByTestId("key-setup-path").textContent).toBe("/repo/canon-ai/.env");
    expect(card.textContent).toContain("not your shell");
    fireEvent.click(screen.getByTestId("key-setup-open"));
    expect(useStore.getState().settings).toEqual({ open: true, pane: "keys", focusVar: null });
  });

  it("stays away once the key file exists", async () => {
    providerKeys.mockResolvedValue(status(true));
    render(<KeySetupCard />);
    await waitFor(() => expect(providerKeys).toHaveBeenCalled());
    expect(screen.queryByTestId("key-setup-card")).toBeNull();
  });

  it("stays away when no file can be resolved (Settings names that problem)", async () => {
    providerKeys.mockResolvedValue(status(false, null));
    render(<KeySetupCard />);
    await waitFor(() => expect(providerKeys).toHaveBeenCalled());
    expect(screen.queryByTestId("key-setup-card")).toBeNull();
  });

  it("re-reads when Settings closes, so saving the first key there clears it", async () => {
    providerKeys.mockResolvedValue(status(false));
    render(<KeySetupCard />);
    await screen.findByTestId("key-setup-card");
    act(() => useStore.getState().openSettings("keys"));
    providerKeys.mockResolvedValue(status(true));
    act(() => useStore.getState().closeSettings());
    await waitFor(() => expect(screen.queryByTestId("key-setup-card")).toBeNull());
  });

  it("'Not now' hides it for the session", async () => {
    providerKeys.mockResolvedValue(status(false));
    const { unmount } = render(<KeySetupCard />);
    fireEvent.click(await screen.findByTestId("key-setup-dismiss"));
    expect(screen.queryByTestId("key-setup-card")).toBeNull();
    unmount();
    render(<KeySetupCard />);
    await waitFor(() => expect(providerKeys).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("key-setup-card")).toBeNull();
  });
});
