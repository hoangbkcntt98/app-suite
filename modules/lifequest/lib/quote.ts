export function getDailyQuoteIndex(date: Date, quoteCount: number) {
  if (quoteCount <= 0) {
    return 0;
  }

  const dayNumber = Math.floor(date.getTime() / 86400000);

  return dayNumber % quoteCount;
}