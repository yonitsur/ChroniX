import React, { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { mathToPlainText, normalizeMathInText } from '../utils/mathUtils';

/**
 * MathMarkdown
 * Renders rich text with mathematical formulas (KaTeX) and lightweight Markdown.
 *
 * Designed to render event descriptions, subtitles, and extracts cleanly,
 * supporting both LTR and RTL (Hebrew/Arabic) contexts without breaking BiDi.
 */

// Hoisted so ReactMarkdown gets the same plugin and component objects on every render.
const NO_PLUGINS = [];
const KATEX_OPTIONS = { throwOnError: false, strict: false };

const INLINE_COMPONENTS = {
  p: ({ children }) => <span className="inline leading-normal">{children}</span>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-[0.9em] font-mono border border-line">
      {children}
    </code>
  ),
  img: () => null,
};

const BLOCK_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed font-sans">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-caption font-mono border border-line">
      {children}
    </code>
  ),
  a: (props) => (
    <a
      {...props}
      className="text-accent hover:underline underline-offset-2 break-words"
      target="_blank"
      rel="noopener noreferrer"
    />
  ),
  ul: ({ children }) => <ul className="my-2 ps-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ps-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  img: () => null,
};

// remark-math + rehype-katex (with its own KaTeX copy) are only fetched once some text
// actually contains a formula, so plain descriptions never pull KaTeX in.
let loadedMathPlugins = null;
let mathPluginsPromise = null;

export function loadMathPlugins() {
  if (loadedMathPlugins) return Promise.resolve(loadedMathPlugins);
  if (!mathPluginsPromise) {
    mathPluginsPromise = Promise.all([import('remark-math'), import('rehype-katex')])
      .then(([remarkMath, rehypeKatex]) => {
        loadedMathPlugins = {
          remarkPlugins: [remarkMath.default],
          rehypePlugins: [[rehypeKatex.default, KATEX_OPTIONS]],
        };
        return loadedMathPlugins;
      })
      .catch((err) => {
        mathPluginsPromise = null;
        throw err;
      });
  }
  return mathPluginsPromise;
}

// After normalization every formula is $-delimited; without a "$" remark-math has nothing to do.
export function needsMathPipeline(normalizedText) {
  return typeof normalizedText === 'string' && normalizedText.includes('$');
}

function MathMarkdown({
  content,
  className = '',
  inline = false,
  dir,
}) {
  const normalized = useMemo(() => normalizeMathInText(content || ''), [content]);
  const hasMath = needsMathPipeline(normalized);
  const [mathPlugins, setMathPlugins] = useState(loadedMathPlugins);

  useEffect(() => {
    if (!hasMath || mathPlugins) return undefined;
    let cancelled = false;
    loadMathPlugins()
      .then((plugins) => { if (!cancelled) setMathPlugins(plugins); })
      .catch(() => { /* keep the plain-text rendering */ });
    return () => { cancelled = true; };
  }, [hasMath, mathPlugins]);

  if (!content) return null;

  const plugins = hasMath ? (mathPlugins || loadedMathPlugins) : null;
  // While the math pipeline loads, show formulas as readable Unicode instead of raw LaTeX.
  const text = hasMath && !plugins ? mathToPlainText(content) : normalized;
  const Tag = inline ? 'span' : 'div';

  return (
    <Tag className={`math-markdown-container ${className}`} dir={dir}>
      <ReactMarkdown
        remarkPlugins={plugins ? plugins.remarkPlugins : NO_PLUGINS}
        rehypePlugins={plugins ? plugins.rehypePlugins : NO_PLUGINS}
        components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </Tag>
  );
}

export default memo(MathMarkdown);
