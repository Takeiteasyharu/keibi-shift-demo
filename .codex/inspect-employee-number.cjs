const cliRoot = "C:/Users/harut/AppData/Local/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib";
const auth = require(`${cliRoot}/auth.js`);
const apiv2 = require(`${cliRoot}/apiv2.js`);

const projectId = "keibi-shift-kokubunji-de-fef98";
const employeeNumber = process.argv[2];
if (!/^\d{6}$/.test(employeeNumber || "")) throw new Error("6桁の警備員番号が必要です");

function decodeValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  return "[complex]";
}

function summarizeDocument(document) {
  if (!document) return null;
  const fields = {};
  for (const [key, value] of Object.entries(document.fields || {})) fields[key] = decodeValue(value);
  return { path: document.name.split("/documents/")[1], fields };
}

async function request(url, init = {}) {
  const token = await apiv2.getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) throw new Error(`${response.status} ${body.error?.message || response.statusText}`);
  return { status: response.status, body };
}

async function main() {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Firebase CLIにログイン済みアカウントがありません");
  auth.setActiveAccount({}, account);

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const mappingResult = await request(`${firestoreBase}/employeeNumbers/${employeeNumber}`);
  const mapping = mappingResult.status === 404 ? null : summarizeDocument(mappingResult.body);

  const queryResult = await request(`${firestoreBase}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "users" }],
      where: { fieldFilter: { field: { fieldPath: "employeeNumber" }, op: "EQUAL", value: { stringValue: employeeNumber } } }
    } })
  });
  const users = (queryResult.body || []).filter(item => item.document).map(item => summarizeDocument(item.document));
  const uids = new Set(users.map(item => item.path.split("/")[1]));
  if (mapping?.fields?.uid) uids.add(mapping.fields.uid);

  const related = [];
  for (const uid of uids) {
    for (const collectionName of ["userRoles", "staffRequests"]) {
      const result = await request(`${firestoreBase}/${collectionName}/${encodeURIComponent(uid)}`);
      if (result.status !== 404) related.push(summarizeDocument(result.body));
    }
  }

  const internalEmail = `keibi-${employeeNumber}@auth.keibi.invalid`;
  const authResult = await request(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
    method: "POST",
    body: JSON.stringify({ email: [internalEmail] })
  });
  const authUsers = (authResult.body.users || []).map(user => ({
    uid: user.localId,
    email: user.email,
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  }));

  console.log(JSON.stringify({ employeeNumber, mapping, users, related, authUsers }, null, 2));
}

main().catch(error => {
  console.error(`調査失敗: ${error.message}`);
  process.exitCode = 1;
});
