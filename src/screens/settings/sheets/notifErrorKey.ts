/* Map a typed error code from useNotifications to a user-readable i18n
   key. Shared by Settings (the toggle/reactivate handlers) and the
   extracted NotificationsSheet (the reminder-minutes SegmentedControl)
   so the two can't drift on which key a given failure surfaces. */
export function notifErrorKey(code: string | undefined) {
  switch (code) {
    case "permission-denied": return "notifications.toastPermissionDenied";
    case "install-required":  return "notifications.toastInstallRequired";
    case "subscribe-failed":  return "notifications.toastSubscribeFailed";
    case "server-error":      return "notifications.toastServerError";
    case "unsupported":       return "notifications.toastUnsupported";
    default:                  return "notifications.toastSubscribeFailed";
  }
}
