// The memo as formatted text: headings, bold, lists, quotes and paragraphs, with every citation
// reference and every bolded authority name linked to the document behind it. Each of the memo's own
// headings is a dropdown, so a long answer opens as its short answer plus a row of section titles and
// the reader unfolds only what they came for.

import { Fragment, useMemo, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Citation } from "@/lib/citations";
import { cn } from "@/lib/utils";

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

/** One dropdown: the heading that opens it, and the blocks the writer put under that heading. */
type Section = { key: string; title: string | null; blocks: Block[] };

/**
 * The memo cut at its own top-level headings. Whatever the writer put above the first heading stays
 * outside the dropdowns — that is the short answer, and it should be read without a click. A heading
 * nested below the top level stays inside its section, so sub-headings do not become siblings of it.
 */
function split(blocks: Block[]): Section[] {
  let top = 0;
  for (const block of blocks) {
    if (block.kind === "h") top = top ? Math.min(top, block.level) : block.level;
  }
  const sections: Section[] = [{ key: "s0", title: null, blocks: [] }];
  for (const block of blocks) {
    if (top && block.kind === "h" && block.level === top) {
      sections.push({ key: `s${sections.length}`, title: block.text, blocks: [] });
      continue;
    }
    sections[sections.length - 1].blocks.push(block);
  }
  return sections;
}

/** A section title is a button, so its text cannot hold links: the marks come off, the words stay. */
function headingText(text: string): string {
  return text
    .replace(/\*\*|__|[*_`]/g, "")
    .replace(/\[(\d{1,3})\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function renderBlock(block: Block, key: string, citations: Citation[], cursor: { n: number }): ReactNode {
  if (block.kind === "h") {
    const Tag = `h${Math.max(2, block.level)}` as "h2" | "h3";
    return (
      <Tag key={key} className={headingClass[block.level]}>
        {inlineNodes(block.text, citations, cursor)}
      </Tag>
    );
  }
  if (block.kind === "ul") {
    return (
      <ul key={key} className="list-disc space-y-1 pl-5">
        {block.items.map((item, i) => (
          <li key={`i${i}`}>{inlineNodes(item, citations, cursor)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "ol") {
    return (
      <ol key={key} className="list-decimal space-y-1 pl-5">
        {block.items.map((item, i) => (
          <li key={`i${i}`}>{inlineNodes(item, citations, cursor)}</li>
        ))}
      </ol>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote key={key} className="border-l-2 border-border pl-3 italic text-muted-foreground">
        {inlineNodes(block.text, citations, cursor)}
      </blockquote>
    );
  }
  return <p key={key}>{inlineNodes(block.text, citations, cursor)}</p>;
}

/**
 * The memo as formatted text and nothing else. The list of authorities it cites is not repeated under
 * the prose: `[n]` already links to the document, and the Sources drawer holds the full list, so the
 * answer stays the answer instead of becoming a bibliography with a memo on top.
 *
 * `collapsible` is off for the draft as it streams in, because a heading that folded away the words
 * arriving underneath it would hide the writing rather than help the reader.
 */
export default function Memo({
  answer,
  citations,
  collapsible = true,
}: {
  answer: string;
  citations: Citation[];
  collapsible?: boolean;
}) {
  const blocks = useMemo(() => parse(answer), [answer]);
  const sections = useMemo(() => split(blocks), [blocks]);
  const cursor = { n: 0 };

  const plain = (list: Block[], prefix: string) => (
    <div className="space-y-3">{list.map((block, i) => renderBlock(block, `${prefix}b${i}`, citations, cursor))}</div>
  );

  const lead = sections[0];
  const titled = sections.slice(1);
  if (!collapsible || !titled.length) {
    return <div className="max-w-[70ch] text-sm leading-relaxed text-foreground">{plain(blocks, "")}</div>;
  }

  return (
    <div className="max-w-[70ch] text-sm leading-relaxed text-foreground">
      {!!lead.blocks.length && plain(lead.blocks, "lead")}

      {/* The first section is open, so an answer still leads with its substance; the rest are one click away. */}
      <Accordion type="multiple" defaultValue={[titled[0].key]} className={cn(lead.blocks.length > 0 && "mt-2")}>
        {titled.map((section) => (
          <AccordionItem key={section.key} value={section.key} className="border-border/70">
            <AccordionTrigger className="rounded-md py-1.5 text-sm font-semibold hover:bg-accent/60 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {headingText(section.title ?? "")}
            </AccordionTrigger>
            <AccordionContent className="pb-2 motion-reduce:animate-none">
              <div className="space-y-2">{section.blocks.map((block, i) => renderBlock(block, `${section.key}b${i}`, citations, cursor))}</div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
