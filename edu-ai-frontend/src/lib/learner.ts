export const GUEST_LEARNER_ID_STORAGE_KEY = "edu-demo-learner-id"

export function getOrCreateGuestLearnerId() {
  if (typeof window === "undefined") {
    return "browser-demo-learner"
  }

  const existing = window.localStorage.getItem(GUEST_LEARNER_ID_STORAGE_KEY)?.trim()
  if (existing) {
    return existing
  }

  const nextId =
    typeof window.crypto?.randomUUID === "function"
      ? `browser_${window.crypto.randomUUID()}`
      : `browser_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(GUEST_LEARNER_ID_STORAGE_KEY, nextId)
  return nextId
}
