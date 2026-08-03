// ** import lib
import { useState } from 'react';

import { fileSrc } from '../lib/tauri';

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Rendered when the underlying `<img>` fails to load. Required. */
  fallback: React.ReactNode;
  loading?: 'lazy' | 'eager';
}

/**
 * A defensive `<img>` wrapper. The asset protocol can refuse a file (custom
 * storage not in the scope, deleted source, transient IPC hiccup) and a raw
 * `<img>` would then show the browser's broken-image glyph — a state we
 * never want. The fallback element must always be provided.
 */
export function SafeImage({ src, alt, className, fallback, loading = 'lazy' }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading={loading}
      decoding="async"
    />
  );
}

/**
 * Variant of {@link SafeImage} that runs the `src` through Tauri's
 * `convertFileSrc` so absolute Windows paths become webview-loadable URLs.
 * Same fallback contract.
 */
export function SafeAssetImage({
  path,
  alt,
  className,
  fallback,
  loading = 'lazy',
}: Omit<SafeImageProps, 'src'> & { path: string | null | undefined }) {
  if (!path) return <>{fallback}</>;
  return (
    <SafeImage
      src={fileSrc(path)}
      alt={alt}
      className={className}
      fallback={fallback}
      loading={loading}
    />
  );
}
