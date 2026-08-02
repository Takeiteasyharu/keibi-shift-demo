const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);

const projectId = "keibi-shift-kokubunji-de-fef98";
const currentUid = "nNIy5SfAsgfUmOHS0i7AkU6zX333";
const oldUid = "VZGJycAygIhKAkwmI4kOGGxTieR2";
const apply = process.argv.includes("--apply");

async function request(url, init = {}, allow404 = false) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok && !(allow404 && response.status === 404)) {
    throw new Error(`${response.status} ${body?.error?.message || response.statusText}`);
  }
  return response.status === 404 ? null : body;
}

async function queryByUid(base, collectionId, uid) {
  const rows = await request(`${base}:runQuery`, {
    method: "POST",
    body: JSON.stringify({structuredQuery: {
      from: [{collectionId}],
      where: {fieldFilter: {field: {fieldPath: "uid"}, op: "EQUAL", value: {stringValue: uid}}}
    }})
  });
  return rows.filter(row => row.document).map(row => row.document);
}

function migratedFields(source) {
  const fields = {...source.fields};
  fields.uid = {stringValue: currentUid};
  fields.updatedByUid = {stringValue: currentUid};
  fields.updatedByType = {stringValue: "self"};
  fields.updatedByRole = {stringValue: ""};
  fields.updateReason = {stringValue: ""};
  fields.updateReasonNote = {stringValue: ""};
  fields.updatedAfterDeadline = {booleanValue: Boolean(fields.updatedAfterDeadline?.booleanValue)};
  return fields;
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLIにログイン済みアカウントがありません");
  auth.setActiveAccount({}, account);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const [user, role, mapping, oldDocs, currentDocs] = await Promise.all([
    request(`${base}/users/${currentUid}`, {}, true),
    request(`${base}/userRoles/${currentUid}`, {}, true),
    request(`${base}/employeeNumbers/016939`, {}, true),
    queryByUid(base, "availability", oldUid),
    queryByUid(base, "availability", currentUid)
  ]);
  if (!user || !role || !mapping) throw new Error("現在UIDの必須ドキュメントが不足しているため中止しました");
  if (user.fields?.authUid?.stringValue !== currentUid || mapping.fields?.uid?.stringValue !== currentUid) {
    throw new Error("現在UIDの対応が一致しないため中止しました");
  }
  if (role.fields?.role?.stringValue !== "guard" || role.fields?.accountStatus?.stringValue !== "approved") {
    throw new Error("現在UIDのrole/accountStatusが想定と異なるため中止しました");
  }
  const currentDates = new Set(currentDocs.map(doc => doc.fields.date.stringValue));
  const conflicts = oldDocs.filter(doc => currentDates.has(doc.fields.date.stringValue));
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    currentUid,
    oldUid,
    oldPaths: oldDocs.map(doc => doc.name.split("/documents/")[1]),
    currentPaths: currentDocs.map(doc => doc.name.split("/documents/")[1]),
    conflicts: conflicts.map(doc => doc.fields.date.stringValue)
  }, null, 2));
  if (!apply) return console.log("dry-run完了。書き込みは行っていません。");
  if (conflicts.length) throw new Error("同一日付の競合があるため自動上書きせず中止しました");
  if (!oldDocs.length) return console.log("移行対象はありません。既に修復済みです。");

  const writes = [];
  for (const source of oldDocs) {
    const date = source.fields.date.stringValue;
    const targetName = `projects/${projectId}/databases/(default)/documents/availability/${date}_${currentUid}`;
    writes.push({update: {name: targetName, fields: migratedFields(source)}});
    writes.push({delete: source.name, currentDocument: {updateTime: source.updateTime}});
  }
  await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: "POST",
    body: JSON.stringify({writes})
  });
  const [remainingOld, migratedCurrent] = await Promise.all([
    queryByUid(base, "availability", oldUid),
    queryByUid(base, "availability", currentUid)
  ]);
  if (remainingOld.length || migratedCurrent.length !== oldDocs.length + currentDocs.length) {
    throw new Error("移行後検証が一致しません");
  }
  console.log(`修復完了: ${oldDocs.length}件を現在UIDへ移行し、旧UID文書を削除しました。`);
}

main().catch(error => {
  console.error(`修復失敗: ${error.message}`);
  process.exitCode = 1;
});
