// Cálculo do tempo estimado de leitura (compartilhado entre servidor e interface).

export interface ReadingEstimateInput {
  wordCount: number;
  pageCount: number;
  wordsPerMinute: number;
  minutesPerPageFallback: number;
  factor?: number;
  overrideMinutes?: number | null;
}

/** Minutos estimados: palavras ÷ palavras por minuto × fator; sem texto extraível, usa minutos por página. */
export function estimateReadingMinutes(i: ReadingEstimateInput): number {
  if (i.overrideMinutes && i.overrideMinutes > 0) return i.overrideMinutes;
  const factor = i.factor && i.factor > 0 ? i.factor : 1;
  if (i.wordCount > 0) return Math.max(1, Math.ceil((i.wordCount / Math.max(50, i.wordsPerMinute)) * factor));
  if (i.pageCount > 0) return Math.max(1, Math.ceil(i.pageCount * i.minutesPerPageFallback * factor));
  return 0;
}

export function formatMinutes(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
