const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);

const projectId = "keibi-shift-kokubunji-de-fef98";
const employeeNumber = process.argv[2];
const expectedUid = process.argv[3];
if (!/^\d{6}$/.test(employeeNumber || "") || !expectedUid) throw new Error("警備員番号と確認済みUIDが必要です");

async function request(url, init = {}, allow404 = false) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok && !(allow404 && response.status === 404)) {
    throw new Error(`${response.status} ${body?.error?.message || response.statusText}`);
  }
  return { status: response.status, body };
}

function stringField(document, field) {
  return document?.fields?.[field]?.stringValue;
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLIにログイン済みアカウントがありません");
  auth.setActiveAccount({}, account);

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const mappingUrl = `${base}/employeeNumbers/${employeeNumber}`;
  const mapping = await request(mappingUrl, {}, true);
  if (mapping.status === 404) throw new Error("番号予約は既に存在しません");
  if (stringField(mapping.body, "uid") !== expectedUid) throw new Error("番号予約のUIDが調査時から変わったため中止しました");

  for (const collectionName of ["users", "userRoles", "staffRequests"]) {
    const related = await request(`${base}/${collectionName}/${encodeURIComponent(expectedUid)}`, {}, true);
    if (related.status !== 404) throw new Error(`${collectionName}/${expectedUid} が存在するため中止しました`);
  }

  const query = await request(`${base}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "users" }],
      where: { fieldFilter: { field: { fieldPath: "employeeNumber" }, op: "EQUAL", value: { stringValue: employeeNumber } } },
      limit: 1
    } })
  });
  if ((query.body || []).some(item => item.document)) throw new Error("同じ警備員番号のusers文書が存在するため中止しました");

  const internalEmail = `keibi-${employeeNumber}@auth.keibi.invalid`;
  const authLookup = await request(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
    method: "POST",
    body: JSON.stringify({ email: [internalEmail] })
  });
  if ((authLookup.body?.users || []).length) throw new Error("同じ警備員番号のAuthユーザーが存在するため中止しました");

  const updateTime = encodeURIComponent(mapping.body.updateTime);
  await request(`${mappingUrl}?currentDocument.updateTime=${updateTime}`, { method: "DELETE" });
  const verify = await request(mappingUrl, {}, true);
  if (verify.status !== 404) throw new Error("削除後の確認で番号予約が残っています");
  console.log(`削除完了: employeeNumbers/${employeeNumber}`);
}

main().catch(error => {
  console.error(`削除失敗: ${error.message}`);
  process.exitCode = 1;
});
