import { useState, type ReactNode } from "react";
import { resolveImage, type ImageSource, type SlotName } from "../images";

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
  if (!resolved || failed === resolved.src) return fallback;
  return (
    <img
      className={className}
      src={resolved.src}
      srcSet={resolved.srcSet}
      sizes={resolved.sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setFailed(resolved.src)}
    />
  );
}
