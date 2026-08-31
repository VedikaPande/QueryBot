import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders Markdown from the agent.
 *
 * `rehype-highlight` was already a dependency but was never wired up, so SQL and
 * code blocks in answers rendered unhighlighted. Colours come from the theme
 * tokens in `index.css` rather than a hardcoded value, which is what makes the
 * output legible in dark mode.
 */
const MarkdownRenderer = ({ content, className }: MarkdownRendererProps) => (
  <div className={cn('markdown-content', className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {content}
    </ReactMarkdown>
  </div>
);

export default MarkdownRenderer;
