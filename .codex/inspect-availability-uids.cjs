const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);

const projectId = "keibi-shift-kokubunji-de-fef98";
const uids = process.argv.slice(2);
if (!uids.length) throw new Error("確認対象UIDが必要です");

function decode(value) {
  if (!value) return null;
  for (const key of ["stringValue", "booleanValue", "integerValue", "timestampValue"]) {
    if (key in value) return value[key];
  }
  return "[complex]";
}

function summarize(document) {
  const fields = {};
  for (const [key, value] of Object.entries(document.fields || {})) fields[key] = decode(value);
  return { path: document.name.split("/documents/")[1], fields };
}

async function request(url, init = {}, allow404 = false) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !(allow404 && response.status === 404)) throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  if (response.status === 404) return null;
  return body;
}

async function queryByUid(base, collectionId, uid) {
  const body = await request(`${base}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } }
    } })
  });
  return body.filter(item => item.document).map(item => summarize(item.document));
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLIにログイン済みアカウントがありません");
  auth.setActiveAccount({}, account);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const result = {};
  for (const uid of uids) {
    result[uid] = {};
    result[uid].documents = {};
    for (const collectionId of ["users", "userRoles", "staffRequests"]) {
      const document = await request(`${base}/${collectionId}/${encodeURIComponent(uid)}`, {}, true);
      result[uid].documents[collectionId] = document ? summarize(document) : null;
    }
    for (const collectionId of ["availability", "shiftCandidateAvailability"]) {
      result[uid][collectionId] = await queryByUid(base, collectionId, uid);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`調査失敗: ${error.message}`);
  process.exitCode = 1;
});
