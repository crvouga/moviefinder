import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  prepareImage,
  resolveImage,
  imageUnavailable,
  type ImageSource,
} from "../../src/client/images";
class TestImage {
  static created: TestImage[] = [];
  src = "";
  srcset = "";
  sizes = "";
  fetchPriority = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn(async () => {});
  removeAttribute = vi.fn();
  constructor() {
    TestImage.created.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  TestImage.created = [];
});
describe("navigation artwork", () => {
  it("shares one decoded image, promotes priority and keeps a navigation consumer alive", async () => {
    vi.stubGlobal("Image", TestImage);
    const images: ImageSource[] = [{ path: "/shared-test-image.jpg", role: "poster" }];
    const intent = new AbortController();
    const prediction = prepareImage(images, "hero", intent.signal);
    const navigation = prepareImage(images, "hero", undefined, true);
    expect(TestImage.created).toHaveLength(1);
    const image = TestImage.created[0]!;
    expect(image.fetchPriority).toBe("high");
    intent.abort();
    await expect(prediction).rejects.toBeDefined();
    expect(image.removeAttribute).not.toHaveBeenCalled();
    image.onload!();
    await navigation;
    expect(image.decode).toHaveBeenCalledTimes(1);
    await prepareImage(images, "hero");
    expect(TestImage.created).toHaveLength(1);
  });
  it("cancels abandoned image work and allows a later attempt", async () => {
    vi.stubGlobal("Image", TestImage);
    const images: ImageSource[] = [{ path: "/abandoned-test-image.jpg", role: "poster" }];
    const controller = new AbortController();
    const pending = prepareImage(images, "hero", controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(TestImage.created[0]!.removeAttribute).toHaveBeenCalledWith("src");
    const retry = prepareImage(images, "hero");
    expect(TestImage.created).toHaveLength(2);
    TestImage.created[1]!.onload!();
    await retry;
  });
  it("uses a stable fallback for failed or stalled artwork and permits retry after expiry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", TestImage);
    const images: ImageSource[] = [{ path: "/stalled-test-image.jpg", role: "poster" }];
    const resolved = resolveImage(images, "hero")!;
    const pending = prepareImage(images, "hero");
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(imageUnavailable(resolved)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(imageUnavailable(resolved)).toBe(false);
    const retry = prepareImage(images, "hero");
    expect(TestImage.created).toHaveLength(2);
    TestImage.created[1]!.onerror!();
    await retry;
  });
});
