// ** import types
import type { SourceApp } from '../lib/types';

// ** import lib
import { AppWindow } from 'lucide-react';

import { SafeAssetImage } from './SafeImage';

interface Props {
  source: SourceApp | null;
  size?: number;
  className?: string;
  /**
   * True when the icon is rendered inline next to the source name; the label
   * is then exposed as a `title` tooltip so hovering reads as "From
   * Visual Studio Code". Set to false for the kind-icon slot, where the
   * surrounding context already names the source.
   */
  withTooltip?: boolean;
}

/**
 * Renders the captured source application's icon when one was extracted, and
 * a neutral app glyph otherwise. Every code path returns a non-empty node so
 * callers can rely on the slot always being filled.
 */
export function SourceIcon({ source, size = 14, className, withTooltip = false }: Props) {
  const tooltip = source ? `From ${source.name}` : undefined;
  const wrapper = (children: React.ReactNode) =>
    withTooltip ? (
      <span className={className} title={tooltip} aria-label={tooltip}>
        {children}
      </span>
    ) : (
      <span className={className} aria-hidden>
        {children}
      </span>
    );
  if (source?.iconPath) {
    return wrapper(
      <SafeAssetImage
        path={source.iconPath}
        alt=""
        className="source-icon"
        fallback={<AppWindow size={size} aria-hidden className="source-icon-fallback" />}
        loading="eager"
      />,
    );
  }
  return wrapper(
    <AppWindow size={size} aria-hidden className="source-icon-fallback" />,
  );
}
