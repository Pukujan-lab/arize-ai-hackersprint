// The memo as formatted text: headings, bold, lists, quotes and paragraphs, with every citation
// reference and every bolded authority name linked to the document behind it.

import { Fragment, useMemo, type ReactNode } from "react";
import type { Citation } from "@/lib/citations";

const SOURCE_SEARCH = "https://www.courtlistener.com/?q=";

/** Where a citation's document lives, or a search for it on an external legal database. */
export function sourceHref(citation: Citation): string {
  const url = (citation.url || "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  return SOURCE_SEARCH + encodeURIComponent(citation.citation || citation.title || "legal authority");
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string };

function parse(answer: string): Block[] {
  const lines = String(answer || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let items: string[] | null = null;
  let ordered = false;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "p", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (items && items.length) blocks.push(ordered ? { kind: "ol", items } : { kind: "ul", items });
    items = null;
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ kind: "quote", text: quote.join(" ") });
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push({ kind: "h", level: Math.min(3, heading[1].length + 1), text: heading[2].trim() });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      flushPara();
      flushQuote();
      if (items && ordered) flushList();
      if (!items) {
        items = [];
        ordered = false;
      }
      items.push(bullet[1].trim());
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushPara();
      flushQuote();
      if (items && !ordered) flushList();
      if (!items) {
        items = [];
        ordered = true;
      }
      items.push(numbered[1].trim());
      continue;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushPara();
      flushList();
      quote.push(quoted[1].trim());
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

const linkClass =
  "rounded-sm underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function inlineNodes(text: string, citations: Citation[], cursor: { n: number }): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `m${(cursor.n += 1)}`;

  while (i < text.length) {
    const rest = text.slice(i);

    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      const title = bold[1].trim();
      const cite = citations.find((c) => (c.title || "").trim() === title);
      const inner = <strong className="font-semibold">{inlineNodes(bold[1], citations, cursor)}</strong>;
      out.push(
        cite ? (
          <a
            key={key()}
            href={sourceHref(cite)}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {inner}
          </a>
        ) : (
          <Fragment key={key()}>{inner}</Fragment>
        ),
      );
      i += bold[0].length;
      continue;
    }

    const italic = rest.match(/^\*([^*\n]+)\*/) || rest.match(/^_([^_\n]+)_/);
    if (italic) {
      out.push(<em key={key()}>{inlineNodes(italic[1], citations, cursor)}</em>);
      i += italic[0].length;
      continue;
    }

    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      out.push(
        <code key={key()} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {code[1]}
        </code>,
      );
      i += code[0].length;
      continue;
    }

    const ref = rest.match(/^\[(\d{1,3})\]/);
    if (ref) {
      const n = Number(ref[1]);
      const cite = citations.find((c) => (c.ref || "").trim() === ref[0]) || citations[n - 1];
      if (cite) {
        out.push(
          <a
            key={key()}
            href={sourceHref(cite)}
            target="_blank"
            rel="noopener noreferrer"
            title={cite.title || cite.citation || "Authority"}
            className={linkClass}
          >
            {ref[0]}
          </a>,
        );
        i += ref[0].length;
        continue;
      }
    }

    // Plain text, up to the next character that could start any of the forms above.
    const stop = rest.slice(1).search(/[*_`\[]/);
    const len = stop < 0 ? rest.length : stop + 1;
    out.push(<Fragment key={key()}>{rest.slice(0, len)}</Fragment>);
    i += len;
  }
  return out;
}

const headingClass: Record<number, string> = {
  1: "text-base font-semibold",
  2: "text-base font-semibold",
  3: "pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground",
};

/** The authorities the memo actually cites, in the order the memo cites them. */
function citedIn(answer: string, citations: Citation[]): { ref: string; citation: Citation }[] {
  const out: { ref: string; citation: Citation }[] = [];
  const seen = new Set<string>();
  for (const match of String(answer || "").matchAll(/\[(\d{1,3})\]/g)) {
    const ref = match[0];
    if (seen.has(ref)) continue;
    const citation = citations.find((c) => (c.ref || "").trim() === ref) || citations[Number(match[1]) - 1];
    if (!citation) continue;
    seen.add(ref);
    out.push({ ref, citation });
  }
  return out;
}

export default function Memo({ answer, citations }: { answer: string; citations: Citation[] }) {
  const blocks = useMemo(() => parse(answer), [answer]);
  const footnotes = useMemo(() => citedIn(answer, citations), [answer, citations]);
  const cursor = { n: 0 };

  return (
    <div className="max-w-[70ch] space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, index) => {
        if (block.kind === "h") {
          const Tag = (`h${Math.max(2, block.level)}`) as "h2" | "h3";
          return (
            <Tag key={`b${index}`} className={headingClass[block.level]}>
              {inlineNodes(block.text, citations, cursor)}
            </Tag>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={`b${index}`} className="list-disc space-y-1 pl-5">
              {block.items.map((item, i) => (
                <li key={`i${i}`}>{inlineNodes(item, citations, cursor)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={`b${index}`} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, i) => (
                <li key={`i${i}`}>{inlineNodes(item, citations, cursor)}</li>
              ))}
            </ol>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={`b${index}`} className="border-l-2 border-border pl-3 italic text-muted-foreground">
              {inlineNodes(block.text, citations, cursor)}
            </blockquote>
          );
        }
        return <p key={`b${index}`}>{inlineNodes(block.text, citations, cursor)}</p>;
      })}

      {footnotes.length > 0 && (
        <div className="mt-4 border-t border-border pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Authorities cited</h2>
          <ul className="mt-1 space-y-1">
            {footnotes.map(({ ref, citation }) => (
              <li key={ref} className="text-xs leading-relaxed">
                <a
                  href={sourceHref(citation)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {ref} {citation.title || citation.citation || "Authority"}
                </a>
                <span className="text-muted-foreground">
                  {" · "}
                  {[citation.citation, citation.court, citation.date].filter(Boolean).join(" · ") || "Citation not recorded"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
