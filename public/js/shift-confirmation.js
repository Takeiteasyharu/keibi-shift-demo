import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { createMapAddressLink, createMapButton } from "./map-link.js";
import { branchName } from "./branches.js";
import { createSelfProgressSection } from "./shift-progress.js?v=20260803-1";

let el;
let navigate;
let currentProfile;
let unsubscribe = null;
let upcomingShifts = [];
let pastShifts = [];
let pastVisibleCount = 20;
const progressByShiftId = new Map();
let observerVersion = 0;

export function initShiftConfirmation(elements, showScreen) {
  el = elements;
  navigate = showScreen;
  el.closeOwnShiftDetailButton.addEventListener("click", closeDetail);
  el.closeShiftMembersButton.addEventListener("click", closeMembers);
  el.loadMorePastShiftsButton.addEventListener("click", async () => {
    pastVisibleCount += 20;
    await loadVisibleProgress();
    render();
  });
  el.ownShiftDetailModal.addEventListener("click", event => {
    if (event.target === el.ownShiftDetailModal) closeDetail();
  });
  el.shiftMembersModal.addEventListener("click", event => {
    if (event.target === el.shiftMembersModal) closeMembers();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (el.shiftMembersModal.classList.contains("show")) closeMembers();
    else if (el.ownShiftDetailModal.classList.contains("show")) closeDetail();
  });
}

export function showOwnShifts(profile) {
  const version = ++observerVersion;
  currentProfile = profile;
  pastVisibleCount = 20;
  progressByShiftId.clear();
  navigate("ownShifts");
  el.ownShiftsMessage.textContent = "自分の確定シフトを読み込んでいます。";
  el.ownShiftsMessage.className = "message show";
  el.ownShiftsList.replaceChildren();
  el.pastShiftsList.replaceChildren();
  el.loadMorePastShiftsButton.hidden = true;
  unsubscribe?.();
  const ownQuery = query(collection(db, "shiftGroups"),
    where("status", "==", "confirmed"),
    where("memberUids", "array-contains", profile.uid));
  unsubscribe = onSnapshot(ownQuery, async snapshot => {
    if (version !== observerVersion || currentProfile?.uid !== profile.uid) return;
    closeMembers();
    const today = toDateKey(new Date());
    const all = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.status === "confirmed" && Array.isArray(item.memberUids)
        && item.memberUids.includes(profile.uid));
    upcomingShifts = all.filter(item => item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
    pastShifts = all.filter(item => item.date < today)
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.startTime).localeCompare(String(a.startTime)));
    await loadVisibleProgress();
    if (version !== observerVersion || currentProfile?.uid !== profile.uid) return;
    el.ownShiftsMessage.className = "message";
    render();
  }, error => {
    if (version !== observerVersion || currentProfile?.uid !== profile.uid) return;
    console.error(error);
    el.ownShiftsMessage.textContent = "シフトを読み込めませんでした。通信状態を確認してください。";
    el.ownShiftsMessage.className = "message show error";
  });
}

export function stopOwnShiftsObserver() {
  observerVersion += 1;
  unsubscribe?.();
  unsubscribe = null;
  upcomingShifts = [];
  pastShifts = [];
  progressByShiftId.clear();
  currentProfile = null;
}

async function loadVisibleProgress() {
  if (!currentProfile?.uid) return;
  const targets = [...upcomingShifts, ...pastShifts.slice(0, pastVisibleCount)]
    .filter(shift => !progressByShiftId.has(shift.id));
  const results = await Promise.all(targets.map(async shift => {
    try {
      const snapshot = await getDoc(doc(db, "shiftProgress", shift.id, "workers", currentProfile.uid));
      return [shift.id, snapshot.data() || {}];
    } catch (error) {
      console.warn("シフトの上番状況を取得できませんでした", { shiftId: shift.id, code: error?.code });
      return [shift.id, {}];
    }
  }));
  results.forEach(([shiftId, progress]) => progressByShiftId.set(shiftId, progress));
}

function render() {
  el.ownShiftsList.replaceChildren();
  el.pastShiftsList.replaceChildren();
  renderShiftList(el.ownShiftsList, upcomingShifts, false);
  renderShiftList(el.pastShiftsList, pastShifts.slice(0, pastVisibleCount), true);
  el.loadMorePastShiftsButton.hidden = pastVisibleCount >= pastShifts.length;
}

function renderShiftList(container, items, isPast) {
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "own-shifts-empty";
    empty.textContent = isPast ? "過去の確定シフトはありません。" : "今後の確定シフトはありません。";
    container.appendChild(empty);
    return;
  }
  items.forEach((shift, index) => {
    const card = document.createElement("article");
    card.className = `own-shift-card ${isPast ? "is-past" : ""} shift-${shift.shiftType === "night" ? "night" : "day"}`;
    if (!isPast && index === 0) {
      const next = document.createElement("div");
      next.className = "next-shift-label";
      next.textContent = "次回の勤務";
      card.appendChild(next);
    }
    const heading = document.createElement("div");
    heading.className = "own-shift-heading";
    const date = document.createElement("strong");
    date.textContent = formatDate(shift.date);
    const type = document.createElement("span");
    type.className = "own-shift-type";
    type.textContent = shift.shiftType === "night" ? "夜勤" : "日勤";
    heading.append(date, type);
    const title = document.createElement("h2");
    title.textContent = valueOrUnset(shift.title);
    const summary = document.createElement("div");
    summary.className = "own-shift-summary";
    const summaryAddress = detailLine("現場", "");
    summaryAddress.lastChild.replaceWith(createMapAddressLink(shift.address));
    summary.append(
      summaryAddress,
      detailLine("集合・開始", shift.meetingTime || shift.startTime),
      detailLine("勤務時間", timeRange(shift)),
      detailLine("役割", roleLabel(shift)),
      detailLine("所属支社", branchName(shift.branchId)),
      detailLine("上番状況", progressLabel(progressByShiftId.get(shift.id))),
      detailLine("最終更新", formatTimestamp(shift.updatedAt))
    );
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "詳細を見る";
    button.addEventListener("click", () => openDetail(shift));
    const mapButton = createMapButton(shift.address);
    card.append(heading, title, summary, mapButton, button);
    if (!isPast && shift.leaderUid === currentProfile.uid) {
      const membersButton = document.createElement("button");
      membersButton.type = "button";
      membersButton.className = "leader-members-button";
      membersButton.textContent = "隊員を確認";
      membersButton.addEventListener("click", () => openMembers(shift));
      card.appendChild(membersButton);
    }
    container.appendChild(card);
  });
}

function progressLabel(progress = {}) {
  if (progress.arrivedAt) return `上番済み ${formatTimestamp(progress.arrivedAt)}`;
  if (progress.departedAt) return `出発済み ${formatTimestamp(progress.departedAt)}`;
  if (progress.departureAcknowledgedAt) return `出発確認済み ${formatTimestamp(progress.departureAcknowledgedAt)}`;
  return "未上番";
}

async function openDetail(shift) {
  el.ownShiftDetailTitle.textContent = `${formatDate(shift.date)} ${shift.shiftType === "night" ? "夜勤" : "日勤"}`;
  const addressRow = detailLine("現場", "");
  addressRow.lastChild.replaceWith(createMapAddressLink(shift.address));
  addressRow.appendChild(createMapButton(shift.address));
  el.ownShiftDetailBody.replaceChildren(
    detailLine("グループタイトル", shift.title),
    detailLine("得意先", shift.clientName),
    addressRow,
    detailLine("集合場所", shift.meetingPlace),
    detailLine("集合時刻", shift.meetingTime),
    detailLine("勤務予定", timeRange(shift)),
    detailLine("役割", roleLabel(shift)),
    detailLine("所属支社", branchName(shift.branchId)),
    detailLine("上番状況", progressLabel(progressByShiftId.get(shift.id))),
    detailLine("備考", shift.note),
    detailLine("最終更新", formatTimestamp(shift.updatedAt))
  );
  if (shift.date >= toDateKey(new Date()) && shift.leaderUid === currentProfile.uid) {
    const membersButton = document.createElement("button");
    membersButton.type = "button";
    membersButton.className = "leader-members-button";
    membersButton.textContent = "隊員を確認";
    membersButton.addEventListener("click", () => openMembers(shift));
    el.ownShiftDetailBody.appendChild(membersButton);
  }
  el.ownShiftDetailBody.appendChild(await createSelfProgressSection(shift, currentProfile));
  el.ownShiftDetailModal.classList.add("show");
  requestAnimationFrame(() => el.closeOwnShiftDetailButton.focus());
}

function closeDetail() {
  el.ownShiftDetailModal.classList.remove("show");
}

async function openMembers(shift) {
  if (shift.status !== "confirmed" || shift.leaderUid !== currentProfile.uid) return;
  el.shiftMembersTitle.textContent = `${formatDate(shift.date)} ${shift.shiftType === "night" ? "夜勤" : "日勤"}`;
  el.shiftMembersSummary.textContent =
    `${valueOrUnset(shift.title)}\n配置人数：${shift.memberUids.length}名\n隊長：1名\n隊員：${Math.max(0, shift.memberUids.length - 1)}名`;
  el.shiftMembersList.innerHTML = '<div class="panel">隊員情報を読み込んでいます。</div>';
  el.shiftMembersModal.classList.add("show");
  try {
    const snapshots = await Promise.all(shift.memberUids.map(async uid => ({
      profile: await getDoc(doc(db, "shiftMemberProfiles", shift.id, "members", uid)),
      progress: await getDoc(doc(db, "shiftProgress", shift.id, "workers", uid))
    })));
    el.shiftMembersList.replaceChildren();
    snapshots.forEach(item => {
      if (!item.profile.exists()) return;
      const member = item.profile.data();
      const progress = item.progress.data() || {};
      const card = document.createElement("article");
      card.className = "shift-member-card";
      const name = document.createElement("h3");
      name.textContent = member.name || "氏名未設定";
      const role = document.createElement("strong");
      role.className = member.workerId === shift.leaderUid ? "member-role leader" : "member-role";
      role.textContent = member.workerId === shift.leaderUid ? "隊長" : "隊員";
      const details = document.createElement("div");
      details.textContent = `警備員番号：${member.employeeNumber || "未設定"}\n最寄り駅：${member.nearestStation || "未設定"}\n` +
        `進捗：${progress.arrivedAt ? "到着済" : progress.departedAt ? "出発済" : "未出発"}`;
      card.append(name, role, details);
      el.shiftMembersList.appendChild(card);
    });
    if (!el.shiftMembersList.childElementCount) {
      el.shiftMembersList.innerHTML = '<div class="panel">隊員情報がまだ準備されていません。内勤者へお問い合わせください。</div>';
    }
  } catch (error) {
    console.error(error);
    el.shiftMembersList.innerHTML = '<div class="message show error">隊員情報を確認できませんでした。シフトが変更された可能性があります。</div>';
  }
}

function closeMembers() {
  el.shiftMembersModal.classList.remove("show");
}

function detailLine(label, value, valueClass = "") {
  const row = document.createElement("div");
  row.className = "own-shift-detail-row";
  const term = document.createElement("strong");
  term.textContent = `${label}：`;
  const content = document.createElement("span");
  content.className = valueClass;
  content.textContent = valueOrUnset(value);
  row.append(term, content);
  return row;
}

function roleLabel(shift) {
  return shift.leaderUid === currentProfile.uid ? "隊長" : "隊員";
}

function timeRange(shift) {
  const start = shift.startTime || "未設定";
  const end = shift.endTime || "未設定";
  return `${start} ～ ${end}`;
}

function valueOrUnset(value) {
  const text = String(value ?? "").trim();
  return text || "未設定";
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}月${day}日（${"日月火水木金土"[date.getDay()]}）`;
}

function formatTimestamp(value) {
  const date = value?.toDate?.();
  if (!date) return "未設定";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}時${String(date.getMinutes()).padStart(2, "0")}分`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
