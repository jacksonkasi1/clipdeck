// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import { useState } from 'react';
import {
  FileImage,
  FileText,
  Files,
  Link2,
  Mail,
} from 'lucide-react';

import { fileSrc } from '../lib/tauri';

interface KindIconProps {
  item: ClipItem;
  size?: number;
}

function ThumbnailImage({ src, alt, className, fallback }: {
  src: string;
  alt: string;
  className: string;
  fallback: () => React.ReactNode;
}) {
  // A broken-image icon must never appear. If the asset protocol refuses the
  // file (custom storage not in the scope, deleted source, transient IPC
  // hiccup) we fall back to the kind-appropriate lucide icon and re-attempt
  // the load on the next render. `key` cycles on retry so a recovered file
  // re-fetches the bytes without bouncing the React tree.
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback()}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
      decoding="async"
    />
  );
}

export function KindIcon({ item, size = 18 }: KindIconProps) {
  // Image-kind items: prefer the on-disk thumbnail. If it fails to load (or
  // is not yet generated), the user still sees a recognisable icon.
  if (item.kind === 'image' && item.image?.thumbPath) {
    return (
      <ThumbnailImage
        src={fileSrc(item.image.thumbPath)}
        alt=""
        className="kind-thumbnail"
        fallback={() => <FileImage size={size} strokeWidth={1.7} aria-hidden />}
      />
    );
  }

  if (item.kind === 'color') {
    return (
      <span
        className="kind-color"
        style={{ backgroundColor: item.preview.trim() }}
        aria-label={`Color ${item.preview.trim()}`}
      />
    );
  }

  // File-kind items: when any of the underlying files is an image, we have
  // already generated a managed thumbnail in the snapshot worker. Use it;
  // otherwise fall back to the generic files icon.
  if (item.kind === 'files') {
    const firstImageAsset = item.fileAssets.find(
      (asset) => asset.thumbPath && asset.status === 'ready',
    );
    if (firstImageAsset?.thumbPath) {
      return (
        <ThumbnailImage
          src={fileSrc(firstImageAsset.thumbPath)}
          alt=""
          className="kind-thumbnail"
          fallback={() => <Files size={size} strokeWidth={1.7} aria-hidden />}
        />
      );
    }
  }

  const props = { size, strokeWidth: 1.7, 'aria-hidden': true as const };
  switch (item.kind) {
    case 'link':
      return <Link2 {...props} />;
    case 'email':
      return <Mail {...props} />;
    case 'image':
      return <FileImage {...props} />;
    case 'files':
      return <Files {...props} />;
    default:
      return <FileText {...props} />;
  }
}
