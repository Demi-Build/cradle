import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Lightbox } from "./Lightbox";
import { useStore } from "../store";

function resetStore() {
  useStore.setState({
    worldPath: "",
    world: null,
    worldStoryTitle: null,
    worldBeats: [],
    entities: {},
    selection: { kind: "none" },
    error: null,
    lightbox: null,
    recents: [],
    route: "start",
    drawerOpen: false,
    loading: false,
  });
}

describe("Lightbox", () => {
  beforeEach(resetStore);

  it("renders nothing when lightbox is null", () => {
    const { container } = render(<Lightbox />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the image with src and alt from store state", () => {
    useStore.setState({ lightbox: { src: "/foo.png", alt: "a portrait" } });
    render(<Lightbox />);
    const img = screen.getByRole("img", { name: "a portrait" });
    expect(img).toHaveAttribute("src", "/foo.png");
  });

  it("clicking the backdrop closes the lightbox", () => {
    useStore.setState({ lightbox: { src: "/f.png", alt: "x" } });
    const { container } = render(<Lightbox />);
    const backdrop = container.querySelector(".lightbox-backdrop")!;
    fireEvent.click(backdrop);
    expect(useStore.getState().lightbox).toBeNull();
  });

  it("clicking the image does NOT close (event stopped)", () => {
    useStore.setState({ lightbox: { src: "/f.png", alt: "x" } });
    render(<Lightbox />);
    fireEvent.click(screen.getByRole("img"));
    expect(useStore.getState().lightbox).not.toBeNull();
  });

  it("clicking the close button closes", () => {
    useStore.setState({ lightbox: { src: "/f.png", alt: "x" } });
    render(<Lightbox />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(useStore.getState().lightbox).toBeNull();
  });

  it("pressing Escape closes when open", () => {
    useStore.setState({ lightbox: { src: "/f.png", alt: "x" } });
    render(<Lightbox />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().lightbox).toBeNull();
  });

  it("does not register the Escape listener while closed", () => {
    render(<Lightbox />);
    // Should not throw or change state.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().lightbox).toBeNull();
  });

  it("ignores non-Escape keys when open", () => {
    useStore.setState({ lightbox: { src: "/f.png", alt: "x" } });
    render(<Lightbox />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useStore.getState().lightbox).not.toBeNull();
  });
});
