const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || "keibi-shift-kokubunji-de-fef98";
if (!firestoreHost || !authHost) throw new Error("Firestore/Auth Emulatorが必要です");

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {"Content-Type": "application/json", ...(init.headers || {})}
  });
  const body = await response.json().catch(() => ({}));
  return {ok: response.ok, status: response.status, body};
}

async function signUp(label) {
  const result = await jsonRequest(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: "POST",
    body: JSON.stringify({email: `${label}@example.test`, password: "test123456", returnSecureToken: true})
  });
  if (!result.ok) throw new Error(`Auth作成失敗: ${JSON.stringify(result.body)}`);
  return {uid: result.body.localId, token: result.body.idToken};
}

function valueMap(values) {
  const fields = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") fields[key] = {stringValue: value};
    else if (typeof value === "boolean") fields[key] = {booleanValue: value};
  }
  return fields;
}

async function seed(path, values) {
  const result = await jsonRequest(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    method: "PATCH",
    headers: {Authorization: "Bearer owner"},
    body: JSON.stringify({fields: valueMap(values)})
  });
  if (!result.ok) throw new Error(`seed失敗 ${path}: ${JSON.stringify(result.body)}`);
}

async function save(token, uid, date, proxy = null) {
  const id = `${date}_${uid}`;
  const updatedByUid = proxy?.operatorUid || uid;
  const updatedByType = proxy ? "proxy" : "self";
  const audit = proxy
    ? {updatedByRole: "staff", updateReason: "phone_request", updateReasonNote: ""}
    : {updatedByRole: "", updateReason: "", updateReasonNote: ""};
  const availability = valueMap({
    uid, branchId: "kokubunji", date, day: true, night: false,
    unavailable: false, undecided: false, note: "", updatedByUid, updatedByType,
    ...audit, updatedAfterDeadline: false
  });
  const candidate = valueMap({
    uid, branchId: "kokubunji", date, day: true, night: false,
    unavailable: false, undecided: false, note: ""
  });
  return jsonRequest(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: token ? {Authorization: `Bearer ${token}`} : {},
    body: JSON.stringify({writes: [
      {
        update: {name: `projects/${projectId}/databases/(default)/documents/availability/${id}`, fields: availability},
        updateTransforms: [
          {fieldPath: "createdAt", setToServerValue: "REQUEST_TIME"},
          {fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME"}
        ]
      },
      {
        update: {name: `projects/${projectId}/databases/(default)/documents/shiftCandidateAvailability/${id}`, fields: candidate},
        updateTransforms: [{fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME"}]
      }
    ]})
  });
}

async function main() {
  const owner = await signUp("owner");
  const other = await signUp("other");
  const staff = await signUp("staff");
  await seed(`userRoles/${owner.uid}`, {role: "guard", accountStatus: "approved", branchId: "kokubunji"});
  await seed(`userRoles/${other.uid}`, {role: "guard", accountStatus: "approved", branchId: "kokubunji"});
  await seed(`userRoles/${staff.uid}`, {role: "staff", accountStatus: "approved", branchId: "kokubunji"});
  await seed(`users/${owner.uid}`, {inputMode: "web", branchId: "kokubunji"});

  const cases = [
    ["本人による本人データ", await save(owner.token, owner.uid, "2026-09-01"), true],
    ["本人による他人データ", await save(other.token, owner.uid, "2026-09-02"), false],
    ["未ログイン", await save(null, owner.uid, "2026-09-03"), false],
    ["staff代理入力", await save(staff.token, owner.uid, "2026-09-04", {operatorUid: staff.uid}), true]
  ];
  let failed = false;
  for (const [label, result, expected] of cases) {
    const passed = result.ok === expected;
    console.log(`${passed ? "PASS" : "FAIL"} ${label}: HTTP ${result.status}`);
    if (!passed) failed = true;
  }
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
