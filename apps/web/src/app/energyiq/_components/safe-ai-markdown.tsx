import React from "react";
import ReactMarkdown from "react-markdown";

const SAFE_AI_MARKDOWN_ELEMENTS = ["p", "br", "strong", "em"] as const;

export function SafeAiMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className} data-safe-ai-markdown="true">
      <ReactMarkdown
        allowedElements={[...SAFE_AI_MARKDOWN_ELEMENTS]}
        skipHtml
        unwrapDisallowed
        components={{
          p: ({ children: paragraph }) => <p className="mb-2 last:mb-0">{paragraph}</p>,
          strong: ({ children: emphasis }) => <strong className="font-semibold text-foreground">{emphasis}</strong>,
          em: ({ children: emphasis }) => <em className="italic text-foreground">{emphasis}</em>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
