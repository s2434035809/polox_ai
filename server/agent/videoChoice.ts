import type { AiModelConfig, SchemaProperty } from '../../shared/types/aiModel'
import type { AskUserArgs, ChatMessage, ChoiceAnswer, GenerateVideoArgs, VideoFamily } from './types'
import { AGENT_MODELS } from '../../shared/utils/agentModels'

/**
 * Video model / parameter cards driven only by the agent LLM's structured `videoRequest`.
 * User prose is never keyword- or regex-matched here. OSS has no credit ledger: "cheapest"
 * is the minimum of a relative cost index over the models registered right now, not a
 * hard-coded model name.
 */

export interface VideoRequestFields {
  requestKind?: 'new' | 'extend' | 'redo' | 'modify' | 'finalize'
  totalDurationSeconds?: number
  resolution?: string
  aspectRatio?: string
  seamlessLoop?: boolean
  firstFrame?: boolean
  referenceMedia?: 'none' | 'image' | 'video' | 'image_and_video' | 'audio' | 'unclear'
  modelId?: string
  clipCount?: number
  sourceImageUrls?: string[]
  structure?: 'continuous' | 'storyboard' | 'conflict'
}

const REQUEST_KINDS = new Set(['new', 'extend', 'redo', 'modify', 'finalize'])
const REFERENCE = new Set(['none', 'image', 'video', 'image_and_video', 'audio', 'unclear'])
const STRUCTURES = new Set(['continuous', 'storyboard', 'conflict'])
export const MAX_VIDEO_CLIPS = 20
const CHEAP_TEST_TIP = 'Tip: duration and resolution start at the cheapest tier so you can cheap-test first. Raise them after you like the result. Skip uses every Recommended value.'

export function validateVideoRequest(value: unknown): VideoRequestFields {
  if (!value || typeof value !== 'object')
    return {}
  const raw = value as Record<string, unknown>
  const request: VideoRequestFields = {}
  if (REQUEST_KINDS.has(String(raw.requestKind)))
    request.requestKind = raw.requestKind as VideoRequestFields['requestKind']
  if (STRUCTURES.has(String(raw.structure)))
    request.structure = raw.structure as VideoRequestFields['structure']
  if (REFERENCE.has(String(raw.referenceMedia)))
    request.referenceMedia = raw.referenceMedia as VideoRequestFields['referenceMedia']
  const duration = Number(raw.totalDurationSeconds)
  if (Number.isFinite(duration) && duration > 0)
    request.totalDurationSeconds = duration
  if (typeof raw.resolution === 'string' && raw.resolution.trim())
    request.resolution = raw.resolution.trim().slice(0, 32)
  if (typeof raw.aspectRatio === 'string' && raw.aspectRatio.trim())
    request.aspectRatio = raw.aspectRatio.trim().slice(0, 16)
  if (typeof raw.seamlessLoop === 'boolean')
    request.seamlessLoop = raw.seamlessLoop
  if (typeof raw.firstFrame === 'boolean')
    request.firstFrame = raw.firstFrame
  if (typeof raw.modelId === 'string' && raw.modelId.trim())
    request.modelId = raw.modelId.trim().slice(0, 120)
  const clips = Number(raw.clipCount)
  if (Number.isInteger(clips) && clips > 1)
    request.clipCount = Math.min(MAX_VIDEO_CLIPS, clips)
  if (Array.isArray(raw.sourceImageUrls)) {
    const urls = raw.sourceImageUrls.filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item)).slice(0, MAX_VIDEO_CLIPS)
    if (urls.length)
      request.sourceImageUrls = urls
  }
  return request
}

function latestUserIndex(messages: ChatMessage[]) {
  return messages.findLastIndex(message => message.role === 'user' && !message.internal)
}

function askArgs(message: ChatMessage): Array<{ id: string, args: Record<string, unknown> }> {
  if (message.role !== 'assistant')
    return []
  const rows: Array<{ id: string, args: Record<string, unknown> }> = []
  for (const call of message.tool_calls || []) {
    if (call.function.name !== 'ask_user')
      continue
    try {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>
      if (args && typeof args === 'object')
        rows.push({ id: call.id, args })
    }
    catch { /* Ignore malformed calls. */ }
  }
  return rows
}

/** Where the current video request opened. A finished video or a stop closes it. */
export function videoRequestStart(messages: ChatMessage[]) {
  const lastUser = latestUserIndex(messages)
  let userIndex = -1
  let requestStart = -1
  let completed = -1
  const calls = new Map<string, string>()
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    if (message.role === 'user' && !message.internal)
      userIndex = index
    if (message.role === 'assistant' && message.stopped) {
      requestStart = -1
      continue
    }
    for (const row of askArgs(message)) {
      calls.set(row.id, 'ask_user')
      const request = validateVideoRequest(row.args.videoRequest)
      const questions = Array.isArray(row.args.questions) ? row.args.questions as Array<{ id?: string }> : []
      const videoCard = Boolean(request.requestKind) || questions.some(question => String(question.id || '').startsWith('video_'))
      if (videoCard && userIndex >= 0 && userIndex > completed)
        requestStart = userIndex
    }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) {
        if (call.function.name === 'generate_video' || call.function.name.startsWith('model_'))
          calls.set(call.id, call.function.name)
      }
    }
    if (message.role !== 'tool' || !message.tool_call_id || typeof message.content !== 'string')
      continue
    const name = calls.get(message.tool_call_id)
    if (!name || name === 'ask_user')
      continue
    try {
      const result = JSON.parse(message.content) as { ok?: boolean, urls?: unknown[] }
      const modelId = name.startsWith('model_')
        ? AGENT_MODELS.find(model => `model_${model.id.replace(/[^a-z0-9]/gi, '_')}` === name && model.category === 'Video')?.id
        : name === 'generate_video' ? 'generate_video' : ''
      if ((modelId || name === 'generate_video') && result.ok && Array.isArray(result.urls) && result.urls.length) {
        completed = index
        requestStart = -1
      }
    }
    catch { /* Ignore unrelated tool results. */ }
  }
  if (requestStart >= 0)
    return requestStart
  if (completed >= 0) {
    const next = messages.findIndex((message, index) => index > completed && message.role === 'user' && !message.internal)
    return next >= 0 ? next : messages.length
  }
  return lastUser
}

function mergedRequest(messages: ChatMessage[]): VideoRequestFields {
  const start = videoRequestStart(messages)
  const request: VideoRequestFields = {}
  for (const message of messages.slice(Math.max(start, 0))) {
    for (const row of askArgs(message))
      Object.assign(request, validateVideoRequest(row.args.videoRequest))
  }
  return request
}

function userText(message: ChatMessage) {
  const content = message.content
  return typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : ''
}

function stillUrls(message: ChatMessage) {
  if (message.role !== 'user' || message.internal)
    return []
  const content = message.content
  const parts = Array.isArray(content) ? content.filter(part => part.type === 'image_url').map(part => part.image_url.url) : []
  const listed = [...userText(message).matchAll(/https?:\/\/[^\s<>"']+?\.(?:png|jpe?g|webp)(?:\?[^\s<>"']*)?(?=\s|$)/gi)].map(match => match[0])
  return [...new Set([...parts, ...listed])]
}

function scopedMedia(messages: ChatMessage[]) {
  const start = Math.max(videoRequestStart(messages), 0)
  const scoped = messages.slice(start)
  const stills = [...new Set([...scoped.flatMap(stillUrls), ...(mergedRequest(messages).sourceImageUrls || [])])]
  let videos = 0
  let audios = 0
  for (const message of scoped) {
    const text = userText(message)
    if (/\n\nAttached video references:/i.test(text))
      videos += 1
    if (/\n\nAttached voice references:/i.test(text))
      audios += 1
  }
  return { stills, videos, audios }
}

interface AnsweredCard {
  args: AskUserArgs
  skipped: boolean
  answers: ChoiceAnswer[]
}

function answeredCards(messages: ChatMessage[]): AnsweredCard[] {
  const start = videoRequestStart(messages)
  const calls = new Map<string, AskUserArgs>()
  const cards: AnsweredCard[] = []
  for (const message of messages.slice(Math.max(start, 0))) {
    for (const row of askArgs(message)) {
      const questions = Array.isArray(row.args.questions) ? row.args.questions as AskUserArgs['questions'] : []
      calls.set(row.id, { ...(row.args as unknown as AskUserArgs), questions, videoRequest: validateVideoRequest(row.args.videoRequest) })
    }
    if (message.role !== 'tool' || !message.tool_call_id || typeof message.content !== 'string')
      continue
    const args = calls.get(message.tool_call_id)
    if (!args)
      continue
    try {
      const result = JSON.parse(message.content) as { ok?: boolean, skipped?: boolean, cancelled?: boolean, answers?: ChoiceAnswer[] }
      if (result.cancelled || result.ok === false)
        continue
      if (result.ok && (result.skipped || Array.isArray(result.answers)))
        cards.push({ args, skipped: Boolean(result.skipped), answers: result.answers || [] })
    }
    catch { /* Ignore unrelated tool results. */ }
  }
  return cards
}

function propsOf(model: AiModelConfig): Record<string, SchemaProperty> {
  return model.schema?.components?.schemas?.Input?.properties || {}
}

function hasField(model: AiModelConfig, names: string[]) {
  const fields = propsOf(model)
  return names.some(name => Boolean(fields[name]))
}

function resolutionWeight(value: string) {
  const text = String(value).toLowerCase()
  const pixels = text.match(/(\d+)\s*p/)
  if (pixels)
    return Number(pixels[1])
  if (text.includes('4k'))
    return 2160
  if (text.includes('2k'))
    return 1440
  const number = text.match(/(\d{3,4})/)
  return number ? Number(number[1]) : 1080
}

function durationBounds(model: AiModelConfig) {
  const field = propsOf(model).duration
  const allowed = (field?.enum || []).map(Number).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  const min = allowed[0] ?? (typeof field?.minimum === 'number' ? field.minimum : Number(field?.default || 5))
  const max = allowed.at(-1) ?? (typeof field?.maximum === 'number' ? field.maximum : min)
  return { min, max, allowed }
}

function resolutionsOf(model: AiModelConfig) {
  const values = (propsOf(model).resolution?.enum || []).map(String)
  return [...values].sort((a, b) => resolutionWeight(a) - resolutionWeight(b))
}

/**
 * Relative cost index for ranking only. Not a price quote and not a recommended model name.
 * Lower means cheaper at the same duration and resolution.
 */
export function videoRateIndex(modelId: string) {
  const key = modelId.toLowerCase()
  if (key.startsWith('wan/'))
    return 1
  if (key.includes('seedance-2-5') || key.includes('seedance-2.5'))
    return 2.1
  if (key.includes('seedance-2'))
    return 1.35
  if (key.includes('flux-3') || key.includes('flux3'))
    return 1.8
  if (key.includes('minimax'))
    return 2.6
  return 2
}

export function cheapestVideoCost(model: AiModelConfig) {
  const resolutions = resolutionsOf(model)
  const weight = resolutions.length ? resolutionWeight(resolutions[0]!) : resolutionWeight(String(propsOf(model).resolution?.default || '720p'))
  const { min } = durationBounds(model)
  return videoRateIndex(model.id) * Math.max(min, 1) * weight
}

function videoFamilyFor(modelId: string): VideoFamily | undefined {
  if (modelId.includes('seedance-2-5') || modelId.includes('seedance-2.5'))
    return 'seedance-2-5'
  if (modelId.includes('seedance-2'))
    return 'seedance-2'
  if (modelId.startsWith('wan/'))
    return 'wan-3'
  return undefined
}

function candidates(messages: ChatMessage[]) {
  const request = mergedRequest(messages)
  const media = scopedMedia(messages)
  const loop = request.seamlessLoop === true
  const reference = request.referenceMedia
  const wantsVideo = reference === 'video' || reference === 'image_and_video' || media.videos > 0
  const wantsImage = reference === 'image' || reference === 'image_and_video' || media.stills.length > 0
  const wantsAudio = reference === 'audio' || media.audios > 0
  const explicitReference = reference === 'image' || reference === 'video' || reference === 'image_and_video' || reference === 'audio'
  return AGENT_MODELS.filter((model) => {
    if (model.category !== 'Video')
      return false
    if (loop)
      return model.task === 'Image to Video' && hasField(model, ['last_image', 'last_frame', 'last_frame_url'])
    if (explicitReference || wantsVideo || (wantsImage && reference !== 'none' && !request.firstFrame) || wantsAudio) {
      if (wantsVideo)
        return model.task === 'Reference to Video' && hasField(model, ['reference_videos', 'reference_video_urls', 'video'])
      if (wantsImage)
        return model.task === 'Reference to Video' && hasField(model, ['reference_images', 'reference_image_urls', 'images'])
      if (wantsAudio)
        return model.task === 'Reference to Video' && hasField(model, ['reference_audios', 'reference_audio_urls'])
      return model.task === 'Reference to Video'
    }
    if (request.firstFrame || media.stills.length)
      return model.task === 'Image to Video' && hasField(model, ['image', 'first_frame', 'first_frame_url'])
    return model.task === 'Text to Video'
  })
}

function referenceState(messages: ChatMessage[]) {
  const request = mergedRequest(messages)
  const media = scopedMedia(messages)
  const declared = request.referenceMedia
  const explicit = declared === 'image' || declared === 'video' || declared === 'image_and_video' || declared === 'audio' || declared === 'none'
  const ambiguous = declared === 'unclear' && !media.stills.length && !media.videos && !media.audios
  const cards = answeredCards(messages)
  const answered = cards.some(card => card.skipped
    ? card.args.questions.some(question => question.id === 'video_reference_intent')
    : card.answers.some(answer => answer.questionId === 'video_reference_intent'))
  const missing = !ambiguous && declared !== 'none' && declared !== undefined && explicit
    && ((declared === 'video' || declared === 'image_and_video') && !media.videos
      || declared === 'image' && !media.stills.length
      || declared === 'audio' && !media.audios)
  return { ambiguous: ambiguous && !answered, missing, answered }
}

export interface VideoChoice {
  settled: boolean
  stage: 'reference' | 'upload' | 'model' | 'params' | 'complete' | 'conflict'
  modelId?: string
  family?: VideoFamily
  settings?: { resolution: string, duration: number, aspect_ratio?: string }
  clipCount: number
}

function chosenOption(card: AnsweredCard, questionId: string) {
  const question = card.args.questions.find(item => item.id === questionId)
  const answer = card.answers.find(item => item.questionId === questionId)
  if (!question)
    return undefined
  if (card.skipped || answer?.skipped)
    return question.recommendedId
  return answer?.optionId
}

function modelFromCard(messages: ChatMessage[]) {
  const available = candidates(messages)
  const card = answeredCards(messages).findLast(item => item.args.questions.some(question => question.id === 'video_model'))
  if (!card)
    return undefined
  const optionId = chosenOption(card, 'video_model')
  return available.find(model => model.id === optionId)
}

function parameterQuestions(model: AiModelConfig, request: VideoRequestFields) {
  const resolutions = resolutionsOf(model)
  const bounds = durationBounds(model)
  const questions: AskUserArgs['questions'] = []
  const fixed: { resolution: string, duration: number, aspect_ratio?: string } = {
    resolution: resolutions[0] || String(propsOf(model).resolution?.default || ''),
    duration: bounds.min,
  }
  if (resolutions.length > 1) {
    const requested = request.resolution && resolutions.find(value => value.toLowerCase() === request.resolution!.toLowerCase())
    const cheapest = resolutions[0]!
    questions.push({
      id: 'video_param_resolution',
      prompt: 'Which resolution?',
      recommendedId: `resolution:${cheapest}`,
      options: resolutions.slice(0, 7).map(value => ({
        id: `resolution:${value}`,
        label: `${value}${value === cheapest ? ' (Recommended)' : ''}${requested && value === requested && value !== cheapest ? ' · your request' : ''}`,
        description: value === cheapest ? 'Cheapest tier. Cheap-test first, then raise it if you like the result.' : 'Higher resolution costs more.',
      })),
    })
  }
  const requestedDuration = request.totalDurationSeconds
  const legalRequested = requestedDuration !== undefined
    ? (bounds.allowed.length ? bounds.allowed.find(value => value >= requestedDuration) : Math.min(bounds.max, Math.max(bounds.min, requestedDuration)))
    : undefined
  const durationValues = [...new Set([bounds.min, ...(legalRequested && legalRequested !== bounds.min ? [legalRequested] : [])])].filter(value => value > 0)
  if (durationValues.length > 1 || bounds.min !== bounds.max) {
    const options = durationValues.map(value => ({
      id: `duration:${value}`,
      label: `${value}s${value === bounds.min ? ' (Recommended)' : ''}${legalRequested === value && value !== bounds.min ? ' · your request' : ''}`,
      description: value === bounds.min ? 'Shortest length. Cheap-test first.' : 'Longer clip.',
    }))
    if (!bounds.allowed.length && bounds.max > bounds.min)
      options.push({ id: 'other', label: 'Other', description: `${bounds.min}–${bounds.max} seconds` })
    questions.push({
      id: 'video_param_duration',
      prompt: 'Which duration?',
      recommendedId: `duration:${bounds.min}`,
      options,
    })
  }
  const ratios = (propsOf(model).aspect_ratio?.enum || []).map(String)
  if (request.aspectRatio && ratios.includes(request.aspectRatio))
    fixed.aspect_ratio = request.aspectRatio
  return { questions, fixed, bounds }
}

function settingsFromCard(model: AiModelConfig, messages: ChatMessage[]) {
  const request = mergedRequest(messages)
  const spec = parameterQuestions(model, request)
  const card = answeredCards(messages).findLast(item => item.args.questions.some(question => question.id.startsWith('video_param_')))
  if (!spec.questions.length)
    return spec.fixed
  if (!card)
    return undefined
  const settings = { ...spec.fixed }
  for (const question of spec.questions) {
    const optionId = chosenOption(card, question.id)
    if (!optionId)
      return undefined
    if (question.id === 'video_param_resolution') {
      const value = optionId.startsWith('resolution:') ? optionId.slice('resolution:'.length) : ''
      if (!resolutionsOf(model).includes(value))
        return undefined
      settings.resolution = value
    }
    if (question.id === 'video_param_duration') {
      if (optionId === 'other') {
        const answer = card.answers.find(item => item.questionId === question.id)
        const number = Number(answer?.text?.trim())
        if (!Number.isFinite(number) || number < spec.bounds.min || number > spec.bounds.max)
          return undefined
        settings.duration = Math.round(number)
      }
      else {
        const value = Number(optionId.startsWith('duration:') ? optionId.slice('duration:'.length) : '')
        if (!Number.isFinite(value))
          return undefined
        settings.duration = value
      }
    }
  }
  return settings
}

export function videoChoice(messages: ChatMessage[]): VideoChoice {
  const request = mergedRequest(messages)
  const clipCount = request.clipCount || 1
  if (request.structure === 'conflict')
    return { settled: false, stage: 'conflict', clipCount }
  const reference = referenceState(messages)
  if (reference.ambiguous)
    return { settled: false, stage: 'reference', clipCount }
  if (reference.missing)
    return { settled: false, stage: 'upload', clipCount }
  const model = modelFromCard(messages)
  if (!model)
    return { settled: false, stage: 'model', clipCount }
  const settings = settingsFromCard(model, messages)
  if (!settings)
    return { settled: false, stage: 'params', modelId: model.id, family: videoFamilyFor(model.id), clipCount }
  return { settled: true, stage: 'complete', modelId: model.id, family: videoFamilyFor(model.id), settings, clipCount }
}

export function modelChoiceAskArgs(messages: ChatMessage[], proposed?: AskUserArgs): AskUserArgs {
  const preview = validateVideoRequest(proposed?.videoRequest)
  const withPreview = Object.keys(preview).length
    ? [...messages, {
        role: 'assistant' as const,
        tool_calls: [{ id: 'video-request-preview', type: 'function' as const, function: { name: 'ask_user', arguments: JSON.stringify({ videoRequest: preview, questions: [] }) } }],
      }]
    : messages
  const request = { ...mergedRequest(withPreview), ...preview }
  if (request.structure === 'conflict')
    throw new Error('The request asks for both one uncut take and separate shots. Call ask_user to resolve that before choosing a model. Do not generate yet.')
  const state = videoChoice(withPreview)
  const clips = state.clipCount
  const base = {
    ...(Object.keys(request).length ? { videoRequest: request } : {}),
    recommendation: '',
  }
  if (state.stage === 'reference') {
    return {
      ...base,
      prompt: 'Use reference-to-video?',
      questions: [{
        id: 'video_reference_intent',
        prompt: 'Use reference-to-video?',
        recommendedId: 'yes',
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      }],
    }
  }
  if (state.stage === 'upload') {
    const prompt = request.seamlessLoop
      ? clips > 1 ? `Add the ${clips} images. Each one is both the first and last frame of its own loop.` : 'Add the image used as both the first and last frame of the loop.'
      : 'Add the reference media before generation.'
    return {
      ...base,
      prompt,
      questions: [{
        id: 'video_reference_upload',
        prompt,
        recommendedId: 'upload',
        options: [{ id: 'upload', label: 'Add media', description: 'Upload a file or pick one already in the project.' }],
      }],
    }
  }
  const available = candidates(withPreview).slice().sort((a, b) => cheapestVideoCost(a) - cheapestVideoCost(b) || a.name.localeCompare(b.name))
  if (!available.length)
    throw new Error('No registered video model fits this request.')
  if (state.stage === 'model' || !state.modelId) {
    const families: AiModelConfig[] = []
    for (const model of available) {
      if (!families.some(item => item.name === model.name))
        families.push(model)
    }
    const listed = families.slice(0, 7)
    const cheapest = listed[0]!
    return {
      ...base,
      prompt: clips > 1 ? `Choose the model for these ${clips} videos.` : 'Choose the model for this video.',
      recommendation: `Recommended: ${cheapest.name}, the cheapest suitable model registered right now. ${CHEAP_TEST_TIP}`,
      questions: [{
        id: 'video_model',
        prompt: 'Which video model should I use?',
        recommendedId: cheapest.id,
        options: [
          ...listed.map(model => ({
            id: model.id,
            label: `${model.name}${model.id === cheapest.id ? ' (Recommended)' : ''}`,
            description: model.id === cheapest.id
              ? `${model.task}. Cheapest suitable option right now. ${CHEAP_TEST_TIP}`
              : `${model.task}.`,
          })),
          { id: 'other', label: 'Other', custom: true },
        ],
      }],
    }
  }
  const model = AGENT_MODELS.find(item => item.id === state.modelId)
  if (!model)
    throw new Error('Choose a video model first.')
  const spec = parameterQuestions(model, request)
  return {
    ...base,
    prompt: clips > 1 ? `Choose duration and resolution for each of the ${clips} videos.` : 'Choose duration and resolution.',
    recommendation: CHEAP_TEST_TIP + (clips > 1 ? ` One card covers all ${clips} videos.` : ''),
    questions: spec.questions.length
      ? spec.questions
      : [{
          id: 'video_param_duration',
          prompt: 'Which duration?',
          recommendedId: `duration:${spec.fixed.duration}`,
          options: [{ id: `duration:${spec.fixed.duration}`, label: `${spec.fixed.duration}s (Recommended)`, description: 'Cheapest tier.' }],
        }],
  }
}

export function videoToolError(messages: ChatMessage[]) {
  const state = videoChoice(messages)
  if (state.stage === 'conflict')
    return 'Resolve whether this is one uncut take or separate shots before generating.'
  if (state.stage === 'complete')
    return ''
  return 'Video model and parameters are not chosen yet. Call ask_user alone with videoRequest filled from your reading of the user (requestKind, and structure, referenceMedia, seamlessLoop, firstFrame, clipCount, totalDurationSeconds, resolution, aspectRatio, modelId, sourceImageUrls only when the user addressed them). The runtime replaces that call with the live model card, then the cheapest duration and resolution card. Do not generate until both are answered.'
}

export function selectedVideoToolError(messages: ChatMessage[], calledModelId: string | undefined) {
  const state = videoChoice(messages)
  if (!state.settled || !state.modelId)
    return videoToolError(messages)
  if (calledModelId === state.modelId)
    return ''
  const tool = `model_${state.modelId.replace(/[^a-z0-9]/gi, '_')}`
  return `Selected model is ${state.modelId}; call ${tool} or generate_video after the parameter card. Compatible models are chosen on the card, not inferred from the wording.`
}

export function applySettledVideoArgs(args: GenerateVideoArgs, messages: ChatMessage[]): GenerateVideoArgs {
  const state = videoChoice(messages)
  if (!state.settled || !state.settings || !state.family)
    return args
  return {
    ...args,
    family: state.family,
    resolution: (state.settings.resolution || args.resolution) as GenerateVideoArgs['resolution'],
    duration: state.settings.duration || args.duration,
    ...(state.settings.aspect_ratio ? { aspect_ratio: state.settings.aspect_ratio as GenerateVideoArgs['aspect_ratio'] } : {}),
  }
}

export function isVideoModelTool(name: string) {
  const model = AGENT_MODELS.find(item => `model_${item.id.replace(/[^a-z0-9]/gi, '_')}` === name)
  return Boolean(model && model.category === 'Video')
}

export function videoModelIdForTool(name: string) {
  return AGENT_MODELS.find(item => `model_${item.id.replace(/[^a-z0-9]/gi, '_')}` === name && item.category === 'Video')?.id
}
