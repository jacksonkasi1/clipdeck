// ** import types
import type { ClipItem, LinkPreview } from '../lib/types';

// ** import lib
import { useEffect, useRef, useState } from 'react';
import { Globe, Link2, LoaderCircle } from 'lucide-react';

import { SafeAssetImage } from './SafeImage';
import { api } from '../lib/tauri';
import { normaliseUrl, tryParseScheme } from '../lib/url';

interface Props {
  item: ClipItem;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; preview: LinkPreview }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

/**
 * Rich preview surface for link-kind clipboard entries. Calls the native
 * `fetch_link_preview` command once per URL, caches the result in component
 * state for the lifetime of the page, and renders a graceful fallback when
 * the page publishes no metadata. The fetch is aborted on unmount so a fast
 * list scroll cannot pile up orphan requests.
 */
export function LinkPreviewCard({ item }: Props) {
  const url = (item.content || item.preview).trim();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inflight = useRef(0);

  useEffect(() => {
    if (!url) {
      setState({ kind: 'empty' });
      return;
    }
    if (tryParseScheme(url) === null) {
      setState({ kind: 'empty' });
      return;
    }
    const token = ++inflight.current;
    setState({ kind: 'loading' });
    let cancelled = false;
    api.fetchLinkPreview(url)
      .then((preview) => {
        if (cancelled || inflight.current !== token) return;
        if (!preview) {
          setState({ kind: 'empty' });
          return;
        }
        if (
          !preview.title
          && !preview.description
          && !preview.siteName
          && !preview.imagePath
          && !preview.faviconPath
        ) {
          setState({ kind: 'empty' });
          return;
        }
        setState({ kind: 'ready', preview });
      })
      .catch((error: unknown) => {
        if (cancelled || inflight.current !== token) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <article className="link-card link-card--loading" aria-busy>
        <span className="link-mark"><LoaderCircle size={34} className="spin" aria-hidden /></span>
        <strong>Fetching page metadata…</strong>
        <span>{url}</span>
      </article>
    );
  }
  if (state.kind === 'error' || state.kind === 'empty') {
    return (
      <article className="link-card link-card--minimal">
        <span className="link-mark"><Link2 size={34} aria-hidden /></span>
        <strong>{hostOf(url)}</strong>
        <span className="link-card-url">{url}</span>
      </article>
    );
  }
  const { preview } = state;
  const title = preview.title?.trim() || hostOf(url);
  const resolved = preview.resolvedUrl?.trim() || url;
  return (
    <article className="link-card link-card--rich">
      {preview.imagePath ? (
        <SafeAssetImage
          path={preview.imagePath}
          alt={title}
          className="link-card-image"
          fallback={<Globe size={32} aria-hidden />}
          loading="eager"
        />
      ) : (
        <div className="link-card-image link-card-image--placeholder" aria-hidden>
          <Globe size={32} />
        </div>
      )}
      <div className="link-card-body">
        <header>
          <SafeAssetImage
            path={preview.faviconPath}
            alt=""
            className="link-card-favicon"
            fallback={<Globe size={14} aria-hidden />}
            loading="eager"
          />
          <span className="link-card-host">{preview.siteName?.trim() || hostOf(resolved)}</span>
        </header>
        <h3 className="link-card-title">{title}</h3>
        {preview.description && (
          <p className="link-card-description">{preview.description}</p>
        )}
        <span className="link-card-url" title={resolved}>{resolved}</span>
      </div>
    </article>
  );
}

function hostOf(value: string): string {
  try {
    const url = new URL(normaliseUrl(value));
    return url.hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}
