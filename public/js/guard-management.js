import { db } from "./firebase-config.js";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let el;
let navigate;
let notify;
let currentProfile;
let currentRole;
let workers = [];
let editingWorker = null;
let pendingAccountAction = null;
let openActionMenu = null;
let openProxyCalendar;
let refreshIntegratedManagement;
let pendingWebEditWorker = null;
let pendingProfileForm = null;

export function initGuardManagement(elements, showScreen, showToast, proxyCalendar, refreshManagement) {
  el = elements;
  navigate = showScreen;
  notify = showToast;
  openProxyCalendar = proxyCalendar;
  refreshIntegratedManagement = refreshManagement;
  el.guardManagementSearch.addEventListener("input", renderActiveWorkers);
  el.newManagedGuardButton.addEventListener("click", () => openWorkerEditor());
  el.openDeletedAccountsButton.addEventListener("click", showDeletedAccounts);
  el.backToGuardManagementButton.addEventListener("click", () =>
    refreshIntegratedManagement ? refreshIntegratedManagement() : showGuardManagement());
  el.cancelManagedGuardButton.addEventListener("click", closeWorkerEditor);
  el.saveManagedGuardButton.addEventListener("click", prepareSaveWorker);
  el.cancelAccountStatusButton.addEventListener("click", closeAccountConfirm);
  el.confirmAccountStatusButton.addEventListener("click", applyAccountStatusAction);
  el.managedGuardModal.addEventListener("click", event => {
    if (event.target === el.managedGuardModal) closeWorkerEditor();
  });
  el.accountStatusConfirmModal.addEventListener("click", event => {
    if (event.target === el.accountStatusConfirmModal) closeAccountConfirm();
  });
  el.cancelWebProfileEditButton.addEventListener("click", closeWebEditConfirm);
  el.confirmWebProfileEditButton.addEventListener("click", confirmWebEdit);
  el.webProfileEditConfirmModal.addEventListener("click", event => {
    if (event.target === el.webProfileEditConfirmModal) closeWebEditConfirm();
  });
  el.cancelProfileSaveButton.addEventListener("click", closeProfileSaveConfirm);
  el.confirmProfileSaveButton.addEventListener("click", confirmProfileSave);
  el.profileSaveConfirmModal.addEventListener("click", event => {
    if (event.target === el.profileSaveConfirmModal) closeProfileSaveConfirm();
  });
  document.addEventListener("click", event => {
    if (openActionMenu && !event.target.closest(".worker-action-menu-wrap")) closeActionMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeActionMenu();
    if (el.managedGuardModal.classList.contains("show")) closeWorkerEditor();
    if (el.accountStatusConfirmModal.classList.contains("show")) closeAccountConfirm();
    if (el.webProfileEditConfirmModal.classList.contains("show")) closeWebEditConfirm();
    if (el.profileSaveConfirmModal.classList.contains("show")) closeProfileSaveConfirm();
  });
}

export function createIntegratedWorkerMenu(worker, profile, role) {
  currentProfile = profile;
  currentRole = role;
  return createWorkerActionMenu(worker);
}

export function setGuardManagementContext(profile, role) {
  currentProfile = profile;
  currentRole = role;
}

export async function showGuardManagement(profile = currentProfile, role = currentRole) {
  updateContext(profile, role);
  requireOfficeRole();
  navigate("guardManagement");
  await loadWorkers();
}

async function showDeletedAccounts() {
  requireOfficeRole();
  navigate("deletedAccounts");
  await loadWorkers();
}

function updateContext(profile, role) {
  if (profile) currentProfile = profile;
  if (role) currentRole = role;
}

function requireOfficeRole() {
  if (!["staff", "admin"].includes(currentRole?.role)) {
    throw new Error("警備員管理画面を開く権限がありません。");
  }
}

async function loadWorkers() {
  clearMessage(el.guardManagementMessage);
  clearMessage(el.deletedAccountsMessage);
  try {
    const branchId = currentRole.branchId;
    const [usersSnapshot, rolesSnapshot] = await Promise.all([
      getDocs(query(collection(db, "users"), where("branchId", "==", branchId))),
      getDocs(query(collection(db, "userRoles"), where("branchId", "==", branchId)))
    ]);
    const roles = new Map(rolesSnapshot.docs.map(item => [item.id, item.data()]));
    workers = usersSnapshot.docs.map(item => {
      const roleData = roles.get(item.id) || {};
      const data = item.data();
      return {
        id: item.id,
        ...data,
        role: roleData.role || "guard",
        accountStatus: roleData.accountStatus || "inactive",
        disabledAt: roleData.disabledAt || null,
        disabledByUid: roleData.disabledByUid || "",
        inputMode: data.inputMode === "managed" ? "managed" : "web"
      };
    }).sort((a, b) => String(a.employeeNumber).localeCompare(String(b.employeeNumber), "ja"));
    renderActiveWorkers();
    renderInactiveWorkers();
  } catch (error) {
    console.error(error);
    const target = el.deletedAccountsScreen.classList.contains("active")
      ? el.deletedAccountsMessage
      : el.guardManagementMessage;
    showMessage(target, "警備員一覧を読み込めませんでした。", true);
  }
}

function renderActiveWorkers() {
  const search = el.guardManagementSearch.value.trim().toLowerCase();
  const visible = workers.filter(worker =>
    worker.accountStatus === "active" &&
    (!search || `${worker.name || ""} ${worker.employeeNumber || ""}`.toLowerCase().includes(search))
  );
  el.guardManagementTableBody.replaceChildren();
  el.guardManagementCards.replaceChildren();
  visible.forEach(worker => renderActiveWorker(worker));
  renderEmptyState(visible, el.guardManagementTableBody, el.guardManagementCards, 8,
    "条件に一致する利用中のアカウントはありません。");
}

function renderActiveWorker(worker) {
  const values = [
    worker.employeeNumber,
    worker.name,
    roleLabel(worker.role),
    worker.nearestStation || "―",
    worker.contactEmail || "―",
    inputModeLabel(worker.inputMode),
    "利用中"
  ];
  const row = document.createElement("tr");
  values.forEach(value => appendTextCell(row, value));
  const actionCell = document.createElement("td");
  actionCell.appendChild(createWorkerActionMenu(worker));
  row.appendChild(actionCell);
  el.guardManagementTableBody.appendChild(row);

  const card = createWorkerCard(worker);
  const details = document.createElement("div");
  details.className = "guard-card-details";
  details.textContent =
    `警備員番号：${worker.employeeNumber}\n` +
    `最寄り駅：${worker.nearestStation || "―"}\n` +
    `連絡用メール：${worker.contactEmail || "―"}\n` +
    `利用方法：${inputModeLabel(worker.inputMode)}\n` +
    "アカウント状態：利用中";
  card.append(details, createWorkerActionMenu(worker));
  el.guardManagementCards.appendChild(card);
}

function renderInactiveWorkers() {
  const visible = workers.filter(worker => worker.accountStatus === "inactive");
  const nameByUid = new Map(workers.map(worker => [worker.id, worker.name]));
  el.deletedAccountsTableBody.replaceChildren();
  el.deletedAccountsCards.replaceChildren();
  visible.forEach(worker => {
    const disabledBy = nameByUid.get(worker.disabledByUid) ||
      (worker.disabledByUid ? `UID: ${worker.disabledByUid}` : "記録なし");
    const values = [
      worker.employeeNumber,
      worker.name,
      roleLabel(worker.role),
      worker.nearestStation || "―",
      inputModeLabel(worker.inputMode),
      formatTimestamp(worker.disabledAt),
      disabledBy
    ];
    const row = document.createElement("tr");
    values.forEach(value => appendTextCell(row, value));
    const actionCell = document.createElement("td");
    actionCell.appendChild(createRestoreControl(worker));
    row.appendChild(actionCell);
    el.deletedAccountsTableBody.appendChild(row);

    const card = createWorkerCard(worker);
    const details = document.createElement("div");
    details.className = "guard-card-details";
    details.textContent =
      `警備員番号：${worker.employeeNumber}\n` +
      `最寄り駅：${worker.nearestStation || "―"}\n` +
      `利用方法：${inputModeLabel(worker.inputMode)}\n` +
      `利用停止日時：${formatTimestamp(worker.disabledAt)}\n` +
      `利用停止した担当者：${disabledBy}`;
    card.append(details, createRestoreControl(worker));
    el.deletedAccountsCards.appendChild(card);
  });
  renderEmptyState(visible, el.deletedAccountsTableBody, el.deletedAccountsCards, 8,
    "削除済みアカウントはありません。");
}

function createWorkerCard(worker) {
  const card = document.createElement("article");
  card.className = "guard-management-card";
  const heading = document.createElement("div");
  heading.className = "guard-card-heading";
  const name = document.createElement("strong");
  name.textContent = worker.name || "氏名未登録";
  const badge = document.createElement("span");
  badge.className = `role-badge role-badge-${worker.role || "unknown"}`;
  badge.textContent = roleLabel(worker.role);
  heading.append(name, badge);
  card.appendChild(heading);
  return card;
}

function createWorkerActionMenu(worker) {
  const wrap = document.createElement("div");
  wrap.className = "worker-action-menu-wrap";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "worker-action-menu-button";
  trigger.textContent = "⋮";
  trigger.setAttribute("aria-label", `${worker.name}さんの操作メニュー`);
  trigger.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "worker-action-menu";
  menu.hidden = true;

  if (canEditWorker(worker)) menu.appendChild(createMenuButton("編集", () => requestWorkerEdit(worker)));
  if (canProxyInput(worker)) {
    menu.appendChild(createMenuButton("勤務希望を代理入力", () => openProxyCalendar(worker, "admin")));
  }
  if (canDisable(worker)) {
    menu.appendChild(createMenuButton("退職・利用停止", () => openAccountConfirm("disable", worker), true));
  }
  if (!menu.childElementCount) {
    const note = document.createElement("span");
    note.className = "worker-action-unavailable";
    note.textContent = "実行できる操作はありません";
    menu.appendChild(note);
  }
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeActionMenu();
    if (willOpen) {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      openActionMenu = { menu, trigger };
    }
  });
  wrap.append(trigger, menu);
  return wrap;
}

function createMenuButton(label, handler, destructive = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (destructive) button.className = "worker-menu-disable";
  button.addEventListener("click", () => {
    closeActionMenu();
    handler();
  });
  return button;
}

function closeActionMenu() {
  if (!openActionMenu) return;
  openActionMenu.menu.hidden = true;
  openActionMenu.trigger.setAttribute("aria-expanded", "false");
  openActionMenu = null;
}

function canProxyInput(worker) {
  const inputMode = worker.inputMode === "managed" ? "managed" : "web";
  return worker.accountStatus === "active" &&
    ["managed", "web"].includes(inputMode) &&
    (worker.id || worker.uid) !== currentProfile?.uid &&
    worker.branchId === currentRole?.branchId &&
    ["staff", "admin"].includes(currentRole?.role) &&
    (currentRole.role === "admin" || worker.role !== "admin");
}

function canEditWorker(worker) {
  return worker.accountStatus === "active" &&
    (worker.id || worker.uid) !== currentProfile?.uid &&
    worker.branchId === currentRole?.branchId &&
    ["staff", "admin"].includes(currentRole?.role) &&
    (currentRole.role === "admin" || worker.role !== "admin");
}

function canDisable(worker) {
  return worker.accountStatus === "active" &&
    worker.id !== currentProfile?.uid &&
    worker.role !== "admin" &&
    ["staff", "admin"].includes(currentRole?.role);
}

function createRestoreControl(worker) {
  if (currentRole?.role === "admin") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "利用を再開する";
    button.addEventListener("click", () => openAccountConfirm("restore", worker));
    return button;
  }
  const note = document.createElement("span");
  note.className = "restore-admin-only";
  note.textContent = "復元は管理者のみ";
  return note;
}

function openAccountConfirm(action, worker) {
  pendingAccountAction = { action, worker };
  if (action === "disable") {
    el.accountStatusConfirmTitle.textContent = "退職・利用停止の確認";
    el.accountStatusConfirmMessage.textContent =
      `${worker.name}さんを利用停止にしますか？\n\n` +
      "利用停止後：\n" +
      "・新しい勤務希望の対象から除外されます\n" +
      "・シフト作成候補から除外されます\n" +
      "・通常の警備員一覧では非表示になります\n" +
      "・過去の勤務希望やシフト履歴は削除されません";
    el.confirmAccountStatusButton.textContent = "利用停止にする";
    el.confirmAccountStatusButton.className = "danger";
  } else {
    el.accountStatusConfirmTitle.textContent = "利用再開の確認";
    el.accountStatusConfirmMessage.textContent =
      `${worker.name}さんの利用を再開しますか？\n通常の警備員一覧とシフト候補へ再表示されます。`;
    el.confirmAccountStatusButton.textContent = "利用を再開する";
    el.confirmAccountStatusButton.className = "";
  }
  el.accountStatusConfirmModal.classList.add("show");
  requestAnimationFrame(() => el.cancelAccountStatusButton.focus());
}

function closeAccountConfirm() {
  pendingAccountAction = null;
  el.accountStatusConfirmModal.classList.remove("show");
}

async function applyAccountStatusAction() {
  if (!pendingAccountAction) return;
  const { action, worker } = pendingAccountAction;
  if (action === "disable" && !canDisable(worker)) {
    showMessage(el.guardManagementMessage, "このアカウントは利用停止にできません。", true);
    closeAccountConfirm();
    return;
  }
  if (action === "restore" && currentRole?.role !== "admin") {
    showMessage(el.deletedAccountsMessage, "利用再開は管理者だけが実行できます。", true);
    closeAccountConfirm();
    return;
  }
  el.confirmAccountStatusButton.disabled = true;
  try {
    const roleRef = doc(db, "userRoles", worker.id);
    if (action === "disable") {
      await updateDoc(roleRef, {
        accountStatus: "inactive",
        disabledAt: serverTimestamp(),
        disabledByUid: currentProfile.uid,
        updatedAt: serverTimestamp()
      });
      notify(`${worker.name}さんを利用停止にしました。`);
    } else {
      await updateDoc(roleRef, {
        accountStatus: "active",
        disabledAt: deleteField(),
        disabledByUid: deleteField(),
        updatedAt: serverTimestamp()
      });
      notify(`${worker.name}さんの利用を再開しました。`);
    }
    closeAccountConfirm();
    if (refreshIntegratedManagement) await refreshIntegratedManagement();
    else await loadWorkers();
  } catch (error) {
    console.error(error);
    const target = action === "restore" ? el.deletedAccountsMessage : el.guardManagementMessage;
    showMessage(target, action === "restore"
      ? "利用を再開できませんでした。権限と通信状態を確認してください。"
      : "利用停止にできませんでした。権限と通信状態を確認してください。", true);
    closeAccountConfirm();
  } finally {
    el.confirmAccountStatusButton.disabled = false;
  }
}

function openWorkerEditor(worker = null) {
  editingWorker = worker;
  const isWeb = worker && worker.inputMode !== "managed";
  el.managedGuardModalTitle.textContent = worker
    ? `${isWeb ? "Web利用者" : "代理入力警備員"}を編集`
    : "新しい警備員を登録";
  el.managedGuardEmployeeNumber.value = worker?.employeeNumber || "";
  el.managedGuardEmployeeNumber.readOnly = Boolean(worker);
  el.managedGuardName.value = worker?.name || "";
  el.managedGuardPhone.value = worker?.phone || "";
  el.managedGuardPostalCode.value = worker?.postalCode || "";
  el.managedGuardPrefecture.value = worker?.prefecture || "";
  el.managedGuardCity.value = worker?.city || "";
  el.managedGuardAddressLine.value = worker?.addressLine || "";
  el.managedGuardBuilding.value = worker?.building || "";
  el.managedGuardNearestStation.value = worker?.nearestStation || "";
  el.managedGuardContactEmail.value = worker?.contactEmail || "";
  el.managedGuardContactEmail.readOnly = Boolean(isWeb);
  el.managedGuardContactEmailLabel.hidden = Boolean(isWeb);
  el.managedGuardFixedInputMode.textContent = `利用方法：${isWeb ? "Web利用" : "代理入力"}`;
  el.managedGuardFixedRole.textContent = `区分：${worker ? roleLabel(worker.role) : "警備員"}`;
  el.managedGuardFixedStatus.textContent = `状態：${worker?.accountStatus || "active"}`;
  clearMessage(el.managedGuardFormMessage);
  el.managedGuardModal.classList.add("show");
  requestAnimationFrame(() => (worker ? el.managedGuardName : el.managedGuardEmployeeNumber).focus());
}

function requestWorkerEdit(worker) {
  if (!canEditWorker(worker)) return;
  if (worker.inputMode === "managed") {
    openWorkerEditor(worker);
    return;
  }
  pendingWebEditWorker = worker;
  el.webProfileEditConfirmMessage.textContent =
    `この警備員は本人がWebからプロフィールを管理できます。\n\n` +
    `内勤者が編集すると、本人が登録している情報を変更します。\n` +
    `本人から変更依頼を受けていることを確認してください。\n\n` +
    `対象：\n警備員番号：${worker.employeeNumber}\n氏名：${worker.name}`;
  el.webProfileEditConfirmModal.classList.add("show");
}

function closeWebEditConfirm() {
  pendingWebEditWorker = null;
  el.webProfileEditConfirmModal.classList.remove("show");
}

function confirmWebEdit() {
  const worker = pendingWebEditWorker;
  closeWebEditConfirm();
  if (worker && canEditWorker(worker)) openWorkerEditor(worker);
}

function closeWorkerEditor() {
  editingWorker = null;
  clearMessage(el.managedGuardFormMessage);
  el.managedGuardModal.classList.remove("show");
}

function prepareSaveWorker() {
  const form = readForm();
  const errors = validateForm(form);
  if (errors.length) {
    showMessage(el.managedGuardFormMessage, errors.join("・"), true);
    return;
  }
  if (!editingWorker) {
    saveWorker(form);
    return;
  }
  pendingProfileForm = form;
  el.profileSaveConfirmMessage.textContent =
    `対象：\n警備員番号：${editingWorker.employeeNumber}\n氏名：${editingWorker.name}\n\n` +
    "プロフィール情報を更新します。よろしいですか？";
  el.profileSaveConfirmModal.classList.add("show");
}

function closeProfileSaveConfirm() {
  pendingProfileForm = null;
  el.profileSaveConfirmModal.classList.remove("show");
}

async function confirmProfileSave() {
  if (!pendingProfileForm || !editingWorker) return;
  const form = pendingProfileForm;
  el.profileSaveConfirmModal.classList.remove("show");
  pendingProfileForm = null;
  await saveWorker(form);
}

async function saveWorker(form) {
  el.saveManagedGuardButton.disabled = true;
  el.confirmProfileSaveButton.disabled = true;
  const wasEditing = Boolean(editingWorker);
  try {
    if (editingWorker) await updateWorkerProfile(form);
    else await createManagedWorker(form);
    closeWorkerEditor();
    notify(wasEditing ? "警備員情報を更新しました。" : "代理入力警備員を登録しました。");
    if (refreshIntegratedManagement) await refreshIntegratedManagement();
    else await loadWorkers();
  } catch (error) {
    console.error(error);
    const message = !editingWorker && ["permission-denied", "already-exists"].includes(error?.code)
      ? "この警備員番号はすでに登録されています。"
      : "警備員情報を保存できませんでした。";
    showMessage(el.managedGuardFormMessage, message, true);
  } finally {
    el.saveManagedGuardButton.disabled = false;
    el.confirmProfileSaveButton.disabled = false;
  }
}

function readForm() {
  return {
    employeeNumber: el.managedGuardEmployeeNumber.value.trim(),
    name: el.managedGuardName.value.trim(),
    phone: el.managedGuardPhone.value.trim(),
    postalCode: el.managedGuardPostalCode.value.replace(/\D/g, ""),
    prefecture: el.managedGuardPrefecture.value.trim(),
    city: el.managedGuardCity.value.trim(),
    addressLine: el.managedGuardAddressLine.value.trim(),
    building: el.managedGuardBuilding.value.trim(),
    nearestStation: el.managedGuardNearestStation.value.trim(),
    contactEmail: el.managedGuardContactEmail.value.trim()
  };
}

function validateForm(form) {
  const errors = [];
  if (!/^\d{6}$/.test(form.employeeNumber)) errors.push("警備員番号は6桁で入力してください");
  if (!form.name || form.name.length > 80) errors.push("氏名を80文字以内で入力してください");
  if (form.phone && !/^[0-9+\-() 　]{6,20}$/.test(form.phone)) errors.push("電話番号を20文字以内で入力してください");
  if (!/^\d{7}$/.test(form.postalCode)) errors.push("郵便番号は7桁で入力してください");
  if (!form.prefecture || !form.city || !form.addressLine) errors.push("住所を入力してください");
  if (!form.nearestStation) errors.push("最寄り駅を入力してください");
  if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
    errors.push("正しい連絡用メールアドレスを入力してください");
  }
  return errors;
}

async function createManagedWorker(form) {
  if (workers.some(worker => worker.employeeNumber === form.employeeNumber)) {
    const error = new Error("duplicate employee number");
    error.code = "already-exists";
    throw error;
  }
  const workerRef = doc(collection(db, "users"));
  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(doc(db, "employeeNumbers", form.employeeNumber), { uid: workerRef.id });
  batch.set(workerRef, {
    ...form,
    branchId: currentRole.branchId,
    inputMode: "managed",
    authUid: null,
    createdBy: currentProfile.uid,
    createdAt: now,
    updatedAt: now
  });
  batch.set(doc(db, "userRoles", workerRef.id), {
    role: "guard",
    branchId: currentRole.branchId,
    accountStatus: "active",
    leaderEligible: false,
    createdAt: now,
    updatedAt: now
  });
  await batch.commit();
}

function updateWorkerProfile(form) {
  const values = {
    name: form.name,
    phone: form.phone,
    postalCode: form.postalCode,
    prefecture: form.prefecture,
    city: form.city,
    addressLine: form.addressLine,
    building: form.building,
    nearestStation: form.nearestStation,
    updatedByUid: currentProfile.uid,
    updatedAt: serverTimestamp()
  };
  if (editingWorker.inputMode === "managed") values.contactEmail = form.contactEmail;
  return updateDoc(doc(db, "users", editingWorker.id || editingWorker.uid), values);
}

function appendTextCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "―";
  row.appendChild(cell);
}

function renderEmptyState(visible, tableBody, cards, colspan, text) {
  if (visible.length) return;
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colspan;
  cell.textContent = text;
  row.appendChild(cell);
  tableBody.appendChild(row);
  const card = document.createElement("div");
  card.className = "panel";
  card.textContent = text;
  cards.appendChild(card);
}

function formatTimestamp(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleString("ja-JP") : "記録なし";
}

function roleLabel(role) {
  return { guard: "警備員", staff: "内勤者", admin: "管理者" }[role] || "区分不明";
}

function inputModeLabel(mode) {
  return mode === "managed" ? "代理入力" : "Web利用";
}

function showMessage(target, text, error) {
  target.textContent = text;
  target.className = `message show ${error ? "error" : "success"}`;
}

function clearMessage(target) {
  target.textContent = "";
  target.className = "message";
}
