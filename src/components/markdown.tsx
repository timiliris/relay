import { Check, Copy } from 'lucide-react';
import {
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useIsDark } from '@/hooks/use-is-dark';
import { cn } from '@/lib/utils';

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Rendu Markdown (GFM) avec formules LaTeX (KaTeX), coloration syntaxique,
 * diagrammes Mermaid (chargés à la demande) et bouton « copier » sur les blocs de code.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
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
  const code = extractText(children).replace(/\n$/, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
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
      {language === 'mermaid' ? (
        <Mermaid code={code} />
      ) : (
        <pre
          className={cn('overflow-x-auto p-3 text-[13px] leading-relaxed', className)}
          {...props}
        >
          {children}
        </pre>
      )}
    </div>
  );
}

let mermaidSeq = 0;

/** Diagramme Mermaid : la bibliothèque (lourde) n'est chargée qu'au premier usage. */
function Mermaid({ code }: { code: string }) {
  const { t } = useTranslation();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const dark = useIsDark();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        const { svg: rendered } = await mermaid.render(`mermaid-${++mermaidSeq}`, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark]);

  if (error) {
    return (
      <div className="p-3 text-xs">
        <p className="mb-2 text-destructive">{t('chat.mermaidError')}</p>
        <pre className="overflow-x-auto font-mono">{code}</pre>
      </div>
    );
  }
  if (!svg) return <p className="p-3 text-xs text-muted-foreground">{t('common.loading')}</p>;
  return <SvgHost svg={svg} />;
}

/** Injecte le SVG (assaini par Mermaid en mode `strict`) sans passer par dangerouslySetInnerHTML. */
function SvgHost({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <div ref={ref} className="overflow-x-auto p-3 [&_svg]:mx-auto" />;
}
