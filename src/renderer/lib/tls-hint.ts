/**
 * «self signed certificate in certificate chain» and its relatives, recognised
 * wherever they surface — a response's transport error, a pre-request script's
 * error, or a line the script logged — so the fix is one click away instead of
 * a trip through Settings, as Postman offers «Disable SSL Verification» right
 * in the error.
 */
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { tr } from './i18n'

/** Node / OpenSSL wording and codes for a certificate the client refused. */
const CERT_ERROR = /self[- ]signed certificate|certificate (?:in certificate chain|has expired|is not yet valid)|unable to (?:get local issuer certificate|verify the first certificate|get issuer certificate)|SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|Hostname\/IP does not match certificate/i

export function isCertificateError(text: string | null | undefined): boolean {
  return !!text && CERT_ERROR.test(text)
}

/** Is «Verify SSL certificates» currently on? */
export function sslVerificationOn(): boolean {
  return useSettings.getState().settings.rejectUnauthorized !== false
}

/** Turn «Verify SSL certificates» off for every request and pm.sendRequest. */
export function disableSslVerification(): void {
  useSettings.getState().update({ rejectUnauthorized: false })
  useUi
    .getState()
    .showToast(tr('Проверка SSL-сертификатов отключена для всех запросов и pm.sendRequest. Включить обратно — «Настройки → Основные».'))
}
