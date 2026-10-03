let controller: AbortController | undefined
let paused = false
let installed = false
const resumeListeners = new Set<() => void>()
const pauseListeners = new Set<() => void>()

function pause() {
  if (paused)
    return
  paused = true
  controller?.abort()
  for (const listener of pauseListeners)
    listener()
}

function resume() {
  if (!paused || document.hidden)
    return
  paused = false
  controller = new AbortController()
  for (const listener of resumeListeners)
    listener()
}

function install() {
  if (installed || !import.meta.client)
    return
  installed = true
  controller = new AbortController()
  paused = document.hidden
  if (paused)
    controller.abort()
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume())
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', resume)
  // WebKit can deliver pagehide (or a stale hidden state) without a matching
  // visible/pageshow event; focus and the Page Lifecycle resume event also end a pause.
  window.addEventListener('focus', resume)
  document.addEventListener('resume', resume)
}

export function pageLifecycleSignal() {
  install()
  // A visible page must never hand out an aborted signal: that would make every
  // request fail instantly until another lifecycle event happens to arrive.
  if (paused && !document.hidden)
    resume()
  return controller?.signal
}

export function onPageResume(listener: () => void) {
  install()
  resumeListeners.add(listener)
  return () => resumeListeners.delete(listener)
}

export function onPagePause(listener: () => void) {
  install()
  pauseListeners.add(listener)
  return () => pauseListeners.delete(listener)
}

export async function pageFetch(input: RequestInfo | URL, init: RequestInit = {}, timeout = 10000) {
  const requestController = new AbortController()
  const lifecycle = pageLifecycleSignal()
  const abort = () => requestController.abort()
  if (lifecycle?.aborted || init.signal?.aborted)
    abort()
  lifecycle?.addEventListener('abort', abort, { once: true })
  init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeout)
  try {
    requestController.signal.throwIfAborted()
    return await fetch(input, { ...init, signal: requestController.signal })
  }
  finally {
    clearTimeout(timer)
    lifecycle?.removeEventListener('abort', abort)
    init.signal?.removeEventListener('abort', abort)
  }
}

export async function pageFetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}, timeout = 10000) {
  const requestController = new AbortController()
  const lifecycle = pageLifecycleSignal()
  const abort = () => requestController.abort()
  if (lifecycle?.aborted || init.signal?.aborted)
    abort()
  lifecycle?.addEventListener('abort', abort, { once: true })
  init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeout)
  try {
    requestController.signal.throwIfAborted()
    const response = await fetch(input, { ...init, signal: requestController.signal })
    return { ok: response.ok, status: response.status, data: await response.json() as T }
  }
  finally {
    clearTimeout(timer)
    lifecycle?.removeEventListener('abort', abort)
    init.signal?.removeEventListener('abort', abort)
  }
}
