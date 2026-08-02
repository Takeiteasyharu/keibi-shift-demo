const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);
const projectId = "keibi-shift-kokubunji-de-fef98";
const employeeNumber = process.argv[2];
if (!employeeNumber) throw new Error("employee number required");

async function request(url, init = {}, allow404 = false) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {...init, headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !(allow404 && response.status === 404)) throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  return response.status === 404 ? null : body;
}

function fields(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key,
    value.stringValue ?? value.booleanValue ?? value.integerValue ?? value.timestampValue ?? "[complex]"
  ]));
}

async function queryUid(base, collectionId, uid) {
  const rows = await request(`${base}:runQuery`, {method: "POST", body: JSON.stringify({structuredQuery: {
    from: [{collectionId}], where: {fieldFilter: {field: {fieldPath: "uid"}, op: "EQUAL", value: {stringValue: uid}}}
  }})});
  return rows.filter(row => row.document).map(row => ({path: row.document.name.split("/documents/")[1], fields: fields(row.document)}));
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLI login required");
  auth.setActiveAccount({}, account);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const mapping = await request(`${base}/employeeNumbers/${employeeNumber}`, {}, true);
  const uid = mapping?.fields?.uid?.stringValue;
  if (!uid) throw new Error("employee mapping not found");
  const [user, role, availability, candidates] = await Promise.all([
    request(`${base}/users/${uid}`, {}, true), request(`${base}/userRoles/${uid}`, {}, true),
    queryUid(base, "availability", uid), queryUid(base, "shiftCandidateAvailability", uid)
  ]);
  console.log(JSON.stringify({employeeNumber, uid, user: fields(user), role: fields(role), availability, candidates}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
