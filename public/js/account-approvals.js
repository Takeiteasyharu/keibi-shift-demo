import { db } from "./firebase-config.js";
import { ALL_BRANCHES, BRANCHES, branchName, getAdminSelectedBranchId, isBranchId } from "./branches.js";
import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, where, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let el;
let navigate;
let currentProfile;
let currentRole;
let unsubscribe;
let pendingReject = null;

export function initAccountApprovals(elements, showScreen) {
  el = elements;
  navigate = showScreen;
  el.cancelAccountRejectionButton.addEventListener("click", closeRejectDialog);
  el.confirmAccountRejectionButton.addEventListener("click", submitRejection);
  el.accountRejectionModal.addEventListener("click", event => {
    if (event.target === el.accountRejectionModal) closeRejectDialog();
  });
}

export function showAccountApprovals(profile, roleData) {
  if (roleData?.role !== "admin") throw new Error("新規アカウントを承認できるのは管理者だけです。");
  currentProfile = profile;
  currentRole = roleData;
  navigate("accountApprovals");
  subscribePendingAccounts();
}

export function stopAccountApprovals() {
  unsubscribe?.();
  unsubscribe = null;
}

function subscribePendingAccounts() {
  unsubscribe?.();
  el.accountApprovalsMessage.textContent = "承認待ちアカウントを読み込んでいます。";
  el.accountApprovalsMessage.className = "message show";
  const pendingQuery = query(collection(db, "userRoles"), where("accountStatus", "==", "pending"));
  unsubscribe = onSnapshot(pendingQuery, async snapshot => {
    const relatedSnapshots = await Promise.all(snapshot.docs.map(item => Promise.all([
      getDoc(doc(db, "users", item.id)),
      getDoc(doc(db, "staffRequests", item.id))
    ])));
    const selectedBranch = getAdminSelectedBranchId();
    const rows = snapshot.docs.map((roleDoc, index) => ({
      uid: roleDoc.id,
      ...relatedSnapshots[index][0].data(),
      ...roleDoc.data(),
      staffRequestStatus: relatedSnapshots[index][1].exists() ? relatedSnapshots[index][1].data().status : null
    })).filter(account => account.staffRequestStatus !== "pending")
      .filter(account => selectedBranch === ALL_BRANCHES || account.requestedBranchId === selectedBranch)
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
    renderRows(rows);
    el.accountApprovalsMessage.className = "message";
  }, error => {
    console.error(error);
    el.accountApprovalsMessage.textContent = "承認待ちアカウントを読み込めませんでした。";
    el.accountApprovalsMessage.className = "message show error";
  });
}

function renderRows(rows) {
  el.accountApprovalsTableBody.replaceChildren();
  el.accountApprovalsCards.replaceChildren();
  rows.forEach(account => {
    const select = createBranchSelect(account.requestedBranchId);
    const actions = createActions(account, select);
    const tr = document.createElement("tr");
    [account.name, account.employeeNumber, branchName(account.requestedBranchId), formatDate(account.createdAt)]
      .forEach(value => { const td = document.createElement("td"); td.textContent = value || "―"; tr.appendChild(td); });
    const branchCell = document.createElement("td"); branchCell.appendChild(select);
    const actionCell = document.createElement("td"); actionCell.appendChild(actions);
    tr.append(branchCell, actionCell);
    el.accountApprovalsTableBody.appendChild(tr);

    const cardSelect = createBranchSelect(account.requestedBranchId);
    const card = document.createElement("article");
    card.className = "request-card account-approval-card";
    const details = document.createElement("div");
    details.textContent = `氏名：${account.name}\n警備員番号：${account.employeeNumber}\n希望支社：${branchName(account.requestedBranchId)}\n登録日時：${formatDate(account.createdAt)}`;
    const label = document.createElement("label"); label.textContent = "正式所属支社"; label.appendChild(cardSelect);
    card.append(details, label, createActions(account, cardSelect));
    el.accountApprovalsCards.appendChild(card);
  });
  if (!rows.length) {
    el.accountApprovalsTableBody.innerHTML = '<tr><td colspan="6">承認待ちアカウントはありません。</td></tr>';
    el.accountApprovalsCards.innerHTML = '<div class="panel">承認待ちアカウントはありません。</div>';
  }
}

function createBranchSelect(initialBranchId) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", "正式所属支社");
  BRANCHES.forEach(branch => select.add(new Option(branch.name, branch.id)));
  select.value = isBranchId(initialBranchId) ? initialBranchId : BRANCHES[0].id;
  return select;
}

function createActions(account, select) {
  const wrap = document.createElement("div");
  wrap.className = "request-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "承認";
  approve.addEventListener("click", async () => {
    if (!confirm(`${account.name}さんを${branchName(select.value)}所属として承認しますか？`)) return;
    approve.disabled = true;
    try { await approveAccount(account, select.value); }
    catch (error) { console.error(error); approve.disabled = false; showError("承認できませんでした。"); }
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "danger";
  reject.textContent = "却下";
  reject.addEventListener("click", () => openRejectDialog(account));
  wrap.append(approve, reject);
  return wrap;
}

async function approveAccount(account, branchId) {
  if (!isBranchId(branchId) || currentRole?.role !== "admin") throw new Error("invalid-approval");
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(doc(db, "users", account.uid), { branchId, updatedAt: now });
  batch.update(doc(db, "employeeNumbers", account.employeeNumber), {
    accountStatus: "approved", branchId
  });
  batch.update(doc(db, "userRoles", account.uid), {
    branchId, accountStatus: "approved", approvedByUid: currentProfile.uid,
    approvedAt: now, updatedAt: now
  });
  // 他支社応援候補では住所・連絡先を公開せず、必要最小限の項目だけを参照する。
  batch.set(doc(db, "shiftCandidateProfiles", account.uid), {
    uid: account.uid, employeeNumber: account.employeeNumber, name: account.name,
    nearestStation: account.nearestStation || "", branchId,
    accountStatus: "approved", updatedAt: now
  });
  await batch.commit();
}

function openRejectDialog(account) {
  pendingReject = account;
  el.accountRejectionTarget.textContent = `${account.name} / 警備員番号 ${account.employeeNumber}`;
  el.accountRejectionReason.value = "";
  el.accountRejectionMessage.className = "message";
  el.accountRejectionModal.classList.add("show");
  requestAnimationFrame(() => el.accountRejectionReason.focus());
}

function closeRejectDialog() {
  el.accountRejectionModal.classList.remove("show");
  pendingReject = null;
}

async function submitRejection() {
  const reason = el.accountRejectionReason.value.trim();
  if (!reason || reason.length > 200) {
    el.accountRejectionMessage.textContent = "却下理由を200文字以内で入力してください。";
    el.accountRejectionMessage.className = "message show error";
    return;
  }
  const account = pendingReject;
  if (!account || currentRole?.role !== "admin") return;
  el.confirmAccountRejectionButton.disabled = true;
  try {
    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.update(doc(db, "userRoles", account.uid), {
      accountStatus: "rejected", rejectionReason: reason,
      rejectedByUid: currentProfile.uid, rejectedAt: now, updatedAt: now
    });
    batch.update(doc(db, "employeeNumbers", account.employeeNumber), { accountStatus: "rejected" });
    await batch.commit();
    closeRejectDialog();
  } catch (error) {
    console.error(error);
    el.accountRejectionMessage.textContent = "却下処理に失敗しました。";
    el.accountRejectionMessage.className = "message show error";
  } finally {
    el.confirmAccountRejectionButton.disabled = false;
  }
}

function showError(message) {
  el.accountApprovalsMessage.textContent = message;
  el.accountApprovalsMessage.className = "message show error";
}
function formatDate(value) { return value?.toDate?.().toLocaleString("ja-JP") || "―"; }
function timestampMillis(value) { return value?.toMillis?.() || 0; }
