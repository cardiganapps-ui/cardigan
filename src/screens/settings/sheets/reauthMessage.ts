/* Map server-side reauth codes → user-facing Spanish messages so the
   ARCO sheets (export / delete) know what to say beyond a generic "wrong
   password". Shared by ExportDataSheet + DeleteAccountSheet. */
export function reauthMessageFor(code: string, t: (key: string) => string): string {
  if (code === "wrong_password") return t("settings.privacyReauthWrong");
  if (code === "password_required") return t("settings.privacyReauthRequired");
  if (code === "oauth_only") return t("settings.privacyReauthOauthOnly");
  if (code === "captcha_failed") return t("settings.privacyReauthCaptcha");
  return t("settings.privacyReauthError");
}
