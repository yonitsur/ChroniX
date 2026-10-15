import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathInText } from '../utils/mathUtils';

/**
 * MathMarkdown
 * Renders rich text with mathematical formulas (KaTeX) and lightweight Markdown.
 *
 * Designed to render event descriptions, subtitles, and extracts cleanly,
 * supporting both LTR and RTL (Hebrew/Arabic) contexts without breaking BiDi.
 */
export default function MathMarkdown({
  content,
  className = '',
  inline = false,
  dir,
}) {
  if (!content) return null;

  const normalized = useMemo(() => {
    return normalizeMathInText(content);
  }, [content]);

  // When inline=true, render children directly without block wrapper elements
  const components = useMemo(() => {
    if (inline) {
      return {
        p: ({ children }) => <span className="inline leading-normal">{children}</span>,
        strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-[0.9em] font-mono border border-line">
            {children}
          </code>
        ),
      };
    }

    return {
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
    };
  }, [inline]);

  const Tag = inline ? 'span' : 'div';

  return (
    <Tag className={`math-markdown-container ${className}`} dir={dir}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </Tag>
  );
}
