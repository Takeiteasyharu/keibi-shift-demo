import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";
import { branchName } from "./branches.js";

const statusCall = httpsCallable(functions, "getPasswordChangeStatus");
const requestCall = httpsCallable(functions, "requestPasswordChange");
const listCall = httpsCallable(functions, "listPasswordChangeRequests");
const reviewCall = httpsCallable(functions, "reviewPasswordChangeRequest");
let el;
let navigate;
let notify;
let pendingReview = null;

export function initPasswordChange(elements, showScreen, showToast) {
  el = elements;
  navigate = showScreen;
  notify = showToast;
  el.submitPasswordChangeButton.addEventListener("click", submitRequest);
  el.cancelPasswordChangeButton.addEventListener("click", closeRequestModal);
  el.passwordChangeRequestModal.addEventListener("click", event => {
    if (event.target === el.passwordChangeRequestModal) closeRequestModal();
  });
  el.cancelPasswordReviewButton.addEventListener("click", closeReviewModal);
  el.confirmPasswordReviewButton.addEventListener("click", confirmReview);
}

export async function openPasswordChangeRequest(employeeNumber) {
  if (!/^\d{6}$/.test(employeeNumber)) throw new Error("employee-number-required");
  const status = await getPasswordChangePending(employeeNumber);
  if (status) return {pending: true};
  el.passwordChangeEmployeeNumber.value = employeeNumber;
  el.newPassword.value = "";
  el.newPasswordConfirm.value = "";
  el.passwordChangeMessage.className = "message";
  el.passwordChangeRequestModal.classList.add("show");
  requestAnimationFrame(() => el.newPassword.focus());
  return {pending: false};
}

export async function getPasswordChangePending(employeeNumber) {
  const result = await statusCall({employeeNumber});
  return Boolean(result.data?.pending);
}

async function submitRequest() {
  const employeeNumber = el.passwordChangeEmployeeNumber.value;
  const password = el.newPassword.value;
  if (password.length < 6 || password.length > 128) return showModalMessage("新しいパスワードは6文字以上128文字以内で入力してください。", true);
  if (password !== el.newPasswordConfirm.value) return showModalMessage("新しいパスワードが一致しません。", true);
  el.submitPasswordChangeButton.disabled = true;
  try {
    await requestCall({employeeNumber, newPassword: password});
    closeRequestModal();
    return {ok: true};
  } catch (error) {
    console.error("パスワード変更申請に失敗しました", {code: error?.code, error});
    if (String(error?.code).includes("already-exists")) return showModalMessage("現在、パスワード変更を申請中です。管理者の承認をお待ちください。", true);
    showModalMessage("パスワード変更を申請できませんでした。入力内容を確認してください。", true);
  } finally {
    el.submitPasswordChangeButton.disabled = false;
  }
}

function closeRequestModal() {
  el.passwordChangeRequestModal.classList.remove("show");
  el.newPassword.value = "";
  el.newPasswordConfirm.value = "";
}

function showModalMessage(text, error) {
  el.passwordChangeMessage.textContent = text;
  el.passwordChangeMessage.className = `message show ${error ? "error" : "success"}`;
}

export async function showPasswordChangeRequests() {
  navigate("passwordChangeRequests");
  el.passwordChangeRequestsMessage.className = "message";
  el.passwordChangeRequestsTableBody.replaceChildren();
  el.passwordChangeRequestsCards.replaceChildren();
  try {
    const result = await listCall();
    const requests = result.data?.requests || [];
    requests.sort((a, b) => Number(a.requestedAt) - Number(b.requestedAt));
    requests.forEach(renderRequest);
    if (!requests.length) renderEmpty();
  } catch (error) {
    console.error("パスワード変更申請一覧の取得に失敗しました", {code: error?.code, error});
    el.passwordChangeRequestsMessage.textContent = "パスワード変更申請を読み込めませんでした。";
    el.passwordChangeRequestsMessage.className = "message show error";
  }
}

function renderRequest(item) {
  const row = document.createElement("tr");
  [item.employeeNumber, item.name, branchName(item.branchId), formatDate(item.requestedAt)].forEach(value => {
    const cell = document.createElement("td"); cell.textContent = value || "―"; row.appendChild(cell);
  });
  const actions = document.createElement("td");
  actions.append(actionButton("承認", () => openReview(item, "approve")), actionButton("却下", () => openReview(item, "reject"), true));
  row.appendChild(actions);
  el.passwordChangeRequestsTableBody.appendChild(row);
  const card = document.createElement("article");
  card.className = "request-card";
  const text = document.createElement("div");
  text.textContent = `${item.employeeNumber}\n${item.name}\n${branchName(item.branchId)}\n申請日時：${formatDate(item.requestedAt)}`;
  const cardActions = document.createElement("div"); cardActions.className = "actions";
  cardActions.append(actionButton("承認", () => openReview(item, "approve")), actionButton("却下", () => openReview(item, "reject"), true));
  card.append(text, cardActions); el.passwordChangeRequestsCards.appendChild(card);
}

function actionButton(label, handler, danger = false) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  if (danger) button.className = "danger"; button.addEventListener("click", handler); return button;
}

function openReview(item, action) {
  pendingReview = {item, action};
  el.passwordReviewTitle.textContent = action === "approve" ? "パスワード変更申請を承認" : "パスワード変更申請を却下";
  el.passwordReviewMessage.textContent = action === "approve"
    ? "このパスワードへ変更します。\n\nよろしいですか？"
    : "この申請を却下します。\n\nパスワードは変更されません。";
  el.confirmPasswordReviewButton.textContent = action === "approve" ? "変更する" : "却下する";
  el.confirmPasswordReviewButton.classList.toggle("danger", action === "reject");
  el.passwordReviewModal.classList.add("show");
}

function closeReviewModal() { pendingReview = null; el.passwordReviewModal.classList.remove("show"); }

async function confirmReview() {
  if (!pendingReview) return;
  const {item, action} = pendingReview;
  el.confirmPasswordReviewButton.disabled = true;
  try {
    await reviewCall({uid: item.uid, action});
    closeReviewModal();
    notify(action === "approve" ? "パスワードを変更しました。" : "パスワード変更申請を却下しました。");
    await showPasswordChangeRequests();
  } catch (error) {
    console.error("パスワード変更申請の処理に失敗しました", {code: error?.code, error});
    notify("パスワード変更申請を処理できませんでした。");
  } finally { el.confirmPasswordReviewButton.disabled = false; }
}

function renderEmpty() {
  const row = document.createElement("tr"); const cell = document.createElement("td");
  cell.colSpan = 5; cell.textContent = "申請中のパスワード変更はありません"; row.appendChild(cell);
  el.passwordChangeRequestsTableBody.appendChild(row);
}

function formatDate(value) {
  if (!value) return "―";
  return new Intl.DateTimeFormat("ja-JP", {year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}).format(new Date(value));
}
