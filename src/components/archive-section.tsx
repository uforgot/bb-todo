"use client";

import type { ArchiveProject, ArchiveCategory, ArchiveItem } from "@/hooks/use-archive";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function ItemCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-xs tabular-nums text-green-500">
      {count}
    </span>
  );
}

function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-300/60 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "Z");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function ItemRow({ item, query }: { item: ArchiveItem; query?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="size-5 shrink-0 flex items-center justify-center text-xs text-green-500">
        ✓
      </span>
      <span className="flex-1 text-sm leading-snug text-pretty line-through text-muted-foreground">
        <HighlightText text={item.title} query={query} />
      </span>
      {item.archivedAt && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
          {formatDate(item.archivedAt)}
        </span>
      )}
    </div>
  );
}

function CategoryBlock({ category, query }: { category: ArchiveCategory; query?: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-2 pb-1 mb-0.5 border-b border-border/20">
        <span className="text-xs font-semibold text-muted-foreground">
          <HighlightText text={category.name} query={query} />
        </span>
        <ItemCount count={category.items.length} />
      </div>
      <div>
        {category.items.map((item) => (
          <ItemRow key={item.id} item={item} query={query} />
        ))}
      </div>
    </div>
  );
}

interface ArchiveSectionProps {
  project: ArchiveProject;
  defaultOpen?: boolean;
  query?: string;
}

export function ArchiveSection({ project, defaultOpen = false, query }: ArchiveSectionProps) {
  const totalItems = project.items.length +
    project.categories.reduce((acc, c) => acc + c.items.length, 0);

  return (
    <Card className="border shadow-none rounded-lg mb-1 border-border/50">
      <Accordion type="single" collapsible defaultValue={defaultOpen ? "section" : undefined}>
        <AccordionItem value="section" className="border-0">
          <AccordionTrigger className="px-3 py-1 hover:no-underline hover:bg-accent/20 rounded-lg transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-balance">
                {project.emoji ? `${project.emoji} ` : ""}
                <HighlightText text={project.name} query={query} />
              </span>
              <ItemCount count={totalItems} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-1.5">
            {project.items.length > 0 && (
              <div>
                {project.items.map((item) => (
                  <ItemRow key={item.id} item={item} query={query} />
                ))}
              </div>
            )}
            {project.categories.length > 0 && (
              <div className={project.items.length > 0 ? "mt-1.5" : ""}>
                {project.categories.map((cat) => (
                  <CategoryBlock key={cat.id} category={cat} query={query} />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
