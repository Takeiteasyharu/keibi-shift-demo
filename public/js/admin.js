// 個人情報保護のため、一般の警備員アカウントから管理画面は開かない。
// 将来、管理者専用のCustom Claimsと別途監査済みルールを導入するまで、
// 他利用者のusers/availabilityを取得する処理は実装しない。
export function disableAdminScreen(elements) {
  if (elements.adminScreen) elements.adminScreen.setAttribute("aria-hidden", "true");
}
