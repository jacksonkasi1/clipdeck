// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import {
  FileImage,
  FileText,
  Files,
  Link2,
  Mail,
} from 'lucide-react';

import { SafeAssetImage } from './SafeImage';

interface KindIconProps {
  item: ClipItem;
  size?: number;
}

export function KindIcon({ item, size = 18 }: KindIconProps) {
  // Image-kind items: prefer the on-disk thumbnail. If it fails to load (or
  // is not yet generated), the user still sees a recognisable icon.
  if (item.kind === 'image' && item.image?.thumbPath) {
    return (
      <SafeAssetImage
        path={item.image.thumbPath}
        alt=""
        className="kind-thumbnail"
        fallback={<FileImage size={size} strokeWidth={1.7} aria-hidden />}
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
        <SafeAssetImage
          path={firstImageAsset.thumbPath}
          alt=""
          className="kind-thumbnail"
          fallback={<Files size={size} strokeWidth={1.7} aria-hidden />}
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
