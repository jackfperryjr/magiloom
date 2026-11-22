// Hand-kept DragonRealms titles that Elanthipedia doesn't list YET, so
// scripts/scrape-titles.js can't pick them up. The scrape already includes the
// wiki's Category:Custom_titles (every page in it is also in Category:Titles), so
// this is only for new titles waiting to be added to the wiki. Once a title shows
// up in a re-scrape, its entry here is a harmless duplicate and can be removed.
// Add the title exactly as the game prints it. Merged in lib/lookName.ts.

export const CUSTOM_DR_TITLES: readonly string[] = [
  'Lantern Keeper',
]
