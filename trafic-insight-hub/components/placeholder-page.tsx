export function PlaceholderPage({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 md:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Em construção
      </p>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{title}</h1>
      <p className="mt-1 max-w-[60ch] text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <ul className="mt-6 flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
