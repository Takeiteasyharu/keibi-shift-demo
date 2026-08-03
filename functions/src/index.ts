import {createCipheriv, createDecipheriv, createHash, randomBytes} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";

initializeApp();
const db = getFirestore();
const auth = getAuth();
const API_KEY = "AIzaSyAVFlHLYDH6qVp14w4z9UvSPxc8Hq0ju5I";
const REGION = "asia-northeast1";
const passwordRequestKey = defineSecret("PASSWORD_REQUEST_ENCRYPTION_KEY");
const INVALID_LOGIN = "警備員番号またはパスワードが正しくありません";

function clientKey(request: any, employeeNumber: string) {
  const ip = request.rawRequest?.ip || "unknown";
  return createHash("sha256").update(`${ip}:${employeeNumber}`).digest("hex");
}

async function enforceRateLimit(request: any, employeeNumber: string) {
  const ref = db.collection("_loginAttempts").doc(clientKey(request, employeeNumber));
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const now = Date.now();
    const data = snapshot.data();
    const windowStart = data?.windowStart?.toMillis?.() || 0;
    const count = now - windowStart < 15 * 60_000 ? Number(data?.count || 0) : 0;
    if (count >= 5) throw new HttpsError("resource-exhausted", INVALID_LOGIN);
    tx.set(ref, {
      count: count + 1,
      windowStart: count ? data!.windowStart : FieldValue.serverTimestamp(),
      expiresAt: new Date(now + 24 * 60 * 60_000)
    });
  });
}

async function clearRateLimit(request: any, employeeNumber: string) {
  await db.collection("_loginAttempts").doc(clientKey(request, employeeNumber)).delete().catch(() => undefined);
}

async function verifyPassword(email: string, password: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({email, password, returnSecureToken: true})}
  );
  if (!response.ok) throw new HttpsError("unauthenticated", INVALID_LOGIN);
  return response.json() as Promise<{localId: string; idToken: string}>;
}

export const loginWithEmployeeNumber = onCall(
  {region: REGION, timeoutSeconds: 20, memory: "256MiB"},
  async request => {
    const employeeNumber = String(request.data?.employeeNumber || "");
    const password = String(request.data?.password || "");
    if (!/^\d{6}$/.test(employeeNumber) || password.length < 6 || password.length > 128) {
      throw new HttpsError("unauthenticated", INVALID_LOGIN);
    }
    await enforceRateLimit(request, employeeNumber);
    try {
      const mapping = await db.collection("employeeNumbers").doc(employeeNumber).get();
      const data = mapping.data();
      if (data?.passwordChangeStatus === "pending") {
        throw new HttpsError("failed-precondition", "PASSWORD_CHANGE_PENDING");
      }
      if (!mapping.exists || data?.accountStatus !== "active" || !data?.uid) {
        throw new HttpsError("unauthenticated", INVALID_LOGIN);
      }
      const user = await auth.getUser(data.uid);
      if (!user.email || user.disabled) throw new HttpsError("unauthenticated", INVALID_LOGIN);
      const verified = await verifyPassword(user.email, password);
      if (verified.localId !== user.uid) throw new HttpsError("unauthenticated", INVALID_LOGIN);
      const claims = {
        role: data.role || "guard",
        branchId: data.branchId,
        accountStatus: data.accountStatus
      };
      await auth.setCustomUserClaims(user.uid, claims);
      await clearRateLimit(request, employeeNumber);
      return {customToken: await auth.createCustomToken(user.uid, claims)};
    } catch {
      throw new HttpsError("unauthenticated", INVALID_LOGIN);
    }
  }
);

function encryptionKey() {
  const key = Buffer.from(passwordRequestKey.value(), "base64");
  if (key.length !== 32) throw new HttpsError("internal", "暗号化設定が不正です");
  return key;
}

function encryptPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {ciphertext: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64")};
}

function decryptPassword(data: FirebaseFirestore.DocumentData) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(String(data.passwordIv), "base64"));
  decipher.setAuthTag(Buffer.from(String(data.passwordTag), "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(String(data.passwordCiphertext), "base64")), decipher.final()
  ]).toString("utf8");
}

async function passwordRequestTarget(employeeNumber: string) {
  const mapping = await db.collection("employeeNumbers").doc(employeeNumber).get();
  const data = mapping.data();
  if (!mapping.exists || !data?.uid || !["active", "approved"].includes(String(data.accountStatus))) {
    throw new HttpsError("not-found", "対象のアカウントを確認できません");
  }
  const [profile, role] = await Promise.all([
    db.collection("users").doc(data.uid).get(), db.collection("userRoles").doc(data.uid).get()
  ]);
  if (!profile.exists || !role.exists || !["active", "approved"].includes(String(role.data()?.accountStatus))) {
    throw new HttpsError("not-found", "対象のアカウントを確認できません");
  }
  return {mapping, mappingData: data, profile: profile.data()!, role: role.data()!};
}

export const getPasswordChangeStatus = onCall(
  {region: REGION, timeoutSeconds: 15, memory: "256MiB"},
  async request => {
    const employeeNumber = String(request.data?.employeeNumber || "");
    if (!/^\d{6}$/.test(employeeNumber)) return {pending: false};
    const mapping = await db.collection("employeeNumbers").doc(employeeNumber).get();
    if (!mapping.exists || !mapping.data()?.uid) return {pending: false};
    const pending = await db.collection("passwordChangeRequests").doc(mapping.data()!.uid).get();
    return {pending: pending.exists && pending.data()?.status === "pending"};
  }
);

export const requestPasswordChange = onCall(
  {region: REGION, timeoutSeconds: 20, memory: "256MiB", secrets: [passwordRequestKey]},
  async request => {
    const employeeNumber = String(request.data?.employeeNumber || "");
    const password = String(request.data?.newPassword || "");
    if (!/^\d{6}$/.test(employeeNumber) || password.length < 6 || password.length > 128) {
      throw new HttpsError("invalid-argument", "申請内容を確認してください");
    }
    await enforceRateLimit(request, `password-change:${employeeNumber}`);
    const target = await passwordRequestTarget(employeeNumber);
    const uid = String(target.mappingData.uid);
    const requestRef = db.collection("passwordChangeRequests").doc(uid);
    const existing = await requestRef.get();
    if (existing.exists && existing.data()?.status === "pending") {
      throw new HttpsError("already-exists", "PASSWORD_CHANGE_PENDING");
    }
    const encrypted = encryptPassword(password);
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(requestRef, {
      uid, employeeNumber, name: String(target.profile.name || ""),
      branchId: String(target.role.branchId || ""), status: "pending",
      passwordCiphertext: encrypted.ciphertext, passwordIv: encrypted.iv, passwordTag: encrypted.tag,
      requestedAt: now, updatedAt: now, updatedByUid: uid, updatedByName: String(target.profile.name || "")
    });
    batch.update(target.mapping.ref, {passwordChangeStatus: "pending", passwordChangeRequestedAt: now});
    await batch.commit();
    return {ok: true};
  }
);

async function requireOffice(uid: string) {
  const [roleSnapshot, profileSnapshot] = await Promise.all([
    db.collection("userRoles").doc(uid).get(), db.collection("users").doc(uid).get()
  ]);
  const role = roleSnapshot.data();
  if (!roleSnapshot.exists || !profileSnapshot.exists || !["active", "approved"].includes(String(role?.accountStatus)) || !["staff", "admin"].includes(String(role?.role))) {
    throw new HttpsError("permission-denied", "この操作を実行する権限がありません");
  }
  return {role: role!, profile: profileSnapshot.data()!};
}

export const listPasswordChangeRequests = onCall(
  {region: REGION, timeoutSeconds: 20, memory: "256MiB"},
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const office = await requireOffice(request.auth.uid);
    let query: FirebaseFirestore.Query = db.collection("passwordChangeRequests").where("status", "==", "pending");
    if (office.role.role === "staff") query = query.where("branchId", "==", office.role.branchId);
    const snapshot = await query.limit(100).get();
    return {requests: snapshot.docs.map(item => {
      const data = item.data();
      return {uid: item.id, employeeNumber: data.employeeNumber, name: data.name, branchId: data.branchId,
        requestedAt: data.requestedAt?.toMillis?.() || 0};
    })};
  }
);

export const reviewPasswordChangeRequest = onCall(
  {region: REGION, timeoutSeconds: 30, memory: "256MiB", secrets: [passwordRequestKey]},
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const action = String(request.data?.action || "");
    const targetUid = String(request.data?.uid || "");
    if (!["approve", "reject"].includes(action) || !targetUid) throw new HttpsError("invalid-argument", "申請を確認できません");
    const office = await requireOffice(request.auth.uid);
    const requestRef = db.collection("passwordChangeRequests").doc(targetUid);
    const snapshot = await requestRef.get();
    const data = snapshot.data();
    if (!snapshot.exists || data?.status !== "pending") throw new HttpsError("not-found", "対象の申請が見つかりません");
    if (office.role.role === "staff" && data.branchId !== office.role.branchId) {
      throw new HttpsError("permission-denied", "他支社の申請は処理できません");
    }
    if (action === "approve") await auth.updateUser(targetUid, {password: decryptPassword(data)});
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.update(requestRef, {
      status: action === "approve" ? "approved" : "rejected",
      passwordCiphertext: FieldValue.delete(), passwordIv: FieldValue.delete(), passwordTag: FieldValue.delete(),
      updatedAt: now, updatedByUid: request.auth.uid, updatedByName: String(office.profile.name || "")
    });
    batch.update(db.collection("employeeNumbers").doc(String(data.employeeNumber)), {
      passwordChangeStatus: FieldValue.delete(), passwordChangeRequestedAt: FieldValue.delete(),
      updatedAt: now, updatedByUid: request.auth.uid, updatedByName: String(office.profile.name || "")
    });
    batch.set(db.collection("users").doc(targetUid), {
      updatedAt: now, updatedByUid: request.auth.uid, updatedByName: String(office.profile.name || "")
    }, {merge: true});
    await batch.commit();
    return {ok: true};
  }
);

export const registerDemoGuard = onCall(
  {region: REGION, timeoutSeconds: 30, memory: "256MiB"},
  async request => {
    const d = request.data || {};
    const employeeNumber = String(d.employeeNumber || "");
    const email = String(d.email || "").trim().toLowerCase();
    const password = String(d.password || "");
    if (!/^\d{6}$/.test(employeeNumber) || !email.includes("@") || password.length < 6) {
      throw new HttpsError("invalid-argument", "登録内容を確認してください");
    }
    await enforceRateLimit(request, employeeNumber);
    const mappingRef = db.collection("employeeNumbers").doc(employeeNumber);
    if ((await mappingRef.get()).exists) throw new HttpsError("already-exists", "この警備員番号は使用できません");
    let user;
    try {
      user = await auth.createUser({email, password, displayName: String(d.name || ""), emailVerified: false});
      const claims = {role: "guard", branchId: "kokubunji", accountStatus: "active"};
      await auth.setCustomUserClaims(user.uid, claims);
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.create(mappingRef, {uid: user.uid, ...claims, createdAt: now, updatedAt: now});
      batch.create(db.collection("users").doc(user.uid), {
        employeeNumber, name: String(d.name || ""), email,
        postalCode: String(d.postalCode || ""), prefecture: String(d.prefecture || ""),
        city: String(d.city || ""), addressLine: String(d.addressLine || ""),
        building: String(d.building || ""), nearestStation: String(d.nearestStation || ""),
        ...claims, createdAt: now, updatedAt: now
      });
      await batch.commit();
      const verified = await verifyPassword(email, password);
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`, {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({requestType: "VERIFY_EMAIL", idToken: verified.idToken})
      });
      return {customToken: await auth.createCustomToken(user.uid, claims)};
    } catch (error) {
      if (user) await auth.deleteUser(user.uid).catch(() => undefined);
      throw error instanceof HttpsError ? error : new HttpsError("internal", "登録できませんでした");
    }
  }
);
