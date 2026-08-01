export const ALL_BRANCHES = "all";

export const BRANCHES = Object.freeze([
  Object.freeze({ id: "kokubunji", name: "国分寺支社" }),
  Object.freeze({ id: "mitaka", name: "三鷹支社" })
]);

const branchIds = new Set(BRANCHES.map(branch => branch.id));
const storageKey = "adminSelectedBranchId";
let adminSelectedBranchId = normalizeAdminSelection(localStorage.getItem(storageKey));

export function isBranchId(value) {
  return branchIds.has(value);
}

export function branchName(branchId) {
  return BRANCHES.find(branch => branch.id === branchId)?.name || "所属支社未設定";
}

export function isOperationalAccount(status) {
  // 既存データの active と、新承認フローの approved の両方を稼働状態として扱う。
  return status === "active" || status === "approved";
}

export function getAdminSelectedBranchId() {
  return adminSelectedBranchId;
}

export function setAdminSelectedBranchId(value) {
  adminSelectedBranchId = normalizeAdminSelection(value);
  localStorage.setItem(storageKey, adminSelectedBranchId);
  window.dispatchEvent(new CustomEvent("admin-branch-change", { detail: adminSelectedBranchId }));
  return adminSelectedBranchId;
}

export function effectiveBranchId(roleData) {
  return roleData?.role === "admin" ? adminSelectedBranchId : roleData?.branchId;
}

export function populateBranchSelect(select, { includeAll = false } = {}) {
  select.replaceChildren();
  if (includeAll) select.add(new Option("すべての支社", ALL_BRANCHES));
  BRANCHES.forEach(branch => select.add(new Option(branch.name, branch.id)));
}

export async function ensureBranchDocuments() {
  const snapshots = await Promise.all(BRANCHES.map(branch => getDoc(doc(db, "branches", branch.id))));
  const batch = writeBatch(db);
  let changed = false;
  BRANCHES.forEach((branch, index) => {
    if (snapshots[index].exists()) return;
    changed = true;
    batch.set(doc(db, "branches", branch.id), {
      name: branch.name, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  if (changed) await batch.commit();
}

function normalizeAdminSelection(value) {
  return value === ALL_BRANCHES || isBranchId(value) ? value : ALL_BRANCHES;
}
import { db } from "./firebase-config.js";
import { doc, getDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
