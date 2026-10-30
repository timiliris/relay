import { Check, Copy } from 'lucide-react';
import { type ComponentProps, isValidElement, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownProps {
  children: string;
  className?: string;
}

/** Rendu Markdown (GFM) avec coloration syntaxique et bouton « copier » sur les blocs de code. */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: CodeBlock, a: ExternalLink }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ExternalLink(props: ComponentProps<'a'>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

function languageOf(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null;
  const match = /language-([\w-]+)/.exec(children.props.className ?? '');
  return match?.[1] ?? null;
}

function CodeBlock({ children, className, ...props }: ComponentProps<'pre'>) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(extractText(children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // presse-papiers indisponible
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? 'texte'}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-3.5"
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre className={cn('overflow-x-auto p-3 text-[13px] leading-relaxed', className)} {...props}>
        {children}
      </pre>
    </div>
  );
}
