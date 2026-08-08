export type OverviewNavigationSection = {
  id: string;
  label: string;
};

export function OverviewSectionNavigation({
  sections,
  activeSectionId,
  onSelect,
}: {
  sections: ReadonlyArray<OverviewNavigationSection>;
  activeSectionId: string;
  onSelect: (sectionId: string) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <aside className="sticky top-0 z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur xl:top-6 xl:z-auto xl:mx-0 xl:bg-transparent xl:px-0 xl:py-0 xl:backdrop-blur-none">
      <p className="mb-2 hidden px-3 text-xs font-semibold text-foreground xl:block">
        Overview contents
      </p>
      <nav
        className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-card)] xl:flex-col xl:overflow-visible xl:shadow-none"
        aria-label="Overview contents"
      >
        {sections.map((section) => {
          const active = activeSectionId === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => onSelect(section.id)}
              aria-current={active ? "location" : undefined}
              className={[
                "flex min-h-10 shrink-0 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors xl:w-full",
                active
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              {section.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
