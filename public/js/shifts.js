import { db } from "./firebase-config.js";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ALL_BRANCHES, BRANCHES, branchName, effectiveBranchId, isBranchId, isOperationalAccount } from "./branches.js";

let el;
let currentRole;
let currentProfile;
let editingId = null;
let candidates = [];
let groups = [];
let selectedLeader = null;
let selectedMembers = new Set();
let profileNames = new Map();
let candidatesExpanded = false;
let openCardMenu = null;
let pendingDateAction = null;
let confirmationResolve = null;
let notifyUser = () => {};
const recentlyDuplicatedIds = new Set();
let memberProfilesBackfilled = false;
let stopGroupsObserver = null;
let groupsObserverVersion = 0;

export function stopShiftGroupObserver() {
  groupsObserverVersion += 1;
  stopGroupsObserver?.();
  stopGroupsObserver = null;
  groups = [];
}

export async function loadOwnConfirmedShifts(uid, branchId) {
  const base = collection(db, "shiftGroups");
  const memberQuery = branchId
    ? query(base, where("branchId", "==", branchId), where("status", "==", "confirmed"), where("memberUids", "array-contains", uid))
    : query(base, where("status", "==", "confirmed"), where("memberUids", "array-contains", uid));
  const leaderQuery = branchId
    ? query(base, where("branchId", "==", branchId), where("status", "==", "confirmed"), where("leaderUid", "==", uid))
    : query(base, where("status", "==", "confirmed"), where("leaderUid", "==", uid));
  const [memberSnapshot, legacyLeaderSnapshot] = await Promise.all([
    getDocs(memberQuery),
    getDocs(leaderQuery)
  ]);
  return [...new Map(
    [...memberSnapshot.docs, ...legacyLeaderSnapshot.docs].map(item => [item.id, { id: item.id, ...item.data() }])
  ).values()];
}

export function initShifts(elements, showScreen, notify) {
  el = elements;
  notifyUser = notify;
  BRANCHES.forEach(branch => el.shiftGroupBranch.add(new Option(branch.name, branch.id)));
  for (let hour = 0; hour < 24; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour).padStart(2, "0");
    option.textContent = String(hour).padStart(2, "0");
    el.shiftStartHour.appendChild(option);
  }
  for (let count = 1; count <= 10; count += 1) {
    const option = button(`${count}人`, () => {
      el.shiftRequiredMembers.value = String(count);
      closeRequiredMembersOptions();
      renderCompletion();
    });
    option.className = "number-option secondary";
    el.requiredMembersOptions.appendChild(option);
  }
  el.shiftBuilderDate.value = localKey(new Date());
  el.shiftPrevDay.addEventListener("click", () => moveDay(-1));
  el.shiftNextDay.addEventListener("click", () => moveDay(1));
  el.shiftToday.addEventListener("click", () => {
    el.shiftBuilderDate.value = localKey(new Date());
    renderGroups();
  });
  el.shiftBuilderDate.addEventListener("change", renderGroups);
  el.shiftTypeDay.addEventListener("click", () => setType("day"));
  el.shiftTypeNight.addEventListener("click", () => setType("night"));
  el.newShiftGroupButton.addEventListener("click", () => openEditor());
  el.closeShiftGroupButton.addEventListener("click", closeEditor);
  el.closeShiftGroupTopButton.addEventListener("click", closeEditor);
  el.draftShiftButton.addEventListener("click", () => saveGroup("draft", notify));
  el.draftShiftTopButton.addEventListener("click", () => saveGroup("draft", notify));
  el.confirmShiftButton.addEventListener("click", () => saveGroup("confirmed", notify));
  el.confirmShiftTopButton.addEventListener("click", () => saveGroup("confirmed", notify));
  el.requiredMembersPickerButton.addEventListener("click", () => {
    const willOpen = el.requiredMembersOptions.hidden;
    el.requiredMembersOptions.hidden = !willOpen;
    el.requiredMembersPickerButton.setAttribute("aria-expanded", String(willOpen));
  });
  el.closeAvailabilityNotePanel.addEventListener("click", closeAvailabilityNote);
  el.availabilityNotePanel.addEventListener("click", event => {
    if (event.target === el.availabilityNotePanel) closeAvailabilityNote();
  });
  el.memberSearch.addEventListener("input", () => {
    if (el.memberSearch.value.trim()) setCandidatesExpanded(true);
    renderCandidates();
  });
  el.memberCandidatesToggle.addEventListener("click", () => {
    const expanding = !candidatesExpanded;
    if (!expanding) el.showOutsideAvailability.checked = false;
    setCandidatesExpanded(expanding);
    renderCandidates();
  });
  el.showOutsideAvailability.addEventListener("change", () => {
    setCandidatesExpanded(el.showOutsideAvailability.checked);
    renderCandidates();
  });
  el.showOtherBranchCandidates.addEventListener("change", loadCandidates);
  el.shiftGroupBranch.addEventListener("change", () => {
    selectedMembers.clear();
    selectedLeader = null;
    loadCandidates();
  });
  el.cancelShiftDateActionButton.addEventListener("click", closeDateActionModal);
  el.saveShiftDateActionButton.addEventListener("click", () => runCardOperation(saveDateAction));
  el.shiftDateActionModal.addEventListener("click", event => {
    if (event.target === el.shiftDateActionModal) closeDateActionModal();
  });
  el.confirmShiftOperationButton.addEventListener("click", () => finishConfirmation(true));
  el.cancelShiftOperationButton.addEventListener("click", () => finishConfirmation(false));
  el.shiftOperationConfirmModal.addEventListener("click", event => {
    if (event.target === el.shiftOperationConfirmModal) finishConfirmation(false);
  });
  document.addEventListener("click", event => {
    if (openCardMenu && !openCardMenu.contains(event.target)) closeCardMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (el.shiftOperationConfirmModal.classList.contains("show")) finishConfirmation(false);
    else if (el.shiftDateActionModal.classList.contains("show")) closeDateActionModal();
    else closeCardMenu();
  });
  el.clearLeaderButton.addEventListener("click", () => {
    selectedLeader = null;
    renderSelectedMembers();
  });
  [
    el.shiftGroupTitle, el.shiftAddress, el.shiftStartHour, el.shiftStartMinute, el.shiftRequiredMembers
  ].forEach(input => input.addEventListener("input", renderCompletion));

  return async (profile, role) => {
    if (!["staff", "admin"].includes(role?.role)) throw new Error("シフト作成権限がありません。");
    currentProfile = profile;
    currentRole = role;
    showScreen("shiftBuilder");
    if (!memberProfilesBackfilled) {
      await backfillConfirmedMemberProfiles();
      memberProfilesBackfilled = true;
    }
    await renderGroups();
  };
}

function type() {
  return el.shiftTypeDay.classList.contains("active") ? "day" : "night";
}

function setType(value) {
  el.shiftTypeDay.className = value === "day" ? "active" : "secondary";
  el.shiftTypeNight.className = value === "night" ? "active" : "secondary";
  renderGroups();
}

async function renderGroups() {
  if (!currentRole) return;
  stopGroupsObserver?.();
  stopGroupsObserver = null;
  const observerVersion = ++groupsObserverVersion;
  closeCardMenu();
  groups = [];
  el.shiftGroupsList.innerHTML = '<div class="panel">シフトグループを読み込んでいます。</div>';
  const branchId = effectiveBranchId(currentRole);
  const allBranches = currentRole.role === "admin" && branchId === ALL_BRANCHES;
  el.newShiftGroupButton.disabled = false;
  el.shiftBuilderMessage.textContent = allBranches ? "すべての支社を表示中です。新規作成時に作成先支社を選択してください。" : "";
  el.shiftBuilderMessage.className = allBranches ? "message show" : "message";
  const groupQuery = allBranches
    ? query(collection(db, "shiftGroups"), where("date", "==", el.shiftBuilderDate.value), where("shiftType", "==", type()))
    : query(collection(db, "shiftGroups"), where("branchId", "==", branchId),
      where("date", "==", el.shiftBuilderDate.value), where("shiftType", "==", type()));
  const profileSnapshot = await getDocs(
    allBranches ? collection(db, "users") : query(collection(db, "users"), where("branchId", "==", branchId))
  );
  if (observerVersion !== groupsObserverVersion) return;
  profileNames = new Map(profileSnapshot.docs.map(item => [item.id, item.data().name]));
  stopGroupsObserver = onSnapshot(groupQuery, groupSnapshot => {
    if (observerVersion !== groupsObserverVersion) return;
    groups = groupSnapshot.docs.map(item => normalizeGroup({ id: item.id, ...item.data() }));
    renderGroupCards(allBranches);
  }, error => {
    if (observerVersion !== groupsObserverVersion) return;
    console.error("シフトグループのリアルタイム取得に失敗しました", error);
    el.shiftGroupsList.innerHTML = '<div class="message show error">シフトグループを読み込めませんでした。</div>';
  });
}

function renderGroupCards(allBranches) {
  closeCardMenu();
  el.shiftGroupsList.replaceChildren();

  groups.forEach(group => {
    const issues = incompleteIssues(group);
    const card = document.createElement("article");
    const isConfirmed = group.status === "confirmed";
    card.className = `shift-group-card ${issues.length ? "incomplete" : "complete"} ${isConfirmed ? "status-confirmed-card" : "status-draft-card"}`;
    const visibleIssues = issues.slice(0, 3);
    const remaining = issues.length - visibleIssues.length;
    card.innerHTML = `
      <div class="group-card-heading">
        <div class="group-card-controls">
          <span class="shift-status-badge ${isConfirmed ? "is-confirmed" : "is-draft"}">${isConfirmed ? "確定済み" : "下書き"}</span>
          <span class="completion-badge ${issues.length ? "is-incomplete" : "is-complete"}">${issues.length ? "未完成" : "入力完了"}</span>
        </div>
      </div>
      <h2 class="group-card-title">${safe(group.title || "名称未入力のグループ")}</h2>
      ${allBranches ? `<div><b>支社：</b>${safe(branchName(group.branchId))}</div>` : ""}
      <div>${safe(group.address || "現場住所未入力")}</div>
      <div>勤務開始：${safe(displayStartTime(group.startTime) || "開始時刻未入力")}</div>
      <div>隊長：${safe(group.leaderUid ? nameOf(group.leaderUid) : "未選択")}　配置人数：${group.memberUids.length}人</div>
      <div>備考：${safe(group.note || "なし")}</div>
      <div class="shift-card-audit"><b>作成者：</b>${safe(group.createdByName || nameOf(group.createdBy) || group.createdBy || "不明")}</div>
      <div class="shift-card-audit"><b>最終更新：</b>${safe(group.updatedByName || nameOf(group.updatedByUid) || "不明")}　${safe(formatUpdatedAt(group.updatedAt))}</div>
      ${issues.length ? `<div class="incomplete-summary"><strong>未入力項目があります</strong><ul>${visibleIssues.map(issue => `<li>${safe(issue)}</li>`).join("")}</ul>${remaining > 0 ? `<div>ほか${remaining}件</div>` : ""}</div>` : ""}
    `;
    const cardControls = card.querySelector(".group-card-controls");
    cardControls.appendChild(createCardMenu(group, card));
    if (recentlyDuplicatedIds.has(group.id)) {
      const notice = document.createElement("div");
      notice.className = "duplicated-shift-notice";
      notice.textContent = "複製しました。複製したシフトです。内容を確認してください。";
      card.appendChild(notice);
      recentlyDuplicatedIds.delete(group.id);
    }
    el.shiftGroupsList.appendChild(card);
  });
  if (!groups.length) {
    el.shiftGroupsList.innerHTML = '<div class="panel">この日の作成済みグループはありません。</div>';
  }
}

function createCardMenu(group, card) {
  const wrap = document.createElement("div");
  wrap.className = "shift-card-menu-wrap";
  const trigger = button("⋮", event => {
    event.stopPropagation();
    const isOpening = openCardMenu !== wrap;
    closeCardMenu();
    if (!isOpening) return;
    openCardMenu = wrap;
    card.classList.add("menu-open");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  });
  trigger.className = "shift-card-menu-button secondary";
  trigger.setAttribute("aria-label", `${group.title || "名称未入力のグループ"}の操作メニューを開く`);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "shift-card-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const targetType = group.shiftType === "day" ? "night" : "day";
  menu.append(
    menuButton("編集", () => openEditor(group)),
    menuButton(`${targetType === "day" ? "日勤" : "夜勤"}に変更`, () => changeShiftType(group, targetType)),
    menuButton("日付を変更", () => openDateActionModal("move", group)),
    menuButton("複製", () => openDateActionModal("duplicate", group)),
    menuButton("削除", () => deleteGroup(group), true)
  );
  wrap.append(trigger, menu);
  return wrap;
}

function menuButton(label, handler, destructive = false) {
  const item = button(label, event => {
    event.stopPropagation();
    closeCardMenu();
    runCardOperation(handler);
  });
  item.setAttribute("role", "menuitem");
  if (destructive) item.className = "menu-delete";
  return item;
}

function closeCardMenu() {
  if (!openCardMenu) return;
  openCardMenu.querySelector(".shift-card-menu").hidden = true;
  openCardMenu.querySelector(".shift-card-menu-button").setAttribute("aria-expanded", "false");
  openCardMenu.closest(".shift-group-card")?.classList.remove("menu-open");
  openCardMenu = null;
}

async function runCardOperation(operation) {
  try {
    await operation();
  } catch (error) {
    console.error(error);
    notifyUser("シフトを更新できませんでした。");
  }
}

async function changeShiftType(group, targetType) {
  const typeLabel = targetType === "day" ? "日勤" : "夜勤";
  const duplicateWarning = await duplicateAssignmentWarning(group, group.date, targetType, group.id);
  const confirmedWarning = confirmedOperationWarning(group);
  const message = [
    confirmedWarning,
    `このシフトを${typeLabel}に変更しますか？`,
    duplicateWarning
  ].filter(Boolean).join("\n\n");
  if (!await confirmOperation(message, "変更する")) return;
  await updateDoc(doc(db, "shiftGroups", group.id), {
    shiftType: targetType,
    updatedByUid: currentProfile.uid,
    updatedByName: currentProfile.name,
    updatedAt: serverTimestamp()
  });
  await syncShiftCandidateAssignments(group.id, { ...group, shiftType: targetType });
  notifyUser(`${typeLabel}に変更しました。`);
  await renderGroups();
}

function openDateActionModal(mode, group) {
  closeCardMenu();
  pendingDateAction = { mode, group };
  const duplicating = mode === "duplicate";
  el.shiftDateActionTitle.textContent = duplicating ? "複製先の日付を選択" : "シフトの日付を変更";
  el.shiftDateActionHelp.textContent = duplicating
    ? "複製先の日付を選択してください。複製先は下書きになります。"
    : "変更後の日付を選択してください。";
  el.shiftDateActionInput.value = group.date;
  el.shiftDateActionInput.min = localKey(new Date());
  el.saveShiftDateActionButton.textContent = duplicating ? "この日付に複製" : "この日付に変更";
  clearDateActionError();
  el.shiftDateActionModal.classList.add("show");
  requestAnimationFrame(() => el.shiftDateActionInput.focus());
}

function closeDateActionModal() {
  pendingDateAction = null;
  clearDateActionError();
  el.shiftDateActionModal.classList.remove("show");
}

function clearDateActionError() {
  el.shiftDateActionError.textContent = "";
  el.shiftDateActionError.className = "message";
}

async function saveDateAction() {
  if (!pendingDateAction) return;
  const targetDate = el.shiftDateActionInput.value;
  if (!targetDate) {
    showDateActionError("日付を選択してください。");
    return;
  }
  if (targetDate < localKey(new Date())) {
    showDateActionError("過去の日付には変更・複製できません。");
    return;
  }
  const action = pendingDateAction;
  closeDateActionModal();
  if (action.mode === "duplicate") await duplicateGroup(action.group, targetDate);
  else await changeGroupDate(action.group, targetDate);
}

function showDateActionError(message) {
  el.shiftDateActionError.textContent = message;
  el.shiftDateActionError.className = "message show error";
}

async function changeGroupDate(group, targetDate) {
  if (targetDate === group.date) {
    notifyUser("日付は変更されていません。");
    return;
  }
  const duplicateWarning = await duplicateAssignmentWarning(group, targetDate, group.shiftType, group.id);
  const message = [
    confirmedOperationWarning(group),
    `このシフトの日付を${formatJapaneseDate(targetDate)}に変更しますか？`,
    duplicateWarning
  ].filter(Boolean).join("\n\n");
  if (!await confirmOperation(message, "変更する")) return;
  await updateDoc(doc(db, "shiftGroups", group.id), {
    date: targetDate,
    updatedByUid: currentProfile.uid,
    updatedByName: currentProfile.name,
    updatedAt: serverTimestamp()
  });
  await syncShiftCandidateAssignments(group.id, { ...group, date: targetDate });
  notifyUser(`${formatJapaneseDate(targetDate)}に変更しました。`);
  await renderGroups();
}

async function duplicateGroup(group, targetDate) {
  const duplicateWarning = await duplicateAssignmentWarning(group, targetDate, group.shiftType);
  const message = [
    `このシフトを${formatJapaneseDate(targetDate)}に複製しますか？`,
    "複製先は下書きになります。配置内容を必ず確認してください。",
    duplicateWarning
  ].filter(Boolean).join("\n\n");
  if (!await confirmOperation(message, "この日付に複製")) return;
  const copied = {
    ...copyShiftContent(group),
    date: targetDate,
    status: "draft",
    createdBy: currentProfile.uid,
    createdByName: currentProfile.name,
    updatedByUid: currentProfile.uid,
    updatedByName: currentProfile.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const created = await addDoc(collection(db, "shiftGroups"), copied);
  await syncShiftCandidateAssignments(created.id, copied);
  recentlyDuplicatedIds.add(created.id);
  el.shiftBuilderDate.value = targetDate;
  setTypeClasses(group.shiftType);
  notifyUser("シフトを複製しました。配置内容を確認してください。");
  await renderGroups();
}

function copyShiftContent(group) {
  const managementFields = new Set(["id", "status", "createdAt", "updatedAt", "createdBy", "createdByName", "updatedByUid", "updatedByName"]);
  const content = Object.fromEntries(
    Object.entries(group).filter(([key]) => !managementFields.has(key))
  );
  content.memberUids = [...group.memberUids];
  return content;
}

async function deleteGroup(group) {
  const warning = group.status === "confirmed"
    ? "確定済みシフトを変更します。\nこのシフトは確定済みです。\n削除すると警備員のシフト確認画面からも消えます。"
    : "このシフトを削除しますか？";
  const message = `${warning}\n\nこの操作は元に戻せません。`;
  if (!await confirmOperation(message, "削除する", true)) return;
  await deleteDoc(doc(db, "shiftGroups", group.id));
  await syncShiftCandidateAssignments(group.id, null);
  notifyUser("シフトを削除しました。");
  await renderGroups();
}

function confirmOperation(message, confirmLabel, destructive = false) {
  if (confirmationResolve) finishConfirmation(false);
  el.shiftOperationConfirmMessage.textContent = message;
  el.confirmShiftOperationButton.textContent = confirmLabel;
  el.confirmShiftOperationButton.className = destructive ? "danger" : "";
  el.shiftOperationConfirmModal.classList.add("show");
  return new Promise(resolve => {
    confirmationResolve = resolve;
    requestAnimationFrame(() => el.confirmShiftOperationButton.focus());
  });
}

function finishConfirmation(confirmed) {
  if (!confirmationResolve) return;
  const resolve = confirmationResolve;
  confirmationResolve = null;
  el.shiftOperationConfirmModal.classList.remove("show");
  resolve(confirmed);
}

function confirmedOperationWarning(group) {
  return group.status === "confirmed" ? "確定済みシフトを変更します。" : "";
}

async function duplicateAssignmentWarning(group, targetDate, targetType, excludedId = null) {
  if (!group.memberUids.length) return "";
  const snapshot = await getDocs(query(
    collection(db, "shiftGroups"),
    where("branchId", "==", group.branchId),
    where("date", "==", targetDate),
    where("shiftType", "==", targetType)
  ));
  const duplicateUids = new Set();
  snapshot.docs.forEach(item => {
    if (item.id === excludedId) return;
    const other = normalizeGroup(item.data());
    other.memberUids.forEach(uid => {
      if (group.memberUids.includes(uid)) duplicateUids.add(uid);
    });
  });
  if (!duplicateUids.size) return "";
  const typeLabel = targetType === "day" ? "日勤" : "夜勤";
  const names = [...duplicateUids].map(uid => `${nameOf(uid)}さん`).join("、");
  return `重複配置の可能性があります。\n${names}は、${formatJapaneseDate(targetDate)}の${typeLabel}ですでに別のシフトへ配置されています。\n続行する場合は配置内容を確認してください。`;
}

function formatJapaneseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function setTypeClasses(value) {
  el.shiftTypeDay.className = value === "day" ? "active" : "secondary";
  el.shiftTypeNight.className = value === "night" ? "active" : "secondary";
}

async function openEditor(group = null) {
  const normalized = group ? normalizeGroup(group) : null;
  const selectedViewBranch = effectiveBranchId(currentRole);
  const selectingBranch = currentRole.role === "admin" && selectedViewBranch === ALL_BRANCHES && !normalized;
  editingId = normalized?.id || null;
  selectedLeader = normalized?.leaderUid || null;
  selectedMembers = new Set(normalized?.memberUids || []);
  const fields = {
    shiftGroupTitle: "title",
    shiftAddress: "address",
    shiftRequiredMembers: "requiredMembers",
    shiftGroupNote: "note"
  };
  Object.entries(fields).forEach(([id, key]) => {
    el[id].value = normalized?.[key] ?? "";
  });
  const defaultHour = type() === "day" ? "09" : "20";
  const [startHour, startMinute] = normalizeStartTime(normalized?.startTime, defaultHour);
  el.shiftStartHour.value = startHour;
  el.shiftStartMinute.value = startMinute;
  el.shiftDepartureCheckTime.value = normalized?.departureCheckTime || "";
  el.shiftGroupBranchWrap.hidden = currentRole.role !== "admin" || (selectedViewBranch !== ALL_BRANCHES && !normalized);
  el.shiftGroupBranch.disabled = Boolean(normalized) || !selectingBranch;
  el.shiftGroupBranch.value = normalized?.branchId || (isBranchId(selectedViewBranch) ? selectedViewBranch : "");
  closeRequiredMembersOptions();
  el.memberSearch.value = "";
  el.showOutsideAvailability.checked = false;
  setCandidatesExpanded(false);
  el.shiftGroupModalTitle.textContent = normalized ? "グループを編集" : "新しいグループ";
  el.shiftGroupModal.classList.add("show");
  const editor = el.shiftGroupModal.querySelector(".shift-editor");
  editor.scrollTop = 0;
  requestAnimationFrame(() => { editor.scrollTop = 0; });
  await loadCandidates();
  editor.scrollTop = 0;
}

function closeEditor() {
  closeRequiredMembersOptions();
  el.shiftGroupModal.classList.remove("show");
}

async function loadCandidates() {
  const branch = editingId
    ? groups.find(group => group.id === editingId)?.branchId
    : (currentRole.role === "admin" ? el.shiftGroupBranch.value : effectiveBranchId(currentRole));
  if (!isBranchId(branch)) {
    candidates = [];
    el.memberCandidates.textContent = "先に作成先支社を選択してください。";
    selectedMembers.clear();
    selectedLeader = null;
    renderSelectedMembers();
    return;
  }
  const date = el.shiftBuilderDate.value;
  const includeOtherBranches = currentRole.role === "staff" && el.showOtherBranchCandidates.checked;
  const [usersSnap, rolesSnap, availabilitySnap, groupsSnap, externalProfilesSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("branchId", "==", branch))),
    getDocs(query(collection(db, "userRoles"), where("branchId", "==", branch))),
    includeOtherBranches
      ? getDocs(query(collection(db, "shiftCandidateAvailability"), where("date", "==", date)))
      : getDocs(query(collection(db, "availability"), where("branchId", "==", branch), where("date", "==", date))),
    includeOtherBranches
      ? getDocs(query(collection(db, "shiftCandidateAssignments"), where("date", "==", date), where("shiftType", "==", type())))
      : getDocs(query(collection(db, "shiftGroups"), where("branchId", "==", branch), where("date", "==", date), where("shiftType", "==", type()))),
    includeOtherBranches
      ? getDocs(query(collection(db, "shiftCandidateProfiles"), where("accountStatus", "in", ["active", "approved"])))
      : Promise.resolve({ docs: [] })
  ]);
  const roles = new Map(rolesSnap.docs.map(item => [item.id, item.data()]));
  const availability = new Map(availabilitySnap.docs.map(item => [item.data().uid, item.data()]));
  const occupied = new Map();
  groupsSnap.docs.filter(item => item.id !== editingId && item.data().shiftGroupId !== editingId).forEach(item => {
    if (includeOtherBranches) occupied.set(item.data().uid, item.data().title || "名称未入力のグループ");
    else normalizeGroup(item.data()).memberUids.forEach(uid => occupied.set(uid, item.data().title || "名称未入力のグループ"));
  });
  const ownCandidates = usersSnap.docs.map(item => {
    const role = roles.get(item.id);
    const wish = availability.get(item.id);
    return {
      uid: item.id,
      ...item.data(),
      active: isOperationalAccount(role?.accountStatus),
      wants: Boolean(wish?.[type()]),
      availabilityNote: String(wish?.note || ""),
      occupied: occupied.get(item.id) || ""
    };
  }).filter(person => person.active);
  const externalCandidates = externalProfilesSnap.docs
    .map(item => ({ uid: item.id, ...item.data() }))
    .filter(person => person.branchId !== branch && isOperationalAccount(person.accountStatus))
    .map(person => {
      const wish = availability.get(person.uid);
      return {
        ...person, active: true, wants: Boolean(wish?.[type()]),
        availabilityNote: String(wish?.note || ""), occupied: occupied.get(person.uid) || "",
        isOtherBranch: true
      };
    })
    // 他支社候補は「勤務可能」の要件を満たす人だけを表示する。
    .filter(person => person.wants);
  // 将来的に勤務可否は role ではなく shiftEligible などの専用属性で管理する。
  candidates = [...ownCandidates, ...externalCandidates];
  renderCandidates();
}

function renderCandidates() {
  const term = el.memberSearch.value.trim().toLowerCase();
  const matches = person => !term || `${person.name} ${person.employeeNumber}`.toLowerCase().includes(term);
  const members = candidates.filter(person =>
    !person.occupied &&
    (person.wants || el.showOutsideAvailability.checked || selectedMembers.has(person.uid)) &&
    matches(person)
  );
  el.memberCandidates.replaceChildren();
  members.forEach(person => {
    el.memberCandidates.appendChild(candidateRow(person, selectedMembers.has(person.uid), () => {
      if (selectedMembers.has(person.uid)) {
        selectedMembers.delete(person.uid);
        if (selectedLeader === person.uid) selectedLeader = null;
      } else {
        selectedMembers.add(person.uid);
      }
      renderCandidates();
    }));
  });
  if (!members.length) el.memberCandidates.textContent = "条件に一致する未配置警備員がいません。";
  renderSelectedMembers();
}

function setCandidatesExpanded(expanded) {
  candidatesExpanded = expanded;
  el.memberCandidates.hidden = !expanded;
  el.memberCandidatesToggle.textContent = expanded ? "▲" : "▼";
  el.memberCandidatesToggle.setAttribute("aria-expanded", String(expanded));
  el.memberCandidatesToggle.setAttribute(
    "aria-label",
    expanded ? "未配置警備員の一覧を閉じる" : "勤務可能な未配置警備員の一覧を開く"
  );
}

function displayStartTime(value) {
  if (!value) return "";
  const [hour, minute = "00"] = value.split(":");
  const numericHour = Number(hour);
  return `${Number.isFinite(numericHour) ? numericHour : hour}:${minute}`;
}

function renderSelectedMembers() {
  el.selectedMembersList.replaceChildren();
  const people = [...selectedMembers].map(uid => candidates.find(item => item.uid === uid) || { uid, name: nameOf(uid), employeeNumber: "" });
  people.forEach(person => {
    const row = document.createElement("div");
    row.className = "selected-member-row";
    const name = document.createElement("span");
    name.textContent = `${person.name} ${person.employeeNumber ? `／${person.employeeNumber}` : ""}`;
    const remove = button("このメンバーを削除", () => {
      selectedMembers.delete(person.uid);
      if (selectedLeader === person.uid) selectedLeader = null;
      renderCandidates();
    });
    remove.className = "secondary member-remove";
    row.append(name, remove);
    el.selectedMembersList.appendChild(row);
  });
  if (!people.length) el.selectedMembersList.textContent = "メンバーが選択されていません。";

  el.leaderChoices.replaceChildren();
  people.forEach(person => {
    const choice = button(person.name, () => {
      selectedLeader = person.uid;
      renderSelectedMembers();
    });
    choice.className = selectedLeader === person.uid ? "leader-choice selected" : "leader-choice secondary";
    choice.setAttribute("aria-pressed", String(selectedLeader === person.uid));
    choice.textContent += selectedLeader === person.uid ? "（選択中）" : "（未選択）";
    el.leaderChoices.appendChild(choice);
  });
  if (!people.length) el.leaderChoices.textContent = "先にメンバーを選択してください。";
  el.clearLeaderButton.disabled = !selectedLeader;
  renderCompletion();
}

function candidateRow(person, checked, onChange) {
  const row = document.createElement("div");
  row.className = "candidate-row";
  const label = document.createElement("label");
  label.className = "candidate-main";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", onChange);
  const requestedShift = person.wants ? (type() === "day" ? "日勤" : "夜勤") : "希望なし";
  label.append(input, document.createTextNode(
    `${person.name}／${person.employeeNumber}／${requestedShift}／最寄り駅 ${person.nearestStation || "―"}` +
    `${person.isOtherBranch ? `／${branchName(person.branchId)}` : ""}`
  ));
  row.appendChild(label);
  if (person.availabilityNote) {
    const preview = person.availabilityNote.length > 10
      ? `${person.availabilityNote.slice(0, 10)}…`
      : person.availabilityNote;
    const noteButton = button(`備考：${preview}`, () => openAvailabilityNote(person.availabilityNote));
    noteButton.className = "availability-note-preview secondary";
    row.appendChild(noteButton);
  } else {
    const noNote = document.createElement("span");
    noNote.className = "candidate-no-note";
    noNote.textContent = "備考なし";
    row.appendChild(noNote);
  }
  return row;
}

function openAvailabilityNote(text) {
  el.availabilityNoteFullText.textContent = text;
  el.availabilityNotePanel.classList.add("show");
}

function closeAvailabilityNote() {
  el.availabilityNotePanel.classList.remove("show");
}

function currentFormData(status = "draft") {
  const requiredText = el.shiftRequiredMembers.value.trim();
  return {
    date: el.shiftBuilderDate.value,
    shiftType: type(),
    branchId: editingId
      ? groups.find(group => group.id === editingId)?.branchId
      : (currentRole.role === "admin" ? el.shiftGroupBranch.value : effectiveBranchId(currentRole)),
    title: el.shiftGroupTitle.value.trim(),
    clientName: "",
    address: el.shiftAddress.value.trim(),
    meetingPlace: "",
    meetingTime: "",
    startTime: `${el.shiftStartHour.value}:${el.shiftStartMinute.value}`,
    departureCheckTime: el.shiftDepartureCheckTime.value,
    endTime: "",
    note: el.shiftGroupNote.value.trim(),
    leaderUid: selectedLeader,
    memberUids: [...selectedMembers],
    requiredMembers: requiredText ? Number(requiredText) : null,
    status
  };
}

function renderCompletion() {
  const data = currentFormData();
  const issues = incompleteIssues(data);
  const requiredFields = [
    [el.shiftGroupTitle, data.title],
    [el.shiftAddress, data.address],
    [el.shiftStartHour, data.startTime],
    [el.shiftStartMinute, data.startTime],
    [el.shiftRequiredMembers, data.requiredMembers]
  ];
  requiredFields.forEach(([input, value]) => input.classList.toggle("input-incomplete", value === "" || value === null));
  el.groupCompletionMessage.className = `completion-warning ${issues.length ? "show" : "complete show"}`;
  el.groupCompletionMessage.textContent = issues.length
    ? `未入力項目があります：${issues.join("、")}`
    : "入力完了です。";
}

function incompleteIssues(group) {
  const issues = [];
  if (!group.title) issues.push("グループタイトル未入力");
  if (!group.address) issues.push("現場住所未入力");
  if (!group.startTime) issues.push("勤務開始時刻未入力");
  if (!group.leaderUid) issues.push("隊長未選択");
  if (group.requiredMembers === null || group.requiredMembers === undefined || group.requiredMembers === "") {
    issues.push("必要人数未入力");
  } else if (group.memberUids.length < group.requiredMembers) {
    issues.push(`あと${group.requiredMembers - group.memberUids.length}人必要`);
  }
  if (!group.memberUids.length) issues.push("メンバー未選択");
  return issues;
}

async function saveGroup(status, notify) {
  const data = currentFormData(status);
  if (!isBranchId(data.branchId)) {
    alert("作成先支社を選択してください。");
    el.shiftGroupBranch.focus();
    return;
  }
  if (data.date < localKey(new Date())) {
    alert("過去の日付にはシフトを作成できません。");
    return;
  }
  if (data.requiredMembers !== null && (!Number.isInteger(data.requiredMembers) || data.requiredMembers < 1 || data.requiredMembers > 99)) {
    alert("必要人数は1～99人で入力してください。");
    return;
  }
  const outside = candidates.filter(person => data.memberUids.includes(person.uid) && !person.wants);
  if (outside.length && !confirm("希望していない勤務帯の警備員が含まれます。それでも配置しますか？")) return;
  const issues = incompleteIssues(data);
  const incompleteConfirmation = editingId
    ? "未入力または未設定の項目があります。このまま変更を確定しますか？"
    : "未入力または未設定の項目がありますが、グループを作成しますか？";
  if (status === "confirmed" && issues.length &&
      !confirm(`${incompleteConfirmation}\n\n${issues.join("\n")}`)) return;
  if (status === "confirmed" && !issues.length &&
      !confirm(`${data.date} ${data.shiftType === "day" ? "日勤" : "夜勤"}\n${data.title}\n${data.memberUids.length}名で確定しますか？`)) return;

  const shiftRef = editingId ? doc(db, "shiftGroups", editingId) : doc(collection(db, "shiftGroups"));
  const batch = writeBatch(db);
  if (editingId) batch.update(shiftRef, {
    ...data,
    updatedByUid: currentProfile.uid,
    updatedByName: currentProfile.name,
    updatedAt: serverTimestamp()
  });
  else batch.set(shiftRef, {
    ...data,
    createdBy: currentProfile.uid,
    createdByName: currentProfile.name,
    updatedByUid: currentProfile.uid,
    updatedByName: currentProfile.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  await syncShiftCandidateAssignments(shiftRef.id, data);
  await syncShiftMemberProfiles(shiftRef.id, data, status);
  closeEditor();
  notify(status === "confirmed" ? "シフトを確定しました。" : "下書きを保存しました。");
  await renderGroups();
}

async function syncShiftCandidateAssignments(shiftGroupId, data) {
  const existing = await getDocs(query(
    collection(db, "shiftCandidateAssignments"), where("shiftGroupId", "==", shiftGroupId)
  ));
  const batch = writeBatch(db);
  existing.docs.forEach(item => batch.delete(item.ref));
  if (data) {
    data.memberUids.forEach(uid => {
      batch.set(doc(db, "shiftCandidateAssignments", `${shiftGroupId}_${uid}`), {
        shiftGroupId, uid, branchId: data.branchId, date: data.date,
        shiftType: data.shiftType, title: String(data.title || "").slice(0, 80),
        updatedAt: serverTimestamp()
      });
    });
  }
  await batch.commit();
}

async function syncShiftMemberProfiles(shiftId, data, status) {
  const membersCollection = collection(db, "shiftMemberProfiles", shiftId, "members");
  const existing = await getDocs(query(membersCollection, where("branchId", "==", data.branchId)));
  const operations = existing.docs.map(item => ({ type: "delete", ref: item.ref }));
  if (status === "confirmed") {
    const byUid = new Map(candidates.map(person => [person.uid, person]));
    data.memberUids.forEach(uid => {
      const person = byUid.get(uid);
      if (!person) return;
      operations.push({
        type: "set",
        ref: doc(membersCollection, uid),
        data: {
          workerId: uid,
          name: String(person.name || "").slice(0, 80),
          employeeNumber: String(person.employeeNumber || ""),
          nearestStation: String(person.nearestStation || "").slice(0, 80),
          branchId: data.branchId,
          updatedAt: serverTimestamp()
        }
      });
    });
  }
  for (let index = 0; index < operations.length; index += 8) {
    const profileBatch = writeBatch(db);
    operations.slice(index, index + 8).forEach(operation => {
      if (operation.type === "delete") profileBatch.delete(operation.ref);
      else profileBatch.set(operation.ref, operation.data);
    });
    await profileBatch.commit();
  }
}

async function backfillConfirmedMemberProfiles() {
  const branchId = effectiveBranchId(currentRole);
  if (branchId === ALL_BRANCHES) return;
  const [shiftSnapshot, usersSnapshot] = await Promise.all([
    getDocs(query(collection(db, "shiftGroups"), where("branchId", "==", branchId), where("status", "==", "confirmed"))),
    getDocs(query(collection(db, "users"), where("branchId", "==", branchId)))
  ]);
  const users = new Map(usersSnapshot.docs.map(item => [item.id, { uid: item.id, ...item.data() }]));
  for (const shiftDocument of shiftSnapshot.docs) {
    const shift = normalizeGroup(shiftDocument.data());
    const existing = await getDocs(query(
      collection(db, "shiftMemberProfiles", shiftDocument.id, "members"),
      where("branchId", "==", branchId)
    ));
    const existingIds = new Set(existing.docs.map(item => item.id));
    const missing = shift.memberUids.filter(uid => !existingIds.has(uid) && users.has(uid));
    for (let index = 0; index < missing.length; index += 8) {
      const batch = writeBatch(db);
      missing.slice(index, index + 8).forEach(uid => {
        const person = users.get(uid);
        batch.set(doc(db, "shiftMemberProfiles", shiftDocument.id, "members", uid), {
          workerId: uid,
          name: String(person.name || "").slice(0, 80),
          employeeNumber: String(person.employeeNumber || ""),
          nearestStation: String(person.nearestStation || "").slice(0, 80),
          branchId,
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }
  }
}

function normalizeGroup(group) {
  const memberUids = [...new Set([
    ...(Array.isArray(group.memberUids) ? group.memberUids : []),
    ...(group.leaderUid ? [group.leaderUid] : [])
  ])];
  return {
    ...group,
    title: group.title || "",
    clientName: group.clientName || "",
    address: group.address || "",
    meetingPlace: group.meetingPlace || "",
    meetingTime: group.meetingTime || "",
    startTime: group.startTime || "",
    departureCheckTime: group.departureCheckTime || "",
    endTime: group.endTime || "",
    note: group.note || "",
    leaderUid: group.leaderUid || null,
    memberUids,
    requiredMembers: Number.isInteger(group.requiredMembers) ? group.requiredMembers : null
  };
}

function moveDay(amount) {
  const [year, month, day] = el.shiftBuilderDate.value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  el.shiftBuilderDate.value = localKey(date);
  renderGroups();
}

function localKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatUpdatedAt(value) {
  const date = value?.toDate?.();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "更新日時を取得中";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function normalizeStartTime(value, defaultHour) {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value || "");
  if (!match) return [defaultHour, "00"];
  const minute = Number(match[2]);
  const allowed = ["00", "15", "30", "45"];
  const closest = allowed.reduce((best, item) =>
    Math.abs(Number(item) - minute) < Math.abs(Number(best) - minute) ? item : best
  );
  return [match[1], closest];
}

function closeRequiredMembersOptions() {
  el.requiredMembersOptions.hidden = true;
  el.requiredMembersPickerButton.setAttribute("aria-expanded", "false");
}

function nameOf(uid) {
  return profileNames.get(uid) || candidates.find(item => item.uid === uid)?.name || uid || "未選択";
}

function safe(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function button(label, handler) {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = label;
  item.addEventListener("click", handler);
  return item;
}
