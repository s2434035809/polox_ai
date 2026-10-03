/**
 * Attachment names shown to the agent LLM next to attached media URLs.
 *
 * Names are user-given labels (original or renamed file / asset names). They are untrusted
 * user data: never parsed or matched against the user's text here. The LLM alone decides how a
 * reference like "the logo" maps to an attachment.
 */

export const ATTACHMENT_NAME_MAX = 100

/**
 * One-line, bounded, inert label: control / line-break / bidi characters become spaces,
 * URL schemes are dropped (runtime helpers scan attachment sections for URLs, so a name must
 * never look like one), whitespace is collapsed and the result is capped at 100 characters.
 */
export function sanitizeAttachmentName(value: unknown): string {
  if (typeof value !== 'string')
    return ''
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\//gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ATTACHMENT_NAME_MAX)
    .trim()
}

/** `1. "logo.png" — https://…` (JSON-quoted name) or `1. https://…` when there is no name. */
export function attachmentListLine(index: number, url: string, name?: string): string {
  const label = sanitizeAttachmentName(name)
  return label ? `${index + 1}. ${JSON.stringify(label)} — ${url}` : `${index + 1}. ${url}`
}

export const MAX_CHAT_ATTACHMENTS = 16

/**
 * Chat request `attachments`: plain URL strings (legacy) or `{ url, name }` objects carrying the
 * name the user sees on the attachment chip at send time. Returns unique http(s) URLs in order
 * plus the sanitized send-time names by URL.
 */
export function parseChatAttachments(value: unknown): { urls: string[], names: Map<string, string> } {
  const names = new Map<string, string>()
  if (!Array.isArray(value))
    return { urls: [], names }
  const urls: string[] = []
  for (const item of value) {
    const raw = typeof item === 'string'
      ? item
      : item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string'
        ? (item as { url: string }).url
        : ''
    const url = raw.trim()
    if (!/^https?:\/\//i.test(url))
      continue
    urls.push(url)
    const name = item && typeof item === 'object' ? sanitizeAttachmentName((item as { name?: unknown }).name) : ''
    if (name && !names.has(url))
      names.set(url, name)
  }
  if (urls.length > MAX_CHAT_ATTACHMENTS)
    throw new Error('A maximum of 16 attached images is allowed')
  return { urls: [...new Set(urls)], names }
}
