import { Image as MantineImage } from "@mantine/core";
import { currentNavigationContext, track } from "../telemetry";
import { useMemo, useState, type ReactNode } from "react";
import { resolveImage, imageUnavailable, type ImageSource, type SlotName } from "../images";

// Hand it every image you have and the slot it fills; it picks the artwork and the resolution.
export function Image({
  images,
  slot,
  alt = "",
  priority = false,
  className,
  fallback = null,
}: {
  images: readonly ImageSource[];
  slot: SlotName;
  alt?: string;
  priority?: boolean;
  className?: string;
  fallback?: ReactNode;
}) {
  const resolved = resolveImage(images, slot);
  const [failed, setFailed] = useState<string>();
  const timing = useMemo(
    () => ({ started: performance.now(), context: currentNavigationContext() }),
    [resolved?.src],
  );
  if (!resolved || failed === resolved.src || imageUnavailable(resolved)) return fallback;
  return (
    <MantineImage
      h="100%"
      w="100%"
      fit="cover"
      radius="md"
      className={className}
      src={resolved.src}
      srcSet={resolved.srcSet}
      sizes={resolved.sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onLoad={() =>
        track("image", "display", { ...timing.context, ms: performance.now() - timing.started })
      }
      onError={() => setFailed(resolved.src)}
    />
  );
}
