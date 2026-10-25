/**
 * Official DragonRealms artwork.
 *
 * The game marks some text with `<resource picture="N"/>`: an NPC portrait ahead
 * of a LOOK, an event scene ahead of its description. The pictures are public
 * on play.net in two sizes, a small thumbnail (`N_t.jpg`, ~80px wide) and the
 * full image (`N.jpg`). The renderer's CSP allows exactly this host for images
 * (see index.html), so a change of host here needs a matching change there.
 *
 * `0` means "no artwork" and arrives on every room change, so it's never a picture.
 */

const ART_BASE = 'https://www.play.net/bfe/DR-art/'

/** A positive integer picture id, bounded so a garbled attribute can't build a silly URL. */
export const isArtworkId = (id: string): boolean => /^[1-9]\d{0,9}$/.test(id)

export const artworkThumbUrl = (id: string): string => `${ART_BASE}${id}_t.jpg`
export const artworkFullUrl  = (id: string): string => `${ART_BASE}${id}.jpg`
