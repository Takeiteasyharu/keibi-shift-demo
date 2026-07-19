import {createHash} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";

initializeApp();
const db = getFirestore();
const auth = getAuth();
const API_KEY = "AIzaSyAVFlHLYDH6qVp14w4z9UvSPxc8Hq0ju5I";
const REGION = "asia-northeast1";
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
