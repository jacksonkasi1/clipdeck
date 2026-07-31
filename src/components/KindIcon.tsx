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

import { fileSrc } from '../lib/tauri';

interface KindIconProps {
  item: ClipItem;
  size?: number;
}

export function KindIcon({ item, size = 18 }: KindIconProps) {
  if (item.kind === 'image' && item.image?.thumbPath) {
    return <img src={fileSrc(item.image.thumbPath)} alt="" className="kind-thumbnail" />;
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
