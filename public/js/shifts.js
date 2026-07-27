import { db } from "./firebase-config.js";
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

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

export async function loadOwnConfirmedShifts(uid) {
  const base = collection(db, "shiftGroups");
  const [memberSnapshot, legacyLeaderSnapshot] = await Promise.all([
    getDocs(query(base, where("status", "==", "confirmed"), where("memberUids", "array-contains", uid))),
    getDocs(query(base, where("status", "==", "confirmed"), where("leaderUid", "==", uid)))
  ]);
  return [...new Map(
    [...memberSnapshot.docs, ...legacyLeaderSnapshot.docs].map(item => [item.id, { id: item.id, ...item.data() }])
  ).values()];
}

export function initShifts(elements, showScreen, notify) {
  el = elements;
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
    setCandidatesExpanded(!candidatesExpanded);
    renderCandidates();
  });
  el.showOutsideAvailability.addEventListener("change", () => {
    if (el.showOutsideAvailability.checked) setCandidatesExpanded(true);
    renderCandidates();
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
  const groupQuery = query(
    collection(db, "shiftGroups"),
    where("branchId", "==", currentRole.branchId),
    where("date", "==", el.shiftBuilderDate.value),
    where("shiftType", "==", type())
  );
  const [groupSnapshot, profileSnapshot] = await Promise.all([
    getDocs(groupQuery),
    getDocs(query(collection(db, "users"), where("branchId", "==", currentRole.branchId)))
  ]);
  groups = groupSnapshot.docs.map(item => normalizeGroup({ id: item.id, ...item.data() }));
  profileNames = new Map(profileSnapshot.docs.map(item => [item.id, item.data().name]));
  el.shiftGroupsList.replaceChildren();

  groups.forEach(group => {
    const issues = incompleteIssues(group);
    const card = document.createElement("article");
    card.className = `shift-group-card ${issues.length ? "incomplete" : "complete"}`;
    const visibleIssues = issues.slice(0, 3);
    const remaining = issues.length - visibleIssues.length;
    card.innerHTML = `
      <div class="group-card-heading">
        <h2>${safe(group.title || "名称未入力のグループ")}</h2>
        <span class="completion-badge ${issues.length ? "is-incomplete" : "is-complete"}">${issues.length ? "未完成" : "入力完了"}</span>
      </div>
      <div>${safe(group.address || "現場住所未入力")}</div>
      <div>勤務開始：${safe(displayStartTime(group.startTime) || "開始時刻未入力")}</div>
      <div>隊長：${safe(group.leaderUid ? nameOf(group.leaderUid) : "未選択")}　配置人数：${group.memberUids.length}人</div>
      <div>備考：${safe(group.note || "なし")}</div>
      ${issues.length ? `<div class="incomplete-summary"><strong>未入力項目があります</strong><ul>${visibleIssues.map(issue => `<li>${safe(issue)}</li>`).join("")}</ul>${remaining > 0 ? `<div>ほか${remaining}件</div>` : ""}</div>` : ""}
    `;
    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = button("編集", () => openEditor(group));
    const remove = button("削除", async () => {
      if (confirm("このグループを削除しますか？")) {
        await deleteDoc(doc(db, "shiftGroups", group.id));
        await renderGroups();
      }
    });
    remove.className = "danger";
    actions.append(edit, remove);
    card.appendChild(actions);
    el.shiftGroupsList.appendChild(card);
  });
  if (!groups.length) {
    el.shiftGroupsList.innerHTML = '<div class="panel">この日の作成済みグループはありません。</div>';
  }
}

async function openEditor(group = null) {
  const normalized = group ? normalizeGroup(group) : null;
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
  const branch = currentRole.branchId;
  const date = el.shiftBuilderDate.value;
  const [usersSnap, rolesSnap, availabilitySnap, groupsSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("branchId", "==", branch))),
    getDocs(query(collection(db, "userRoles"), where("branchId", "==", branch))),
    getDocs(query(collection(db, "availability"), where("branchId", "==", branch), where("date", "==", date))),
    getDocs(query(collection(db, "shiftGroups"), where("branchId", "==", branch), where("date", "==", date), where("shiftType", "==", type())))
  ]);
  const roles = new Map(rolesSnap.docs.map(item => [item.id, item.data()]));
  const availability = new Map(availabilitySnap.docs.map(item => [item.data().uid, item.data()]));
  const occupied = new Map();
  groupsSnap.docs.filter(item => item.id !== editingId).forEach(item => {
    normalizeGroup(item.data()).memberUids.forEach(uid => occupied.set(uid, item.data().title || "名称未入力のグループ"));
  });
  candidates = usersSnap.docs.map(item => {
    const role = roles.get(item.id);
    const wish = availability.get(item.id);
    return {
      uid: item.id,
      ...item.data(),
      active: role?.accountStatus === "active",
      wants: Boolean(wish?.[type()]),
      availabilityNote: String(wish?.note || ""),
      occupied: occupied.get(item.id) || ""
    };
  // 将来的に勤務可否は role ではなく shiftEligible などの専用属性で管理する。
  }).filter(person => person.active);
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
  label.append(input, document.createTextNode(
    `${person.name}／${person.employeeNumber}／${person.wants ? "希望あり" : "希望外"}／最寄り駅 ${person.nearestStation || "―"}`
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
    branchId: currentRole.branchId,
    title: el.shiftGroupTitle.value.trim(),
    clientName: "",
    address: el.shiftAddress.value.trim(),
    meetingPlace: "",
    meetingTime: "",
    startTime: `${el.shiftStartHour.value}:${el.shiftStartMinute.value}`,
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
  if (data.date < localKey(new Date())) {
    alert("過去の日付にはシフトを作成できません。");
    return;
  }
  if (data.requiredMembers !== null && (!Number.isInteger(data.requiredMembers) || data.requiredMembers < 1 || data.requiredMembers > 99)) {
    alert("必要人数は1～99人で入力してください。");
    return;
  }
  const requiredErrors = [];
  if (!data.title) requiredErrors.push("グループタイトル");
  if (!data.address) requiredErrors.push("現場住所");
  if (!data.startTime) requiredErrors.push("勤務開始時刻");
  if (data.requiredMembers === null) requiredErrors.push("必要人数");
  if (requiredErrors.length) {
    alert(`次の必須項目を入力してください。\n${requiredErrors.join("\n")}`);
    return;
  }
  const outside = candidates.filter(person => data.memberUids.includes(person.uid) && !person.wants);
  if (outside.length && !confirm("希望していない勤務帯の警備員が含まれます。それでも配置しますか？")) return;
  const issues = incompleteIssues(data);
  if (status === "confirmed" && issues.length &&
      !confirm(`未入力または未設定の項目があります。このまま確定しますか？\n\n${issues.join("\n")}`)) return;
  if (status === "confirmed" && !issues.length &&
      !confirm(`${data.date} ${data.shiftType === "day" ? "日勤" : "夜勤"}\n${data.title}\n${data.memberUids.length}名で確定しますか？`)) return;

  if (editingId) {
    await updateDoc(doc(db, "shiftGroups", editingId), { ...data, updatedAt: serverTimestamp() });
  } else {
    await addDoc(collection(db, "shiftGroups"), {
      ...data,
      createdBy: currentProfile.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  closeEditor();
  notify(status === "confirmed" ? "シフトを確定しました。" : "下書きを保存しました。");
  await renderGroups();
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
