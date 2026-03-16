export function normalizeModelList(models: Iterable<string | null | undefined>): string[] {
  const uniqueModels = new Set<string>();

  for (const model of models) {
    if (typeof model !== "string") {
      continue;
    }

    const normalized = model.trim();
    if (!normalized) {
      continue;
    }

    uniqueModels.add(normalized);
  }

  return Array.from(uniqueModels).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}