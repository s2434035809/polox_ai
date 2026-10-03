/**
 * Upload rules shared by the canvas file drop. They mirror the chat attachment
 * upload in useAgentLab.attachFiles (same types, per-kind size limits and error copy);
 * scripts/test-canvas-file-drop.mjs checks the two stay in sync.
 */
export type AgentUploadKind = 'image' | 'audio' | 'video' | 'document'

export const AGENT_UPLOAD_MAX_BYTES: Record<AgentUploadKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  document: 40 * 1024 * 1024,
}

export const AGENT_UPLOAD_SIZE_ERRORS: Record<AgentUploadKind, string> = {
  image: 'Each image must be 10MB or smaller',
  audio: 'Each audio file must be 15MB or smaller',
  video: 'Each video must be 200MB or smaller',
  document: 'Each document must be 40MB or smaller',
}

/** File picker `accept` for canvas/chat uploads (same list the chat paperclip uses). */
export const AGENT_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/ogg,audio/mp4,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv'

export const AGENT_UPLOAD_TYPE_ERROR = 'Upload JPEG, PNG, WEBP, GIF, MP4/MOV/WEBM video, MP3/WAV/AAC/OGG/M4A/WEBM audio, or PDF/DOCX/PPTX/XLSX/CSV'

export interface AgentUploadPlan<F extends { size: number }> {
  accepted: Array<{ file: F, kind: AgentUploadKind }>
  /** Error messages to surface, in order (the last one is what the single error banner shows). */
  errors: string[]
}

/**
 * Split dropped files into uploadable ones and user-facing errors.
 * `classify` returns the attachment kind or null for unsupported files.
 */
export function planAgentUploads<F extends { size: number }>(files: F[], classify: (file: F) => AgentUploadKind | null): AgentUploadPlan<F> {
  const errors: string[] = []
  const typed = files.flatMap((file) => {
    const kind = classify(file)
    return kind ? [{ file, kind }] : []
  })
  if (typed.length < files.length)
    errors.push(AGENT_UPLOAD_TYPE_ERROR)
  if (!typed.length)
    return { accepted: [], errors }
  const accepted = typed.filter((item) => {
    if (item.file.size <= AGENT_UPLOAD_MAX_BYTES[item.kind])
      return true
    errors.push(AGENT_UPLOAD_SIZE_ERRORS[item.kind])
    return false
  })
  return { accepted, errors }
}
